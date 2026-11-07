#!/usr/bin/env bash
# meta-aggregate.sh — agregação determinista de uma meta-avaliação A/B (§18).
# Compara dois braços de um caso meta: with-template vs without-template.
# Cada braço tem N runs com counts.json (saída de meta-count.sh).
# Computa mean±stddev de miss/conflict/clarify e pass-rate por braço e os deltas
# (with - without). O template "ajuda" quando reduz miss/conflict e eleva pass-rate.
# A estatística é feita aqui, nunca pelo modelo (§10.11).
# Uso:
#   meta-aggregate.sh <case-dir>
#   espera <case-dir>/runs/with-template/run-*/counts.json
#       e  <case-dir>/runs/without-template/run-*/counts.json
#   grava <case-dir>/meta-aggregate.json
set -euo pipefail

case_dir="${1:-}"
if [ -z "$case_dir" ] || [ ! -d "$case_dir" ]; then
  echo "Usage: meta-aggregate.sh <case-dir>" >&2
  exit 1
fi

node - "$case_dir" <<'NODEEOF'
const { readdirSync, readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const caseDir = process.argv[2];

function loadArm(arm) {
  const dir = join(caseDir, 'runs', arm);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(n => /^run-/.test(n))
    .map(n => join(dir, n, 'counts.json'))
    .filter(existsSync)
    .map(p => JSON.parse(readFileSync(p, 'utf8')));
}

const withArm = loadArm('with-template');
const withoutArm = loadArm('without-template');

if (withArm.length === 0 || withoutArm.length === 0) {
  console.error('FAIL: ambos os braços precisam de >=1 run com counts.json ' +
    `(with=${withArm.length}, without=${withoutArm.length})`);
  process.exit(1);
}

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const stddev = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
};
const round = (x, d = 4) => Number.isFinite(x) ? Number(x.toFixed(d)) : null;

function summarize(arm) {
  const miss = arm.map(c => c.miss);
  const conflict = arm.map(c => c.conflict);
  const clarify = arm.map(c => c.clarify);
  const pass = arm.map(c => (c.passed ? 1 : 0));
  return {
    n: arm.length,
    miss_mean: round(mean(miss), 2), miss_stddev: round(stddev(miss), 2),
    conflict_mean: round(mean(conflict), 2), conflict_stddev: round(stddev(conflict), 2),
    clarify_mean: round(mean(clarify), 2),
    pass_rate: round(mean(pass))
  };
}

const w = summarize(withArm);
const wo = summarize(withoutArm);

const out = {
  case: caseDir.split('/').filter(Boolean).pop(),
  artifact_under_test: 'requirements',
  with_template: w,
  without_template: wo,
  delta: {
    // negativo = template reduz achados (bom); positivo em pass_rate = bom
    miss: round(w.miss_mean - wo.miss_mean, 2),
    conflict: round(w.conflict_mean - wo.conflict_mean, 2),
    clarify: round(w.clarify_mean - wo.clarify_mean, 2),
    pass_rate: round(w.pass_rate - wo.pass_rate)
  }
};

// Veredito determinista: o template ajuda se reduz achados sem piorar pass-rate.
out.verdict =
  (out.delta.miss <= 0 && out.delta.conflict <= 0 && out.delta.pass_rate >= 0 &&
   (out.delta.miss < 0 || out.delta.conflict < 0 || out.delta.pass_rate > 0))
    ? 'template_helps'
    : (out.delta.miss > 0 || out.delta.conflict > 0 || out.delta.pass_rate < 0)
      ? 'template_hurts'
      : 'neutral';

writeFileSync(join(caseDir, 'meta-aggregate.json'), JSON.stringify(out, null, 2) + '\n');

const sign = x => (x >= 0 ? '+' : '') + x;
console.log(
  `OK meta: ${out.verdict}; MISS ${wo.miss_mean}→${w.miss_mean} (Δ${sign(out.delta.miss)}); ` +
  `CONFLICT ${wo.conflict_mean}→${w.conflict_mean} (Δ${sign(out.delta.conflict)}); ` +
  `pass-rate ${wo.pass_rate}→${w.pass_rate} (Δ${sign(out.delta.pass_rate)}) ` +
  `[with n=${w.n}, without n=${wo.n}]`
);
NODEEOF

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
case_rel="$case_dir"
case "$case_rel" in
  "$ROOT"/*) case_rel="${case_rel#"$ROOT"/}" ;;
esac
# REQ-06: best-effort here, not blocking — meta-aggregate.json is already written above; a
# failure recording evidence must not fail an eval that otherwise succeeded.
bash "$SCRIPT_DIR/run-manifest.sh" write \
  --stage eval \
  --dir "$case_rel" \
  --status passed \
  --inputs "case.json,runs" \
  --outputs "meta-aggregate.json" \
  --command "meta-aggregate::meta-aggregate.sh $case_dir::passed" \
  --runner local \
  --profile standard \
  --budget-class high \
  --expected-runs 1 \
  --estimated-timeout-s 300 \
  --uses-llm false \
  --uses-subagent false >/dev/null || true
