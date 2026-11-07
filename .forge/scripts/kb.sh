#!/usr/bin/env bash
# kb.sh — busca unificada sobre o conhecimento acumulado do projeto (/forge:kb).
#
# Indexa baseline (.forge/product/current), specs arquivadas, ledger, docs/plans, CHANGELOG.md e as
# mensagens PRÓPRIAS do liaison (nunca conteúdo de peer nem blobs) e busca por BM25 + entidades,
# fundidos por RRF, com propagação de links. Zero dependência: só bash e node.
#
# A camada semântica (embeddings densos + re-rank por cross-encoder, locais, WASM, sem binário
# nativo) é OPCIONAL e só existe depois de `kb.sh semantic install` — o único subcomando que acessa a
# rede. Sem ela, tudo funciona em modo lexical; nenhum subcomando chama LLM nem provedor cloud.
#
# Subcomandos:
#   build                         (re)constrói o índice; com a camada semântica, calcula os vetores faltantes
#   query "<texto>" [--top N] [--json] [--lexical] [--no-rerank]
#   status [--json]               estado do índice e da camada semântica
#   eval <consultas.json> [--json] [--lexical]   métricas de ranking (hit@k, MRR) por modo
#   semantic install|remove|status
#
# Raízes (lib/forge-root.sh): com FORGE_ROOT, tudo nele. Sem ele, documentos versionados e o índice
# vêm da árvore de trabalho corrente; ledger e liaison, do checkout principal (estado durável de
# projeto mora no tronco). O único git executado é `rev-parse`, dentro de forge-root.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/forge-root.sh
. "$SCRIPT_DIR/lib/forge-root.sh"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)" >&2; exit 1; }

if [ -n "${FORGE_ROOT:-}" ]; then
  DOC_ROOT="$FORGE_ROOT"; STATE_ROOT="$FORGE_ROOT"
else
  DOC_ROOT="$(forge_worktree_root "$SCRIPT_DIR")"
  STATE_ROOT="$(forge_resolve_root)"
fi

cmd="${1:-}"; [ "$#" -gt 0 ] && shift
exec node "$SCRIPT_DIR/lib/kb-cli.mjs" "$cmd" --doc-root "$DOC_ROOT" --state-root "$STATE_ROOT" "$@"
