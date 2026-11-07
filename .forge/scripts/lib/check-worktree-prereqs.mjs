#!/usr/bin/env node
// check-worktree-prereqs (issue #81) — enumera de UMA VEZ os pré-requisitos de árvore (deps
// instaladas, artefato de build declarado) que o pre-push depende mas não produz, em vez de
// revelar um por gate/ciclo.
//
// Custo medido em campanha real (axis-go-cloud, PR #272): 9 tentativas de push, ZERO bloqueadas
// por defeito de código — 5 por node_modules ausente, 2 por typecheck falhando pela mesma raiz,
// 1 por árvore em check-out diferente da empurrada, 1 por timeout. A cadeia tinha quatro degraus e
// cada um só apareceu depois que o anterior saiu: quem estima "falta só isso" a partir do primeiro
// bloqueio subestima por construção, porque os degraus 3 e 4 eram INVISÍVEIS enquanto o 1
// bloqueava. Cada ciclo de descoberta custou ~70min (exercita as suítes de todos os serviços que o
// diff alcança).
//
// Este script NUNCA executa suíte, install ou build — só `existsSync`/`readFileSync` sobre o que
// já está no disco. É a propriedade que mantém o preflight mais barato que o hook que ele
// antecede: enumerar "o que falta" custa stat(2), produzir "o que falta" custa minutos.
//
// O conjunto de artefatos é DERIVADO de pnpm-workspace.yaml e dos campos main/module/types/exports
// de cada package.json de workspace — nunca hardcoded por projeto (issue #81, "Por que isso é do
// template"). Duas categorias, cada workspace package contribui no máximo uma vez a cada uma:
//
//   1. deps (node_modules) — root, se package.json declarar dependencies/devDependencies, e cada
//      workspace do pnpm-workspace.yaml que declarar as suas. Um único `pnpm install` resolve
//      root + todos os workspaces de uma vez (pnpm hoisting), então é reportado como UM item com
//      a lista de diretórios afetados — não N itens com o mesmo remédio repetido.
//   2. build (dist/main/types ausente) — só para workspace com script "build" em package.json E
//      >=1 campo main/module/types/exports resolvendo para um caminho que não existe. Workspace
//      sem script "build" não entra: não há artefato derivável a cobrar (evita ruído — property 3
//      do design: "todos presentes -> rc=0", e gate que produz ruído ensina a ser ignorado).
//
// Property 5 (achada contra a árvore real do axis-go-cloud, onde o script cobrava
// packages/dotnet e packages/nuget-vendored — de outra stack): diretório casado pelo glob de
// pnpm-workspace.yaml que NÃO TEM package.json não é workspace pnpm — ignorado silenciosamente,
// nunca contado como pendência.
//
// Usage: check-worktree-prereqs.mjs --path <dir>
// Saída: nada + exit 0 quando tudo presente; lista numerada (cada item com o comando que o
// produz) + exit 1 na primeira ausência — mas TODAS as ausências da mesma categoria e de todas as
// categorias aparecem na mesma execução, nunca uma por vez.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseYamlSubset } from './yaml-lite.mjs';

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// Só o formato dominante em pnpm-workspace.yaml: prefixo literal + "/*" (um nível), diretório
// literal sem glob, ou negação ("!...", ignorada — nunca vira workspace positivo). Glob mais
// profundo (múltiplos "*") é limitação conhecida e documentada — não derruba o script: apenas não
// expande essa entrada (nunca falso-positivo por entrada não suportada).
function expandGlob(root, glob) {
  if (!glob || glob.startsWith('!')) return [];
  if (!glob.includes('*')) {
    const p = join(root, glob);
    return isDir(p) ? [p] : [];
  }
  if (!glob.endsWith('/*') || glob.slice(0, -2).includes('*')) return [];
  const base = join(root, glob.slice(0, -2));
  if (!isDir(base)) return [];
  return readdirSync(base).map((name) => join(base, name)).filter(isDir);
}

// Workspaces pnpm candidatos: expandidos do glob e FILTRADOS por ter package.json (property 5).
function pnpmWorkspaceDirs(root) {
  const wsFile = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(wsFile)) return [];
  let doc;
  try { doc = parseYamlSubset(readFileSync(wsFile, 'utf8')); } catch { return []; }
  const globs = Array.isArray(doc.packages) ? doc.packages : [];
  const seen = new Set();
  const dirs = [];
  for (const g of globs) {
    if (typeof g !== 'string') continue;
    for (const dir of expandGlob(root, g)) {
      if (seen.has(dir)) continue;
      seen.add(dir);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

function installCommandFor(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm install --prefer-offline';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm ci';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn install --frozen-lockfile';
  return 'pnpm install --prefer-offline'; // pnpm-workspace.yaml presente sem lockfile identificável
}

function declaresDeps(pkg) {
  return Boolean(pkg && (pkg.dependencies || pkg.devDependencies || pkg.peerDependencies));
}

// Caminhos de saída de build que o próprio package.json declara (main/module/types + folhas de
// "exports"). Entradas com "*" (subpath patterns) não são resolvíveis sem um arquivo real — nunca
// avaliadas, para não virar falso-positivo por padrão não resolvido.
function declaredOutputs(pkg) {
  const out = [];
  for (const f of ['main', 'module', 'types']) if (typeof pkg[f] === 'string') out.push(pkg[f]);
  const walk = (v) => {
    if (typeof v === 'string') { if (!v.includes('*')) out.push(v); }
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k]);
  };
  if (pkg.exports) walk(pkg.exports);
  return [...new Set(out)];
}

export function collectMissing(root) {
  const missing = [];

  const rootPkg = readJSON(join(root, 'package.json'));
  const wsDirs = pnpmWorkspaceDirs(root);

  // ── categoria 1: dependências instaladas (root + workspaces, um remédio só) ──
  const needsDeps = [];
  if (declaresDeps(rootPkg) && !existsSync(join(root, 'node_modules'))) needsDeps.push('.');
  for (const dir of wsDirs) {
    const pkg = readJSON(join(dir, 'package.json'));
    if (declaresDeps(pkg) && !existsSync(join(dir, 'node_modules'))) needsDeps.push(relative(root, dir));
  }
  if (needsDeps.length) {
    missing.push({
      label: `dependências não instaladas: ${needsDeps.join(', ')}`,
      remedy: installCommandFor(root),
    });
  }

  // ── categoria 2: build declarado e não produzido, por workspace ──
  for (const dir of wsDirs) {
    const pkg = readJSON(join(dir, 'package.json'));
    if (!pkg || !pkg.scripts || !pkg.scripts.build) continue;
    const outputs = declaredOutputs(pkg);
    if (!outputs.length) continue;
    const absent = outputs.filter((rel) => !existsSync(join(dir, rel)));
    if (!absent.length) continue;
    const name = pkg.name || relative(root, dir);
    missing.push({
      label: `workspace '${name}' (${relative(root, dir)}) não buildado — ausente: ${absent.join(', ')}`,
      remedy: `pnpm --filter ${name} build`,
    });
  }

  return missing;
}

function main() {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--path');
  if (pi === -1 || !args[pi + 1]) {
    console.error('FAIL (usage: check-worktree-prereqs.mjs --path <dir>)');
    process.exit(1);
  }
  const root = args[pi + 1];
  const missing = collectMissing(root);
  if (!missing.length) process.exit(0);
  console.log(`pré-condições de worktree ausentes (${missing.length}) — cada item com o comando que o produz:`);
  missing.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.label}`);
    console.log(`     -> ${m.remedy}`);
  });
  process.exit(1);
}

main();
