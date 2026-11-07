#!/usr/bin/env bash
# forge archive (§13.2, W3.2) — incorporates a VERIFIED change into the baseline
# and moves the folder to history:
#   1. pre-flight §13.1 (validate-archive: §19.2 spec rules + archive conditions)
#   2. delta dry-run (in memory; resulting baseline validated; nothing written) —
#      skipped when manifest.archive.baseline_delta: none (verified refactor, no
#      spec-delta.yaml; sanctioned by the pre-flight in step 1)
#   3. delta apply (write-temp + atomic rename per capability) — skipped for the same reason
#   4. aggregated PRD/FRD/NFRD/TRD/DDD views: skipped in v1 (note printed)
#   5. archive metadata in the manifest (status archived, kind baseline_update)
#   6. move to .forge/specs/archived/YYYY-MM-DD-<id>/
#   7. archived/index.yaml + product/current/CHANGELOG.md entries
# Usage: archive-spec.sh <change-id>   (FORGE_ROOT overrides the repo root)
# Output: step lines + final "OK ..." / "FAIL (...)".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ID="${1:-}"
[ -n "$ID" ] || { echo "FAIL (usage: archive-spec.sh <change-id>)"; exit 2; }
DIR="$ROOT/.forge/specs/active/$ID"
[ -d "$DIR" ] || { echo "FAIL (no active change: $ID)"; exit 1; }
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bash "$SCRIPT_DIR/budget-preflight.sh" --stage archive --change "$ID" --outputs "product/current/CHANGELOG.md,evidence/runs/*/run-manifest.json" || true

# [0/6] impact freshness — auto-recuperação determinista. O merge na integração depois do
# último /forge:impact muda o grafo e faria o pré-flight falhar com "impact.json is stale";
# a recuperação era sempre o mesmo runbook manual (graph update → impact --change → re-rodar).
# Executa exatamente essa sequência aqui, só quando o change toca código e há grafo, e só se
# o impact.json está ausente/stale (fingerprint ≠ grafo atual). Divergência real (impact que
# continua inválido após o refresh) ainda reprova no pré-flight [1/6].
if command -v node >/dev/null 2>&1; then
  # julgamento único de frescor (mesma lib que o pré-flight [1/6] consome) — 'not-applicable'
  # cobre change sem affected_paths de código ou repo sem grafo.
  IMPACT_STATUS="$(node "$SCRIPT_DIR/lib/impact-freshness.mjs" "$DIR" "$ROOT" 2>/dev/null || echo not-applicable)"
  if [ "$IMPACT_STATUS" = "missing" ] || [ "$IMPACT_STATUS" = "stale" ]; then
    echo "[0/6] impact refresh (impact.json $IMPACT_STATUS — auto-recovery: graph update → impact --change $ID)"
    FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/graph.sh" update || echo "  WARN: graph update falhou — pré-flight decide"
    FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/impact.sh" --change "$ID" || echo "  WARN: impact refresh falhou — pré-flight decide"
  fi
fi

echo "[1/6] pre-flight (§13.1)"
FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/validate-archive.sh" --path "$DIR" || exit 1

# liaison acks (rule conventions/liaison-protocol.md): incorporar um change ao baseline com um
# contract-change inbound ainda pendente de ack é justamente como o drift entra — o baseline passa
# a afirmar algo que o outro repositório não confirmou. Só cobra os acks DESTE repositório, e só em
# enforce:block; em warn apenas avisa. `spec-close.sh` deliberadamente NÃO consulta este check:
# fechar um change (abandoned/superseded/delivered-externally) não afirma nada sobre contrato, e
# travar o encerramento por ack de peer deixaria changes zumbis presos no ativo.
if [ -f "$SCRIPT_DIR/check-liaison-acks.sh" ]; then
  FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/check-liaison-acks.sh" || exit 1
fi

