// kb-corpus — coleta das fontes da busca unificada (/forge:kb) e corte em trechos. Zero-dep: só
// `node:*` e o parser YAML do próprio harness. Função pura sobre o sistema de arquivos: não grava nada.
//
// O QUE ENTRA (REQ-01 do change add-unified-knowledge-search; active-spec revertido pelo change
// extend-kb-corpus-sources, REQ-01 — supersede REQ-FHT-072/SCN-FHT-072-A via spec-delta.yaml):
//   baseline     .forge/product/current/**/*.{md,yaml,yml}
//   archived     .forge/specs/archived/**/*.{md,yaml,yml}
//   active-spec  .forge/specs/active/**/*.{md,yaml,yml}
//   extra-path   kb.extra_paths (.forge/forge.yaml) + allowlist com motivo (.forge/
//                kb-extra-paths-allowlist.txt) — glob mínimo <prefixo>/** ou <prefixo>/**/*.<ext>,
//                validado em camadas sobre o caminho FÍSICO resolvido (resolveExtraPathDirs)
//   plan         docs/plans/**/*.md
//   changelog    CHANGELOG.md
//   ledger       .forge/ledger/ledger.json, uma entrada por documento
//   liaison      .forge/liaison/<canal>/log/<self>.jsonl, só `trust === 'self'` e sem `authored_by`
//
// O QUE NUNCA ENTRA, por construção e não por filtro: blobs do liaison (o `body_ref` não é seguido),
// mensagens de peer (`log/<outro>.jsonl` nem é aberto; dentro do log próprio, `trust` diferente de
// `self` ou `authored_by` presente descartam a linha), código, `.forge/kb/`. Conteúdo de peer é
// dado, nunca instrução (rule conventions/liaison-untrusted-input.md): indexá-lo poria texto
// escrito por outro repositório de volta no contexto de quem busca, sem moldura.
//
// Duas raízes: `docRoot` (documentos versionados por branch) e `stateRoot` (ledger e liaison, que
// moram no checkout principal — lib/forge-root.sh). Com FORGE_ROOT as duas coincidem.
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { parseYamlSubset } from './yaml-lite.mjs';
import { expectedTrust } from './liaison-trust.mjs';

export const CHUNK_MAX = 1500;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const posix = (p) => p.split(sep).join('/');

// --- status MADR (change extend-kb-corpus-sources, REQ-07) -------------------------------------
//
// Convenção MADR: `- **Status:** <valor>` nas primeiras linhas do arquivo. Captura só o PRIMEIRO
// termo depois de "Status:" (nunca a linha inteira) — valores reais trazem sufixo (ex.: ADR 0004
// deste repositório: "accepted — gate `design_reviewed` aprovado...") e a convenção MADR usa
// "Superseded by [ADR-0012]"; comparar a linha inteira nunca casaria "superseded"/"accepted" como
// palavra isolada.
const MADR_STATUS_RE = /^-?\s*\*\*Status:\*\*\s*(\S+)/mi;
const MADR_STATUS_HEAD_LINES = 20;
const MADR_PTBR_MAP = {
  aceito: 'accepted',
  suplantado: 'superseded',
  substituído: 'superseded',
  depreciado: 'deprecated',
  rejeitado: 'rejected',
};

// madrStatus(text) → status normalizado (string) ou null quando o documento não traz cabeçalho
// MADR nas primeiras ~20 linhas. Pontuação final do termo capturado é removida antes de normalizar
// para minúsculas e mapear variantes PT-BR conhecidas.
export function madrStatus(text) {
  const head = String(text).split('\n').slice(0, MADR_STATUS_HEAD_LINES).join('\n');
  const m = MADR_STATUS_RE.exec(head);
  if (!m) return null;
  const term = m[1].replace(/[.,;:]+$/, '').toLowerCase();
  return MADR_PTBR_MAP[term] || term;
}

