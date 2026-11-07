#!/usr/bin/env node
// lib/red-level.mjs — alcançabilidade DIRETA teste → arquivos corrigidos (rule
// testing/regression-red-first.md, item avisado 5: "teste que não alcança, no grafo de
// código, nenhum dos arquivos corrigidos"). Inverso de lib/impact-scan.mjs, que faz
// alcançabilidade REVERSA (fix → quem depende dele); aqui partimos do node do TESTE e
// seguimos edges e.resolved===true no sentido da dependência (o que o teste importa),
// até ver se algum fix_files aparece no conjunto visitado. Reusa a mesma técnica de
// adjacência/BFS de lib/graph-deps.mjs e lib/graph-govern.mjs (Map<id,[id]> a partir de
// edges resolvidos), aplicada nó a nó em vez de módulo a módulo.
//
// Proxy imperfeito por design (a rule é explícita: não enxerga DI, reflexão, e2e sobre
// processo HTTP nem message bus) — por isso o item 5 é enforceable:false (avisa, não
// bloqueia). Grafo ausente, malformado, ou incapaz de resolver test_path/fix_files a um
// node ⇒ status:'unknown' e NENHUM finding — nunca falso positivo por grafo desatualizado
// ou por uma stack que o extractor nativo não cobre (ADR 0001 v0.2 / issue #18).
import { readFileSync, existsSync } from 'node:fs';

// resolveNodeId: casa um path solto (test_path/fix_files — relativo ao repo, como
// declarado em evidence/red/*.json) contra os ids do grafo. Igualdade exata primeiro;
// sufixo "/<path>" depois, para tolerar uma raiz relativa ligeiramente diferente sem
// arriscar casar o arquivo errado (nunca prefixo solto — evitaria colisão tipo "a.ts"
// casando com "banana.ts").
export function resolveNodeId(ids, p) {
  if (!p) return null;
  const norm = String(p).replace(/^\.\//, '');
  if (ids.has(norm)) return norm;
  for (const id of ids) if (id.endsWith('/' + norm)) return id;
  return null;
}

// checkReachability({ graph, testPath, fixFiles }) -> { reachable, layersCrossed, status }
//   status: 'ok'              — algum fix_files está no conjunto alcançado pelo teste
//           'no-intersection' — grafo resolveu teste e ao menos um fix_file, mas nenhum
//                                aparece no conjunto alcançado (finding do item 5)
//           'unknown'         — grafo ausente/malformado, ou test_path/fix_files não
//                                resolvem a nenhum node (nunca gera finding)
export function checkReachability({ graph, testPath, fixFiles }) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return { reachable: false, layersCrossed: [], status: 'unknown', reason: 'graph ausente ou malformado' };
  if (!testPath || !Array.isArray(fixFiles) || !fixFiles.length)
    return { reachable: false, layersCrossed: [], status: 'unknown', reason: 'test_path/fix_files insuficientes' };

  const ids = new Set(graph.nodes.map((n) => n.id));
  const testId = resolveNodeId(ids, testPath);
  if (!testId)
    return { reachable: false, layersCrossed: [], status: 'unknown', reason: 'test_path fora do grafo (ausente/desatualizado/stack não coberta)' };

  const fixIds = [...new Set(fixFiles.map((f) => resolveNodeId(ids, f)).filter(Boolean))];
  if (!fixIds.length)
    return { reachable: false, layersCrossed: [], status: 'unknown', reason: 'nenhum fix_files resolvido no grafo (ausente/desatualizado/stack não coberta)' };

  // adjacência direta (from -> [to]), só edges resolvidas — mesma convenção de graph-govern.mjs
  const fwd = new Map();
  for (const e of graph.edges) {
    if (!e || e.resolved !== true) continue;
    if (!fwd.has(e.from)) fwd.set(e.from, []);
    fwd.get(e.from).push(e.to);
  }
  const layerOf = new Map(graph.nodes.map((n) => [n.id, n.layer || 'unknown']));

  const visited = new Set([testId]);
  const queue = [testId];
  while (queue.length) {
    const cur = queue.shift();
    for (const nx of (fwd.get(cur) || [])) if (!visited.has(nx)) { visited.add(nx); queue.push(nx); }
  }

  const reachable = fixIds.some((id) => visited.has(id));
  const layersCrossed = [...new Set([...visited].map((id) => layerOf.get(id)).filter(Boolean))].sort();
  return { reachable, layersCrossed, status: reachable ? 'ok' : 'no-intersection' };
}

// CLI opcional (depuração manual): red-level.mjs <graph.json> <test_path> <fix1,fix2,...>
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [graphPath, testPath, fixFilesArg] = process.argv.slice(2);
  let graph = null;
  if (graphPath && existsSync(graphPath)) { try { graph = JSON.parse(readFileSync(graphPath, 'utf8')); } catch { graph = null; } }
  const fixFiles = fixFilesArg ? fixFilesArg.split(',').map((s) => s.trim()).filter(Boolean) : [];
  console.log(JSON.stringify(checkReachability({ graph, testPath, fixFiles })));
}
