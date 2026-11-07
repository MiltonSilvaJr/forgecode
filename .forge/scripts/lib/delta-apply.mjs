#!/usr/bin/env node
// forge delta apply (§13.2 steps 2-5, W3.2). Zero-dependency. Applies the
// operations of a change's spec-delta.yaml to the baseline capabilities:
//   - loads target capabilities (creates new ones for add on missing capability)
//   - applies ops IN MEMORY: add_requirement, modify_requirement (FULL
//     REPLACEMENT of the requirement object — never a merge), remove_requirement
//     (physical removal + history note), add_contract (appends to requirement),
//     remove_capability (physical removal of the whole capability directory —
//     for empty/seed capabilities by default; requirements:[] is the safety
//     rail, `force: true` is required to remove a capability that still has
//     requirements, so a verified spec is never dropped by accident)
//   - validates every resulting capability against the baseline-capability rules
//   - --dry-run: prints the plan, writes NOTHING
//   - apply: write-temp + atomic rename per capability + history append +
//     semver bump (remove: major; add: minor; modify/contract: patch — the
//     highest applicable bump wins, once per capability per archive);
//     remove_capability has no surviving capability to version — it deletes the
//     directory outright (recorded in the change's spec-delta.yaml, which the
//     archive script folds into product/current/CHANGELOG.md — capability id +
//     op count already, generically, for every op type)
// Usage: delta-apply.mjs <change-dir> <forge-root> [--dry-run]
// Output: one line per capability + final "OK ..." / "FAIL (...)".
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { parseYamlSubset, yamlQuote as q } from './yaml-lite.mjs';

const changeDir = process.argv[2];
const forgeRoot = process.argv[3];
const dryRun = process.argv.includes('--dry-run');
if (!changeDir || !forgeRoot) { console.log('FAIL (usage: delta-apply.mjs <change-dir> <forge-root> [--dry-run])'); process.exit(1); }
const root = resolve(forgeRoot);
const dir = resolve(changeDir);
const changeId = basename(dir);
const CAPS = join(root, '.forge/product/current/capabilities');
const today = new Date().toISOString().slice(0, 10);

// ── load delta ────────────────────────────────────────────────────────────────
let delta;
try { delta = parseYamlSubset(readFileSync(join(dir, 'spec-delta.yaml'), 'utf8')); }
catch (e) { console.log(`FAIL (spec-delta.yaml: ${e.message})`); process.exit(1); }
const ops = Array.isArray(delta.operations) ? delta.operations : [];
if (!ops.length) { console.log('FAIL (spec-delta.yaml has no operations)'); process.exit(1); }

// ── load/instantiate target capabilities ────────────────────────────────────
const caps = new Map(); // capId -> { data, isNew, bump }
function capOf(id) {
  if (!caps.has(id)) {
    const p = join(CAPS, id, 'spec.yaml');
    if (existsSync(p)) caps.set(id, { data: parseYamlSubset(readFileSync(p, 'utf8')), isNew: false, bump: 0 });
    else caps.set(id, { data: { capability_id: id, version: '0.1.0', status: 'current', requirements: [], history: [] }, isNew: true, bump: 0 });
  }
  return caps.get(id);
}

// ── apply ops in memory ───────────────────────────────────────────────────────
const errors = [];
const BUMP = { patch: 1, minor: 2, major: 3 };
const summary = [];
const removals = new Map(); // capId -> { reason, requirementCount }

