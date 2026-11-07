#!/usr/bin/env bash
# Legacy docs/product ingestion (§22.6, W3.2) — imports an existing docs/product/
# tree into the baseline WITHOUT deleting or modifying the original:
#   docs/product/{prd,frd-nfrd,ddd,trd,adr,glossary} -> .forge/product/current/...
# Capabilities are NOT auto-extracted (semantic work — /forge:archive builds them
# change by change, or an agent-assisted extraction does it later).
# Refuses to run if product/current already has imported content (no silent merge).
# Usage: ingest-legacy.sh   (FORGE_ROOT overrides the repo root)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SRC="$ROOT/docs/product"
DST="$ROOT/.forge/product/current"

[ -d "$SRC" ] || { echo "OK (no docs/product to ingest)"; exit 0; }

# `|| existing=""`: baseline ausente faz o `find` falhar, o `pipefail` promove, e `set -e` mata o
# script sem dizer nada — o `2>/dev/null` já declara que a falha é esperada aqui.
existing="$(find "$DST" -type f ! -name '.gitkeep' ! -name 'CHANGELOG.md' 2>/dev/null | head -1)" || existing=""
[ -z "$existing" ] || { echo "FAIL (product/current already has content — ingestion only runs on an empty baseline; resolve manually)"; exit 3; }

count=0
for area in prd frd-nfrd ddd trd adr glossary; do
  [ -d "$SRC/$area" ] || continue
  mkdir -p "$DST/$area"
  cp -R "$SRC/$area/." "$DST/$area/"
  n="$(find "$SRC/$area" -type f | wc -l | tr -d ' ')"
  count=$((count + n))
  echo "  ingested: $area ($n file(s))"
done

[ "$count" -gt 0 ] || { echo "OK (docs/product has no recognized areas to ingest)"; exit 0; }
echo "OK ingested $count file(s) from docs/product into product/current (original preserved; capabilities pending semantic extraction)"
