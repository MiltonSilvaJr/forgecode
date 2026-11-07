#!/usr/bin/env bash
# Spec state machine (minimal subset of §10.7/§12, W2.2 full schema in W3.0).
# Applies ONE transition to an active change manifest, enforcing the chain
# adapted to the change's scale (§10.3):
#   scale 0:  idea -> proposed -> tasks-ready -> implementing -> implemented -> verified
#   scale 1:  + requirements-ready (before tasks-ready)
#   scale >=2: + design-ready (after requirements-ready). type:bugfix (ou quick_plan.skipped_phases
#     contendo "design", qualquer type) pode pular requirements-ready -> tasks-ready direto — mas
#     design-ready CONTINUA na cadeia para quem passar por ele (bugfix com decisão arquitetural,
#     manifest legado já parado lá antes deste pulo existir). É uma rota lateral alternativa, não
#     uma remoção do estado (LDG-0030 — a 1ª versão deste fix removia design-ready da cadeia para
#     bugfix, o que travava manifests legados e proibia a opção descrita em commands/specs/design.md
#     "crie design.md só se a correção exigir decisão arquitetural" — corrigido por review).
# Lateral states:
#   any -> blocked (requires --reason)
#   blocked -> any chain state (requires --reason; human decision)
# NOT handled here (use the dedicated commands):
#   abandoned/rejected/superseded -> spec-close.sh ; archived -> /forge:archive (MVP3)
# Usage: spec-transition.sh <change-id> <new-status> [--reason "<text>"]
# Output: "OK <id>: <old> -> <new>" or "FAIL (...)". Updates status + updated_at.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# Ver comentário em validate-spec.sh: a transição para verified aciona o red-first pelo validador,
# que resolve o replay via FORGE_ROOT. Sem export, a transição documentada em verify.md pularia o
# replay em silêncio — o pré-requisito falta e o gate se desliga, em vez de reprovar.
export FORGE_ROOT="$ROOT"

ID="${1:-}"; TARGET="${2:-}"; REASON=""
[ $# -ge 2 ] || { echo "FAIL (usage: spec-transition.sh <change-id> <new-status> [--reason ...])"; exit 2; }
shift 2
while [ $# -gt 0 ]; do case "$1" in
  --reason) REASON="${2:-}"; shift 2 ;;
  *) echo "FAIL (unknown argument: $1)"; exit 2 ;;
esac; done

DIR="$ROOT/.forge/specs/active/$ID"
MAN="$DIR/manifest.yaml"
[ -f "$MAN" ] || { echo "FAIL (no active change: $ID)"; exit 1; }

CURRENT="$(awk -F': ' '$1=="status"{print $2; exit}' "$MAN")"
SCALE="$(awk -F': ' '$1=="scale"{print $2; exit}' "$MAN")"
TYPE="$(awk -F': ' '$1=="type"{print $2; exit}' "$MAN")"

case "$TARGET" in
  abandoned|rejected|superseded) echo "FAIL (use spec-close.sh / /forge:close for $TARGET)"; exit 2 ;;
  archived) echo "FAIL (archive arrives in MVP3 — /forge:archive)"; exit 2 ;;
esac

# chain for this scale — design-ready sempre presente a partir de scale 2 (nunca removida:
# ver nota acima). O pulo de bugfix é uma rota lateral checada à parte, abaixo.
chain="idea proposed"
[ "$SCALE" -ge 1 ] 2>/dev/null && chain="$chain requirements-ready"
[ "$SCALE" -ge 2 ] 2>/dev/null && chain="$chain design-ready"
chain="$chain tasks-ready implementing implemented verified"

in_chain() { printf ' %s ' $chain | grep -q " $1 "; }

# LDG-0030 + LDG-0172 (gate w205): pulo lateral requirements-ready -> tasks-ready para
# type:bugfix (root cause vive no bugfix.md; ver design.md command doc) OU para qualquer type
# cujo manifest declare `quick_plan.enabled: true` com "design" em `skipped_phases` — design-ready
# permanece um alvo válido da cadeia normal para quem o alcançar por qualquer outro caminho
# (opt-in com design.md real, ou manifest legado já parado lá). A condição que faltava para
# generalizar a `quick_plan` (validate-spec.mjs honrar a dispensa no guard de design.md a partir
# de tasks-ready) foi cumprida — sem isso o pulo autorizado aqui seria reprovado logo depois pelo
# validador, código morto anunciado como recurso (a versão anterior deste comentário registrava
# essa lacuna; achado em revisão de PR, corrigido).
QUICK_PLAN_SKIPS_DESIGN=0
if command -v node >/dev/null 2>&1; then
  QUICK_PLAN_SKIPS_DESIGN="$(FORGE_QP_MANIFEST="$MAN" node --input-type=module -e "
    import { parseYamlSubset } from '$SCRIPT_DIR/lib/yaml-lite.mjs';
    import { readFileSync } from 'node:fs';
    const man = parseYamlSubset(readFileSync(process.env.FORGE_QP_MANIFEST, 'utf8'));
    const sp = man.quick_plan && man.quick_plan.skipped_phases;
    const skips = !!(man.quick_plan && man.quick_plan.enabled === true && Array.isArray(sp) && sp.includes('design'));
    process.stdout.write(skips ? '1' : '0');
  " 2>/dev/null || echo 0)"