for (const [i, o] of ops.entries()) {
  const at = `operations[${i}]`;
  if (o.op === 'add_requirement' || o.op === 'modify_requirement') {
    if (!o.requirement) { errors.push(`${at}: structured requirement payload missing`); continue; }
    const cap = capOf(o.capability);
    const reqs = Array.isArray(cap.data.requirements) ? cap.data.requirements : (cap.data.requirements = []);
    const idx = reqs.findIndex((r) => r.id === o.requirement_id);
    if (o.op === 'add_requirement') {
      if (idx >= 0) { errors.push(`${at}: ${o.requirement_id} already exists in ${o.capability} (use modify_requirement)`); continue; }
      reqs.push(o.requirement);
      cap.bump = Math.max(cap.bump, BUMP.minor);
      summary.push(`add ${o.requirement_id} -> ${o.capability}`);
    } else {
      if (idx < 0) { errors.push(`${at}: ${o.requirement_id} not found in ${o.capability}`); continue; }
      reqs[idx] = o.requirement; // FULL REPLACEMENT — never a merge (§10.4)
      cap.bump = Math.max(cap.bump, BUMP.patch);
      summary.push(`modify ${o.requirement_id} in ${o.capability} (full replacement)`);
    }
  } else if (o.op === 'remove_requirement') {
    const cap = capOf(o.capability);
    const reqs = Array.isArray(cap.data.requirements) ? cap.data.requirements : [];
    const idx = reqs.findIndex((r) => r.id === o.requirement_id);
    if (idx < 0) { errors.push(`${at}: ${o.requirement_id} not found in ${o.capability}`); continue; }
    reqs.splice(idx, 1);
    cap.removeNote = `removed ${o.requirement_id}: ${o.reason || ''}${o.migration ? `; migration: ${o.migration}` : ''}`;
    cap.bump = Math.max(cap.bump, BUMP.major);
    summary.push(`remove ${o.requirement_id} from ${o.capability}`);
  } else if (o.op === 'add_contract') {
    if (!o.capability || !o.requirement_id) { errors.push(`${at}: add_contract needs capability + requirement_id for deterministic apply`); continue; }
    const cap = capOf(o.capability);
    const req = (cap.data.requirements || []).find((r) => r.id === o.requirement_id);
    if (!req) { errors.push(`${at}: ${o.requirement_id} not found in ${o.capability}`); continue; }
    req.contracts = Array.isArray(req.contracts) ? req.contracts : [];
    if (!req.contracts.includes(o.path)) req.contracts.push(o.path);
    cap.bump = Math.max(cap.bump, BUMP.patch);
    summary.push(`contract ${o.path} -> ${o.capability}/${o.requirement_id}`);
  } else if (o.op === 'remove_capability') {
    const capId = String(o.capability || '');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(capId)) { errors.push(`${at}: capability id invalid: ${o.capability}`); continue; }
    if (!o.reason) { errors.push(`${at}: remove_capability requires reason`); continue; }
    const capFile = join(CAPS, capId, 'spec.yaml');
    if (!existsSync(capFile)) { errors.push(`${at}: capability ${capId} not found (nothing to remove)`); continue; }
    let existing;
    try { existing = parseYamlSubset(readFileSync(capFile, 'utf8')); }
    catch (e) { errors.push(`${at}: capability ${capId} spec.yaml unreadable: ${e.message}`); continue; }
    const reqCount = Array.isArray(existing.requirements) ? existing.requirements.length : 0;
    // safety rail: only empty/seed capabilities (requirements: []) are removable by default —
    // a capability that already carries verified requirements needs explicit `force: true`,
    // so a spec is never dropped from the baseline by accident.
    if (reqCount > 0 && o.force !== true) {
      errors.push(`${at}: capability ${capId} has ${reqCount} requirement(s) — pass force: true to remove a non-empty capability`);
      continue;
    }
    removals.set(capId, { reason: o.reason, requirementCount: reqCount });
    summary.push(`remove capability ${capId}`);
  } else {
    errors.push(`${at}: op invalid: ${o.op}`);
  }
}

// a capability cannot be both modified/added-to and removed by the same delta —
// the ops would contradict each other about whether the directory survives.
for (const id of removals.keys())
  if (caps.has(id)) errors.push(`operations: capability ${id} is both modified and removed in the same delta`);

