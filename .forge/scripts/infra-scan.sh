#!/usr/bin/env bash
# forge infra-diagram — scaffold de diagram-as-code (mingrammer/diagrams) a partir do
# docker-compose. Uso: infra-scan.sh [--out <dir>]   (FORGE_ROOT overrides root)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
node "$SCRIPT_DIR/lib/infra-scan.mjs" "$ROOT" "$@"
