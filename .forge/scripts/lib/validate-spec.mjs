#!/usr/bin/env node
// forge validate spec — full version (§19.2, W3.1).
// Zero-dependency (Node >= 20). Validates ONE active change folder:
//   1. manifest.yaml parses (yaml-lite subset) and conforms to the rules of
//      spec-manifest.schema.json, re-implemented deterministically here.
//   2. artifacts required by type/scale/status exist (doc §10.3 + §12).
//   3. approvals.yaml (when present) conforms to approvals.schema.json rules
//      (§12.1 decision form + legacy §10.10 form).
//   4. status=verified requires verification.yaml (§12).
//   5. §19.2 content rules: mandatory headings per artifact, no orphan
//      <CHANGE_*> placeholders, no bare NEEDS CLARIFICATION from
//      requirements-ready on (backtick-quoted mentions are instructional),
//      traceability.yaml coherence, spec-delta.yaml structural rules.
//   6. integridade do grafo de tasks (TSK-01..04) e cobertura de superfície
//      (SRF-01) via lib/tasks-graph.mjs, na transição a tasks-ready — os dois
//      checks que o harness especificava como instrução para LLM.
// Output: uma linha de veredito "OK <id>" (exit 0) ou "FAIL (<reasons>)"
// (exit 1), precedida por zero ou mais linhas "WARN (<achado>)" para achados
// rebaixáveis, que não alteram o exit code. Usage:
//   node validate-spec.mjs <path-to-change-dir>
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseYamlSubset } from './yaml-lite.mjs';
import { hasScaffoldMarkers } from './scaffold-markers.mjs';
import { evaluateRedFirst } from './check-red-first.mjs';
import { isDefectFixing } from './defect-scope.mjs';
import { applyMode } from './gate-mode.mjs';
import { parseTasks, checkTasksGraph, parseSurfaceChecklist, checkSurfaceCoverage, checkSurfaceChecklistPresence, checkSurfaceDeclaration, checkSurfaceChecklistLiteral } from './tasks-graph.mjs';
import { parseStories, checkStoryCoverage, checkStoryCycle } from './story-shard.mjs';

const dir = process.argv[2];
if (!dir) { console.log('FAIL (usage: validate-spec.mjs <change-dir>)'); process.exit(1); }
const root = resolve(dir);
const errors = [];
// Achados rebaixáveis: saem como linhas `WARN (...)` antes do veredito e NÃO mudam o exit code.
// O contrato de saída continua tendo exatamente uma linha de veredito (`OK <id>` / `FAIL (...)`).
const warnings = [];

// Paths que o grafo de código classifica `layer:api` — insumo do SRF-01, quando o grafo existe.
// Sem grafo o check opera só com a heurística de nome de path, e nunca por isso deixa de rodar:
// pré-requisito ausente degrada a precisão, não desliga a verificação.
function apiLayerPaths() {
  try {
    const gp = join(process.env.FORGE_ROOT || root, '.forge/graph/graph.json');
    if (!existsSync(gp)) return [];
    const g = JSON.parse(readFileSync(gp, 'utf8'));
    return (Array.isArray(g.nodes) ? g.nodes : []).filter((n) => n && n.layer === 'api').map((n) => n.id);
  } catch { return []; }
}

// ── load manifest ────────────────────────────────────────────────────────────
const manifestPath = join(root, 'manifest.yaml');
if (!existsSync(manifestPath)) { console.log('FAIL (manifest.yaml missing)'); process.exit(1); }
let man;
try { man = parseYamlSubset(readFileSync(manifestPath, 'utf8')); }
catch (e) { console.log(`FAIL (manifest.yaml: ${e.message})`); process.exit(1); }

