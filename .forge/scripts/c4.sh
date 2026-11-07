#!/usr/bin/env bash
# forge c4 (§16.5, W4.3) — gera diagramas C4 (Mermaid) + overview.html a partir
# do grafo de código e do baseline. Determinista, zero tokens.
# Usage: c4.sh   (FORGE_ROOT overrides root)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
[ -f "$ROOT/.forge/graph/graph.json" ] || { echo "FAIL (no graph — run: /forge:codegraph)"; exit 1; }
node "$SCRIPT_DIR/lib/c4-gen.mjs" "$ROOT"
node "$SCRIPT_DIR/lib/graph-deps.mjs" "$ROOT" --by-project --json >/dev/null 2>&1 || true
node "$SCRIPT_DIR/lib/overview-gen.mjs" "$ROOT"
