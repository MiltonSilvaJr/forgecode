#!/usr/bin/env bash
# spec-advance-module.sh — vínculo mínimo entre o caminho module-based (/forge:coding-loop
# → sprint-orchestrator, que opera sobre docs/product/modules/<modulo>/PROGRESS-TRACKING.md)
# e o lifecycle SDD (.forge/specs/active/<id>/manifest.yaml). Sem ele, um change implementado
# por ondas congela em tasks-ready mesmo com 100% das TASKs done e branch mergeada.
#
# Mapeia <modulo> → change ativo e avança o status via spec-transition.sh (chain scale-aware),
# de forma IDEMPOTENTE e NÃO-DESTRUTIVA:
#   phase=implementing  (abertura da 1ª onda):  tasks-ready → implementing
#   phase=implemented   (todas as TASKs [X]):   → implementing → implemented
# Já estar em/depois do alvo = no-op silencioso. Nunca pula etapas da chain nem arquiva.
#
# Mapeamento módulo→change (determinista): um change ativo cujo affected_paths referencia
# `modules/<modulo>`, ou cujo id é exatamente <modulo>. Se ZERO ou MÚLTIPLOS casarem, faz
# no-op com log em stderr — NUNCA quebra o loop de codificação (é vínculo best-effort).
#
# Uso: spec-advance-module.sh <modulo> <implementing|implemented>
# Saída: "OK ...", "NOOP (...)" ou "SKIP (...)"; sempre exit 0 (não derruba a onda).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

MOD="${1:-}"; PHASE="${2:-}"
[ -n "$MOD" ] && [ -n "$PHASE" ] || { echo "SKIP (usage: spec-advance-module.sh <modulo> <implementing|implemented>)"; exit 0; }
case "$PHASE" in
  implementing|implemented) ;;
  *) echo "SKIP (fase inválida: $PHASE — use implementing|implemented)"; exit 0 ;;
esac

ACTIVE="$ROOT/.forge/specs/active"
[ -d "$ACTIVE" ] || { echo "NOOP (sem .forge/specs/active — nada a avançar)"; exit 0; }

# Descobre change(s) que casam com o módulo.
matches=""
for d in "$ACTIVE"/*/; do
  [ -d "$d" ] || continue
  id="$(basename "$d")"
  man="$d/manifest.yaml"
  [ -f "$man" ] || continue
  # Só o bloco `affected_paths:` conta (não prosa em title/description de outro change) —
  # awk extrai as linhas indentadas até a próxima chave de topo.
  if [ "$id" = "$MOD" ] || awk '/^affected_paths:/{f=1;next} /^[A-Za-z_]/{f=0} f' "$man" 2>/dev/null | grep -qE "modules/$MOD(/|\"|$| )"; then
    matches="$matches $id"
  fi
done
matches="$(printf '%s' "$matches" | xargs 2>/dev/null || true)"

count=0; for _ in $matches; do count=$((count + 1)); done
if [ "$count" -eq 0 ]; then
  echo "SKIP (nenhum change ativo mapeável ao módulo '$MOD' — vínculo module→change ausente)"; exit 0
fi
if [ "$count" -gt 1 ]; then
  echo "SKIP (múltiplos changes casam com '$MOD': $matches — mapeamento ambíguo, resolva à mão)"; exit 0
fi

ID="$matches"
MAN="$ACTIVE/$ID/manifest.yaml"
current="$(awk -F': ' '$1=="status"{print $2; exit}' "$MAN" | tr -d '"'"'"'')"

# índice na sub-chain relevante (só usamos daqui pra frente)
idx_of() { case "$1" in
  tasks-ready) echo 0 ;; implementing) echo 1 ;; implemented) echo 2 ;; verified) echo 3 ;;
  *) echo -1 ;;  # idea/proposed/*-ready anteriores ou blocked → fora do nosso alcance
esac; }

cur_idx="$(idx_of "$current")"
tgt_idx="$(idx_of "$PHASE")"

if [ "$cur_idx" -lt 0 ]; then
  echo "NOOP ($ID em '$current' — antes de tasks-ready ou lateral; coding-loop não avança daqui)"; exit 0
fi
if [ "$cur_idx" -ge "$tgt_idx" ]; then
  echo "NOOP ($ID já em '$current' — >= alvo '$PHASE')"; exit 0
fi

# Avança um passo por vez até o alvo. Qualquer FAIL do spec-transition (ex.: G1/analysis) vira
# SKIP com log — o loop de codificação segue; humano reconcilia depois (surfacing no doctor/status).
step_to() {
  local target="$1"
  local out
  if out="$(bash "$SCRIPT_DIR/spec-transition.sh" "$ID" "$target" 2>&1)"; then
    echo "  $out"
    return 0
  fi
  echo "SKIP ($ID: transição para '$target' recusada — $out; loop segue, reconcilie via /forge:status)"
  return 1
}

echo "advance $ID: $current -> $PHASE"
if [ "$cur_idx" -lt 1 ] && [ "$tgt_idx" -ge 1 ]; then step_to implementing || exit 0; fi
if [ "$tgt_idx" -ge 2 ]; then step_to implemented || exit 0; fi
echo "OK $ID em '$PHASE'"
exit 0
