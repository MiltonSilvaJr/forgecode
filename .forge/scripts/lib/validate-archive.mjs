#!/usr/bin/env node
// forge validate archive (§19.3, W3.1) — static pre-flight for /forge:archive
// (doc §13.1). Zero-dependency. Checks, for ONE active change:
//   1. validate-spec passes (full §19.2 rules — invoked logic shared via files)
//      NOTE: callers run validate-spec first; this script re-checks the archive
//      specific conditions:
//   2. status == verified
//   3. spec-delta.yaml present + structurally valid + apply payloads present
//      (add/modify ops carry the structured `requirement` for deterministic apply);
//      exception: manifest.archive.baseline_delta: none sanctions a verified change
//      that does not alter the baseline — spec-delta.yaml must then be absent
//   4. verification.yaml present (checks recorded; no failed check)
//   5. approvals: manifest gates.human_archive_approval == true
//   6. tasks 100% done
//   7. published docs integrity: if .forge/cache/publish.lock exists, docs/product
//      files must match the recorded hashes (no manual edits without baseline origin)
// Output: "OK <id>" or "FAIL (<reasons>)". Usage: validate-archive.mjs <change-dir> [<forge-root>]
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseYamlSubset } from './yaml-lite.mjs';
import { hasScaffoldMarkers } from './scaffold-markers.mjs';
import { impactStatus } from './impact-freshness.mjs';

const dir = process.argv[2];
if (!dir) { console.log('FAIL (usage: validate-archive.mjs <change-dir> [<forge-root>])'); process.exit(1); }
const root = resolve(dir);
const forgeRoot = resolve(process.argv[3] || join(root, '../../../..'));
const errors = [];
const has = (f) => existsSync(join(root, f));
const load = (f) => parseYamlSubset(readFileSync(join(root, f), 'utf8'));

let man = null;
try { man = load('manifest.yaml'); } catch (e) { console.log(`FAIL (manifest.yaml: ${e.message})`); process.exit(1); }

if (man.status !== 'verified') errors.push(`status must be verified (got: ${man.status}) — finish /forge:verify first`);

// spec-delta with deterministic payloads. archive.baseline_delta: none (manifest.yaml) is the
// sanctioned escape hatch for a verified change that does not touch the baseline (pure
// refactor) — validate-spec already rejects a spec-delta.yaml with empty operations and
// suggests removing the file, so its absence here must be a declared, legitimate path, not a
// silent gap. Without the flag, behavior is unchanged: spec-delta.yaml is required.
const baselineDeltaNone = !!(man.archive && man.archive.baseline_delta === 'none');
if (!has('spec-delta.yaml')) {
  if (!baselineDeltaNone)
    errors.push('spec-delta.yaml missing (nothing to apply — §13.1; set archive.baseline_delta: none in manifest.yaml if this change does not alter the baseline)');
} else if (baselineDeltaNone) {
  errors.push('manifest declares baseline_delta: none but spec-delta.yaml exists — remove one');
} else {
  // guard de scaffold: um esqueleto gerado (spec-delta-scaffold.mjs na fase verify) ou o
  // placeholder do template do spec-new nunca podem chegar ao baseline — o conteúdo passa
  // na validação estrutural, mas é texto de preenchimento, não spec.
  const raw = readFileSync(join(root, 'spec-delta.yaml'), 'utf8');
  if (hasScaffoldMarkers(raw))
    errors.push('spec-delta.yaml still has scaffold/template placeholders — fill the payloads in /forge:verify (§2.5) before archiving');
  try {
    const sd = load('spec-delta.yaml');
    const ops = Array.isArray(sd.operations) ? sd.operations : [];
    if (!ops.length) errors.push('spec-delta.yaml: no operations');
    ops.forEach((o, i) => {
      if ((o.op === 'add_requirement' || o.op === 'modify_requirement') && !o.requirement)
        errors.push(`spec-delta operations[${i}] (${o.op} ${o.requirement_id}): structured 'requirement' payload missing — required for deterministic apply`);
      if (o.requirement && o.requirement.id !== o.requirement_id)
        errors.push(`spec-delta operations[${i}]: requirement.id "${o.requirement.id}" != requirement_id "${o.requirement_id}"`);
    });
  } catch (e) { errors.push(`spec-delta.yaml: ${e.message}`); }
}

