#!/usr/bin/env bash
# forge check data-governance (G4 — GW.3): flagra divergencia vs a matriz de
# governanca de dados (rules/data/data-governance.md). CONFLICT bloqueia.
# Usage: check-data-governance.sh <change-id> | --path <dir|file> [...]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# Exportado porque o contador de controle (lib/gate-universe.mjs) procura a allowlist de
# justificativas em $FORGE_ROOT/.forge/ — sem export, o node cairia no cwd e leria a allowlist
# do repositório errado.
export FORGE_ROOT="$ROOT"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
# Com FORGE_CHANGE_ID (definido por spec-verify.sh e run-gates.sh, issue #192), o modo --path
# também varre os artefatos do change em foco: a varredura de árvore pula .forge/, e sem isto o
# verify deixaria de ver o anti-padrão literal do incidente ("RLS opcional" num requirements.md),
# que o modo <change-id> sempre viu. No pre-push a variável não existe e nada muda.
case "${1:-}" in
  --path)
    shift
    extra=()
    if [ -n "${FORGE_CHANGE_ID:-}" ] && [ -d "$ROOT/.forge/specs/active/$FORGE_CHANGE_ID" ]; then
      extra=("$ROOT/.forge/specs/active/$FORGE_CHANGE_ID")
    fi
    node "$SCRIPT_DIR/lib/check-data-governance.mjs" "$@" ${extra[@]+"${extra[@]}"} ;;
  "") echo "FAIL (usage: check-data-governance.sh <change-id> | --path <dir|file>)"; exit 1 ;;
  *) node "$SCRIPT_DIR/lib/check-data-governance.mjs" "$ROOT/.forge/specs/active/$1" ;;
esac