// ── schema rules (mirror of spec-manifest.schema.json) ──────────────────────
const TYPES = ['feature', 'bugfix', 'refactor', 'greenfield', 'brownfield'];
const MODES = ['greenfield', 'brownfield', 'feature-only'];
const RIGORS = ['spec-anchored', 'spec-first', 'spec-as-source'];
const STATUSES = ['idea', 'proposed', 'requirements-ready', 'design-ready', 'tasks-ready',
  'implementing', 'implemented', 'verified', 'archived',
  'blocked', 'abandoned', 'rejected', 'superseded', 'delivered-externally', 'reopened', 'rolled-back'];
const GATE_KEYS = ['requirements_reviewed', 'design_reviewed', 'tasks_reviewed',
  'implementation_verified', 'human_archive_approval'];
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

for (const k of ['id', 'type', 'mode', 'rigor', 'scale', 'status', 'created_at', 'updated_at', 'owner', 'gates'])
  if (man[k] === undefined || man[k] === null) errors.push(`missing required field: ${k}`);

if (man.id && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(String(man.id))) errors.push(`id not kebab-case: ${man.id}`);
if (man.id && basename(root) !== String(man.id)) errors.push(`id "${man.id}" != folder name "${basename(root)}"`);
if (man.type && !TYPES.includes(man.type)) errors.push(`type invalid: ${man.type} (allowed: ${TYPES.join('|')})`);
if (man.mode && !MODES.includes(man.mode)) errors.push(`mode invalid: ${man.mode} (allowed: ${MODES.join('|')})`);
if (man.rigor && !RIGORS.includes(man.rigor)) errors.push(`rigor invalid: ${man.rigor} (allowed: ${RIGORS.join('|')})`);
if (man.scale !== undefined && man.scale !== null && (!Number.isInteger(man.scale) || man.scale < 0 || man.scale > 4))
  errors.push(`scale must be integer 0..4: ${man.scale}`);
if (man.status && !STATUSES.includes(man.status)) errors.push(`status invalid: ${man.status}`);
for (const k of ['created_at', 'updated_at'])
  if (man[k] && !DATE_RE.test(String(man[k]))) errors.push(`${k} not YYYY-MM-DD: ${man[k]}`);
if (man.gates && typeof man.gates === 'object' && !Array.isArray(man.gates))
  for (const g of GATE_KEYS)
    if (typeof man.gates[g] !== 'boolean') errors.push(`gates.${g} must be boolean`);
// affects_surfaces (REQ-13/NFR-03/§2.5): campo opcional, array de string (ex.: "api", "data").
// Gatilho declarativo de proporcionalidade — consumido pela regra condicional da TASK-09,
// não por este validador. Ausente é válido (change trivial não exige seções novas).
if (man.affects_surfaces !== undefined && man.affects_surfaces !== null) {
  if (!Array.isArray(man.affects_surfaces)) errors.push('affects_surfaces must be an array of strings');
  else man.affects_surfaces.forEach((s, i) => {
    if (typeof s !== 'string') errors.push(`affects_surfaces[${i}] must be a string`);
  });
}

if (man.quick_plan && man.quick_plan.enabled === true) {
  const sp = man.quick_plan.skipped_phases;
  if (!Array.isArray(sp) || sp.length === 0) errors.push('quick_plan.enabled requires non-empty skipped_phases');
  const just = man.quick_plan.justification;
  if (typeof just !== 'string' || just.trim().length < 8) errors.push('quick_plan.enabled requires justification (>= 8 chars)');
}

// ── artifact rules: type/scale/status (doc §10.3 + §12) ─────────────────────
const REQ_ARTIFACT = { bugfix: 'bugfix.md', refactor: 'refactor.md' };
const reqArtifact = REQ_ARTIFACT[man.type] || 'requirements.md';
const has = (f) => existsSync(join(root, f));

const STATUS_ORDER = ['idea', 'proposed', 'requirements-ready', 'design-ready', 'tasks-ready',
  'implementing', 'implemented', 'verified', 'archived'];