// ── interruptores de quality declarados em .forge/forge.yaml (LDG-0008) ──────────────────────
// As chaves `quality.require_*` eram publicadas no forge.yaml e no schema e NENHUM código as
// lia: todo adotante instalava um harness que AFIRMA exigir testes antes do archive e não exigia.
// Uma chave que promete ENFORCEMENT e não tem leitor não é um default ausente — é uma afirmação
// falsa sobre o que o harness cobra.
//
// O sinal que prova cada uma foi MEDIDO antes de escrever isto, e nenhum artefato novo foi
// inventado (se nenhum sinal existente servisse, a saída honesta seria remover a chave também):
//   tests        -> `verification.yaml` já registra os checks com nome e status, e
//                   `spec-verify.sh` os nomeia pelas chaves do bloco runtime (`test`,
//                   `typecheck`, `lint`). "Houve teste" = existe um check `test` com
//                   `status: passed`.
//   traceability -> `traceability.yaml` já existe, tem schema próprio e é validado por
//                   `validate-spec.mjs` QUANDO PRESENTE — nunca exigido. "Há rastreabilidade" =
//                   todo requirement que o `spec-delta.yaml` introduz ou modifica aparece no
//                   `traceability.yaml` ligado a ao menos uma TASK. Um change que não mexe em
//                   requirement nenhum não tem o que rastrear, e passa DIZENDO isso.
const readQuality = () => {
  const p = join(forgeRoot, '.forge/forge.yaml');
  if (!existsSync(p)) return {};
  try {
    const y = parseYamlSubset(readFileSync(p, 'utf8'));
    return (y && y.quality) || {};
  } catch { return {}; }
};
const QUALITY = readQuality();
// Ausência da chave NÃO liga o enforcement: o template a entrega com `true`, e um forge.yaml que
// não a declara é de um projeto que nunca a viu.
const wants = (k) => QUALITY[k] === true || QUALITY[k] === 'true';
const declaredOff = (k) => QUALITY[k] === false || QUALITY[k] === 'false';
const notes = [];

// verification evidence
if (!has('verification.yaml')) errors.push('verification.yaml missing (§13.1: checks executed or justified)');
else {
  try {
    const v = load('verification.yaml');
    const checks = v.verification && Array.isArray(v.verification.checks) ? v.verification.checks : [];
    for (const c of checks) if (c.status === 'failed') errors.push(`verification check failed: ${c.name}`);
    if (wants('require_tests_before_archive')) {
      const passedTest = checks.some((c) => /^test\b/i.test(String(c.name || '')) && c.status === 'passed');
      if (!passedTest) {
        const seen = checks.map((c) => `${c.name}:${c.status}`).join(', ') || '(nenhum)';
        errors.push(`quality.require_tests_before_archive: true e verification.yaml não tem nenhum check 'test' com status 'passed' (checks registrados: ${seen}). Declare 'test:' no bloco runtime do FORGE.md e rode /forge:verify, ou desligue a chave explicitamente em .forge/forge.yaml`);
      } else {
        notes.push("quality.require_tests_before_archive: true — check 'test' passou");
      }
    } else if (declaredOff('require_tests_before_archive')) {
      // Uma chave que só bloqueia e nunca reporta a DISPENSA é indistinguível de uma chave que
      // não existe, do ponto de vista de quem audita o archive depois.
      notes.push('quality.require_tests_before_archive: false — dispensa declarada em .forge/forge.yaml; nenhuma evidência de teste foi exigida');
    }
  } catch (e) { errors.push(`verification.yaml: ${e.message}`); }
}

