#!/usr/bin/env node
// plugin-build — gera o plugin Claude Code "forge" a partir de .forge/commands/**.
//
// Por que um plugin: o Claude Code (>= 2.x) descontinuou o namespace via subdiretório
// em `.claude/commands/` — `/forge:<cmd>` só existe quando os comandos vêm de um PLUGIN
// cujo manifesto tem `name: forge` (o `:` namespace é exclusivo de plugins). Fonte única:
// os MESMOS .md de `.forge/commands/**` que alimentam os adapters (sync-adapters.mjs).
//
// Camadas:
//   - plugin (global, ~/.claude ou marketplace) → fornece os slash commands /forge:*
//   - npx forge-harness init (.forge/ por projeto) → fornece o engine/estado que os
//     comandos chamam (.forge/scripts/...). As duas se complementam.
//
// Determinista: sem timestamps; ordem de comandos estável (localeCompare); gerar 2x é
// byte-idêntico. Dependency-free (roda em projetos sem node_modules). As funções de plano
// (collectCommands/manifest/planForgePlugin) são PURAS — sem I/O — para serem reusadas pelo
// wrapper do harness, pelo bin/forge.mjs (npx) e pelo build de distribuição (marketplace).

import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, rmSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';

const PLUGIN_DESCRIPTION =
  'Forge Project Harness — slash commands /forge:* (SDD spec lifecycle, waves, code graph, ' +
  'docs/ADRs, harness). O engine .forge/ por projeto vem do instalador (npx forge-harness init).';

// Nomes que o Claude Code reserva: um comando chamado exatamente assim, dentro de um plugin,
// COLIDE com a infra de skills e faz o plugin INTEIRO não carregar (silenciosamente — o CLI até
// lista o comando, mas a sessão não expõe nenhum /forge:*). Descoberto por bissecção com `skill`.
const RESERVED_COMMAND_NAMES = new Set(['skill']);

// ── coleta (I/O) ─────────────────────────────────────────────────────────────
// Lê todos os comandos .md de commandsDir (recursivo), exceto README.md, e os achata.
export function collectCommands(commandsDir) {
  const found = [];
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      if (e === '.DS_Store') continue;
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.md') && e !== 'README.md') found.push(p);
    }
  };
  if (existsSync(commandsDir)) walk(commandsDir);
  return found.map((p) => ({ name: basename(p), content: readFileSync(p, 'utf8'), src: p }));
}

// ── manifesto (puro) ─────────────────────────────────────────────────────────
export function manifest({ version, name = 'forge' }) {
  return {
    name,
    description: PLUGIN_DESCRIPTION,
    version,
    author: { name: 'Milton Antonio da Silva Jr' },
    homepage: 'https://github.com/vellus-tech/forge-harness',
  };
}

// ── plano do plugin (puro) ───────────────────────────────────────────────────
// commands: [{ name, content, src? }] → [{ rel, content }] (sem I/O). Lança em colisão
// de basename (os comandos do forge têm nomes únicos; um conflito é erro de fonte).
export function planForgePlugin({ commands, version, name = 'forge' }) {
  const files = [{
    rel: '.claude-plugin/plugin.json',
    content: JSON.stringify(manifest({ version, name }), null, 2) + '\n',
  }];
  const seen = new Map();
  for (const c of commands.slice().sort((a, b) => a.name.localeCompare(b.name))) {
    if (seen.has(c.name)) {
      throw new Error(`colisão de comando '${c.name}' (${c.src ?? '?'} vs ${seen.get(c.name)})`);
    }
    const bare = c.name.replace(/\.md$/, '');
    if (RESERVED_COMMAND_NAMES.has(bare)) {
      throw new Error(
        `comando '${bare}' usa um nome reservado pelo Claude Code (${c.src ?? c.name}) — ` +
        `derrubaria o carregamento do plugin inteiro. Renomeie (ex.: '${bare}-lifecycle').`);
    }
    seen.set(c.name, c.src ?? c.name);
    files.push({ rel: `commands/${c.name}`, content: c.content });
  }
  return files;
}

// ── escrita (I/O) ────────────────────────────────────────────────────────────
// Limpa apenas o subconjunto que geramos (commands/ + .claude-plugin/plugin.json),
// preservando o resto de um skills-dir compartilhado.
export function writePlugin(outDir, files) {
  const cmdOut = join(outDir, 'commands');
  if (existsSync(cmdOut)) rmSync(cmdOut, { recursive: true, force: true });
  for (const f of files) {
    const dest = join(outDir, f.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content);
  }
}

// ── resolução de versão ──────────────────────────────────────────────────────
// --version explícito > package.json (repo do harness) > forge.yaml template_version > 0.0.0
export function resolveVersion(root) {
  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) {
    try { const v = JSON.parse(readFileSync(pkg, 'utf8')).version; if (v) return v; } catch { /* ignore */ }
  }
  const fy = join(root, '.forge', 'forge.yaml');
  if (existsSync(fy)) {
    const m = readFileSync(fy, 'utf8').match(/template_version:\s*"?([^"\n]+)"?/);
    if (m) return m[1].trim();
  }
  return '0.0.0';
}

const expandHome = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : p);

// ── CLI ──────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
  };
  const root = arg('root', process.cwd());
  const commandsDir = expandHome(arg('commands', join(root, '.forge/commands')));
  const out = expandHome(arg('out', join(homedir(), '.claude/skills/forge')));
  const version = arg('version', resolveVersion(root));
  const name = arg('name', 'forge');

  if (!existsSync(commandsDir)) {
    console.error(`FAIL (no commands dir at ${commandsDir} — run from a project with .forge/ or pass --commands)`);
    process.exit(1);
  }
  let files;
  try {
    files = planForgePlugin({ commands: collectCommands(commandsDir), version, name });
  } catch (err) {
    console.error(`FAIL (${err.message})`);
    process.exit(1);
  }
  writePlugin(out, files);
  console.log(`OK plugin '${name}' v${version} → ${out}`);
  console.log(`   ${files.length - 1} comandos /${name}:* (de ${commandsDir})`);

  // O marketplace declara a versão do plugin publicado e precisa acompanhar o package.json. Era
  // passo manual, e passo manual atrelado a bump é passo esquecido: um release saiu com o
  // marketplace uma versão atrás, e quem descobriu foi o gate — depois da tag já cortada e
  // publicada. Sincronizar aqui elimina a classe, em vez de confiar em alguém lembrar.
  syncMarketplace(root, version, name);
}

function syncMarketplace(root, version, name) {
  const mpPath = join(root, '.claude-plugin/marketplace.json');
  if (!existsSync(mpPath)) return;
  let mp;
  try { mp = JSON.parse(readFileSync(mpPath, 'utf8')); } catch { return; }
  const entry = (mp.plugins || []).find((p) => p.name === name) || (mp.plugins || [])[0];
  if (!entry || entry.version === version) return;
  const before = entry.version;
  entry.version = version;
  writeFileSync(mpPath, JSON.stringify(mp, null, 2) + '\n');
  console.log(`   marketplace: ${before} → ${version}`);
}
