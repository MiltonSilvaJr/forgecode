#!/usr/bin/env bash
# forge validate rules (G3 — GW.2): detecta drift de rules ancoradas em ADR.
# Usage: validate-rules.sh   (FORGE_ROOT overrides root)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
node "$SCRIPT_DIR/lib/validate-rules.mjs" "$ROOT"
