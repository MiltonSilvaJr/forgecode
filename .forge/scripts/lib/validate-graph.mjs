#!/usr/bin/env node
// forge validate graph (§19.5, W4.1). Zero-dependency. Validates .forge/graph/graph.json:
//   1. schema graph/v0 rules (re-implemented deterministically here)
//   2. referential integrity: resolved edges point to existing nodes
//   3. duplicate node IDs
//   4. orphan nodes (no in/out edge) → reported as WARN count (not failure)
//   5. layer coverage: every node has a layer
//   6. summary quality: present summaries are non-trivial (>= 12 chars)
//   7. changed-files compatibility (optional): if git is available, warn when
//      tracked source files changed since the graph fingerprints were taken
// Output: "OK graph (N nodes, M edges; W warnings)" or "FAIL (<reasons>)".
// Usage: validate-graph.mjs <graph.json> [<repo-root>]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { classifyOrphans, readLayerMap } from './graph-layers.mjs';

const graphPath = process.argv[2];
if (!graphPath || !existsSync(graphPath)) { console.log(`FAIL (graph.json not found: ${graphPath || '(none)'} — run /forge:codegraph)`); process.exit(1); }
const root = process.argv[3] ? resolve(process.argv[3]) : null;
const errors = [];
const warnings = [];

let g;
try { g = JSON.parse(readFileSync(graphPath, 'utf8')); } catch (e) { console.log(`FAIL (graph.json parse: ${e.message})`); process.exit(1); }

if (g.schema !== 'graph/v0') errors.push(`schema must be graph/v0 (got: ${g.schema})`);
if (!Array.isArray(g.nodes)) errors.push('nodes must be an array');
if (!Array.isArray(g.edges)) errors.push('edges must be an array');
if (errors.length) { console.log(`FAIL (${errors.join('; ')})`); process.exit(1); }

// 'shell' (LDG-0027): produz NÓ, nunca aresta (SCRIPT_DIR/variáveis tornam a extração estática
// pouco confiável — ver graph-build.mjs). Continua em EXTRACTOR_SUPPORTED porque a regra abaixo
// (§19.5) só olha para "tem nó?", não para "tem aresta?" — e todo arquivo .sh sempre vira nó.
const LANGS = new Set(['js', 'ts', 'csharp', 'go', 'python', 'kotlin', 'java', 'shell', 'other']);
// languages the native extractor produces graph nodes for — every LANGS value except the
// 'other' catch-all. Derived (not re-typed) so it never drifts from the enum above.
const EXTRACTOR_SUPPORTED = new Set([...LANGS].filter((l) => l !== 'other'));
const LAYERS = new Set(['api', 'application', 'domain', 'infrastructure', 'contracts', 'test', 'config', 'unknown']);
const ids = new Set();
const dup = new Set();
const FP_RE = /^[a-f0-9]{64}$/;

for (const [i, n] of g.nodes.entries()) {
  const at = `nodes[${i}]`;
  if (!n.id) { errors.push(`${at}: id missing`); continue; }
  if (ids.has(n.id)) dup.add(n.id); else ids.add(n.id);
  if (!LANGS.has(n.lang)) errors.push(`${at} (${n.id}): lang invalid: ${n.lang}`);
  if (!Number.isInteger(n.loc) || n.loc < 0) errors.push(`${at} (${n.id}): loc invalid`);
  if (!FP_RE.test(String(n.fingerprint || ''))) errors.push(`${at} (${n.id}): fingerprint not sha256`);
  if (!LAYERS.has(n.layer)) errors.push(`${at} (${n.id}): layer invalid: ${n.layer} (coverage rule)`);
  if (n.summary != null && String(n.summary).trim().length < 12) errors.push(`${at} (${n.id}): summary too short (min quality)`);
  if (n.taxonomy !== undefined && n.taxonomy !== 'out') errors.push(`${at} (${n.id}): taxonomy invalid: ${n.taxonomy} (only "out" — a declared exit from the layer taxonomy)`);
}
for (const d of dup) errors.push(`duplicate node id: ${d}`);