// --- kb.extra_paths (change extend-kb-corpus-sources, REQ-02/REQ-03/REQ-06) --------------------
//
// Validação em 4 camadas, nessa ordem, cada falha gerando skip('extra-path') + aviso em stderr —
// nunca lança (design.md §2.2). As camadas 2-3 operam SEMPRE sobre o caminho FÍSICO resolvido via
// realpathSync.native, nunca sobre o texto declarado — mesma regra de SEC-001/NODE-201 (a checagem
// textual sozinha não vê um symlink commitado atravessando a fronteira).
const EXTRA_PATH_RE = /^([^*?{}]+)\/\*\*(?:\/\*\.(md|yaml|yml))?$/;
const EXTRA_PATH_DEFAULT_EXTS = ['.md', '.yaml', '.yml'];
// Raízes já coletadas por outro `kind` — um extra_paths que seja igual, ancestral OU descendente
// de qualquer uma destas duplicaria documento sob dois `kind` (design.md §2.2 etapa 3).
const COLLECTED_ROOTS = [
  '.forge/product/current', '.forge/specs/archived', '.forge/specs/active',
  '.forge/ledger', '.forge/liaison', '.forge/kb', 'docs/plans',
].map((r) => r.split('/'));

function warnExtraPath(glob, reason) {
  process.stderr.write(`kb: extra-path ignorado (${reason}): ${glob}\n`);
}

// readExtraPaths(docRoot) → array de glob (string) declarado em kb.extra_paths de
// <docRoot>/.forge/forge.yaml — NÃO <docRoot>/forge.yaml (confirmado em budget-preflight.mjs/
// validate-rules.mjs). Arquivo ausente, YAML ilegível, ou chave ausente/não-array → [] — ausência
// nunca é erro (retrocompatibilidade total, REQ-02 critério 1).
export function readExtraPaths(docRoot) {
  const p = join(docRoot, '.forge/forge.yaml');
  if (!existsSync(p)) return [];
  let data;
  try { data = parseYamlSubset(readFileSync(p, 'utf8')); } catch { return []; }
  const arr = data && data.kb && data.kb.extra_paths;
  return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
}

