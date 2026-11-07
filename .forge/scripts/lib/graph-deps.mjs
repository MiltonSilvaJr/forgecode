#!/usr/bin/env node
// forge graph deps — análise de arquitetura a partir do code graph (inspirado no
// "module dependencies / path finder / layer view" do Understand-Anything, mas
// determinista e zero-dep, zero tokens):
//   1. dependências agregadas MÓDULO→MÓDULO (boundary) com fan-out/fan-in;
//   2. CICLOS entre módulos (smell arquitetural);
//   3. VIOLAÇÕES DE CAMADA (clean architecture): dependência apontando "para fora"
//      (ex.: domain→infrastructure, application→api).
//
// Uso: graph-deps.mjs <forge-root> [--module <prefixo>] [--by-project] [--json]
//   --by-project : usa o diretório do projeto .NET (Collatra.X.Api) como módulo,
//                  revelando dependências entre camadas dentro de um serviço.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const moduleArg = arg('--module');
const byProject = process.argv.includes('--by-project');
const asJson = process.argv.includes('--json');
const graphPath = join(root, '.forge/graph/graph.json');
if (!existsSync(graphPath)) { console.log('FAIL (no graph — run: graph.sh build)'); process.exit(1); }
const g = JSON.parse(readFileSync(graphPath, 'utf8'));

const BOUNDARY_ROOTS = new Set(['src', 'services', 'apps', 'packages', 'modules', 'libs', 'backend', 'frontend']);
function boundaryOf(id) {
  const p = id.split('/');
  if (byProject) {
    // diretório de projeto .NET: segmento DotPascalCase (Collatra.Billing.Api) — TODAS as
    // partes capitalizadas (exclui arquivos como App.tsx, cujo .tsx é minúsculo) e nunca o
    // último segmento (o filename).
    const idx = p.slice(0, -1).findIndex((seg) => /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)+$/.test(seg));
    if (idx >= 0) return p.slice(0, idx + 1).join('/');
  }
  if (BOUNDARY_ROOTS.has(p[0]) && p.length > 1) return `${p[0]}/${p[1]}`;
  return p.length > 1 ? p[0] : '(root)';
}

const layerOf = new Map(g.nodes.map((n) => [n.id, n.layer || 'unknown']));

// ── 1. adjacência módulo→módulo ───────────────────────────────────────────────
const out = new Map();
const modules = new Set();
for (const n of g.nodes) modules.add(boundaryOf(n.id));
for (const e of g.edges) {
  if (!e.resolved) continue;
  const a = boundaryOf(e.from), b = boundaryOf(e.to);
  if (a === b) continue;
  if (!out.has(a)) out.set(a, new Map());
  out.get(a).set(b, (out.get(a).get(b) || 0) + 1);
}

// ── 2. ciclos entre módulos (DFS) ─────────────────────────────────────────────
const cycles = [];
{
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...modules].map((m) => [m, WHITE]));
  const stack = [];
  const adj = (m) => [...(out.get(m)?.keys() || [])].sort();
  const dfs = (m) => {
    color.set(m, GRAY); stack.push(m);
    for (const nx of adj(m)) {
      if (!modules.has(nx)) continue;
      if (color.get(nx) === GRAY) { const i = stack.indexOf(nx); if (i >= 0) cycles.push([...stack.slice(i), nx]); }
      else if (color.get(nx) === WHITE) dfs(nx);
    }
    stack.pop(); color.set(m, BLACK);
  };
  for (const m of [...modules].sort()) if (color.get(m) === WHITE) dfs(m);
  // dedupe: o mesmo ciclo é alcançado por vários pontos de entrada — chave canônica
  // = rotação lexicograficamente mínima dos membros (sem o nó de fechamento repetido).
  const seen = new Set(); const uniq = [];
  for (const c of cycles) {
    const ring = c.slice(0, -1);
    const rots = ring.map((_, i) => [...ring.slice(i), ...ring.slice(0, i)].join('>'));
    const key = rots.sort()[0];
    if (!seen.has(key)) { seen.add(key); uniq.push(c); }
  }
  cycles.length = 0; cycles.push(...uniq);
}

// ── 3. violações de camada (clean architecture) ───────────────────────────────
// Regra: dependências apontam para DENTRO (rumo ao domain). rank cresce para fora.
// contracts/test/config/unknown são neutros (ignorados).
const RANK = { domain: 0, application: 1, infrastructure: 2, api: 3 };
const violations = [];
for (const e of g.edges) {
  if (!e.resolved) continue;
  const lf = layerOf.get(e.from), lt = layerOf.get(e.to);
  if (!(lf in RANK) || !(lt in RANK)) continue;
  if (RANK[lf] < RANK[lt]) violations.push({ from: e.from, to: e.to, from_layer: lf, to_layer: lt });
}
// agrega violações por par de camadas (ex.: domain->infrastructure: N)
const violByPair = {};
for (const v of violations) { const k = `${v.from_layer}→${v.to_layer}`; violByPair[k] = (violByPair[k] || 0) + 1; }

if (asJson) {
  const data = {
    granularity: byProject ? 'project' : 'boundary',
    modules: [...modules].sort(),
    edges: [...out].flatMap(([a, tg]) => [...tg].map(([b, c]) => ({ from: a, to: b, count: c }))),
    cycles,
    layer_violations: violations,
    layer_violations_by_pair: violByPair,
  };
  writeFileSync(join(root, '.forge/graph/module-deps.json'), JSON.stringify(data, null, 2) + '\n');
  console.log(`OK module-deps.json (${modules.size} módulos, ${data.edges.length} deps, ${cycles.length} ciclo(s), ${violations.length} violação(ões) de camada)`);
  process.exit(0);
}

// ── relatório legível ─────────────────────────────────────────────────────────
const list = moduleArg ? [...modules].filter((m) => m.includes(moduleArg)).sort() : [...modules].sort();
const fmt = (tg) => [...(tg || new Map())].sort((x, y) => y[1] - x[1]).map(([b, c]) => `${b} (${c})`).join(', ') || '—';
const interEdges = [...out.values()].reduce((s, m) => s + m.size, 0);
console.log(`# Dependências módulo→módulo — granularidade: ${byProject ? 'projeto (.NET)' : 'boundary'}`);
console.log(`# ${modules.size} módulos, ${interEdges} arestas inter-módulo, ${cycles.length} ciclo(s), ${violations.length} violação(ões) de camada\n`);
for (const m of list) {
  const fanOut = out.get(m);
  const depBy = [...out].filter(([, tg]) => tg.has(m)).map(([a, tg]) => `${a} (${tg.get(m)})`).sort();
  console.log(`## ${m}`);
  console.log(`  depende de (fan-out ${fanOut ? fanOut.size : 0}): ${fmt(fanOut)}`);
  console.log(`  usado por  (fan-in ${depBy.length}): ${depBy.join(', ') || '—'}\n`);
}
console.log(cycles.length ? '## ⚠ Ciclos entre módulos (smell)' : '## Ciclos entre módulos: nenhum ✓');
for (const c of cycles) console.log(`  - ${c.join(' → ')}`);
console.log('');
if (violations.length) {
  console.log('## ⚠ Violações de camada (clean architecture — dependência apontando para fora)');
  for (const [pair, n] of Object.entries(violByPair).sort((a, b) => b[1] - a[1])) console.log(`  - ${pair}: ${n}`);
  console.log('  exemplos:');
  for (const v of violations.slice(0, 5)) console.log(`    ${v.from} (${v.from_layer}) → ${v.to} (${v.to_layer})`);
} else {
  console.log('## Violações de camada: nenhuma ✓');
}
