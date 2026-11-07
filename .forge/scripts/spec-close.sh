#!/usr/bin/env bash
# forge close (W2.2) — ends an active change WITHOUT touching the baseline (§13):
# moves the folder to .forge/specs/archived/YYYY-MM-DD-<id>/ with
# archive.kind: closed_without_baseline_update.
# Rules (§10.7 + plan L3):
#   --reason abandoned|rejected     : only from idea|proposed|requirements-ready|
#                                     design-ready|tasks-ready (pre-implementing)
#   --reason superseded             : from any state; requires --superseded-by <id>
#   --reason delivered-externally   : from any state — the work SHIPPED outside the
#                                     spec pipeline (e.g. a direct PR). Positive terminal:
#                                     status is honest ("delivered"), not "abandoned".
#                                     Baseline untouched by the pipeline (the delivery is
#                                     in the real codebase); reconcile product/current
#                                     separately if needed. The mandatory --note carries
#                                     the evidence (e.g. the PR link).
# A close decision is always logged in approvals.yaml (gate: close) with the
# mandatory --note as its reason (§12.1).
# The script touches nothing outside the change folder EXCEPT the durable ledger
# (.forge/ledger/): it harvests open/wont-fix deferrals + findings there before the move
# (non-blocking — the change's discoveries survive; see ledger-consultation.md).
# --autonomous (§12.2, modo yolo): a disposição foi decidida pelo revisor autônomo (agent
# yolo-gate), não por humano — repassado ao approval-log.sh, que grava autonomous: true e o
# decided_by do decisor autônomo (nunca o git user) e impõe autonomy.human_hard_stops.
# Usage: spec-close.sh <change-id> --reason <r> --note "<text>" [--superseded-by <id>] [--autonomous]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

ID="${1:-}"; shift || true
REASON=""; NOTE=""; SUPERSEDED_BY=""; AUTONOMOUS=0
while [ $# -gt 0 ]; do case "$1" in
  --reason) REASON="${2:-}"; shift 2 ;;
  --note) NOTE="${2:-}"; shift 2 ;;
  --superseded-by) SUPERSEDED_BY="${2:-}"; shift 2 ;;
  --autonomous) AUTONOMOUS=1; shift ;;
  *) echo "FAIL (unknown argument: $1)"; exit 2 ;;
esac; done

[ -n "$ID" ] || { echo "FAIL (usage: spec-close.sh <change-id> --reason <r> --note ...)"; exit 2; }
DIR="$ROOT/.forge/specs/active/$ID"
MAN="$DIR/manifest.yaml"
[ -f "$MAN" ] || { echo "FAIL (no active change: $ID)"; exit 1; }
case "$REASON" in abandoned|rejected|superseded|delivered-externally) ;; *) echo "FAIL (--reason must be abandoned|rejected|superseded|delivered-externally, got: '$REASON')"; exit 2 ;; esac
[ -n "$NOTE" ] || { echo "FAIL (--note is mandatory — every close records a reason, §12.1)"; exit 2; }
if [ "$REASON" = "superseded" ] && [ -z "$SUPERSEDED_BY" ]; then
  echo "FAIL (superseded requires --superseded-by <change-id>)"; exit 2
fi

STATUS="$(awk -F': ' '$1=="status"{print $2; exit}' "$MAN")"
# abandoned/rejected are pre-implementing only; superseded and delivered-externally
# are any-state terminals (a change can be superseded, or shipped out-of-band, at any point).
if [ "$REASON" != "superseded" ] && [ "$REASON" != "delivered-externally" ]; then
  case "$STATUS" in
    idea|proposed|requirements-ready|design-ready|tasks-ready) ;;
    *) echo "FAIL ($REASON only applies before implementing — status is '$STATUS'; from implementing onward use superseded, delivered-externally, or finish the cycle)"; exit 1 ;;
  esac
fi

