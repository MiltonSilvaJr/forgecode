#!/usr/bin/env bash
# forge check migration-review (REQ-05 — rule data/migration-review.md): reporta migration
# tocada sem evidência de parecer de revisão especializada.
# Usage: check-migration-review.sh range <rev-range> [--evidence <path>]
#        check-migration-review.sh --path <dir> [--evidence <path>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
case "${1:-}" in
  range) shift; node "$SCRIPT_DIR/lib/check-migration-review.mjs" range "$@" ;;
  --path) shift; node "$SCRIPT_DIR/lib/check-migration-review.mjs" --path "$@" ;;
  "") echo "FAIL (usage: check-migration-review.sh range <rev-range> | --path <dir>)"; exit 1 ;;
  *) echo "FAIL (usage: check-migration-review.sh range <rev-range> | --path <dir>)"; exit 1 ;;
esac
