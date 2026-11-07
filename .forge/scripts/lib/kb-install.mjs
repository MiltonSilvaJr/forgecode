// kb-install — ÚNICO módulo da busca unificada (/forge:kb) que acessa a rede. Carregado só por
// `kb.sh semantic install`; nenhum outro subcomando, hook, `doctor.sh` ou instalador o importa (gate
// estático). Instala a camada semântica sob `.forge/kb/semantic/` a partir dos pins da maquinaria
// (lib/kb-pins/), e só ativa a camada (grava installed.json) depois de tudo conferir.
//
// Defesas, nesta ordem:
//   1. runtime npm por `npm ci --ignore-scripts` contra o package-lock.json dos pins — versão exata e
//      `integrity` sha512 de cada pacote; nenhum script de instalação roda (o único da árvore é o
//      postinstall de protobufjs, uma checagem de versão);
//   2. varredura de binário nativo (extensão e assinatura Mach-O/ELF/PE) — achou, desfaz tudo;
//   3. cada arquivo de modelo baixado da URL fixada (https, ou http só para loopback de teste) para um
//      `.part`, conferido por sha256 e tamanho, e só então renomeado — divergiu, apaga e aborta;
//   4. installed.json por último, com o hash dos pins usados.
import { mkdirSync, rmSync, copyFileSync, renameSync, writeFileSync, readFileSync, existsSync, createWriteStream, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { findNative, pinsHash } from './kb-integrity.mjs';

const say = (m) => process.stdout.write(`${m}\n`);
const err = (m) => process.stderr.write(`kb: ${m}\n`);

export function urlAllowed(u) {
  let url; try { url = new URL(u); } catch { return false; }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
}

async function download(url, dest, expectSha, expectSize) {
  const part = `${dest}.part`;
  mkdirSync(dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download falhou (${res.status}) — ${url}`);
  const h = createHash('sha256'); let size = 0;
  const out = createWriteStream(part);
  // pipeline() (node:stream/promises) propaga erro de E/S do destino (ENOSPC/EACCES/EIO) como
  // rejeição de Promise — escrita manual com out.write()/out.once('drain') deixa esse erro só
  // como evento 'error' do EventEmitter, fora da cadeia de await, e derruba o processo (NOD-001).
  try {
    await pipeline(res.body, async function* hashThrough(source) {
      for await (const chunk of source) { h.update(chunk); size += chunk.length; yield chunk; }
    }, out);
  } catch (e) {
    rmSync(part, { force: true });
    throw new Error(`falha de E/S ao baixar ${dest.split('/').slice(-2).join('/')}: ${e.message}`);
  }
  const got = h.digest('hex');
  if (got !== expectSha || (expectSize && size !== expectSize)) { rmSync(part, { force: true }); throw new Error(`integridade divergente em ${dest.split('/').slice(-2).join('/')}: sha256 ${got.slice(0, 12)}… (esperado ${expectSha.slice(0, 12)}…), ${size} bytes (esperado ${expectSize})`); }
  renameSync(part, dest);
}

export async function install(semDir, pinsDir) {
  let models, lock, pkg;
  try {
    models = JSON.parse(readFileSync(join(pinsDir, 'models.json'), 'utf8'));
    lock = JSON.parse(readFileSync(join(pinsDir, 'package-lock.json'), 'utf8'));
    pkg = JSON.parse(readFileSync(join(pinsDir, 'package.json'), 'utf8'));
  } catch (e) { err(`pins ilegíveis em ${pinsDir}: ${e.message}`); return 1; }
  const files = ['embedder', 'reranker'].flatMap((r) => (models[r]?.files || []).map((f) => ({ ...f, roleOf: r })));
  for (const f of files) if (!urlAllowed(f.url)) { err(`URL recusada nos pins (só https, ou http para loopback): ${f.url}`); return 1; }
  const total = files.reduce((a, f) => a + (f.size || 0), 0);
  say('kb semantic install — vai baixar e instalar, sob .forge/kb/semantic/:');
  say(`  runtime npm: ${Object.entries(pkg.dependencies || {}).map(([k, v]) => `${k}@${v}`).join(', ')} (registry npm, lockfile com integrity; ~150 MB descompactado)`);
  for (const f of files) say(`  ${f.roleOf}/${f.role}: ${f.url} (${(f.size / 1e6).toFixed(1)} MB)`);
  say(`  modelos: ${(total / 1e6).toFixed(0)} MB no total. Nada disso roda fora desta máquina; a busca nunca acessa a rede.`);

  const npm = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  if (npm.error || npm.status !== 0) { err('npm não encontrado no PATH — a camada semântica precisa do npm para instalar o runtime fixado (nada foi ativado)'); return 1; }

  rmSync(join(semDir, 'installed.json'), { force: true });
  const runtimeDir = join(semDir, 'runtime');
  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });
  copyFileSync(join(pinsDir, 'package.json'), join(runtimeDir, 'package.json'));
  copyFileSync(join(pinsDir, 'package-lock.json'), join(runtimeDir, 'package-lock.json'));
  const ci = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: runtimeDir, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  if (ci.status !== 0) { err('npm ci falhou — nada foi ativado'); rmSync(runtimeDir, { recursive: true, force: true }); return 1; }
  const native = findNative(semDir);
  if (native.length) { err(`binário nativo encontrado após npm ci (${native[0]}) — instalação desfeita`); rmSync(semDir, { recursive: true, force: true }); return 1; }
  const versions = {};
  for (const [key, meta] of Object.entries(lock.packages || {})) {
    if (!key) continue;
    let v; try { v = JSON.parse(readFileSync(join(runtimeDir, key, 'package.json'), 'utf8')).version; } catch { v = null; }
    if (v !== meta.version) { err(`pacote ${key} ausente ou em versão divergente após npm ci — instalação desfeita`); rmSync(semDir, { recursive: true, force: true }); return 1; }
    if (key.split('node_modules/').length === 2) versions[key.replace(/^node_modules\//, '')] = v;
  }
  try {
    for (const f of files) {
      const dest = join(semDir, 'models', f.path);
      if (existsSync(dest) && statSync(dest).size === f.size && createHash('sha256').update(readFileSync(dest)).digest('hex') === f.sha256) { say(`  já presente e íntegro: ${f.path}`); continue; }
      say(`  baixando ${f.path}…`);
      await download(f.url, dest, f.sha256, f.size);
    }
  } catch (e) { err(`${e.message} — nada foi ativado`); return 1; }
  writeFileSync(join(semDir, 'installed.json'), JSON.stringify({ format: 1, pins_sha256: pinsHash(pinsDir), packages: Object.fromEntries(Object.entries(versions).filter(([k]) => k in (pkg.dependencies || {}))) }, null, 2) + '\n');
  say('OK camada semântica instalada. Rode kb.sh build para calcular os vetores (primeira vez: minutos; depois, só trechos novos).');
  return 0;
}