fi
SKIP_DESIGN=0
if [ "$SCALE" -ge 2 ] 2>/dev/null && [ "$CURRENT" = "requirements-ready" ] && [ "$TARGET" = "tasks-ready" ]; then
  if [ "$TYPE" = "bugfix" ] || [ "$QUICK_PLAN_SKIPS_DESIGN" = "1" ]; then
    SKIP_DESIGN=1
  fi
fi

if [ "$TARGET" = "blocked" ]; then
  [ -n "$REASON" ] || { echo "FAIL (blocked requires --reason)"; exit 2; }
elif [ "$CURRENT" = "blocked" ]; then
  in_chain "$TARGET" || { echo "FAIL (cannot unblock to '$TARGET' — not a chain state for scale $SCALE)"; exit 1; }
  [ -n "$REASON" ] || { echo "FAIL (unblocking requires --reason)"; exit 2; }
else
  in_chain "$TARGET" || { echo "FAIL ('$TARGET' is not a chain state for scale $SCALE)"; exit 1; }
  in_chain "$CURRENT" || { echo "FAIL (current status '$CURRENT' is outside the chain — resolve manually)"; exit 1; }
  if [ "$SKIP_DESIGN" -eq 1 ]; then
    : # rota lateral autorizada — bugfix pulando design-ready de propósito
  else
    next="$(printf '%s\n' $chain | awk -v cur="$CURRENT" '$0==cur{getline; print; exit}')"
    [ "$TARGET" = "$next" ] || { echo "FAIL (invalid transition $CURRENT -> $TARGET; next allowed for scale $SCALE: $next)"; exit 1; }
  fi
fi

# G1 guardrail (conflict-handling): a relevant conflict blocks implementation.
# If analysis.md exists and is not clear, refuse the transition to implementing.
# "Clear" = Status line is PASS AND there is no BLOCKER row. Re-run /forge:analyze
# after resolving the conflict to regenerate a clean analysis.md.
if [ "$TARGET" = "implementing" ] && [ -f "$DIR/analysis.md" ]; then
  blockers="$(grep -cE '\| *BLOCKER *\|' "$DIR/analysis.md" || true)"
  status_fail="$(grep -cE '^## *Status:.*FAIL' "$DIR/analysis.md" || true)"
  if [ "$blockers" -gt 0 ] || [ "$status_fail" -gt 0 ]; then
    echo "FAIL (analysis.md has $blockers BLOCKER finding(s) / status FAIL — resolve the conflict and re-run /forge:analyze before implementing; conflict-handling.md G1)"
    exit 1
  fi
fi

# G5 guardrail (frescor de grafo/impacto — lsp-impact-analysis.md, LDG-0036/#82): a mesma
# fórmula que o pré-flight do archive já usa (archive-spec.sh) e que analyze.md item 6 manda o
# AGENTE rodar manualmente, aqui é EXECUTADA — não instrução para lembrar. Um change que toca
# código (affected_paths não vazio) com grafo construído e impact.json ausente/desatualizado não
# avança para implementing: por definição, ninguém ainda mapeou o raio de impacto da mudança que
# está prestes a começar. not-applicable (sem grafo, ou change sem affected_paths — a maioria)
# nunca bloqueia, mesma régua do impact-freshness.mjs em qualquer outro chamador.
if [ "$TARGET" = "implementing" ] && command -v node >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/lib/impact-freshness.mjs" ]; then
  impact_status="$(node "$SCRIPT_DIR/lib/impact-freshness.mjs" "$DIR" "$ROOT" 2>/dev/null || echo not-applicable)"
  case "$impact_status" in
    missing|stale)
      echo "FAIL (impact.json $impact_status — rode /forge:update e depois /forge:impact --change $ID antes de implementing; lsp-impact-analysis.md guardrail G5)"
      exit 1
      ;;
  esac
fi

TODAY="$(date +%F)"
cp "$MAN" "$MAN.bak"
perl -pi -e "s/^status: .*/status: $TARGET/; s/^updated_at: .*/updated_at: \"$TODAY\"/" "$MAN"

if out="$(bash "$SCRIPT_DIR/validate-spec.sh" --path "$DIR" 2>&1)"; then
  rm -f "$MAN.bak"
  # Achado rebaixável calculado na transição e jogado fora é achado que não existe. O ramo de
  # sucesso capturava a saída e só a imprimia ao falhar, então todo WARN (SRF-01/SRF-02, TSK-04
  # furo, TSK-05) morria aqui — o change avançava e ninguém via.
  grep '^WARN ' <<< "$out" || true
  echo "OK $ID: $CURRENT -> $TARGET"
else
  mv "$MAN.bak" "$MAN"
  echo "FAIL (transition would leave change invalid: $out)"
  exit 1
fi
