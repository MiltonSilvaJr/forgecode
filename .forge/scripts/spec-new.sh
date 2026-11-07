#!/usr/bin/env bash
# forge spec new (W2.0) — deterministically creates an active change folder:
#   .forge/specs/active/<change-id>/ with manifest.yaml + type/scale templates.
# Usage:
#   spec-new.sh <change-id> --type feature|bugfix|refactor|greenfield|brownfield
#               [--scale 0..4] [--rigor spec-anchored|spec-first|spec-as-source]
#               [--mode greenfield|brownfield|feature-only] [--owner <name>]
# Behavior:
#   - refuses to overwrite an existing change (exit 3, tree untouched)
#   - installs templates for the phases the scale requires (stubs to be filled
#     by /forge:requirements, /forge:design, /forge:tasks)
#   - validates the result with validate-spec.sh; on failure rolls back (exit 1)
# Output: "OK .forge/specs/active/<id>" or "FAIL (...)".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
TPL="$(cd "$SCRIPT_DIR/.." && pwd)/templates"   # templates ship with the installation, not the data root
ACTIVE="$ROOT/.forge/specs/active"

ID="${1:-}"; shift || true
TYPE=""; SCALE="2"; RIGOR="spec-anchored"; MODE=""; OWNER=""; FROM_LEDGER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --type)  TYPE="${2:-}"; shift 2 ;;
    --scale) SCALE="${2:-}"; shift 2 ;;
    --rigor) RIGOR="${2:-}"; shift 2 ;;
    --mode)  MODE="${2:-}"; shift 2 ;;
    --owner) OWNER="${2:-}"; shift 2 ;;
    --from-ledger) FROM_LEDGER="${2:-}"; shift 2 ;;
    *) echo "FAIL (unknown argument: $1)"; exit 2 ;;
  esac
done

# ── validation of inputs ──────────────────────────────────────────────────────
[ -n "$ID" ] || { echo "FAIL (usage: spec-new.sh <change-id> --type <type> [--scale N])"; exit 2; }
echo "$ID" | grep -Eq '^[a-z0-9][a-z0-9-]*[a-z0-9]$' || { echo "FAIL (change-id must be kebab-case: $ID)"; exit 2; }
case "$TYPE" in feature|bugfix|refactor|greenfield|brownfield) ;; *) echo "FAIL (--type must be feature|bugfix|refactor|greenfield|brownfield, got: '$TYPE')"; exit 2 ;; esac
case "$SCALE" in 0|1|2|3|4) ;; *) echo "FAIL (--scale must be 0..4, got: '$SCALE')"; exit 2 ;; esac
case "$RIGOR" in spec-anchored|spec-first|spec-as-source) ;; *) echo "FAIL (--rigor invalid: $RIGOR)"; exit 2 ;; esac

# mode default: explicit > derived from type > repo heuristic
if [ -z "$MODE" ]; then
  case "$TYPE" in
    greenfield) MODE="greenfield" ;;
    brownfield) MODE="brownfield" ;;
    *) if [ -d "$ROOT/.forge/product/current" ] || [ -d "$ROOT/docs/product" ]; then MODE="brownfield"; else MODE="greenfield"; fi ;;
  esac
fi
case "$MODE" in greenfield|brownfield|feature-only) ;; *) echo "FAIL (--mode invalid: $MODE)"; exit 2 ;; esac
if [ -n "$FROM_LEDGER" ]; then echo "$FROM_LEDGER" | grep -Eq '^LDG-[0-9]{4}$' || { echo "FAIL (--from-ledger deve ser LDG-NNNN, got: '$FROM_LEDGER')"; exit 2; }; fi

[ -n "$OWNER" ] || OWNER="$(git config user.name 2>/dev/null || true)"
[ -n "$OWNER" ] || OWNER="$(id -un)"

DEST="$ACTIVE/$ID"
[ ! -e "$DEST" ] || { echo "FAIL (change already exists: $DEST — choose another id)"; exit 3; }

TODAY="$(date +%F)"
mkdir -p "$DEST"
trap 'rm -rf "$DEST"' ERR

# ── templates by type/scale ───────────────────────────────────────────────────
fill() { # fill <template> <dest-file>
  SRC_FILE="$1" DEST_FILE="$2" CH_ID="$ID" CH_TYPE="$TYPE" CH_SCALE="$SCALE" CH_DATE="$TODAY" CH_OWNER="$OWNER" \
  perl -pe 's/<CHANGE_ID>/$ENV{CH_ID}/g; s/<CHANGE_TYPE>/$ENV{CH_TYPE}/g; s/<CHANGE_SCALE>/$ENV{CH_SCALE}/g; s/<CHANGE_DATE>/$ENV{CH_DATE}/g; s/<CHANGE_OWNER>/$ENV{CH_OWNER}/g' \
    "$1" > "$2"
}

fill "$TPL/spec/proposal.md" "$DEST/proposal.md"
case "$TYPE" in
  bugfix)   [ "$SCALE" -ge 1 ] && fill "$TPL/bugfix/bugfix.md" "$DEST/bugfix.md"
            # evidência do Red-first (rule testing/regression-red-first.md, item 1) — nasce
            # status:pending independentemente de scale (item 1 não é escalonado pela rule);
            # /forge:red record ou check-red-first.sh waive avançam o status.
            mkdir -p "$DEST/evidence/red"
            fill "$TPL/bugfix/red-evidence.json" "$DEST/evidence/red/red-evidence.json" ;;
  refactor) [ "$SCALE" -ge 1 ] && fill "$TPL/refactor/refactor.md" "$DEST/refactor.md" ;;
  *)        [ "$SCALE" -ge 1 ] && fill "$TPL/spec/requirements.md" "$DEST/requirements.md" ;;
