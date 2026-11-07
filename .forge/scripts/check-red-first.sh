#!/usr/bin/env bash
# forge check-red-first (Onda B, rule testing/regression-red-first.md): verificação
# ESTÁTICA do protocolo Red-first em change type:bugfix — SEM rodar teste algum (o replay
# real fica na Onda C). Delega a lib/check-red-first.mjs (padrão do check-authz.sh).
# Itens 1-4 da rule são enforceable:true (bloqueiam mesmo em yolo); itens 5-8 são
# enforceable:false (rebaixáveis — sempre WARN, a rule não define modo warn|enforce aqui).
# Usage: check-red-first.sh check|status <change-id> | waive <change-id> --reason <r> [--note <n>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export FORGE_ROOT="$ROOT"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }

CMD="${1:-}"; shift || true
CHID="${1:-}"
[ -n "$CMD" ] && [ -n "$CHID" ] || { echo "FAIL (usage: check-red-first.sh check|status|waive <change-id> [...])"; exit 1; }
shift || true

case "$CMD" in
  check)  node "$SCRIPT_DIR/lib/check-red-first.mjs" check "$ROOT/.forge/specs/active/$CHID" ;;
  status) node "$SCRIPT_DIR/lib/check-red-first.mjs" status "$ROOT/.forge/specs/active/$CHID" ;;
  waive)  node "$SCRIPT_DIR/lib/check-red-first.mjs" waive "$ROOT/.forge/specs/active/$CHID" "$@" ;;
  *) echo "FAIL (unknown subcommand: $CMD — use check|status|waive)"; exit 1 ;;
esac
