#!/usr/bin/env bash
# Validates Forge stage contracts or checks one stage against produced artifacts.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
node "$SCRIPT_DIR/lib/stage-contract.mjs" "$@" --root "$ROOT"
