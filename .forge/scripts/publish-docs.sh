#!/usr/bin/env bash
# forge publish docs (§8.2, W3.3) — mirrors the baseline (.forge/product/current/)
# into docs/product/ as a GENERATED publication (humans read it there; the source
# of truth stays in the baseline). Writes .forge/cache/publish.lock with the
# sha256 of every published file — validate-archive uses it to detect manual
# edits in docs/product without baseline origin (round-trip integrity).
# Usage: publish-docs.sh   (FORGE_ROOT overrides the repo root)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
SRC="$ROOT/.forge/product/current"
DST="$ROOT/docs/product"
LOCK="$ROOT/.forge/cache/publish.lock"

[ -d "$SRC" ] || { echo "FAIL (no baseline at .forge/product/current)"; exit 1; }

count=0
mkdir -p "$DST" "$ROOT/.forge/cache"
: > "$LOCK.tmp"

while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"
  case "$rel" in *.gitkeep) continue ;; esac
  mkdir -p "$DST/$(dirname "$rel")"
  cp "$f" "$DST/$rel"
  hash="$(shasum -a 256 "$DST/$rel" | cut -d' ' -f1)"
  printf '%s  %s\n' "$hash" "docs/product/$rel" >> "$LOCK.tmp"
  count=$((count + 1))
done < <(find "$SRC" -type f -print0 | LC_ALL=C sort -z)

cat > "$DST/README.md" <<'EOF'
# docs/product — publicação gerada

> Este diretório é uma PUBLICAÇÃO do baseline `.forge/product/current/` (gerada por
> `/forge:publish-docs`). Não edite aqui — mudanças entram por change ativo e
> `/forge:archive`; edições manuais são detectadas pelo `validate-archive`.
EOF
hash="$(shasum -a 256 "$DST/README.md" | cut -d' ' -f1)"
printf '%s  %s\n' "$hash" "docs/product/README.md" >> "$LOCK.tmp"
mv "$LOCK.tmp" "$LOCK"

echo "OK published $count file(s) from product/current to docs/product (lock: .forge/cache/publish.lock)"
