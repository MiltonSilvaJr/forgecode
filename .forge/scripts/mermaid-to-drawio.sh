#!/usr/bin/env bash
# forge mermaid→drawio — converte um .md/.mmd (Mermaid flowchart) em .drawio editável.
# Uso: mermaid-to-drawio.sh <arquivo.md|.mmd> [--out <arquivo.drawio>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }
node "$SCRIPT_DIR/lib/mermaid-to-drawio.mjs" "$@"
