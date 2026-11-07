#!/usr/bin/env node
// forge check-authz (TASK-14, REQ-05/06/07/08, design.md §2.2 "Os três gates").
// Zero-dependência — nenhum `opa`/pacote npm em runtime (NFR-01). Quatro sub-checks:
//
//   REQ-05 deny-by-default em .rego        — SEMPRE enforce (enforceable:true).
//   REQ-06 decisão imperativa fora do PEP  — rebaixável (enforceable:false).
//   REQ-07 cobertura de política x threshold — rebaixável (enforceable:false).
//   REQ-08 rota layer:api sem caminho ao PEP — rebaixável (enforceable:false), via graph-govern.
//
// O modo warn|enforce (REQ-16) vem do bloco `governance.authz` do graph.json (materializado
// por graph-build.mjs a partir do `authz:` do FORGE.md) e é aplicado por lib/gate-mode.mjs —
// só aos sub-checks rebaixáveis; REQ-05 ignora o mode e sempre bloqueia no achado (REQ-01(b)).
// Ausência do bloco `authz:` ⇒ REQ-06/07/08 em no-op (nunca falso-positivo, REQ-11 AC).
//
// Usage: check-authz.mjs <path|file...> [--coverage-report <path>]
//   FORGE_ROOT (env, default cwd) — raiz do projeto: usada para localizar
//   .forge/graph/graph.json (bloco governance.authz) e para relativizar paths reportados,
//   o mesmo referencial que pep_paths/allowlist declaram no FORGE.md (§2.3).
// Output: "OK check-authz (...)" (exit 0) | "CONFLICT (...)"/"WARN (...)" (exit 1 se blocking).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { collect, scan } from './source-scan.mjs';
import { govern, pathMatches } from './graph-govern.mjs';
import { applyMode, governanceFor } from './gate-mode.mjs';
import { universeCheck, emitUniverse } from './gate-universe.mjs';

// ── args: separa --coverage-report <path> (REQ-07) dos paths de entrada ──────────────
const argv = process.argv.slice(2);
let coverageReportPath;
const inputs = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--coverage-report') { coverageReportPath = argv[++i]; continue; }
  inputs.push(argv[i]);
}

const root = resolve(process.env.FORGE_ROOT || '.');
const rel = (f) => relative(root, resolve(f)) || '.';

// Nota: `inputs` vazio NÃO é tratado como early-exit — REQ-07 (cobertura) e REQ-08 (rota→PEP)
// não dependem de paths de código, só do graph.json/relatório de cobertura; só REQ-05/06
// (varredura de arquivo) ficam vazios nesse caso, sem gerar falso-positivo (collect([]) = []).
// O que MUDOU (issue #49): não gerar falso-positivo não autoriza reportar-se verde. Se o conjunto
// varrido por REQ-05/06 vier VAZIO — alvo errado, glob que não casa, repositório sem código nas
// extensões conhecidas — o gate não examinou nada, e isso é um estado próprio, contado e
// reprovável, não o mesmo `OK` de quem varreu o repositório inteiro e não achou violação.

// ── graph.json + bloco governance.authz (ausente ⇒ {} ⇒ sub-checks dependentes no-op) ──
const graphPath = join(root, '.forge/graph/graph.json');
let graph = {};
if (existsSync(graphPath)) {
  try { graph = JSON.parse(readFileSync(graphPath, 'utf8')); } catch { graph = {}; } // malformado ⇒ no-op, nunca falso-positivo
}
const authzBlock = governanceFor(graph, 'authz');

// findings uniformes: { enforceable, msg } — msg já formatado "rel[:linha]: motivo".
const findings = [];

// ── REQ-05 — deny-by-default em .rego (SEMPRE enforce) ────────────────────────────────
// Regex sobre o texto Rego (não invoca `opa` — NFR-01); fragilidade documentada como
// limitação (design §3/§6), mitigada por fixtures. Verificação é por arquivo (um
// package por arquivo nas fixtures/convenção do harness).
const regoFiles = collect(inputs, { exts: new Set(['.rego']) });
const DENY_DEFAULT_RE = /default\s+allow\s*(?::=|=)\s*false\b/;
const ALLOW_TRUE_DEFAULT_RE = /default\s+allow\s*(?::=|=)\s*true\b/;
const UNCONDITIONAL_ALLOW_RE = /^\s*allow\s*(?::=|=)\s*true\s*$/m;
const UNCONDITIONAL_ALLOW_BLOCK_RE = /allow\s*(?:\{\s*true\s*\}|if\s+true\b)/;
for (const f of regoFiles) {
  const r = rel(f);
  const text = readFileSync(f, 'utf8');
  if (ALLOW_TRUE_DEFAULT_RE.test(text)) {
    findings.push({ enforceable: true, msg: `${r}: default allow := true — viola deny-by-default (REQ-05)` });
  } else if (UNCONDITIONAL_ALLOW_RE.test(text) || UNCONDITIONAL_ALLOW_BLOCK_RE.test(text)) {
    findings.push({ enforceable: true, msg: `${r}: allow incondicional — viola deny-by-default (REQ-05)` });
  } else if (!DENY_DEFAULT_RE.test(text)) {
    findings.push({ enforceable: true, msg: `${r}: package sem "default allow := false" (REQ-05)` });
  }
}