# red-first (rule testing/regression-red-first.md): redundante com o bloqueio já feito por
# validate-spec.mjs na transição para verified (chamado acima), mas roda de novo aqui como
# defesa em profundidade — um manifest editado à mão para 'verified' sem passar pela
# transição normal não teria sido pego antes. type != bugfix é no-op (red-evidence.sh/check-red-first.sh).
#
# `ensure` roda SEMPRE antes do check estático, como em spec-verify.sh: o archive é o outro ponto
# em que alguém precisa de garantia de verdade, e o estado pode ter mudado desde o /forge:verify.
# `ensure` nunca falha o script (best-effort, log em /tmp) — quem decide bloquear é o
# check-red-first logo depois.
if [ -f "$SCRIPT_DIR/red-evidence.sh" ]; then
  FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/red-evidence.sh" ensure "$ID" >"/tmp/forge-archive-$ID-red-ensure.log" 2>&1 || true
fi
FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/check-red-first.sh" check "$ID" || exit 1

# spec-delta.yaml legitimately absent (manifest.archive.baseline_delta: none, already
# validated in the pre-flight [1/6]): a verified pure refactor has nothing to dry-run or
# apply — skip both delta-apply.mjs passes instead of failing on a missing file.
if [ -f "$DIR/spec-delta.yaml" ]; then
  HAS_DELTA=1
  echo "[2/6] delta dry-run"
  node "$SCRIPT_DIR/lib/delta-apply.mjs" "$DIR" "$ROOT" --dry-run || exit 1

  echo "[3/6] delta apply"
  node "$SCRIPT_DIR/lib/delta-apply.mjs" "$DIR" "$ROOT" || exit 1
else
  HAS_DELTA=0
  echo "[2/6] delta dry-run: SKIP (baseline_delta: none)"
  echo "[3/6] delta apply: SKIP (baseline_delta: none)"
fi

echo "[4/6] aggregated views: skipped (v1 — capabilities are the primary merge; PRD/FRD/TRD/DDD aggregation arrives with real content)"

echo "[5/6] archive metadata + move"
TODAY="$(date +%F)"
MAN="$DIR/manifest.yaml"
perl -pi -e "s/^status: .*/status: archived/; s/^updated_at: .*/updated_at: \"$TODAY\"/" "$MAN"
grep -q '^  kind: ' "$MAN" || perl -pi -e "s/^archive:$/archive:\n  kind: baseline_update/" "$MAN"
perl -pi -e 's/^  eligible: .*/  eligible: true/' "$MAN"
if [ "$HAS_DELTA" -eq 1 ]; then
  perl -pi -e "s/^  reason: .*/  reason: \"deltas applied to baseline on $TODAY\"/" "$MAN"
else
  perl -pi -e "s/^  reason: .*/  reason: \"verified refactor, no baseline delta ($TODAY)\"/" "$MAN"
fi
echo "[5.5/6] ledger harvest (deferrals/findings -> ledger durável, não-bloqueante)"
# Antes de mover a pasta (o dado do change morre), colhe deferrals open/wont-fix + findings
# MEDIUM/LOW do analysis.md + desvios do verification.md para .forge/ledger/. Idempotente
# (dedup_key) e best-effort — falha aqui nunca aborta o archive.
FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/ledger-ops.sh" harvest "$ID" --origin archive || echo "WARN: ledger harvest falhou (não-bloqueante)"
# Fecha o ciclo: se este change nasceu de um item do ledger (--from-ledger), marca-o resolved
# (entregue ao baseline). Best-effort — nunca aborta o archive.
LEDGER_ORIGIN="$(grep -E '^ledger_origin:' "$MAN" 2>/dev/null | sed 's/^ledger_origin:[[:space:]]*//' || true)"
if [ -n "$LEDGER_ORIGIN" ]; then
  FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/ledger-ops.sh" resolve "$LEDGER_ORIGIN" --note "entregue ao baseline via $ID (archived $TODAY)" >/dev/null 2>&1 \
    && echo "ledger: $LEDGER_ORIGIN -> resolved (entregue via $ID)" || echo "WARN: ledger resolve de $LEDGER_ORIGIN falhou (não-bloqueante)"
fi

DEST="$ROOT/.forge/specs/archived/$TODAY-$ID"
[ ! -e "$DEST" ] || { echo "FAIL (archive destination already exists: $DEST)"; exit 1; }
mkdir -p "$ROOT/.forge/specs/archived"
mv "$DIR" "$DEST"

