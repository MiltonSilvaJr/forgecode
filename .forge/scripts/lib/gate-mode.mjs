// lib/gate-mode.mjs — motor interno (biblioteca, TASK-13, REQ-16, design.md §2.2
// "Contrato comum dos gates"). Zero-dependência. Compartilhado pelos três gates da
// Wave 4 (check-authz.mjs, check-observability.mjs, check-data-governance.mjs) para
// decidir se um finding BLOQUEIA (exit≠0) ou vira aviso (exit 0), conforme o modo
// warn|enforce declarado no bloco `authz:`/`observability:` do FORGE.md — materializado
// em `graph.json:governance.<authz|observability>` por graph-build.mjs (TASK-07).
//
// Contrato (§2.2): cada finding carrega um flag `enforceable` (boolean), decidido pelo
// PRÓPRIO GATE, não por este módulo:
//   - enforceable:true  → INEGOCIÁVEL (REQ-05 deny-by-default, REQ-12a PAN/PII em log).
//                          Ignora o `mode` — SEMPRE bloqueia, mesmo com mode:'warn'.
//   - enforceable:false → REBAIXÁVEL (gates de adoção REQ-06/07/08/09/10).
//                          mode:'warn'    → vira warning (não bloqueia).
//                          mode:'enforce' → bloqueia.
// Finding sem o campo `enforceable` é tratado como rebaixável (default seguro: só
// bloqueia sempre o que o gate marcar explicitamente como inegociável).
//
// Default seguro de `mode`: bloco de governance ausente, ou `mode` ausente/inválido,
// resolve para 'warn' — replica a lição das issues #20/#21 (não travar brownfield sem
// PEP/wrapper declarado). A leitura/aplicação de `allowlist` por path (glob) é do
// lib/graph-govern.mjs (pathMatches/globToRegExp) para os checks baseados em grafo
// (REQ-08/09a); aqui expomos só a leitura crua do campo, para gates que precisem dele
// sem duplicar a semântica de glob.

const VALID_MODES = new Set(['warn', 'enforce']);

// readMode(block): extrai `mode` de um bloco de governance (o objeto authz:/
// observability: já lido de graph.json:governance.<family>, ou qualquer objeto com
// campo `mode`). Aceita undefined/null/mode inválido sem lançar — default seguro 'warn'.
export function readMode(block) {
  return VALID_MODES.has(block && block.mode) ? block.mode : 'warn';
}

// readAllowlist(block): extrai `allowlist` (array) de um bloco de governance. Ausente
// ou malformado ⇒ [] — nunca lança, nunca falso-positivo por efeito colateral.
export function readAllowlist(block) {
  return block && Array.isArray(block.allowlist) ? block.allowlist : [];
}

// governanceFor(graph, family): lê `graph.governance.<family>` ('authz'|'observability')
// de um graph.json completo (ou de qualquer objeto com a mesma forma). Ausência de
// `governance` ou da família ⇒ undefined ⇒ readMode/readAllowlist caem no default
// seguro (REQ-11 AC: ausência de bloco declarativo ⇒ no-op, nunca falso-positivo).
export function governanceFor(graph, family) {
  return graph && graph.governance ? graph.governance[family] : undefined;
}

// applyMode(findings, opts): classifica findings em blocking/warnings conforme o
// contrato acima. `opts` é `{ mode }` já resolvido OU o próprio bloco de governance cru
// (que também carrega `.mode`) — ambos funcionam, então o caller pode escrever tanto
// `applyMode(findings, { mode: 'enforce' })` quanto
// `applyMode(findings, governanceFor(graph, 'authz'))` sem passo extra.
//
// Retorna { blocking, warnings, mode, exitCode } — exitCode é 1 se blocking.length,
// senão 0. O `.sh` do gate usa exitCode diretamente (contrato comum §2.2: OK/exit 0,
// CONFLICT|FAIL/exit≠0; achados rebaixados aparecem como WARN e não mudam o exitCode).
export function applyMode(findings, opts = {}) {
  const mode = readMode(opts);
  const blocking = [];
  const warnings = [];
  for (const f of findings || []) {
    const enforceable = !!(f && f.enforceable === true);
    if (enforceable || mode === 'enforce') blocking.push(f);
    else warnings.push(f);
  }
  return { blocking, warnings, mode, exitCode: blocking.length ? 1 : 0 };
}
