#!/usr/bin/env bash
# check-worktree-prereqs.sh (issue #81) — enumera de uma só vez os pré-requisitos de árvore (deps
# instaladas, build declarado) que o pre-push depende mas não produz. Ver o cabeçalho de
# lib/check-worktree-prereqs.mjs para a medição de campo e o desenho (por que "revelar todas" e
# não "produzir" nem "degradar para aviso").
# Usage: check-worktree-prereqs.sh --path <dir>
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
case "${1:-}" in
  --path) shift; node "$SCRIPT_DIR/lib/check-worktree-prereqs.mjs" --path "${1:-.}" ;;
  *) echo "FAIL (usage: check-worktree-prereqs.sh --path <dir>)"; exit 1 ;;
esac
