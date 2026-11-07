#!/usr/bin/env bash
# forge validate harness (§19.1, W3.1) — aggregates the deterministic harness
# checks into a single OK/FAIL line:
#   1. doctor.sh --report          (FORGE.md/forge.yaml/AGENTS.md projection,
#      symlinks per active adapter, no .claude leaks in canonical source,
#      no orphan <PROJECT_*> placeholders, lockfile drift)
#   2. smoke-adapters.sh           (smokes of every ACTIVE adapter + foreign-path check)
# Raw output goes to /tmp/forge-validate-harness.log (read tail -20 on failure).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="/tmp/forge-validate-harness.log"
: > "$LOG"

fail=0
if ! bash "$SCRIPT_DIR/doctor.sh" --report >>"$LOG" 2>&1; then
  fail=1; reason="doctor reported missing load-bearing diagnostics"
fi
if ! bash "$SCRIPT_DIR/smoke-adapters.sh" >>"$LOG" 2>&1; then
  fail=1; reason="${reason:+$reason; }adapter smokes failed"
fi
# G3 (GW.2): rules anchored to ADRs must not be in drift
if ! bash "$SCRIPT_DIR/validate-rules.sh" >>"$LOG" 2>&1; then
  fail=1; reason="${reason:+$reason; }rule-vs-ADR drift detected"
fi
if ! bash "$SCRIPT_DIR/validate-stage-contract.sh" validate-contracts >>"$LOG" 2>&1; then
  fail=1; reason="${reason:+$reason; }stage contracts invalid"
fi

if [ "$fail" -eq 0 ]; then
  echo "OK harness"
else
  echo "FAIL ($reason — tail -20 $LOG)"
  exit 1
fi
