#!/usr/bin/env node
// forge baseline extract (brownfield §11.2, W4.2). Zero-dependency. Proposes
// capability STUBS for an empty baseline from the code graph boundaries — the
// DETERMINISTIC half: it groups graphed files by their top boundary (first path
// segment under src/services/apps/packages/modules) into candidate capabilities,
// writing spec.yaml stubs (no requirements — those are semantic, curated later
// by an agent or by archiving real changes). Refuses to overwrite existing caps.
//
// Usage: baseline-extract.mjs <forge-root> [--dry-run]
// Output: "OK extracted N capability stub(s)" + list, or "FAIL/OK (...)".
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const dryRun = process.argv.includes('--dry-run');
const graphPath = join(root, '.forge/graph/graph.json');
const capsDir = join(root, '.forge/product/current/capabilities');

if (!existsSync(graphPath)) { console.log('FAIL (no graph — run /forge:codegraph first)'); process.exit(1); }
const g = JSON.parse(readFileSync(graphPath, 'utf8'));

const BOUNDARY_ROOTS = ['src', 'services', 'apps', 'packages', 'modules', 'libs'];
function capabilityOf(id) {
  const parts = id.split('/');
  if (BOUNDARY_ROOTS.includes(parts[0]) && parts.length > 1) return parts[1].toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return parts.length > 1 ? parts[0].toLowerCase().replace(/[^a-z0-9-]/g, '-') : null;
}

const caps = new Map(); // capId -> { files, langs }
for (const n of g.nodes) {
  if (n.layer === 'test' || n.layer === 'config') continue;
  const c = capabilityOf(n.id);
  if (!c) continue;
  if (!caps.has(c)) caps.set(c, { files: 0, langs: new Set() });
  caps.get(c).files++; caps.get(c).langs.add(n.lang);
}

const existing = existsSync(capsDir) ? new Set(readdirSync(capsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) : new Set();
const toCreate = [...caps.keys()].filter((c) => !existing.has(c)).sort();

if (!toCreate.length) { console.log(`OK (no new capability stubs — ${caps.size} boundary(ies) seen, all already in baseline)`); process.exit(0); }

if (dryRun) {
  console.log(`OK dry-run: would create ${toCreate.length} capability stub(s):`);
  for (const c of toCreate) console.log(`  ${c} (${caps.get(c).files} files, ${[...caps.get(c).langs].join('/')})`);
  process.exit(0);
}

mkdirSync(capsDir, { recursive: true });
for (const c of toCreate) {
  const dir = join(capsDir, c);
  mkdirSync(dir, { recursive: true });
  const yaml = [
    `capability_id: ${c}`,
    `version: 0.1.0`,
    `status: current`,
    `requirements: []`,
    `history:`,
    `  - change_id: baseline-extract`,
    `    archived_at: "${new Date().toISOString().slice(0, 10)}"`,
    `    note: "stub extraido de boundary do grafo (${caps.get(c).files} arquivos); requirements pendentes de curadoria"`,
    ``,
  ].join('\n');
  writeFileSync(join(dir, 'spec.yaml'), yaml);
  console.log(`  created: ${c} (${caps.get(c).files} files)`);
}
console.log(`OK extracted ${toCreate.length} capability stub(s) (requirements pending semantic curation)`);
