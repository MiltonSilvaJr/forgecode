// kb-integrity — integridade da camada semântica da busca unificada (/forge:kb): varredura de
// binário nativo, hash dos pins e conferência completa de uma instalação (pins, nativo, versões do
// runtime, sha256 dos modelos). Usado pelo instalador (kb-install.mjs), pela carga (kb-semantic.mjs)
// e por `kb.sh semantic status`. Só `node:*`; nunca rede.
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ---------- varredura de binário nativo ----------
const NATIVE_EXT = /\.(node|dylib|so|dll)$/i;
const NATIVE_MAGIC = ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', '7f454c46', '4d5a'];
export function findNative(dir) {
  const hits = [];
  const walk = (d) => {
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      if (NATIVE_EXT.test(e.name) || /\.so\.\d/.test(e.name)) { hits.push(p); continue; }
      let fd; const b = Buffer.alloc(4);
      try { fd = openSync(p, 'r'); const n = readSync(fd, b, 0, 4, 0); if (n >= 2) { const hx = b.subarray(0, n).toString('hex'); if (NATIVE_MAGIC.some((m) => hx.startsWith(m))) hits.push(p); } } catch { /* ilegível: ignora */ } finally { if (fd !== undefined) closeSync(fd); }
    }
  };
  walk(dir);
  return hits.sort();
}

// ---------- integridade ----------
export function pinsHash(pinsDir) {
  return sha256(readFileSync(join(pinsDir, 'package-lock.json')) + '\u0000' + readFileSync(join(pinsDir, 'models.json')));
}

// verify(semDir, pinsDir, {fullHash}) → {ok, reason?, installed, models}
export function verify(semDir, pinsDir) {
  let installed;
  try { installed = JSON.parse(readFileSync(join(semDir, 'installed.json'), 'utf8')); } catch { return { ok: false, reason: 'installed.json ilegível' }; }
  let models;
  try { models = JSON.parse(readFileSync(join(pinsDir, 'models.json'), 'utf8')); } catch { return { ok: false, reason: 'pins ilegíveis (models.json)' }; }
  try { if (installed.pins_sha256 !== pinsHash(pinsDir)) return { ok: false, reason: 'pins mudaram desde a instalação — rode kb.sh semantic install' }; } catch { return { ok: false, reason: 'pins ilegíveis' }; }
  const native = findNative(semDir);
  if (native.length) return { ok: false, reason: `binário nativo encontrado: ${native[0].slice(semDir.length + 1)}` };
  // pacotes do runtime: presentes, dentro de runtime/node_modules, na versão do lockfile
  const runtimeDir = join(semDir, 'runtime');
  let lock;
  try { lock = JSON.parse(readFileSync(join(pinsDir, 'package-lock.json'), 'utf8')); } catch { return { ok: false, reason: 'pins ilegíveis (package-lock.json)' }; }
  for (const [key, meta] of Object.entries(lock.packages || {})) {
    if (!key) continue;
    const pj = join(runtimeDir, key, 'package.json');
    let v; try { v = JSON.parse(readFileSync(pj, 'utf8')).version; } catch { return { ok: false, reason: `pacote do runtime faltando: ${key.replace(/^node_modules\//, '')}` }; }
    if (v !== meta.version) return { ok: false, reason: `pacote do runtime em versão divergente: ${key.replace(/^node_modules\//, '')} ${v} (pin ${meta.version})` };
  }
  // modelos: presença, tamanho e sha256 completo a cada carga (sem memória: ~225 ms para ~270 MB)
  for (const role of ['embedder', 'reranker']) {
    for (const f of models[role]?.files || []) {
      const p = join(semDir, 'models', f.path);
      let st; try { st = statSync(p); } catch { return { ok: false, reason: `arquivo de modelo faltando: ${f.path}` }; }
      if (st.size !== f.size) return { ok: false, reason: `arquivo de modelo com tamanho divergente: ${f.path}` };
      if (sha256File(p) !== f.sha256) return { ok: false, reason: `sha256 divergente: ${f.path}` };
    }
  }
  return { ok: true, installed, models };
}

// status para `kb.sh semantic status`
export function status(semDir, pinsDir) {
  const v = verify(semDir, pinsDir);
  const lines = [`camada semântica: instalada${v.ok ? ' — integridade confere' : ` — PROBLEMA: ${v.reason}`}`];
  if (v.ok) {
    lines.push(`runtime: ${Object.entries(v.installed.packages || {}).map(([k, x]) => `${k}@${x}`).join(', ')}`);
    for (const role of ['embedder', 'reranker']) lines.push(`${role}: ${v.models[role].id} (${v.models[role].repo}@${String(v.models[role].revision).slice(0, 12)})`);
  }
  return { ok: v.ok, lines };
}