const onMainPath = STATUS_ORDER.includes(man.status);
const reached = (s) => onMainPath && STATUS_ORDER.indexOf(man.status) >= STATUS_ORDER.indexOf(s);
const scale = Number.isInteger(man.scale) ? man.scale : 2;

// Dispensa excepcional para a fase de design (LDG-0172; gate w205): mesmo idioma de
// `skipsStorySharding` abaixo, com "design" no lugar de "story-sharding" — a mesma pergunta não
// ganha um segundo dialeto. `quick_plan.enabled: true` com "design" em `skipped_phases` (bloco já
// validado acima — array não-vazio + justification) libera o guard de `design.md` a partir de
// `tasks-ready`. Antes desta dispensa, as quatro superfícies entregues ao adotante davam três
// respostas incompatíveis sobre se o mecanismo existia (validador nunca consultava `quick_plan`
// aqui, `spec-transition.sh` recusava a rota lateral para qualquer `type` que não fosse `bugfix`
// citando esta mesma ausência, o comando `/forge:design` dizia ao adotante que o mecanismo não
// existe, e o CHANGELOG publicado da 0.7.0 afirmava o contrário) — as quatro agora concordam.
const skipsDesign = !!(man.quick_plan && man.quick_plan.enabled === true
  && Array.isArray(man.quick_plan.skipped_phases) && man.quick_plan.skipped_phases.includes('design'));

if (onMainPath && man.status !== 'idea' && !has('proposal.md'))
  errors.push('proposal.md missing (required from status=proposed onward)');
if (reached('requirements-ready') && scale >= 1 && !has(reqArtifact))
  errors.push(`${reqArtifact} missing (required from requirements-ready onward at scale ${scale})`);
if (man.status === 'design-ready' && !has('design.md'))
  errors.push('design.md missing (status design-ready requires it)');
if (reached('tasks-ready')) {
  if (!has('tasks.md')) errors.push('tasks.md missing (required from tasks-ready onward)');
  if (scale >= 2 && man.type !== 'bugfix' && !has('design.md') && !skipsDesign)
    errors.push(`design.md missing (scale ${scale} requires the design phase from tasks-ready onward)`);
  if (scale >= 1 && !has(reqArtifact))
    errors.push(`${reqArtifact} missing (scale ${scale} requires the requirements phase from tasks-ready onward)`);
}
if (reached('verified') && !has('verification.yaml'))
  errors.push('verification.yaml missing (status verified requires recorded evidence — §12)');

