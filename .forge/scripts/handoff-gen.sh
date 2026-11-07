#!/usr/bin/env bash
# forge handoff generator (deterministic core) — builds .forge/HANDOFF.md sections 1-3 and 5
# from the active change state (manifest/progress/deferrals) + FORGE.md runtime + git HEAD.
# The narrative delta (section 4) is left as a marker for /forge:handoff to fill (and preserved
# across regenerations by handoff-render.mjs).
#
# Usage: handoff-gen.sh [<change-id>]        (FORGE_ROOT overrides the repo root)
# Deterministic: same state -> byte-identical output (uses HEAD commit date, no wall clock).
# Output: "OK <path>" or "FAIL (...)". Exit 1 on error, 2 on ambiguous/no id.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(git -C "$(pwd)" rev-parse --show-toplevel 2>/dev/null || pwd)}"
TPL="$(cd "$SCRIPT_DIR/.." && pwd)/templates/handoff/HANDOFF.md"
ACTIVE="$ROOT/.forge/specs/active"

[ -f "$TPL" ] || { echo "FAIL (template ausente: $TPL)"; exit 1; }

ID="${1:-}"
if [ -z "$ID" ]; then
  count=$(find "$ACTIVE" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ' || true)
  [ -n "$count" ] || count=0
  if [ "$count" = "1" ]; then
    ID="$(basename "$(find "$ACTIVE" -maxdepth 1 -mindepth 1 -type d)")"
  elif [ "$count" = "0" ]; then
    echo "FAIL (nenhum change ativo em $ACTIVE)"; exit 1
  else
    echo "FAIL (múltiplos changes ativos — informe <change-id>)"; exit 2
  fi
fi

DIR="$ACTIVE/$ID"
[ -f "$DIR/manifest.yaml" ] || { echo "FAIL (change inexistente: $ID)"; exit 1; }

# git state — deterministic (HEAD sha + commit date, never wall clock)
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
HEAD_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '')"
HEAD_DATE="$(git -C "$ROOT" log -1 --format=%cI 2>/dev/null || echo '')"

# FORGE.md runtime block (optional — degrades to n/d when absent, e.g. harness-source repo)
FORGE_MD="$ROOT/.forge/FORGE.md"
fm_field() {
  [ -f "$FORGE_MD" ] || { echo ""; return; }
  awk -v key="$1" '
    /^runtime:/ { inblk=1; next }
    inblk && /^[a-z_]+:/ { exit }
    inblk && $0 ~ "^  "key":" { sub("^  "key":[[:space:]]*", ""); print; exit }
  ' "$FORGE_MD"
}

FORGE_ROOT="$ROOT" \
HANDOFF_ID="$ID" \
HANDOFF_DIR="$DIR" \
HANDOFF_TPL="$TPL" \
HANDOFF_BRANCH="$BRANCH" \
HANDOFF_SHA="$HEAD_SHA" \
HANDOFF_DATE="$HEAD_DATE" \
HANDOFF_TEST="$(fm_field test)" \
HANDOFF_TYPECHECK="$(fm_field typecheck)" \
HANDOFF_LINT="$(fm_field lint)" \
node "$SCRIPT_DIR/lib/handoff-render.mjs"

echo "OK $ROOT/.forge/HANDOFF.md"