// referential integrity + orphan detection
const degree = new Map([...ids].map((id) => [id, 0]));
for (const [i, e] of g.edges.entries()) {
  const at = `edges[${i}]`;
  if (!ids.has(e.from)) errors.push(`${at}: from "${e.from}" is not a node`);
  else degree.set(e.from, degree.get(e.from) + 1);
  if (e.resolved === true) {
    if (!ids.has(e.to)) errors.push(`${at}: resolved edge to "${e.to}" but no such node (referential integrity)`);
    else degree.set(e.to, degree.get(e.to) + 1);
  }
}
// Orphan classification (issue #38). A bare count is not actionable: in the measured repo, 926
// orphans hid exactly 4 pieces of real dead code, and the warning gave no way to reach them.
// Orphan BY DESIGN — assembly marker resolved by reflection, migration discovered by assembly
// scanning, browser E2E spec, static content/tooling declared out of taxonomy — is the correct
// state for those files, not a finding. Only what is left over (dead code or an import the
// extractor failed to resolve) is worth a warning; when nothing is left over, there is nothing
// to say and the validator stays silent instead of manufacturing noise.
const orphanIds = [...degree.entries()].filter(([, d]) => d === 0).map(([id]) => id).sort();
if (orphanIds.length) {
  const nodesById = new Map(g.nodes.map((n) => [n.id, n]));
  const declaredGlobs = root ? readLayerMap(root).orphanGlobs : [];
  const { byDesign, candidates, reasons } = classifyOrphans(orphanIds, nodesById, declaredGlobs);
  if (candidates.length) {
    const why = Object.entries(reasons).sort().map(([r, c]) => `${r}: ${c}`).join(', ');
    const shown = candidates.slice(0, 10).join(', ');
    const more = candidates.length > 10 ? `, +${candidates.length - 10} more` : '';
    warnings.push(`${candidates.length} orphan node(s) to review — dead code or unresolved imports: ${shown}${more}`
      + (byDesign.length ? ` (${byDesign.length} further orphan(s) are by design — ${why} — and are not reported)` : ''));
  }
}

// stats coherence
if (g.stats && g.stats.nodes !== g.nodes.length) errors.push(`stats.nodes (${g.stats.nodes}) != actual (${g.nodes.length})`);
if (g.stats && g.stats.edges !== g.edges.length) errors.push(`stats.edges (${g.stats.edges}) != actual (${g.edges.length})`);

// changed-files compatibility (optional)
if (root) {
  try {
    const isRepo = execSync('git rev-parse --is-inside-work-tree', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === 'true';
    if (isRepo) {
      const changed = execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
        .split('\n').filter(Boolean).map((l) => l.slice(3).trim());
      const stale = changed.filter((f) => ids.has(f));
      if (stale.length) warnings.push(`${stale.length} graphed file(s) changed since build (graph may be stale — /forge:graph update)`);
    }
  } catch { /* git unavailable — skip */ }
}

// language coverage (§19.5 — issue #18): a graph with 2 nodes over a repo of 259 .java
// files is worse than useless — it reads as "OK" while every downstream consumer
// (c4/onboard/impact) has no real input. graph-build records the repo's source-file
// census in stats (same walk that builds nodes — no re-walk here). For EACH census
// language with zero graph nodes: a SUPPORTED language is a real build/drift bug (FAIL);
// the DOMINANT unsupported language means the graph is not representative (WARN). A
// non-dominant unsupported language (e.g. a few vendored native files) is ignored — it
// is not noise worth blocking on. Older graphs without a census skip this rule.
if (g.stats && g.stats.census && typeof g.stats.census === 'object') {
  const census = g.stats.census;
  const ranked = Object.entries(census).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const domLang = ranked.length ? ranked[0][0] : null;
  const nodesByLang = {};
  for (const n of g.nodes) nodesByLang[n.lang] = (nodesByLang[n.lang] || 0) + 1;
  for (const [lang, count] of ranked) {
    if ((nodesByLang[lang] || 0) > 0) continue;
    if (EXTRACTOR_SUPPORTED.has(lang)) {
      errors.push(`language '${lang}' (${count} file(s)) has 0 nodes in the graph, but the extractor supports it — graph build is broken or stale (coverage rule §19.5)`);
    } else if (lang === domLang) {
      warnings.push(`dominant language '${lang}' (${count} file(s)) is not covered by the native extractor — the graph is NOT representative of this repo; impact/c4/onboard run on empty input (ADR 0001 v0.2 tree-sitter, issue #18)`);
    }
  }
}

if (errors.length) { console.log(`FAIL (${errors.join('; ')})`); process.exit(1); }
const w = warnings.length ? ` — ${warnings.join('; ')}` : '';
console.log(`OK graph (${g.nodes.length} nodes, ${g.edges.length} edges; ${warnings.length} warning(s)${w})`);
