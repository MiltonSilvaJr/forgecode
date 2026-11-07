#!/usr/bin/env bash
# forge impact (§16.4, W4.2) — diff/spec impact analysis over the code graph.
# Modes:
#   impact.sh --change <change-id>   seeds = manifest affected_paths; writes impact.json in the change
#   impact.sh --files a.ts,b.ts      ad-hoc seeds
#   impact.sh --diff [<base>]        seeds = git changed files (vs base, default HEAD)
# Requires a built graph (.forge/graph/graph.json). FORGE_ROOT overrides the root.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
GRAPH="$ROOT/.forge/graph/graph.json"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
[ -f "$GRAPH" ] || { echo "FAIL (no graph — run: /forge:codegraph)"; exit 1; }

case "${1:-}" in
  --change) node "$SCRIPT_DIR/lib/impact-scan.mjs" --graph "$GRAPH" --change "$ROOT/.forge/specs/active/${2:?--change requires id}" ;;
  --files)  node "$SCRIPT_DIR/lib/impact-scan.mjs" --graph "$GRAPH" --files "${2:?--files requires a,b,c}" ;;
  --diff)
    base="${2:-HEAD}"
    # `|| files=""` em CADA atribuição, e não só na primeira: sob `set -euo pipefail` a falha do
    # `git` é promovida pelo `pipefail` e mata o script sem uma linha de saída. O `2>/dev/null`
    # aqui é intencional (fora de um repositório git não há o que diffar), e é exatamente por isso
    # que a morte era silenciosa. Na segunda atribuição o `[ -n … ] ||` NÃO protegia: ali a
    # atribuição é o último comando da lista OR, e o rc dela é o rc do comando composto.
    files="$(git -C "$ROOT" diff --name-only "$base" 2>/dev/null | paste -sd, -)" || files=""
    if [ -z "$files" ]; then
      files="$(git -C "$ROOT" status --porcelain 2>/dev/null | sed 's/^...//' | paste -sd, -)" || files=""
    fi
    [ -n "$files" ] || { echo "OK impact: 0 seed(s) -> 0 impacted (no changed files)"; exit 0; }
    node "$SCRIPT_DIR/lib/impact-scan.mjs" --graph "$GRAPH" --files "$files" ;;
  *) echo "FAIL (usage: impact.sh --change <id> | --files a,b | --diff [<base>])"; exit 1 ;;
esac
