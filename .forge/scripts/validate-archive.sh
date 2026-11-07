#!/usr/bin/env bash
# forge validate archive (§19.3) — wrapper: full spec validation (§19.2) +
# archive-specific pre-flight (lib/validate-archive.mjs).
# Usage: validate-archive.sh <change-id> | --path <dir>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# Ver comentário em validate-spec.sh: o red-first é resolvido via FORGE_ROOT; sem export, o
# replay é pulado em silêncio quando o script é chamado sem a variável no ambiente.
export FORGE_ROOT="$ROOT"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }

case "${1:-}" in
  --path) DIR="${2:?--path requires a directory}" ;;
  "") echo "FAIL (usage: validate-archive.sh <change-id> | --path <dir>)"; exit 1 ;;
  *) DIR="$ROOT/.forge/specs/active/$1" ;;
esac

out="$(node "$SCRIPT_DIR/lib/validate-spec.mjs" "$DIR")" || { echo "FAIL (spec invalid: $out)"; exit 1; }
node "$SCRIPT_DIR/lib/validate-archive.mjs" "$DIR" "$ROOT"
