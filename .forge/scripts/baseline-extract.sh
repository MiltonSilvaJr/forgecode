#!/usr/bin/env bash
# forge baseline extract (brownfield §11.2) — capability stubs a partir dos
# boundaries do grafo. Wrapper sobre lib/baseline-extract.mjs.
# Usage: baseline-extract.sh [--dry-run]   (FORGE_ROOT overrides root)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
node "$SCRIPT_DIR/lib/baseline-extract.mjs" "$ROOT" "${1:-}"
