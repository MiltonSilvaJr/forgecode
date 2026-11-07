#!/usr/bin/env bash
# Emits a one-line estimate for expensive Forge commands.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
node "$SCRIPT_DIR/lib/budget-preflight.mjs" "$@" --root "$ROOT"
