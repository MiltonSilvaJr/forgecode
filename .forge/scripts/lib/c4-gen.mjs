#!/usr/bin/env node
// forge c4 generate (§16.5, W4.3). Zero-dependency. Derives C4 Mermaid diagrams
// from the code graph (deterministic, zero tokens beyond curation). Output is Markdown
// (.md) wrapping a ```mermaid fenced block, so it renders in any Markdown previewer
// (VS Code, GitHub) instead of showing raw Mermaid like a bare .mmd:
//   c1-context.md   — system + grouped external dependencies
//   c2-container.md  — boundaries (services/packages/apps/src groups) + relations
//   c3-component-<module>.md — files within each multi-file boundary + internal edges
// Convention (§16.5): NO dots and NO em-dash inside Mermaid labels — sanitized here.
// Usage: c4-gen.mjs <forge-root>
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const graphPath = join(root, '.forge/graph/graph.json');
if (!existsSync(graphPath)) { console.log('FAIL (no graph — run /forge:codegraph first)'); process.exit(1); }
const g = JSON.parse(readFileSync(graphPath, 'utf8'));
const c4Dir = join(root, '.forge/graph/c4');
mkdirSync(c4Dir, { recursive: true });

// label sanitizer: remove caracteres que quebram o parser do Mermaid em labels
// (pontos, travessões, parênteses/colchetes/chaves, aspas, #, <, >, |, ;, :, &, backtick).
const san = (s) => String(s)
  .replace(/[—–]/g, '-')
  .replace(/[.()[\]{}<>"'`#|;:&]/g, ' ')
  .replace(/\s+/g, ' ').trim();

// Equilíbrio para grafos grandes (limite Mermaid maxEdges/maxTextSize + legibilidade):
// boundary pequeno → C3 por arquivo (detalhe); boundary grande → C3 AGREGADO por
// submódulo (renderável E completo — nenhum arquivo some, só sobe de abstração).
const C3_MAX_NODES = 50;
// submódulo de um arquivo dentro de um boundary: o projeto .NET (DotPascalCase) se houver,
// senão até 2 níveis de diretório abaixo do boundary.
function subGroup(id, boundary) {
  const rest = id.slice(boundary.length + 1).split('/');
  const dirs = rest.slice(0, -1); // exclui o filename
  const idx = dirs.findIndex((s) => /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)+$/.test(s));
  const take = idx >= 0 ? dirs.slice(0, idx + 1) : dirs.slice(0, 2);
  return take.length ? `${boundary}/${take.join('/')}` : boundary;
}

// Write a diagram as Markdown with a fenced ```mermaid block (human-renderable).
function writeDiagram(base, title, mermaid) {
  const md = `# ${title}\n\n` +
    '> Gerado por `/forge:c4` a partir do code graph. Renderiza como diagrama em qualquer\n' +
    '> previewer de Markdown com suporte a Mermaid (VS Code, GitHub).\n\n' +
    '```mermaid\n' + mermaid + '\n```\n';
  writeFileSync(join(c4Dir, `${base}.md`), md);
}

const BOUNDARY_ROOTS = ['src', 'services', 'apps', 'packages', 'modules', 'libs', 'backend', 'frontend'];
function boundaryOf(id) {
  const p = id.split('/');
  if (BOUNDARY_ROOTS.includes(p[0]) && p.length > 1) return `${p[0]}/${p[1]}`;
  return p.length > 1 ? p[0] : '(root)';
}

// cor por camada (absorvido do Understand-Anything) — classDef Mermaid por layer.
const layerOf = new Map(g.nodes.map((n) => [n.id, n.layer || 'unknown']));
const LAYER_STYLE = {
  api: 'fill:#e3f2fd,stroke:#1565c0,color:#0d47a1',
  application: 'fill:#fff3e0,stroke:#ef6c00,color:#e65100',
  domain: 'fill:#e8f5e9,stroke:#2e7d32,color:#1b5e20',
  infrastructure: 'fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c',
  contracts: 'fill:#e0f7fa,stroke:#00838f,color:#006064',
  test: 'fill:#eceff1,stroke:#546e7a,color:#263238',
  config: 'fill:#fffde7,stroke:#f9a825,color:#f57f17',
  unknown: 'fill:#fafafa,stroke:#bdbdbd,color:#616161',
};
// nó EXTERNO a um boundary (LDG-0031): o C3 canônico mostra os componentes/containers com que o
// boundary conversa, não só os de dentro. Estilo tracejado, deliberadamente fora de LAYER_STYLE —
// não é "não classificado", é "não pertence a este boundary".
const EXTERNAL_STYLE = 'fill:#ffffff,stroke:#9e9e9e,stroke-width:1px,stroke-dasharray: 3 3,color:#616161';
const classDefs = (extra) => Object.entries(LAYER_STYLE).map(([l, s]) => `  classDef ${l} ${s};`)
  .concat(extra ? [`  classDef external ${EXTERNAL_STYLE};`] : []);
function dominantLayer(ids) {
  const c = {};
  for (const id of ids) { const l = layerOf.get(id) || 'unknown'; c[l] = (c[l] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
}

// project name from FORGE.md frontmatter (display), fallback to dir name
let system = 'System';
try {
  const fm = readFileSync(join(root, '.forge/FORGE.md'), 'utf8').match(/^---\n([\s\S]*?)\n---/);
  const disp = fm && fm[1].match(/^\s*display:\s*(.+)$/m);
  const name = fm && fm[1].match(/^\s*name:\s*(.+)$/m);
  if (disp) system = disp[1].trim(); else if (name) system = name[1].trim();
} catch { /* keep default */ }

// ── C1 context ────────────────────────────────────────────────────────────────
const externals = new Set();
for (const e of g.edges) if (!e.resolved && /^[a-z@]/.test(e.to) && !e.to.startsWith('.')) externals.add(e.to.split('/')[0]);
const c1 = ['flowchart TD', `  sys["${san(system)}"]`];
if (externals.size) {
  c1.push('  ext["External dependencies"]', '  sys --> ext');
}
writeDiagram('c1-context', 'C1 — Contexto do Sistema', c1.join('\n'));

// ── C2 container ──────────────────────────────────────────────────────────────
const containers = new Map(); // boundary -> [ids]
for (const n of g.nodes) {
  const b = boundaryOf(n.id);
  if (!containers.has(b)) containers.set(b, []);
  containers.get(b).push(n.id);
}
const idOf = new Map([...containers.keys()].sort().map((b, i) => [b, `c${i}`]));
const c2 = ['flowchart TD'];
for (const [b, ids] of [...containers.entries()].sort()) c2.push(`  ${idOf.get(b)}["${san(b)} (${ids.length})"]:::${dominantLayer(ids)}`);
const seenRel = new Set();
for (const e of g.edges) {
  if (!e.resolved) continue;
  const ba = boundaryOf(e.from), bb = boundaryOf(e.to);
  if (ba === bb) continue;
  const key = `${ba}>${bb}`;
  if (seenRel.has(key)) continue;
  seenRel.add(key);
  c2.push(`  ${idOf.get(ba)} --> ${idOf.get(bb)}`);
}
c2.push(...classDefs());
writeDiagram('c2-container', 'C2 — Containers (cor = camada dominante)', c2.join('\n'));

// ── C3 component (per multi-file boundary) ───────────────────────────────────
const byBoundary = new Map();
for (const n of g.nodes) {
  const b = boundaryOf(n.id);
  if (!byBoundary.has(b)) byBoundary.set(b, []);
  byBoundary.get(b).push(n.id);
}
let c3count = 0;
for (const [b, allFiles] of [...byBoundary.entries()].sort()) {
  // LDG-0031: boundary de UM arquivo também gera C3 — antes disto ele não aparecia em NENHUM
  // dos 3 níveis (C1 só mostra sistema+externals, C2 agrega por boundary como "src/domain (1)",
  // e o C3 era pulado aqui). Contradiz o espírito já declarado deste gerador para boundary
  // grande — "nenhum arquivo some, só sobe de abstração" — e era assimétrico: 2 arquivos
  // expunham os nomes, 1 arquivo sumia.
  const slug = b.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  let title, lines, hasExternal = false;
  if (allFiles.length <= C3_MAX_NODES) {
    // pequeno → detalhe por arquivo
    const inset = new Set(allFiles);
    const nid = new Map([...allFiles].sort().map((f, i) => [f, `f${i}`]));
    title = `C3 — Componentes: ${san(b)} (cor = camada)`;
    lines = ['flowchart TD', `  %% component view: ${san(b)}`];
    for (const f of [...allFiles].sort()) lines.push(`  ${nid.get(f)}["${san(f.split('/').pop())}"]:::${layerOf.get(f) || 'unknown'}`);
    // arestas intra-boundary normalmente; aresta CROSS-boundary para um nó EXTERNO tracejado
    // representando o outro lado (LDG-0031). Antes, `inset.has(from) && inset.has(to)` exigia
    // os dois extremos dentro do boundary e toda dependência de SAÍDA era descartada — o C3
    // ficava afirmativamente enganoso (parecia que o componente não conversava com nada de
    // fora), não só incompleto. Um nó externo por ARQUIVO-alvo distinto (dedup por id), não
    // por aresta — evita duplicar o mesmo alvo quando há várias arestas para ele.
    const outside = new Map(); // outside file id -> mermaid node id (x0, x1, …)
    const outsideId = (fid) => {
      if (!outside.has(fid)) outside.set(fid, `x${outside.size}`);
      return outside.get(fid);
    };
    const crossLines = [];
    for (const e of g.edges) {
      if (!e.resolved) continue;
      const fromIn = inset.has(e.from), toIn = inset.has(e.to);
      if (fromIn && toIn) { lines.push(`  ${nid.get(e.from)} --> ${nid.get(e.to)}`); continue; }
      if (fromIn && !toIn) crossLines.push(`  ${nid.get(e.from)} --> ${outsideId(e.to)}`);
      else if (!fromIn && toIn) crossLines.push(`  ${outsideId(e.from)} --> ${nid.get(e.to)}`);
    }
    if (outside.size) {
      hasExternal = true;
      for (const [fid, xid] of outside) lines.push(`  ${xid}["${san(boundaryOf(fid))}: ${san(fid.split('/').pop())}"]:::external`);
      lines.push(...crossLines);
    }
  } else {
    // grande → agregado por submódulo (renderável + completo; nenhum arquivo some)
    const groupOf = new Map(allFiles.map((f) => [f, subGroup(f, b)]));
    const groups = [...new Set(groupOf.values())].sort();
    const gid = new Map(groups.map((gp, i) => [gp, `g${i}`]));
    const gfiles = new Map(groups.map((gp) => [gp, allFiles.filter((f) => groupOf.get(f) === gp)]));
    const gedge = new Map();
    for (const e of g.edges) {
      if (!e.resolved) continue;
      const ga = groupOf.get(e.from), gb = groupOf.get(e.to);
      if (!ga || !gb || ga === gb) continue;
      gedge.set(`${ga}>${gb}`, (gedge.get(`${ga}>${gb}`) || 0) + 1);
    }
    title = `C3 — Componentes: ${san(b)} (agregado: ${groups.length} submódulos · ${allFiles.length} arquivos; cor = camada)`;
    lines = ['flowchart TD', `  %% component view (aggregated): ${san(b)}`];
    for (const gp of groups) lines.push(`  ${gid.get(gp)}["${san(gp.slice(b.length + 1) || gp)} (${gfiles.get(gp).length})"]:::${dominantLayer(gfiles.get(gp))}`);
    for (const k of [...gedge.keys()].sort()) { const [a, c] = k.split('>'); lines.push(`  ${gid.get(a)} --> ${gid.get(c)}`); }
  }
  lines.push(...classDefs(hasExternal));
  writeDiagram(`c3-component-${slug}`, title, lines.join('\n'));
  c3count++;
}

// clean stale c3 files from previous runs that no longer correspond to a boundary,
// plus any legacy .mmd files from versions that emitted bare Mermaid. Every boundary in
// byBoundary now gets a C3 (LDG-0031 — includes 1-file boundaries), so `wanted` is every
// boundary, no length filter.
const wanted = new Set([...byBoundary.keys()]
  .map((b) => `c3-component-${b.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.md`));
for (const f of readdirSync(c4Dir)) {
  if (f.endsWith('.mmd')) { rmSync(join(c4Dir, f)); continue; }
  if (f.startsWith('c3-component-') && f.endsWith('.md') && !wanted.has(f)) rmSync(join(c4Dir, f));
}

console.log(`OK c4: c1-context, c2-container (${containers.size} containers), ${c3count} component view(s)`);
