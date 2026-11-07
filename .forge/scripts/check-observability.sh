#!/usr/bin/env bash
# forge check observability (Wave 4 — TASK-15, REQ-09/10, design.md §2.2). Gate de
# ADOÇÃO (REQ-16): REQ-09a boundary→wrapper (lib/graph-govern.mjs sobre graph.json),
# REQ-09b logger cru fora do wrapper (lib/source-scan.mjs), REQ-10 alerts-as-code por
# serviço/boundary. mode warn|enforce lido de graph.json:governance.observability
# (bloco `observability:` do FORGE.md, materializado por graph-build.mjs). Ausência de
# grafo/bloco → REQ-09a/REQ-10 em no-op (nunca falso-positivo); REQ-09b roda sempre.
# Usage: check-observability.sh <change-id> | --path <dir|file> [...]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export FORGE_ROOT="$ROOT"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
case "${1:-}" in
  --path) shift; node "$SCRIPT_DIR/lib/check-observability.mjs" --root "$ROOT" "$@" ;;
  "") echo "FAIL (usage: check-observability.sh <change-id> | --path <dir|file>)"; exit 1 ;;
  *) node "$SCRIPT_DIR/lib/check-observability.mjs" --root "$ROOT" "$ROOT/.forge/specs/active/$1" ;;
esac
