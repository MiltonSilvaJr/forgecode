#!/usr/bin/env bash
# meta-count.sh — extrai contagens deterministas de um relatório de validador
# builder→validator (§14.6, §18). Conta [MISS], [CONFLICT], [CLARIFY] e o Status.
# É o "grader" da meta-avaliação: o sinal de qualidade do artefato é o número de
# achados do validador, não um julgamento subjetivo.
# Uso:
#   meta-count.sh <validator-report.txt>   # imprime counts.json em stdout
#   meta-count.sh <validator-report.txt> --out <counts.json>
set -euo pipefail

report="${1:-}"
if [ -z "$report" ] || [ ! -f "$report" ]; then
  echo "Usage: meta-count.sh <validator-report.txt> [--out <counts.json>]" >&2
  exit 1
fi

out=""
if [ "${2:-}" = "--out" ]; then out="${3:-}"; fi

node - "$report" "$out" <<'NODEEOF'
const { readFileSync, writeFileSync } = require('fs');
const report = readFileSync(process.argv[2], 'utf8');
const outFile = process.argv[3] || '';

const lines = report.split(/\r?\n/);
const countMarker = m => lines.filter(l => new RegExp('^\\s*\\[' + m + '\\]\\s*\\S').test(l)).length;

const miss = countMarker('MISS');
const conflict = countMarker('CONFLICT');
const clarify = countMarker('CLARIFY');

// Status: linha "## Status: PASS|FAIL". Se ausente, deriva: FAIL se houver MISS/CONFLICT.
const m = report.match(/##\s*Status:\s*(PASS|FAIL)/i);
let status = m ? m[1].toUpperCase() : ((miss + conflict) > 0 ? 'FAIL' : 'PASS');
const passed = status === 'PASS';

const counts = { status, passed, miss, conflict, clarify, findings: miss + conflict };
const json = JSON.stringify(counts, null, 2) + '\n';
if (outFile) writeFileSync(outFile, json);
process.stdout.write(json);
NODEEOF
