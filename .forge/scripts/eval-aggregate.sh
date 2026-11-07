#!/usr/bin/env bash
# eval-aggregate.sh — agregação determinista de um eval A/B (§17.8.2).
# Lê N grading.json (um por eval-K) de uma iteração e computa mean ± stddev
# e deltas de pass-rate, duração e tokens entre baseline e variant.
# A estatística é feita aqui, nunca pelo modelo — o analyzer apenas interpreta.
# Uso:
#   eval-aggregate.sh <iteration-dir>
#   (procura <iteration-dir>/eval-*/grading.json e grava <iteration-dir>/aggregate.json)
set -euo pipefail

iter_dir="${1:-}"
if [ -z "$iter_dir" ] || [ ! -d "$iter_dir" ]; then
  echo "Usage: eval-aggregate.sh <iteration-dir>" >&2
  exit 1
fi

node - "$iter_dir" <<'NODEEOF'
const { readdirSync, readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const iterDir = process.argv[2];

// Coleta grading.json de cada eval-K
const gradings = readdirSync(iterDir)
  .filter(n => /^eval-/.test(n))
  .map(n => join(iterDir, n, 'grading.json'))
  .filter(existsSync)
  .map(p => JSON.parse(readFileSync(p, 'utf8')));

if (gradings.length === 0) {
  console.error('FAIL: nenhum grading.json em ' + iterDir);
  process.exit(1);
}

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const stddev = xs => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
};
const round = (x, d = 4) => Number.isFinite(x) ? Number(x.toFixed(d)) : null;

// Por grading: pass-rate (sobre todas as expectations), duração média, tokens médios
const baselineRates = [], variantRates = [];
const baselineDur = [], variantDur = [];
const baselineTok = [], variantTok = [];

for (const g of gradings) {
  let bPass = 0, bTot = 0, vPass = 0, vTot = 0;
  let bDurSum = 0, vDurSum = 0, bDurN = 0, vDurN = 0;
  let bTokSum = 0, vTokSum = 0, bTokN = 0, vTokN = 0;

  for (const tc of g.test_cases) {
    for (const e of tc.expectations) {
      // Cada expectation pode trazer passed por lado; aqui o schema guarda 1 passed
      // (avaliação do variant). Para A/B completo, o grader grava expectations do
      // variant; baseline vem do aggregate do grader. Usamos o aggregate por grading
      // quando presente, senão derivamos das expectations.
    }
    if (tc.baseline_result && typeof tc.baseline_result.duration_ms === 'number') {
      bDurSum += tc.baseline_result.duration_ms; bDurN++;
      if (tc.baseline_result.tokens != null) { bTokSum += tc.baseline_result.tokens; bTokN++; }
    }
    if (tc.variant_result && typeof tc.variant_result.duration_ms === 'number') {
      vDurSum += tc.variant_result.duration_ms; vDurN++;
      if (tc.variant_result.tokens != null) { vTokSum += tc.variant_result.tokens; vTokN++; }
    }
  }

  // pass-rate: usa o aggregate do grader (fonte canônica por grading)
  if (g.aggregate) {
    baselineRates.push(g.aggregate.baseline_pass_rate);
    variantRates.push(g.aggregate.variant_pass_rate);
  }
  if (bDurN) baselineDur.push(bDurSum / bDurN);
  if (vDurN) variantDur.push(vDurSum / vDurN);
  if (bTokN) baselineTok.push(bTokSum / bTokN);
  if (vTokN) variantTok.push(vTokSum / vTokN);
}

const bRate = mean(baselineRates), vRate = mean(variantRates);
const bDur = mean(baselineDur), vDur = mean(variantDur);
const bTok = baselineTok.length ? mean(baselineTok) : null;
const vTok = variantTok.length ? mean(variantTok) : null;

const out = {
  skill: gradings[0].skill,
  n_evals: gradings.length,
  baseline: {
    pass_rate_mean: round(bRate),
    pass_rate_stddev: round(stddev(baselineRates)),
    duration_mean_ms: round(bDur, 1),
    duration_stddev_ms: round(stddev(baselineDur), 1),
    tokens_mean: bTok == null ? null : round(bTok, 1)
  },
  variant: {
    pass_rate_mean: round(vRate),
    pass_rate_stddev: round(stddev(variantRates)),
    duration_mean_ms: round(vDur, 1),
    duration_stddev_ms: round(stddev(variantDur), 1),
    tokens_mean: vTok == null ? null : round(vTok, 1)
  },
  delta: {
    pass_rate: round(vRate - bRate),
    duration_ms: round(vDur - bDur, 1),
    tokens: (bTok == null || vTok == null) ? null : round(vTok - bTok, 1)
  }
};

writeFileSync(join(iterDir, 'aggregate.json'), JSON.stringify(out, null, 2) + '\n');

const sign = x => (x >= 0 ? '+' : '') + x;
console.log(
  `OK aggregate: n=${out.n_evals} pass-rate ${out.baseline.pass_rate_mean}→${out.variant.pass_rate_mean} ` +
  `(Δ${sign(out.delta.pass_rate)}) ±${out.variant.pass_rate_stddev}; ` +
  `dur Δ${sign(out.delta.duration_ms)}ms; tokens Δ${out.delta.tokens == null ? 'n/a' : sign(out.delta.tokens)}`
);
NODEEOF

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
iter_rel="$iter_dir"
case "$iter_rel" in
  "$ROOT"/*) iter_rel="${iter_rel#"$ROOT"/}" ;;
esac
# REQ-06: best-effort here, not blocking — aggregate.json is already written above; a failure
# recording evidence must not fail a skill-lifecycle eval that otherwise succeeded.
bash "$SCRIPT_DIR/run-manifest.sh" write \
  --stage skill-lifecycle-eval \
  --dir "$iter_rel" \
  --status passed \
  --inputs "." \
  --outputs "aggregate.json" \
  --command "eval-aggregate::eval-aggregate.sh $iter_dir::passed" \
  --runner local \
  --profile standard \
  --budget-class high \
  --expected-runs 1 \
  --estimated-timeout-s 300 \
  --uses-llm false \
  --uses-subagent false >/dev/null || true
