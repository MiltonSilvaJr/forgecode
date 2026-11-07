#!/usr/bin/env bash
# forge discover (lite wrapper, W2.3) — runs the deterministic inventory (§16.1)
# and writes .forge/graph/manifest.json. Full graph arrives in MVP4.
# Usage: discover.sh [<repo-root>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
node "$SCRIPT_DIR/lib/discover-lite.mjs" "${1:-}"
