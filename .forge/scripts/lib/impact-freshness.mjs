#!/usr/bin/env node
// impact-freshness.mjs — fonte ÚNICA da fórmula de graph fingerprint e do julgamento de
// frescor do impact.json de um change (§13.2/§16.4). Antes desta lib a fórmula vivia
// copiada em impact-scan.mjs (produtor), validate-archive.mjs (gate) e inline num
// `node -e` do archive-spec.sh (auto-recovery) — três pontos a divergir em silêncio.
//
// impactStatus(changeDir, forgeRoot) →
//   'not-applicable'  change sem affected_paths de código, ou sem grafo construído
//   'missing'         grafo existe e o change toca código, mas não há impact.json
//   'stale'           impact.json existe mas o fingerprint não bate com o grafo atual
//                     (ou é ilegível — mesmo remédio: re-rodar /forge:impact)
//   'fresh'           impact.json corresponde ao grafo atual
//
// CLI: impact-freshness.mjs <change-dir> <forge-root>   → imprime o status (exit 0)
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export function graphFingerprint(graph) {
  return createHash('sha256').update(graph.nodes.map((n) => n.id + ':' + n.fingerprint).sort().join('\n')).digest('hex');
}

// affected_paths do manifest — mesma extração mínima do impact-scan.mjs (bloco de
// "  - <path>" sob "affected_paths:"; a forma inline "affected_paths: []" resulta vazia).
export function affectedPathsOf(manifestText) {
  const m = manifestText.match(/^affected_paths:\n((?:\s*-\s.*\n?)*)/m);
  if (!m || !m[1].trim()) return [];
  return m[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
}

export function impactStatus(changeDir, forgeRoot) {
  const dir = resolve(changeDir);
  const root = resolve(forgeRoot);
  const graphPath = join(root, '.forge/graph/graph.json');
  const manPath = join(dir, 'manifest.yaml');
  if (!existsSync(graphPath) || !existsSync(manPath)) return 'not-applicable';
  if (!affectedPathsOf(readFileSync(manPath, 'utf8')).length) return 'not-applicable';
  const impactPath = join(dir, 'impact.json');
  if (!existsSync(impactPath)) return 'missing';
  try {
    const g = JSON.parse(readFileSync(graphPath, 'utf8'));
    const imp = JSON.parse(readFileSync(impactPath, 'utf8'));
    return imp.graph_fingerprint === graphFingerprint(g) ? 'fresh' : 'stale';
  } catch {
    return 'stale';
  }
}

// CLI (usado pelo archive-spec.sh — nunca falha: erro de uso imprime not-applicable)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [changeDir, forgeRoot] = process.argv.slice(2);
  if (!changeDir || !forgeRoot) { console.log('not-applicable'); process.exit(0); }
  try { console.log(impactStatus(changeDir, forgeRoot)); } catch { console.log('not-applicable'); }
}
