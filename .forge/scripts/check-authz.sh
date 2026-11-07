#!/usr/bin/env bash
# forge check-authz (TASK-14, REQ-05/06/07/08): deny-by-default em .rego (sempre enforce),
# decisão imperativa fora do PEP, cobertura de política x threshold, rota layer:api sem
# caminho ao PEP (delegado a graph-govern). CONFLICT bloqueia; WARN não bloqueia (mode:warn
# nos sub-checks rebaixáveis — ver design.md §2.2).
# Usage: check-authz.sh <change-id> | --path <dir|file> [...] [--coverage-report <path>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export FORGE_ROOT="$ROOT"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
case "${1:-}" in
  --path) shift; node "$SCRIPT_DIR/lib/check-authz.mjs" "$@" ;;
  "") echo "FAIL (usage: check-authz.sh <change-id> | --path <dir|file> [...] [--coverage-report <path>])"; exit 1 ;;
  *) node "$SCRIPT_DIR/lib/check-authz.mjs" "$ROOT/.forge/specs/active/$1" "${@:2}" ;;
esac