// ── REQ-06 — decisão imperativa fora do PEP (rebaixável) ──────────────────────────────
// Matriz ANTI por stack (Go/Kotlin/TS), aplicada só a arquivos FORA do(s) pep_paths
// declarado(s) em governance.authz.pep_paths. Dentro do PEP → isento (é o próprio
// mecanismo de decisão, não um anti-padrão).
const ANTI_IMPERATIVE = [
  { re: /\bhasRole\s*\(/, why: 'hasRole(...) — decisão de acesso imperativa fora do PEP (REQ-06)', allow: /\/\/\s*pep-allow/ },
  { re: /\buser\.role\s*==/, why: 'user.role == ... — decisão de acesso imperativa fora do PEP (REQ-06)', allow: /\/\/\s*pep-allow/ },
  { re: /claims\[["']permissions["']\]/, why: 'claims["permissions"] — claim usada como decisão, não insumo do PEP (REQ-06)', allow: /\/\/\s*pep-allow/ },
  { re: /@(?:RolesAllowed|Secured|PreAuthorize)\s*\(/, why: 'decorator de role ad-hoc — decisão de acesso fora do PEP (REQ-06)', allow: /\/\/\s*pep-allow/ },
];
const codeFiles = collect(inputs, { exts: new Set(['.go', '.kt', '.kts', '.ts', '.tsx']) });
const pepPaths = (authzBlock && Array.isArray(authzBlock.pep_paths)) ? authzBlock.pep_paths : [];
const outsidePep = codeFiles.filter((f) => !pathMatches(rel(f), pepPaths));
for (const msg of scan(outsidePep, ANTI_IMPERATIVE, { rel })) {
  findings.push({ enforceable: false, msg: `${msg} (REQ-06)` });
}

// ── REQ-07 — cobertura de política x threshold (rebaixável; sem threshold ⇒ no-op) ────
// Lê o VALOR REPORTADO de um relatório fornecido via --coverage-report (JSON
// { "coverage": <0..1> }); a geração do relatório (ex.: `opa test --coverage`) é do
// projeto consumidor (REQ-07/Notas) — este gate não invoca `opa` (NFR-01).
const threshold = authzBlock && typeof authzBlock.policy_coverage_threshold === 'number'
  ? authzBlock.policy_coverage_threshold : undefined;
if (threshold !== undefined) {
  let coverage;
  if (coverageReportPath && existsSync(coverageReportPath)) {
    try {
      const report = JSON.parse(readFileSync(coverageReportPath, 'utf8'));
      if (typeof report.coverage === 'number') coverage = report.coverage;
    } catch { /* relatório malformado ⇒ tratado como ausente abaixo */ }
  }
  if (coverage === undefined) {
    findings.push({ enforceable: false, msg: `policy_coverage_threshold declarado (${threshold}) mas nenhum relatório de cobertura legível via --coverage-report (REQ-07)` });
  } else if (coverage < threshold) {
    findings.push({ enforceable: false, msg: `cobertura de política ${coverage} < threshold ${threshold} (REQ-07)` });
  }
}

// ── REQ-08 — rota layer:api sem caminho ao PEP (rebaixável; delega a graph-govern) ─────
// govern() já é no-op automático quando graph.governance está ausente (REQ-11 AC).
const governed = govern(graph);
for (const id of governed.authz.findings) {
  findings.push({ enforceable: false, msg: `${id}: rota layer:api sem caminho (import direto/transitivo) ao PEP declarado (REQ-08)` });
}

// ── modo warn|enforce (REQ-16): rebaixa só os findings enforceable:false ──────────────
const result = applyMode(findings, authzBlock);

const lines = [];
if (result.blocking.length) lines.push(`CONFLICT (${result.blocking.map((f) => f.msg).join('; ')})`);
if (result.warnings.length) lines.push(`WARN (${result.warnings.map((f) => f.msg).join('; ')})`);
if (lines.length) { console.log(lines.join('\n')); process.exit(result.exitCode); }

// ── contador de controle (issue #49) — antes do OK, e capaz de reprová-lo ─────────────
const universe = universeCheck({
  root,
  gate: 'authz',
  count: regoFiles.length + codeFiles.length,
  item: 'arquivo(s)',
  scope: inputs.length ? inputs.join(' ') : '(nenhum path recebido)',
});
if (emitUniverse(universe) !== 0) process.exit(1);
console.log(`OK check-authz (${regoFiles.length} .rego, ${codeFiles.length} código, mode=${result.mode})`);
