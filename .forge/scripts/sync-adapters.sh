#!/usr/bin/env bash
# Entry point for adapter generation (§14.1 /forge:sync-adapters).
# Bash wrapper → Node lib (no build step, no dependencies). Requires Node >= 20.
# Usage: sync-adapters.sh [--adapter claude] [--copy-links]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }

exec node "$SCRIPT_DIR/lib/sync-adapters.mjs" --root "$ROOT" "$@"