// ── validate resulting capabilities (mirror of baseline-capability.schema) ──
const NORM = ['SHALL', 'SHALL NOT', 'SHOULD', 'SHOULD NOT', 'MAY'];
for (const [id, cap] of caps) {
  const d = cap.data;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(d.capability_id || ''))) errors.push(`${id}: capability_id invalid`);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(String(d.version || ''))) errors.push(`${id}: version not semver`);
  for (const r of d.requirements || []) {
    if (!/^REQ-[A-Z0-9]+-[0-9]+$/.test(String(r.id || ''))) errors.push(`${id}: requirement id invalid: ${r.id}`);
    if (!r.title || String(r.title).length < 3) errors.push(`${id}/${r.id}: title missing`);
    if (!NORM.includes(r.normative)) errors.push(`${id}/${r.id}: normative invalid: ${r.normative}`);
    for (const s of r.scenarios || [])
      if (!s.id || !s.given || !s.when || !s.then) errors.push(`${id}/${r.id}: scenario incomplete: ${s.id || '(no id)'}`);
  }
}

if (errors.length) { console.log(`FAIL (${errors.join('; ')})`); process.exit(1); }

// ── bump versions + history ──────────────────────────────────────────────────
for (const [id, cap] of caps) {
  if (!cap.isNew && cap.bump > 0) {
    const [ma, mi, pa] = cap.data.version.split('.').map(Number);
    cap.data.version = cap.bump === BUMP.major ? `${ma + 1}.0.0` : cap.bump === BUMP.minor ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
  }
  cap.data.history = Array.isArray(cap.data.history) ? cap.data.history : [];
  const entry = { change_id: changeId, archived_at: today };
  if (cap.removeNote) entry.note = cap.removeNote;
  cap.data.history.push(entry);
}

// ── emit ─────────────────────────────────────────────────────────────────────
function capToYaml(d) {
  const L = [];
  L.push(`capability_id: ${d.capability_id}`);
  L.push(`version: ${d.version}`);
  L.push(`status: ${d.status}`);
  L.push('requirements:');
  for (const r of d.requirements || []) {
    L.push(`  - id: ${r.id}`);
    L.push(`    title: ${q(r.title)}`);
    L.push(`    normative: ${q(r.normative)}`);
    if (r.scenarios && r.scenarios.length) {
      L.push('    scenarios:');
      for (const s of r.scenarios) {
        L.push(`      - id: ${s.id}`);
        L.push(`        given: ${q(s.given)}`);
        L.push(`        when: ${q(s.when)}`);
        L.push(`        then: ${q(s.then)}`);
      }
    }
    if (r.contracts && r.contracts.length) { L.push('    contracts:'); for (const c of r.contracts) L.push(`      - ${c}`); }
    if (r.tests && r.tests.length) { L.push('    tests:'); for (const t of r.tests) L.push(`      - ${t}`); }
  }
  if (!(d.requirements || []).length) L[L.length - 1] = 'requirements: []';
  L.push('history:');
  for (const h of d.history || []) {
    L.push(`  - change_id: ${h.change_id}`);
    L.push(`    archived_at: ${q(h.archived_at)}`);
    if (h.note) L.push(`    note: ${q(h.note)}`);
  }
  return L.join('\n') + '\n';
}

if (dryRun) {
  for (const s of summary) console.log(`  plan: ${s}`);
  console.log(`OK dry-run (${caps.size + removals.size} capability(ies) would change; nothing written)`);
  process.exit(0);
}

for (const [id, cap] of caps) {
  const capDir = join(CAPS, id);
  mkdirSync(capDir, { recursive: true });
  const tmp = join(capDir, '.spec.yaml.tmp');
  writeFileSync(tmp, capToYaml(cap.data));
  renameSync(tmp, join(capDir, 'spec.yaml'));
  console.log(`  applied: ${id} v${cap.data.version}${cap.isNew ? ' (new)' : ''}`);
}
for (const [id, r] of removals) {
  const capDir = join(CAPS, id);
  // capDir is always CAPS/<id> with <id> pattern-validated above — recursive removal never
  // reaches outside .forge/product/current/capabilities.
  rmSync(capDir, { recursive: true, force: true });
  console.log(`  removed: ${id} (${r.reason})`);
}
console.log(`OK applied (${caps.size + removals.size} capability(ies))`);