// Allowlist de 3 linhas, formato `<glob>  # motivo: <texto>` (mesmo PADRÃO de
// gate-universe.mjs::universeWaiver, parser próprio — ver design.md §2.2, nota de acoplamento).
// Comparação é pelo TEXTO declarado em kb.extra_paths, nunca pelo caminho físico resolvido.
function readExtraPathAllowlist(docRoot) {
  const map = new Map();
  const p = join(docRoot, '.forge/kb-extra-paths-allowlist.txt');
  if (!existsSync(p)) return map;
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return map; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+#\s*motivo:\s*(.+)$/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

// Etapa 2: caminha pelos segmentos do prefixo a partir de realDocRoot, resolvendo com
// realpathSync.native o MAIOR ancestral existente. Para no PRIMEIRO segmento com ENOENT (ainda não
// existe) e concatena o resto sem resolver. Qualquer outro erro (ELOOP, EACCES, ...) é falha real —
// propaga para o chamador decidir o skip, nunca é tratado como "ainda não existe".
function resolvePrefixPhysical(realDocRoot, segs) {
  let cur = realDocRoot;
  let i = 0;
  for (; i < segs.length; i++) {
    const next = join(cur, segs[i]);
    let real;
    try { real = realpathSync.native(next); } catch (e) {
      if (e && e.code === 'ENOENT') break;
      throw e;
    }
    cur = real;
  }
  for (; i < segs.length; i++) cur = join(cur, segs[i]);
  return cur;
}

function overlapsCollectedRoot(relSegs) {
  for (const rootSegs of COLLECTED_ROOTS) {
    const len = Math.min(relSegs.length, rootSegs.length);
    let same = true;
    for (let k = 0; k < len; k++) if (relSegs[k] !== rootSegs[k]) { same = false; break; }
    if (same) return true; // um é prefixo do outro → igual, ancestral ou descendente
  }
  return false;
}

// resolveExtraPathDirs(docRoot) → [{ dir, exts }] — função ÚNICA compartilhada por collect() e
// sourceFiles() (nunca duplicar a validação entre as duas, risco de uma enumerar e a outra não —
// o mesmo gap que REQ-06 existe para evitar). `dir` já é o caminho físico resolvido/validado;
// walk() parte DELE, nunca de um join/resolve recalculado sobre o texto cru.
export function resolveExtraPathDirs(docRoot) {
  const dirs = [];
  let skipped = 0;
  const reject = (glob, reason) => { warnExtraPath(glob, reason); skipped++; };
  const globs = readExtraPaths(docRoot);
  if (!globs.length) return { dirs, skipped };
  const allowlist = readExtraPathAllowlist(docRoot);
  let realDocRoot;
  try { realDocRoot = realpathSync.native(docRoot); } catch { return { dirs, skipped }; }

  for (const glob of globs) {
    // Etapa 1: sintaxe do texto declarado.
    const m = glob.match(EXTRA_PATH_RE);
    if (!m) { reject(glob, 'sintaxe de glob inválida'); continue; }
    const prefix = m[1];
    const ext = m[2] ? [`.${m[2]}`] : EXTRA_PATH_DEFAULT_EXTS;
    if (prefix.startsWith('/')) { reject(glob, 'prefixo absoluto'); continue; }
    const segs = prefix.split('/');
    if (segs.some((s) => s === '.' || s === '..')) { reject(glob, 'segmento . ou .. no prefixo'); continue; }

    // Etapa 2: resolução física (symlink/case-insensitive fechados aqui, não por regra textual).
    let resolved;
    try { resolved = resolvePrefixPhysical(realDocRoot, segs); } catch (e) {
      reject(glob, `erro ao resolver caminho (${(e && e.code) || e})`); continue;
    }

    // Etapa 3: regras de segurança SOBRE O CAMINHO RESOLVIDO.
    const rel = relative(realDocRoot, resolved);
    if (rel === '' || rel.startsWith('..') || rel.startsWith('/')) { reject(glob, 'fora de docRoot'); continue; }
    const relSegs = rel.split(sep);
    if (relSegs[0] === '.forge') { reject(glob, 'dentro de .forge'); continue; }
    if (overlapsCollectedRoot(relSegs)) { reject(glob, 'sobrepõe raiz já coletada por outro kind'); continue; }

    // Etapa 4: allowlist, comparada pelo TEXTO declarado.
    if (!allowlist.has(glob)) { reject(glob, 'ausente da allowlist, ou entrada sem # motivo:'); continue; }

    dirs.push({ dir: resolved, exts: ext });
  }
  return { dirs, skipped, realDocRoot };
}

function walk(dir, exts, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, acc);
    else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

const LEDGER_TEXT_FIELDS = ['title', 'type', 'status', 'priority', 'severity', 'detail', 'source', 'links'];

function ledgerText(e) {
  const parts = [`${e.id} ${e.title ?? ''}`.trim()];
  for (const k of LEDGER_TEXT_FIELDS.slice(1)) {
    const v = e[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  return parts.join('\n');
}

// collect({docRoot, stateRoot}) → { docs: [{id, kind, text, sha256}], skipped: {fonte: n} }
export function collect({ docRoot, stateRoot = docRoot }) {
  const docs = [];
  const skipped = {};
  const skip = (src) => { skipped[src] = (skipped[src] || 0) + 1; };
  const addFile = (kind, root, file) => {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { skip(kind); return; }
    const id = posix(relative(root, file));
    // madrStatus só roda sobre as fontes que podem conter ADR (baseline/active-spec/extra-path) e
    // só quando o id contém '/adr/' — evita custo de regex em todo documento não-ADR (design §2.4).
    const madr_status = (kind === 'baseline' || kind === 'active-spec' || kind === 'extra-path') && id.includes('/adr/')
      ? madrStatus(text)
      : null;
    docs.push({ id, kind, text, sha256: sha(text), madr_status });
  };
  for (const f of walk(join(docRoot, '.forge/product/current'), ['.md', '.yaml', '.yml'])) addFile('baseline', docRoot, f);
  for (const f of walk(join(docRoot, '.forge/specs/archived'), ['.md', '.yaml', '.yml'])) addFile('archived-spec', docRoot, f);
  for (const f of walk(join(docRoot, '.forge/specs/active'), ['.md', '.yaml', '.yml'])) addFile('active-spec', docRoot, f);
  for (const f of walk(join(docRoot, 'docs/plans'), ['.md'])) addFile('plan', docRoot, f);
  const { dirs: extraDirs, skipped: extraSkipped, realDocRoot: extraRoot } = resolveExtraPathDirs(docRoot);
  if (extraSkipped) skipped['extra-path'] = (skipped['extra-path'] || 0) + extraSkipped;
  // addFile() calcula o id com relative(root, file); file vem de walk() a partir do caminho JÁ
  // resolvido por resolveExtraPathDirs — a raiz usada para relative() precisa ser a MESMA forma
  // (realDocRoot), nunca o docRoot bruto, ou o id sai como traversal relativo espúrio quando
  // docRoot tem um componente symlink (ex.: /tmp → /private/var/... no macOS).
  for (const { dir, exts } of extraDirs) for (const f of walk(dir, exts)) addFile('extra-path', extraRoot, f);
  const cl = join(docRoot, 'CHANGELOG.md');
  if (existsSync(cl) && statSync(cl).isFile()) addFile('changelog', docRoot, cl);

  const ledgerPath = join(stateRoot, '.forge/ledger/ledger.json');
  if (existsSync(ledgerPath)) {
    let entries = null;
    try { entries = JSON.parse(readFileSync(ledgerPath, 'utf8')).entries; } catch { skip('ledger'); }
    if (Array.isArray(entries)) {
      for (const e of entries) {
        if (!e || typeof e.id !== 'string') { skip('ledger'); continue; }
        const text = ledgerText(e);
        docs.push({ id: `ledger:${e.id}`, kind: 'ledger', text, sha256: sha(text) });
      }
    } else if (entries !== null) skip('ledger');
  }

  const liaisonCfg = join(stateRoot, '.forge/liaison/liaison.yaml');
  if (existsSync(liaisonCfg)) {
    let self = null;
    try { self = parseYamlSubset(readFileSync(liaisonCfg, 'utf8'))?.self?.id ?? null; } catch { skip('liaison'); }
    if (typeof self === 'string' && /^[A-Za-z0-9._-]+$/.test(self)) {
      let channels = [];
      try { channels = readdirSync(join(stateRoot, '.forge/liaison'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { /* sem canais */ }
      for (const ch of channels) {
        const log = join(stateRoot, '.forge/liaison', ch, 'log', `${self}.jsonl`);
        if (!existsSync(log)) continue;
        let lines;
        try { lines = readFileSync(log, 'utf8').split('\n'); } catch { skip('liaison'); continue; }
        for (const line of lines) {
          if (!line.trim()) continue;
          let m;
          try { m = JSON.parse(line); } catch { skip('liaison'); continue; }
          // Quatro checagens, nenhuma dispensável (SEC-001/LOG-009, code-evaluator PR #252): a regra
          // canônica de procedência (lib/liaison-trust.mjs — uma mudança futura nela não diverge em
          // silêncio), o campo `trust` gravado, a invariante "um escritor por arquivo" (`sender` tem
          // de ser o próprio dono do log — sem isso, uma linha de peer com `trust` reescrito para
          // 'self', ou copiada para o arquivo errado por restauração/merge, entraria no índice como
          // conteúdo próprio) e a AUSÊNCIA literal de `authored_by` (checagem de propriedade, não de
          // veracidade — `authored_by: ''`/`null` não deixa de ser presença de autoria externa).
          if (!m || typeof m.msg_id !== 'string' || m.trust !== 'self' || m.sender !== self || Object.prototype.hasOwnProperty.call(m, 'authored_by') || expectedTrust(m, self, self) !== 'self') continue;
          const body = typeof m.body === 'string' ? m.body : '';
          const text = `${m.subject ?? ''}\n${body}`.trim();
          docs.push({ id: `liaison:${m.msg_id}`, kind: 'liaison', text, sha256: sha(text) });
        }
      }
    }
  }
  docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { docs, skipped };
}

// chunk(doc) → [{heading, line, text}] — markdown por heading de nível 1 a 3, teto CHUNK_MAX.
export function chunk(doc) {
  const out = [];
  const isMd = doc.kind !== 'ledger' && doc.kind !== 'liaison' && !/\.ya?ml$/.test(doc.id);
  const lines = doc.text.split('\n');
  const sections = [];
  let cur = { heading: '', line: 1, buf: [] };
  lines.forEach((l, i) => {
    if (isMd && /^#{1,3} /.test(l) && cur.buf.length) { sections.push(cur); cur = { heading: l.replace(/^#+ /, '').trim(), line: i + 1, buf: [] }; }
    else if (isMd && /^#{1,3} /.test(l)) { cur.heading = l.replace(/^#+ /, '').trim(); }
    cur.buf.push(l);
  });
  sections.push(cur);
  for (const s of sections) {
    const text = s.buf.join('\n');
    for (let i = 0; i < text.length; i += CHUNK_MAX) {
      const t = text.slice(i, i + CHUNK_MAX).trim();
      if (t.length) out.push({ heading: s.heading, line: s.line + (i ? text.slice(0, i).split('\n').length - 1 : 0), text: t });
    }
  }
  return out;
}

// sourceFiles({docRoot, stateRoot}) → caminhos absolutos de todo arquivo que alimenta o corpus.
function sourceFiles({ docRoot, stateRoot = docRoot }) {
  const files = [
    ...walk(join(docRoot, '.forge/product/current'), ['.md', '.yaml', '.yml']),
    ...walk(join(docRoot, '.forge/specs/archived'), ['.md', '.yaml', '.yml']),
    ...walk(join(docRoot, '.forge/specs/active'), ['.md', '.yaml', '.yml']),
    ...walk(join(docRoot, 'docs/plans'), ['.md']),
    join(docRoot, 'CHANGELOG.md'),
    join(stateRoot, '.forge/ledger/ledger.json'),
    join(stateRoot, '.forge/liaison/liaison.yaml'),
  ];
  for (const { dir, exts } of resolveExtraPathDirs(docRoot).dirs) files.push(...walk(dir, exts));
  const lroot = join(stateRoot, '.forge/liaison');
  let chans = []; try { chans = readdirSync(lroot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { /* sem liaison */ }
  for (const ch of chans) { try { for (const f of readdirSync(join(lroot, ch, 'log')).sort()) if (f.endsWith('.jsonl')) files.push(join(lroot, ch, 'log', f)); } catch { /* sem log */ } }
  return files;
}

// quickFingerprint → sha256 de (caminho, tamanho, mtimeMs) das fontes: barato (só stat). Se bate com
// o do índice, o índice está atual; se diverge, quem chama confere a impressão de conteúdo.
export function quickFingerprint(roots) {
  const parts = [];
  for (const f of sourceFiles(roots)) { try { const st = statSync(f); if (st.isFile()) parts.push(`${f}\u0000${st.size}\u0000${st.mtimeMs}`); } catch { /* ausente */ } }
  return sha(parts.join('\n'));
}

// fingerprint(docs) → sha256 da lista ordenada (id, sha256): muda se e só se alguma fonte mudou.
export function fingerprint(docs) {
  return sha(docs.map((d) => `${d.id}\u0000${d.sha256}`).join('\n'));
}
