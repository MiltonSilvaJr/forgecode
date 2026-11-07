#!/usr/bin/env bash
# Thin wrapper for run-manifest/v1 evidence. See lib/run-manifest.mjs.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# Só anexa o --root do próprio wrapper quando o chamador NÃO passou um — anexar
# incondicionalmente depois de "$@" fazia o --root do chamador ser sempre descartado,
# porque parseArgs() em lib/run-manifest.mjs deixa a ÚLTIMA ocorrência de uma flag vencer (#128).
caller_has_root=0
for a in "$@"; do
  if [ "$a" = "--root" ]; then
    caller_has_root=1
    break
  fi
done
if [ "$caller_has_root" -eq 1 ]; then
  node "$SCRIPT_DIR/lib/run-manifest.mjs" "$@"
else
  node "$SCRIPT_DIR/lib/run-manifest.mjs" "$@" --root "$ROOT"
fi