# decision log (gate: close)
case "$REASON" in abandoned) DEC="abandon" ;; rejected) DEC="reject" ;; superseded) DEC="supersede" ;; delivered-externally) DEC="deliver-external" ;; esac
# ${arr[@]+...} guard: empty array + set -u explodes on macOS bash 3.2
extra=()
[ -n "$SUPERSEDED_BY" ] && extra=(--superseded-by "$SUPERSEDED_BY")
[ "$AUTONOMOUS" -eq 1 ] && extra+=(--autonomous)
# A saída do approval-log só é descartada no sucesso: na recusa (hard-stop, YAML inválido) a
# linha FAIL dele é a explicação, e o close para antes de tocar manifest ou mover a pasta.
if ! AL_OUT="$(bash "$SCRIPT_DIR/approval-log.sh" "$ID" --gate close --decision "$DEC" --reason "$NOTE" ${extra[@]+"${extra[@]}"} 2>&1)"; then
  echo "$AL_OUT"
  echo "FAIL (approval-log recusou a decisão de close — change $ID continua ativo)"
  exit 1
fi

# manifest: status + archive block (kind/reason), inside the change folder only
TODAY="$(date +%F)"
NOTE_ESC="$(printf '%s' "$NOTE" | sed 's/"/\\"/g')"
perl -pi -e "s/^status: .*/status: $REASON/; s/^updated_at: .*/updated_at: \"$TODAY\"/" "$MAN"
grep -q '^  kind: ' "$MAN" || perl -pi -e "s/^archive:$/archive:\n  kind: closed_without_baseline_update/" "$MAN"
REASON_ESC="$NOTE_ESC" perl -pi -e 's/^  reason: .*/  reason: "$ENV{REASON_ESC}"/' "$MAN"

# Ledger harvest (best-effort, NÃO-BLOQUEANTE): antes de mover a pasta (o dado morre), colhe
# deferrals open/wont-fix + findings MEDIUM/LOW para o ledger durável de projeto. Ver
# rules/conventions/ledger-consultation.md. Falha aqui nunca aborta o close.
FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/ledger-ops.sh" harvest "$ID" --origin close || echo "WARN: ledger harvest falhou (não-bloqueante)"
# Fecha o ciclo do item de origem (--from-ledger), se houver, conforme o motivo do close:
#   abandoned/rejected -> REABRE (open): não foi entregue, volta ao roadmap ativo.
#   delivered-externally -> resolved: entregue fora do pipeline.
#   superseded -> mantém promoted: o change sucessor carrega o item.
LEDGER_ORIGIN="$(grep -E '^ledger_origin:' "$MAN" 2>/dev/null | sed 's/^ledger_origin:[[:space:]]*//' || true)"
if [ -n "$LEDGER_ORIGIN" ]; then
  case "$REASON" in
    abandoned|rejected)
      FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/ledger-ops.sh" update "$LEDGER_ORIGIN" --status open >/dev/null 2>&1 \
        && echo "ledger: $LEDGER_ORIGIN -> open (reaberto — change $ID $REASON)" || echo "WARN: ledger reopen de $LEDGER_ORIGIN falhou (não-bloqueante)" ;;
    delivered-externally)
      FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/ledger-ops.sh" resolve "$LEDGER_ORIGIN" --note "entregue externamente via $ID" >/dev/null 2>&1 \
        && echo "ledger: $LEDGER_ORIGIN -> resolved (entregue externamente via $ID)" || echo "WARN: ledger resolve de $LEDGER_ORIGIN falhou (não-bloqueante)" ;;
    superseded)
      echo "ledger: $LEDGER_ORIGIN permanece promoted (sucessor ${SUPERSEDED_BY:-?} carrega o item)" ;;
  esac
fi

DEST="$ROOT/.forge/specs/archived/$TODAY-$ID"
[ ! -e "$DEST" ] || { echo "FAIL (archive destination already exists: $DEST)"; exit 1; }
mkdir -p "$ROOT/.forge/specs/archived"
mv "$DIR" "$DEST"

echo "OK $ID closed ($REASON) -> .forge/specs/archived/$TODAY-$ID (baseline untouched)"