// ── red-first (rule testing/regression-red-first.md, itens 1-4 — bloqueiam, não rebaixáveis) ──
// change sujeito à política (isDefectFixing — type:bugfix OU fixes_defects declarado, ver
// lib/defect-scope.mjs) só alcança verified com Red observado (por replay real) ou dispensado
// (waived, com a política dos quatro motivos reaplicada a cada checagem) — espelha o precedente
// hasScaffoldMarkers acima: reprova aqui em vez de deixar o gap chegar ao archive.
//
// LDG-0045: este sítio testava só `man.type === 'bugfix'` direto, sem passar por
// isDefectFixing — um change type:feature com fixes_defects declarado alcançava verified com
// evidência pending sem bloqueio nenhum, divergindo dos demais nove sítios que a issue #138 já
// tinha convertido (check-red-first.mjs, red-evidence-ops.mjs, red-evidence.sh,
// hooks/git/lib/check-red-first.sh, spec-verify.sh).
//
// Onda E (decisão do orquestrador) — sem cache local, a única forma não-circular de confirmar
// 'observed' na transição para verified é executar o replay de VERDADE, agora, e deixar o
// resultado real sobrescrever o artefato (inclusive uma evidência forjada à mão) ANTES de
// avaliar. `red-evidence.sh ensure` roda incondicionalmente aqui — não porque confiamos no
// status já escrito, mas justamente para não precisar confiar: evaluateRedFirst(), logo abaixo,
// lê o que ESTA chamada acabou de gravar, não o que estava lá antes. Só dispara quando a
// transição sob validação é para 'verified' ou além (reached('verified')) — no resto do ciclo de
// vida (idea..implemented) valida sem custo de execução, como sempre. best-effort (nunca lança) —
// evaluateRedFirst decide com o que sobrar, inclusive se ensure falhar ao rodar.
//
// Issue #189: `red-evidence.sh ensure <id>` resolve o change PELO ID em .forge/specs/active/ do
// repositório, não pelo diretório validado. Validar um diretório que não é o change ativo daquele
// id (uma cópia num scratchpad, um change arquivado) regravava em silêncio a evidência do change
// REAL. O replay agora só roda quando o diretório validado É o change ativo (comparação por
// realpath); fora dele a evidência é avaliada como está, sem replay e sem escrita, e a saída diz
// isso numa linha WARN — o OK de um diretório que não é o ativo não é um OK sustentado por replay.
function isActiveChangeDir(id) {
  const activeDir = join(process.env.FORGE_ROOT || root, '.forge/specs/active', String(id));
  try { return realpathSync(activeDir) === realpathSync(root); } catch { return false; }
}
if (reached('verified') && isDefectFixing(man)) {
  const ensureScript = join(process.env.FORGE_ROOT || root, '.forge/scripts/red-evidence.sh');
  if (man.id && !isActiveChangeDir(man.id)) {
    warnings.push(`red-first: replay não executado — ${root} não é o change ativo .forge/specs/active/${man.id}/; evidência avaliada como está, nada gravado (issue #189)`);
  } else if (existsSync(ensureScript) && man.id) {
    try {
      execFileSync('bash', [ensureScript, 'ensure', String(man.id)], {
        cwd: process.env.FORGE_ROOT || root,
        env: { ...process.env, FORGE_ROOT: process.env.FORGE_ROOT || root },
        stdio: 'ignore',
      });
    } catch { /* best-effort — evaluateRedFirst abaixo decide com o estado que resultou */ }
  }
  const redFirst = evaluateRedFirst(root);
  if (redFirst.applicable) {
    const applied = applyMode(redFirst.findings, {});
    for (const f of applied.blocking) errors.push(f.msg); // já referencia a rule no próprio texto
  }
}

// ── approvals.yaml rules (§12.1 — mirror of approvals.schema.json) ──────────
const approvalsPath = join(root, 'approvals.yaml');
if (existsSync(approvalsPath)) {
  let ap;
  try { ap = parseYamlSubset(readFileSync(approvalsPath, 'utf8')); }
  catch (e) { errors.push(`approvals.yaml: ${e.message}`); ap = null; }
  if (ap) {
    const APPROVAL_GATES = [...GATE_KEYS, 'close'];
    const DECISIONS = ['approve', 'review', 'reject', 'supersede', 'abandon', 'block', 'deliver-external'];
    const list = Array.isArray(ap.approvals) ? ap.approvals : null;
    if (!list) errors.push('approvals.yaml: top-level "approvals" list missing');
    else list.forEach((e, i) => {
      const at = `approvals[${i}]`;
      if (!e || typeof e !== 'object') { errors.push(`${at}: not an object`); return; }
      if (e.approved_by && e.approved_at && e.decision === undefined) {
        // legacy §10.10 form (plain approval record) — gate is free-form here
        if (!e.gate) errors.push(`${at}: gate missing (legacy form)`);
        return;
      }
      if (!APPROVAL_GATES.includes(e.gate)) errors.push(`${at}: gate invalid: ${e.gate}`);
      if (!DECISIONS.includes(e.decision)) errors.push(`${at}: decision invalid: ${e.decision}`);
      if (!e.decided_by) errors.push(`${at}: decided_by missing`);
      if (!e.decided_at) errors.push(`${at}: decided_at missing`);
      if (e.decision && e.decision !== 'approve' && !(typeof e.reason === 'string' && e.reason.trim().length >= 3))
        errors.push(`${at}: decision "${e.decision}" requires reason (§12.1)`);
      if (e.decision === 'supersede' && !e.superseded_by)
        errors.push(`${at}: supersede requires superseded_by`);
      if (e.autonomous !== undefined && typeof e.autonomous !== 'boolean')
        errors.push(`${at}: autonomous must be a boolean`);
      if (e.autonomous === true && !(typeof e.reason === 'string' && e.reason.trim().length >= 3))
        errors.push(`${at}: autonomous decision requires reason (§12.2 — a máquina sempre registra a análise)`);
      if (e.iteration !== undefined && e.iteration !== null && (!Number.isInteger(e.iteration) || e.iteration < 1 || e.iteration > 3))
        errors.push(`${at}: iteration must be 1..3 (loop §14.6)`);
    });
  }
}

