#!/usr/bin/env bash
# eval-trigger-metrics.sh — mede o triggering de uma skill/pacote sem julgamento subjetivo.
# Entrada: JSON com cases [{id, expected:boolean, triggered:boolean, split?:train|test}].
# Saída: trigger-metrics.json no mesmo diretório, com precision/recall/F1 por split e total.
set -euo pipefail

input="${1:-}"
if [ -z "$input" ] || [ ! -f "$input" ]; then
  echo "Usage: eval-trigger-metrics.sh <trigger-results.json>" >&2
  exit 1
fi

node - "$input" <<'NODEEOF'
const { readFileSync, writeFileSync } = require('fs');
const { dirname, join } = require('path');
const file = process.argv[2];
const d = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(d.cases) || d.cases.length < 2) throw new Error('cases must contain at least two observations');
const groups = { all: d.cases, train: d.cases.filter(c => c.split === 'train'), test: d.cases.filter(c => c.split === 'test') };
const metric = (cases) => {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) {
    if (typeof c.id !== 'string' || typeof c.expected !== 'boolean' || typeof c.triggered !== 'boolean') throw new Error(`invalid case: ${JSON.stringify(c)}`);
    if (c.expected && c.triggered) tp++;
    else if (!c.expected && c.triggered) fp++;
    else if (c.expected && !c.triggered) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  const round = n => Number(n.toFixed(4));
  return { observations: cases.length, true_positive: tp, false_positive: fp, false_negative: fn, true_negative: tn, precision: round(precision), recall: round(recall), f1: round(f1) };
};
const out = { skill: d.skill || null, metrics: { all: metric(groups.all) } };
if (groups.train.length) out.metrics.train = metric(groups.train);
if (groups.test.length) out.metrics.test = metric(groups.test);
writeFileSync(join(dirname(file), 'trigger-metrics.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`OK trigger metrics: precision=${out.metrics.all.precision} recall=${out.metrics.all.recall} f1=${out.metrics.all.f1}`);
NODEEOF