echo "[6/6] index + CHANGELOG"
INDEX="$ROOT/.forge/specs/archived/index.yaml"
[ -f "$INDEX" ] || printf 'archived:\n' > "$INDEX"
{
  printf '  - change_id: %s\n' "$ID"
  printf '    archived_at: "%s"\n' "$TODAY"
  printf '    kind: baseline_update\n'
  printf '    path: %s\n' "$TODAY-$ID"
} >> "$INDEX"

CHG="$ROOT/.forge/product/current/CHANGELOG.md"
[ -f "$CHG" ] || printf '# Product Baseline — CHANGELOG\n\n> One entry per archived change (newest first). Maintained by `/forge:archive` — do not edit by hand.\n' > "$CHG"
# pipefail-safe: spec-delta.yaml is legitimately absent for a baseline_delta: none archive
# (steps [2/6]/[3/6] skipped above) — awk/grep on a missing file would abort the script under
# set -euo pipefail, so short-circuit on HAS_DELTA instead of computing over a nonexistent file.
if [ "$HAS_DELTA" -eq 1 ]; then
  CAPS_TOUCHED="$(awk -F': ' '$1~/^ *capability$/{print $2}' "$DEST/spec-delta.yaml" | sort -u | tr '\n' ' ' | sed 's/ $//')"
  OPS_COUNT="$(grep -c '^  - op: ' "$DEST/spec-delta.yaml" || echo 0)"
  CAPS_LABEL="${CAPS_TOUCHED:-—}"
else
  CAPS_TOUCHED=""
  OPS_COUNT=0
  CAPS_LABEL="— (refactor sem delta de baseline)"
fi
TMP="$(mktemp)"
{
  head -3 "$CHG"
  printf '\n## %s — %s\n\n- **Capabilities:** %s\n- **Operações:** %s\n- **Pasta:** `.forge/specs/archived/%s-%s/`\n' \
    "$TODAY" "$ID" "$CAPS_LABEL" "$OPS_COUNT" "$TODAY" "$ID"
  tail -n +4 "$CHG"
} > "$TMP" && mv "$TMP" "$CHG"

ARCHIVE_DIR=".forge/specs/archived/$TODAY-$ID"
# Evidence write is advisory here, never blocking: by this point the baseline mutation (step
# [3/6]) and the move to archived/ (step [5/6]) already happened — they're the actual archive
# operation, already validated by the pre-flight (§13.1) before any mutation started. A disk-full
# or permission failure writing run-manifest.json must not abort with the change half-moved.
bash "$SCRIPT_DIR/run-manifest.sh" write \
  --stage archive \
  --dir "$ARCHIVE_DIR" \
  --status passed \
  --started-at "$STARTED_AT" \
  --inputs "manifest.yaml,tasks.md,verification.yaml,spec-delta.yaml,impact.json" \
  --outputs "manifest.yaml,evidence/runs" \
  --command "archive-spec::archive-spec.sh $ID::passed" \
  --runner local \
  --profile standard \
  --budget-class medium \
  --expected-runs 1 \
  --estimated-timeout-s 300 \
  --uses-llm false \
  --uses-subagent false >/dev/null || true
# Post-hoc completeness audit, not a gate: the contract here can only check artifacts that exist
# AFTER the archive (manifest status, evidence/runs) — it cannot run before the mutation without
# redefining what it validates. Aborting on failure at this point would leave the change moved to
# archived/ with the baseline already updated but the script exiting non-zero — a worse, half-done
# state than a logged completeness warning. Real preconditions are enforced earlier by
# validate-archive.sh (step [1/6], before any mutation).
if ! contract_out="$(bash "$SCRIPT_DIR/validate-stage-contract.sh" check --stage archive --dir "$ARCHIVE_DIR" 2>&1)"; then
  echo "WARN (stage contract incomplete post-archive: $contract_out)"
fi

if [ "$HAS_DELTA" -eq 1 ]; then
  echo "OK $ID archived -> .forge/specs/archived/$TODAY-$ID (baseline updated)"
else
  echo "OK $ID archived -> .forge/specs/archived/$TODAY-$ID (no baseline delta — verified refactor)"
fi