esac
if [ "$SCALE" -ge 2 ] && [ "$TYPE" != "bugfix" ]; then fill "$TPL/spec/design.md" "$DEST/design.md"; fi
fill "$TPL/spec/tasks.md" "$DEST/tasks.md"
# spec-delta nasce visível como pendência desde o scaffold (§10.4): o esqueleto de template
# é substituído deterministicamente na fase verify (spec-delta-scaffold.mjs) e os payloads
# são autorados no /forge:verify §2.5 — placeholders bloqueiam verified e o archive.
# Só a partir de scale 1: em scale 0 não há artefato de requirements para derivar o delta,
# e o esqueleto viraria bloqueio sem matéria-prima — o fluxo manual continua válido lá.
[ "$SCALE" -ge 1 ] && fill "$TPL/spec/spec-delta.yaml" "$DEST/spec-delta.yaml"

# ── manifest (doc §10.2) ──────────────────────────────────────────────────────
# Nota (LDG-0033, resolvido): os campos de lista abaixo (`affected_capabilities`,
# `affected_paths`, `dependencies.specs/code`, `quick_plan.skipped_phases`) nascem em flow
# style (`[]`). yaml-lite.mjs agora parseia flow style não-vazio corretamente (`[a, b]` vira
# array de verdade, não string literal) — mantido como default deliberado: continua sendo o
# formato mais compacto para editar `skipped_phases: [story-sharding]` à mão, e não há mais
# armadilha em fazê-lo (block style `- item` também funciona; ver tests/w162-yaml-lite-flow-array-gate.sh).
cat > "$DEST/manifest.yaml" <<EOF
id: $ID
type: $TYPE
mode: $MODE
rigor: $RIGOR
scale: $SCALE
status: proposed
created_at: "$TODAY"
updated_at: "$TODAY"
owner: "$OWNER"
parent:
  baseline: .forge/product/current
affected_capabilities: []
affected_paths: []
dependencies:
  specs: []
  code: []
gates:
  requirements_reviewed: false
  design_reviewed: false
  tasks_reviewed: false
  implementation_verified: false
  human_archive_approval: false
dev_loop:
  sharded: false
  stories_path: stories/
  epic_context_compiled: false
quick_plan:
  enabled: false
  skipped_phases: []
  justification:
archive:
  eligible: false
  reason: "tasks not implemented"
EOF

# ── ledger origin: item já substituído (status superseded) não vira elo ─────────────────────
# (add-ledger-evidence-aging, REQ-04) Um change ligado a um item 'superseded' nasceria com
# ledger_origin apontando para algo encerrado: o promote seria recusado e, no archive, o resolve
# também — o sucessor ficaria aberto para sempre com o trabalho entregue. O change continua sendo
# criado (o --from-ledger é não-bloqueante, como para id inexistente), mas sem elo, e o aviso
# nomeia o sucessor e o comando que liga o change a ele.
LEDGER_SUCCESSOR=""
if [ -n "$FROM_LEDGER" ] && [ -f "$ROOT/.forge/ledger/ledger.json" ]; then
  LEDGER_SUCCESSOR="$(node -e '
    const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const e = (d.entries || []).find((x) => x.id === process.argv[2]);
    if (e && e.status === "superseded") process.stdout.write((e.links && e.links.superseded_by) || "(sucessor ausente)");
  ' "$ROOT/.forge/ledger/ledger.json" "$FROM_LEDGER" 2>/dev/null || true)"
  if [ -n "$LEDGER_SUCCESSOR" ]; then
    echo "  WARN: ledger: $FROM_LEDGER foi substituído por $LEDGER_SUCCESSOR — change criado SEM elo com o ledger. Para ligar ao sucessor: bash .forge/scripts/ledger-ops.sh promote $LEDGER_SUCCESSOR --to $ID"
    FROM_LEDGER=""
  fi
fi

# ── ledger origin (opt-in): stamp the manifest so archive/close can close the loop ───────────
if [ -n "$FROM_LEDGER" ]; then
  LEDGER_ORIGIN="$FROM_LEDGER" perl -pi -e 's/^(owner: .*)$/$1\nledger_origin: $ENV{LEDGER_ORIGIN}/' "$DEST/manifest.yaml"
fi

# ── self-validate; roll back on failure ──────────────────────────────────────
out="$(bash "$SCRIPT_DIR/validate-spec.sh" --path "$DEST")" || { rm -rf "$DEST"; echo "FAIL (generated change failed validation: $out)"; exit 1; }

# ── promote the originating ledger entry (best-effort — the change already exists; a broken
#    ledger link must not roll it back). Marks status: promoted + links.promoted_to = <id>. ──
if [ -n "$FROM_LEDGER" ] && [ -x "$SCRIPT_DIR/ledger-ops.sh" ]; then
  if FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/ledger-ops.sh" promote "$FROM_LEDGER" --to "$ID" >/dev/null 2>&1; then
    echo "  ledger: $FROM_LEDGER -> promoted (change $ID)"
  else
    echo "  WARN: ledger promote de $FROM_LEDGER falhou (entrada inexistente?) — change criado, elo não registrado"
  fi
fi

echo "OK .forge/specs/active/$ID"
