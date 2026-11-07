#!/usr/bin/env bash
# forge validate spec (minimal, W2.0) — wrapper over lib/validate-spec.mjs.
# Usage:
#   validate-spec.sh <change-id>      validates .forge/specs/active/<change-id>/
#   validate-spec.sh --path <dir>     validates an explicit change directory
#   validate-spec.sh --all            validates every change under specs/active/
# Output: one "OK <id>" / "FAIL (...)" verdict line per change, precedida por zero ou mais linhas
# "WARN (...)" — achados rebaixáveis (hoje: SRF-01, cobertura de superfície) que NÃO mudam o exit
# code. Exit 1 se algum change reprovou.
# Efeito colateral deliberado: change type:bugfix em `verified` (ou além) executa o replay do Red
# (red-evidence.sh ensure) e GRAVA evidence/red/red-evidence.json — mas só quando o diretório
# validado é o change ativo .forge/specs/active/<id>/. Com --path apontando para outro diretório
# (cópia, change arquivado) a evidência é avaliada como está, sem replay e sem escrita, e a saída
# traz uma linha WARN dizendo isso (issue #189).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# Exportado porque lib/validate-spec.mjs resolve o red-evidence.sh a partir de FORGE_ROOT: sem
# isto ele cai no diretório do change, o existsSync falha e o replay do Red é pulado EM SILÊNCIO.
export FORGE_ROOT="$ROOT"
ACTIVE="$ROOT/.forge/specs/active"

command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }

run_one() { node "$SCRIPT_DIR/lib/validate-spec.mjs" "$1"; }

USAGE="usage: validate-spec.sh <change-id> | --path <dir> | --all — para type:bugfix em verified (ou além), executa o replay do Red e grava evidence/red/red-evidence.json se o diretório for o change ativo .forge/specs/active/<id>/; com --path para outro diretório, avalia a evidência como está, sem replay e sem escrita (WARN)"

case "${1:-}" in
  -h|--help)
    echo "$USAGE"; exit 0
    ;;
  --path)
    [ -n "${2:-}" ] || { echo "FAIL (--path requires a directory)"; exit 1; }
    run_one "$2"
    ;;
  --all)
    fail=0; found=0
    for d in "$ACTIVE"/*/; do
      [ -d "$d" ] || continue
      found=1
      run_one "$d" || fail=1
    done
    [ "$found" -eq 1 ] || { echo "OK (no active changes)"; exit 0; }
    exit "$fail"
    ;;
  "")
    echo "FAIL (usage: validate-spec.sh <change-id> | --path <dir> | --all)"; exit 1
    ;;
  *)
    run_one "$ACTIVE/$1"
    ;;
esac
