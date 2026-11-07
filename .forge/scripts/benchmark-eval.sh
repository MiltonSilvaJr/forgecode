#!/usr/bin/env bash
# Runs canonical Forge benchmark cases with a deterministic stub runner.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
node "$SCRIPT_DIR/lib/benchmark-eval.mjs" "$@" --root "$ROOT"