// ── §19.2 full rules (W3.1): placeholders, clarifications, headings ─────────
const readIf = (f) => (has(f) ? readFileSync(join(root, f), 'utf8') : null);
const MD_ARTIFACTS = ['proposal.md', 'requirements.md', 'bugfix.md', 'refactor.md', 'design.md', 'tasks.md', 'analysis.md', 'verification.md'];

for (const f of MD_ARTIFACTS) {
  const text = readIf(f);
  if (!text) continue;
  const orphan = text.match(/<CHANGE_[A-Z_]+>/);
  if (orphan) errors.push(`${f}: orphan template placeholder ${orphan[0]}`);
  // real NEEDS CLARIFICATION markers block requirements-ready+ (§12). Convention:
  // real markers are bare; instructional mentions are backtick-quoted.
  if (reached('requirements-ready')) {
    const bare = text.split('\n').some((l) => l.includes('NEEDS CLARIFICATION') && !l.includes('`NEEDS CLARIFICATION`'));
    if (bare) errors.push(`${f}: unresolved NEEDS CLARIFICATION (blocks requirements-ready+ — run /forge:clarify)`);
  }
}

// ── helpers for REQ-13/NFR-03 (§2.5): mapas obrigatórios de requirements.md ──
// Extrai o corpo de uma seção "## <heading>" até o próximo "## " (ou fim do arquivo).
function sectionBody(text, headingRe) {
  const m = headingRe.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const nextIdx = rest.search(/^##\s/m);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}
// Uma seção "preenchida" tem ao menos uma linha de tabela (fora do header/separador) sem
// placeholder "<...>" — distingue o esqueleto do template (reprova) de uma tabela real (passa).
function hasFilledTableRow(body) {
  if (!body) return false;
  const rows = body.split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
  return rows.slice(1).some((r) => r.trim().length > 0 && !/<[^<>]*>/.test(r));
}

const headingRules = [
  ['proposal.md', /^## 1\./m, 'section "## 1." (why)'],
  ['proposal.md', /^## 2\./m, 'section "## 2." (what changes)'],
  ['bugfix.md', /comportamento atual/i, 'current-behavior section'],
  ['bugfix.md', /root cause/i, 'root-cause section'],
  ['refactor.md', /invariantes/i, 'invariants section'],
];
for (const [f, re, what] of headingRules) {
  const text = readIf(f);
  if (text && !re.test(text)) errors.push(`${f}: missing ${what}`);
}
if (reached('requirements-ready') && man.type !== 'bugfix' && man.type !== 'refactor' && scale >= 1) {
  const text = readIf('requirements.md');
  if (text && !/^## REQ-/m.test(text)) errors.push('requirements.md: no "## REQ-" entries');
  if (text && !/critérios de aceite/i.test(text)) errors.push('requirements.md: no acceptance criteria (testability — §19.2)');
}
// REQ-13/NFR-03 (§2.5): change cujo manifest declara affects_surfaces incluindo "api" exige,
// em requirements.md, o mapa endpoint→ação→recurso→policy e o mapa de eventos auditáveis
// preenchidos. Proporcionalidade: affects_surfaces ausente (ou sem "api") não exige nada aqui —
// mesma guarda de reached('requirements-ready')/tipo/scale do bloco de REQ- acima.
if (reached('requirements-ready') && man.type !== 'bugfix' && man.type !== 'refactor' && scale >= 1
  && Array.isArray(man.affects_surfaces) && man.affects_surfaces.includes('api')) {
  const text = readIf(reqArtifact) || '';
  const endpointBody = sectionBody(text, /^##\s*Mapa endpoint.*policy\s*$/im);
  const auditBody = sectionBody(text, /^##\s*Mapa de eventos audit[áa]veis\s*$/im);
  if (!hasFilledTableRow(endpointBody))
    errors.push(`${reqArtifact}: missing endpoint→ação→recurso→policy map (required — affects_surfaces includes "api", REQ-13)`);
  if (!hasFilledTableRow(auditBody))
    errors.push(`${reqArtifact}: missing auditable events map (required — affects_surfaces includes "api", REQ-13)`);
}
if (reached('tasks-ready')) {
  const text = readIf('tasks.md');
  if (text && !/^\s*- \[( |-|X|!)\] TASK-[0-9]+/m.test(text)) errors.push('tasks.md: no TASK-NN entries');
  // TSK-01..04 + SRF-01 (lib/tasks-graph.mjs): substituem a auto-checagem por LLM de
  // `commands/specs/tasks.md` §2 e o item 6 de `commands/specs/analyze.md`. Um invariante
  // estrutural verificado por um modelo é um invariante que às vezes não é verificado — foi assim
  // que uma dependência de Wave 4 para Wave 7 atravessou um plano de 89 tasks.
  if (text) {
    const parsed = parseTasks(text);
    for (const f of checkTasksGraph(parsed)) {
      if (f.enforceable) errors.push(`${f.code} ${f.msg}`);
      else warnings.push(`${f.code} ${f.msg}`);      // TSK-04 furo, TSK-05 não-verificável
    }
    // SRF-01 cruza o "Checklist de cobertura de superfície" do requirements.md contra o grafo de
    // tasks. Rebaixável por calibração: sem oráculo de código (SUR-01), o achado não distingue
    // "a rota não existe" de "a task que a entregou declarou `paths:` incompleto".
    // SRF-00 antes de tudo: é a porta que, fechada, torna obrigatório o que vem depois. Roda com o
    // grafo quando ele existe (para reconhecer projeto cujo nome não denuncia a camada) e sem ele
    // quando não existe — degrada a precisão, nunca desliga.
    // respeita `enforceable` como todo o resto: empurrar SRF-00 direto para `errors` fazia o campo
    // ser decorativo, e um campo decorativo é um campo que ninguém percebe quando muda de valor.
    // SRF-03 (LDG-0010): célula de superfície de API escrita em prosa, sem `VERB /path`. Aviso —
    // é o insumo que falta para o SRF-01 poder cruzar contra as rotas reais.
    for (const f of checkSurfaceChecklistLiteral(parseSurfaceChecklist(readIf('requirements.md') || ''))) {
      if (f.enforceable) errors.push(`${f.code} ${f.msg}`);
      else warnings.push(`${f.code} ${f.msg}`);
    }
    for (const f of checkSurfaceDeclaration(man, parsed, { apiPaths: apiLayerPaths() })) {
      if (f.enforceable) errors.push(`${f.code} ${f.msg}`);
      else warnings.push(`${f.code} ${f.msg}`);
    }
    const reqText = readIf(reqArtifact);
    if (reqText) {
      const rows = parseSurfaceChecklist(reqText);
      // SRF-02 primeiro: sem Checklist preenchido o SRF-01 não roda, e "não rodou" precisa aparecer.
      // Silenciar aqui reproduziria, no script, a falha que ele veio corrigir no comando.
      for (const f of checkSurfaceChecklistPresence(reqText)) warnings.push(`${f.code} ${f.msg}`);
      // Sem applyMode: todos os findings de SRF-01 nascem rebaixáveis e o mode aqui seria sempre
      // 'warn', então o ramo blocking era código morto. A promoção a bloqueante é `opts.enforceable`
      // da própria lib, e passa a ser exercida quando houver oráculo de código para confirmá-la.
      for (const f of checkSurfaceCoverage(rows, parsed, { apiPaths: apiLayerPaths() }))
        warnings.push(`${f.code} ${f.msg}`);
    }
  }
}

// ── story sharding obrigatória em scale >= 3 (§17.1 — issue #35) ────────────
// O contrato scale-adaptive (spec.md tabela de scale, tasks.md, spec-manifest.schema.json) já
// declarava que scale >= 3 soma story sharding ao fluxo, mas nada verificava isso antes de
// `/forge:implement` entrar no loop TASK a TASK — `dev_loop.sharded` podia ficar `false` para
// sempre e a implementação seguia em silêncio, sem `epic_context.md` nem stories auto-contidas.
// Roda a partir de `implementing` (onde o loop de execução de fato começa) — como todo o resto
// deste arquivo, é chamado por `spec-transition.sh` ANTES da transição ser persistida (com
// rollback se reprovar), então cobre tanto a chamada direta de `/forge:implement` quanto a
// transição `tasks-ready -> implementing`.
//
// Dispensa excepcional: `quick_plan.enabled: true` com "story-sharding" em
// `quick_plan.skipped_phases` (bloco já validado acima — array não-vazio + justification).
// Aceita tanto block style (`- story-sharding`) quanto flow style (`[story-sharding]`) — desde
// que o LDG-0033 fechou, yaml-lite.mjs parseia as duas formas como array; antes disso, flow
// style virava string literal, falhava o `Array.isArray(sp)` do bloco de quick_plan acima e
// reprovava fechado (nunca concedia a dispensa em silêncio — mas também não a concedia em
// flow style). ver tests/w162-yaml-lite-flow-array-gate.sh e w138 [10]/[11] (as duas formas).
const skipsStorySharding = !!(man.quick_plan && man.quick_plan.enabled === true
  && Array.isArray(man.quick_plan.skipped_phases) && man.quick_plan.skipped_phases.includes('story-sharding'));
if (reached('implementing') && scale >= 3 && !skipsStorySharding) {
  const HINT = 'run /forge:shard <change-id> before /forge:implement';
  const devLoop = (man.dev_loop && typeof man.dev_loop === 'object') ? man.dev_loop : {};
  if (devLoop.sharded !== true)
    errors.push(`scale >= 3 requires story sharding: dev_loop.sharded is not true (${HINT})`);
  if (devLoop.epic_context_compiled !== true)
    errors.push(`scale >= 3 requires story sharding: dev_loop.epic_context_compiled is not true (${HINT})`);
  if (devLoop.sharded === true && devLoop.epic_context_compiled === true) {
    const tasksText = readIf('tasks.md') || '';
    const parsedTasks = parseTasks(tasksText);
    const taskIds = [...new Set(parsedTasks.tasks.map((t) => t.id))];
    if (!taskIds.length) {
      // Vacuidade: tasks.md sem nenhuma TASK-NN não é "nada para cobrir" — é FAIL explícito,
      // igual a stories/ vazio logo abaixo (regra 3 do harness: conjunto varrido vazio nunca é OK
      // por não ter achado nada).
      errors.push(`scale >= 3 requires story sharding: tasks.md has no TASK-NN entries to cover (${HINT})`);
    } else {
      const storiesDir = join(root, devLoop.stories_path || 'stories/');
      const { stories, errors: storyErrors } = parseStories(storiesDir);
      if (storyErrors.length) {
        for (const e of storyErrors) errors.push(`scale >= 3 requires story sharding: ${e} (${HINT})`);
      } else {
        for (const f of checkStoryCoverage(taskIds, stories)) errors.push(`scale >= 3 requires story sharding: ${f} (${HINT})`);
        for (const f of checkStoryCycle(stories)) errors.push(`scale >= 3 requires story sharding: ${f} (${HINT})`);
      }
    }
  }
}

// ── traceability.yaml coherence (§19.2) ─────────────────────────────────────
if (has('traceability.yaml')) {
  try {
    const tr = parseYamlSubset(readFileSync(join(root, 'traceability.yaml'), 'utf8'));
    const list = Array.isArray(tr.traceability) ? tr.traceability : null;
    if (!list) errors.push('traceability.yaml: top-level "traceability" list missing');
    else {
      const reqText = readIf(reqArtifact) || '';
      const tasksText = readIf('tasks.md') || '';
      list.forEach((t, i) => {
        if (!t.requirement_id) { errors.push(`traceability[${i}]: requirement_id missing`); return; }
        if (reqText && !reqText.includes(String(t.requirement_id)))
          errors.push(`traceability[${i}]: ${t.requirement_id} not found in ${reqArtifact}`);
        const tasks = Array.isArray(t.tasks) ? t.tasks : [];
        if (!tasks.length) errors.push(`traceability[${i}]: ${t.requirement_id} has no tasks`);
        for (const tk of tasks)
          if (tasksText && !tasksText.includes(String(tk))) errors.push(`traceability[${i}]: ${tk} not found in tasks.md`);
      });
    }
  } catch (e) { errors.push(`traceability.yaml: ${e.message}`); }
}

// ── spec-delta.yaml structural rules (§19.2 — mirror of spec-delta.schema) ──
if (has('spec-delta.yaml')) {
  // de verified em diante o delta precisa estar AUTORADO: esqueleto/placeholder de scaffold
  // reprova aqui (é o comando que o /forge:verify §2.5 manda rodar após a autoria), não só
  // no pré-flight do archive sessões depois. Antes de verified o esqueleto é estado legítimo.
  if (reached('verified') && hasScaffoldMarkers(readFileSync(join(root, 'spec-delta.yaml'), 'utf8')))
    errors.push('spec-delta.yaml still has scaffold/template placeholders (blocks verified — fill the payloads in /forge:verify §2.5, or remove the file if the change does not alter the baseline)');
  try {
    const sd = parseYamlSubset(readFileSync(join(root, 'spec-delta.yaml'), 'utf8'));
    const ops = Array.isArray(sd.operations) ? sd.operations : null;
    if (!ops || !ops.length) errors.push('spec-delta.yaml: operations list missing/empty');
    else ops.forEach((o, i) => {
      const at = `spec-delta operations[${i}]`;
      const OPS = ['add_requirement', 'modify_requirement', 'remove_requirement', 'add_contract', 'remove_capability'];
      if (!OPS.includes(o.op)) { errors.push(`${at}: op invalid: ${o.op}`); return; }
      if (o.op !== 'add_contract' && o.op !== 'remove_capability' && (!o.capability || !o.requirement_id))
        errors.push(`${at}: capability/requirement_id missing`);
      if (o.op === 'remove_requirement' && !o.reason) errors.push(`${at}: remove requires reason`);
      if (o.op === 'add_contract' && (!o.contract_type || !o.path)) errors.push(`${at}: contract_type/path missing`);
      if (o.op === 'remove_capability' && (!o.capability || !o.reason)) errors.push(`${at}: capability/reason missing`);
    });
  } catch (e) { errors.push(`spec-delta.yaml: ${e.message}`); }
}

// ── verdict ──────────────────────────────────────────────────────────────────
for (const w of warnings) console.log(`WARN (${w})`);
if (errors.length) { console.log(`FAIL (${errors.join('; ')})`); process.exit(1); }
console.log(`OK ${man.id}`);