// traceability (mesmo ponto de ancoragem, mesma passagem sobre o pré-flight)
if (wants('require_traceability_before_archive')) {
  const reqIds = [];
  if (has('spec-delta.yaml')) {
    try {
      const sd = load('spec-delta.yaml');
      for (const o of (Array.isArray(sd.operations) ? sd.operations : [])) {
        if ((o.op === 'add_requirement' || o.op === 'modify_requirement') && o.requirement_id) reqIds.push(o.requirement_id);
      }
    } catch { /* já reportado acima */ }
  }
  if (!reqIds.length) {
    notes.push('quality.require_traceability_before_archive: true — o change não introduz nem modifica requirement algum; nada a rastrear');
  } else if (!has('traceability.yaml')) {
    errors.push(`quality.require_traceability_before_archive: true e traceability.yaml ausente — ${reqIds.length} requirement(s) no spec-delta sem rastreabilidade (${reqIds.join(', ')})`);
  } else {
    try {
      const tr = load('traceability.yaml');
      const list = Array.isArray(tr.traceability) ? tr.traceability : [];
      const traced = new Map(list.map((t) => [String(t.requirement_id), Array.isArray(t.tasks) ? t.tasks : []]));
      const missing = reqIds.filter((id) => !(traced.get(String(id)) || []).length);
      if (missing.length) errors.push(`quality.require_traceability_before_archive: true e ${missing.length} requirement(s) sem TASK em traceability.yaml: ${missing.join(', ')}`);
      else notes.push(`quality.require_traceability_before_archive: true — ${reqIds.length} requirement(s) rastreado(s) a TASK`);
    } catch (e) { errors.push(`traceability.yaml: ${e.message}`); }
  }
} else if (declaredOff('require_traceability_before_archive')) {
  notes.push('quality.require_traceability_before_archive: false — dispensa declarada em .forge/forge.yaml; a rastreabilidade não foi exigida');
}

// human archive approval gate
if (!(man.gates && man.gates.human_archive_approval === true))
  errors.push('gates.human_archive_approval is not true (HITL gate — /forge:archive asks via AskUserQuestion)');

// tasks 100%
if (has('tasks.md')) {
  const open = (readFileSync(join(root, 'tasks.md'), 'utf8').match(/^\s*- \[( |-|!)\] /gm) || []).length;
  if (open > 0) errors.push(`${open} open task(s) in tasks.md`);
} else errors.push('tasks.md missing');

// impact freshness (§13.2 step 7, W4.2): if the change declares code affected_paths
// AND a graph exists, an up-to-date impact.json is required (run /forge:impact).
// Julgamento único em impact-freshness.mjs (mesma lógica do auto-recovery [0/6] do archive).
switch (impactStatus(root, forgeRoot)) {
  case 'missing':
    errors.push('impact.json missing — change touches code and a graph exists (run /forge:impact --change <id> before archive, §13.2)');
    break;
  case 'stale':
    errors.push('impact.json is stale vs current graph (re-run /forge:impact --change <id> after /forge:graph update)');
    break;
  default: // fresh | not-applicable
    break;
}

// published docs integrity (round-trip with publish-docs)
const lockPath = join(forgeRoot, '.forge/cache/publish.lock');
if (existsSync(lockPath)) {
  for (const line of readFileSync(lockPath, 'utf8').split('\n').filter(Boolean)) {
    const [hash, rel] = line.split(/\s{2,}|\t/);
    if (!rel) continue;
    const target = join(forgeRoot, rel);
    if (!existsSync(target)) { errors.push(`published file missing vs publish.lock: ${rel}`); continue; }
    const now = createHash('sha256').update(readFileSync(target)).digest('hex');
    if (now !== hash) errors.push(`docs/product changed without baseline origin: ${rel} (republish from product/current — §8.2)`);
  }
}

if (errors.length) { console.log(`FAIL (${errors.join('; ')})`); process.exit(1); }
// As notas saem no VERDE, não só no vermelho: é onde a dispensa declarada vira registro de
// auditoria. Sem elas, "a chave estava em false" e "a chave nunca existiu" leem igual no log.
for (const n of notes) console.log(`  · ${n}`);
console.log(`OK ${man.id}`);
