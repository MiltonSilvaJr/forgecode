// lib/graph-govern.mjs — motor interno (biblioteca, NÃO gate público, NÃO tem
// entrada CLI própria e não é declarado na chave `gates:` do FORGE.md). Zero-dep.
//
// Opera sobre um `graph.json` (schema graph/v0, ver graph.schema.json) para decidir,
// por reachability, se um node `layer:api` "importa" um módulo de imposição —
// `roles:["pep"]` (REQ-08) ou `roles:["otel-wrapper"]` (REQ-09a) — seguindo só edges
// `resolved:true`, direto ou transitivo. Reusa a MESMA técnica de adjacência/BFS que
// `lib/graph-deps.mjs` já usa para dependências módulo→módulo (Map<id, Set<id>> a
// partir de edges resolvidos) — aqui a granularidade é nó a nó (arquivo→arquivo), não
// módulo a módulo, então a adjacência é construída localmente em vez de importada
// (graph-deps.mjs não exporta símbolos: é um script CLI top-level, não uma lib).
//
// Prova só IMPORTAÇÃO, nunca APLICAÇÃO — ver design §2.3 / epic_context.md (a
// aplicação é responsabilidade da tríade: gate estático + negative_contract_test no
// authz-map + evidência de decision-log no CI do consumidor).
//
// Consumido por lib/check-authz.mjs (REQ-08) e lib/check-observability.mjs (REQ-09a)
// na Wave 4 — este módulo não formata "OK/CONFLICT", só devolve findings estruturados;
// a decisão de warn|enforce (REQ-16) é do lib/gate-mode.mjs (TASK-13), não daqui.

// ── adjacência forward (from → to), só edges resolved:true ────────────────────────
export function buildAdjacency(graph) {
  const adj = new Map();
  for (const e of (graph && graph.edges) || []) {
    if (!e || e.resolved !== true) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from).add(e.to);
  }
  return adj;
}

// ── reachability BFS: fromId alcança algum id de targetIds? (direto/transitivo) ───
// O próprio node contar como "alcançando a si mesmo" quando já carrega o role alvo
// (ex.: o handler api É o pep) é tratado como PASS — targetIds.has(fromId) checa isso
// antes de qualquer travessia.
export function reaches(adj, fromId, targetIds) {
  if (targetIds.has(fromId)) return true;
  const seen = new Set([fromId]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj.get(cur) || []) {
      if (targetIds.has(next)) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

// ── glob → RegExp, mesmo dialeto de pep_paths/wrapper_paths/allowlist do
// graph-build.mjs (§2.3): segmentos separados por "/", "*" vira "[^/]*" dentro de um
// segmento, e o match cobre o próprio path e qualquer coisa abaixo dele.
export function globToRegExp(glob) {
  const escaped = String(glob).split('/')
    .map((seg) => seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('/');
  return new RegExp(`^${escaped}(?:/.*)?$`);
}

export function pathMatches(id, globs) {
  return (Array.isArray(globs) ? globs : []).some((g) => globToRegExp(g).test(id));
}

// ── checkRole: para um bloco de governance (authz ou observability) e um role-alvo
// ("pep" | "otel-wrapper"), varre todo node layer:api fora da allowlist e reporta os
// que não alcançam nenhum node com esse role.
//
// block ausente (governance.authz/observability não declarado no FORGE.md) ⇒
// { checked: false, findings: [] } — no-op, nunca falso-positivo (REQ-11 AC).
export function checkRole(graph, block, role) {
  if (!block || typeof block !== 'object') return { checked: false, findings: [] };
  const nodes = (graph && graph.nodes) || [];
  const targets = new Set(nodes.filter((n) => Array.isArray(n.roles) && n.roles.includes(role)).map((n) => n.id));
  const allowlist = Array.isArray(block.allowlist) ? block.allowlist : [];
  const adj = buildAdjacency(graph);
  const findings = [];
  for (const n of nodes) {
    if (n.layer !== 'api') continue;
    if (pathMatches(n.id, allowlist)) continue;
    if (!reaches(adj, n.id, targets)) findings.push(n.id);
  }
  return { checked: true, findings };
}

// ── govern: conveniência que roda os dois checks (REQ-08 via governance.authz →
// role "pep"; REQ-09a via governance.observability → role "otel-wrapper") a partir
// do bloco `governance` já materializado no graph.json por graph-build.mjs.
// graph.governance ausente por completo ⇒ ambos no-op.
export function govern(graph) {
  const gov = (graph && graph.governance) || {};
  return {
    authz: checkRole(graph, gov.authz, 'pep'),
    observability: checkRole(graph, gov.observability, 'otel-wrapper'),
  };
}
