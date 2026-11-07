#!/usr/bin/env bash
# run-gates.sh — executa os gates declarados em `runtime.gates` do FORGE.md para um change.
#
# Este script já era INVOCADO pela documentação e não existia. `commands/waves/wave.md` manda:
#
#     gate_result="$(bash .forge/scripts/run-gates.sh <change-id> <wave-id> 2>&1 | tail -1)"
#     bash .forge/scripts/wave-ops.sh close <change-id> <wave-id> --gate "$gate_result"
#
# e o arquivo não estava no repositório. O efeito prático é o que se espera de uma referência morta:
# o veredito da wave passou a vir do chamador. A skill `wave-advance` chegava a passar `--gate OK`
# literal, e o `wave-ops.sh close` assumia `OK` quando ninguém passava nada. Ninguém mentiu — só
# não havia como não mentir.
#
# Uso:
#   run-gates.sh <change-id> [wave-id] [--phase <fase>]
# `--phase` é o seletor de fase do #82 (issue: "runtime.gates só sabe agendar gate de árvore de
# fontes"). Default: "source" — a fase implícita de toda declaração já existente (CSV escalar,
# sem fase nenhuma), então quem NUNCA passar `--phase` continua vendo exatamente o comportamento
# de sempre (retrocompat literal — golden capturado em tests/fixtures/w171). Um pipeline de
# deploy chama `run-gates.sh <id> --phase pre-deploy` / `--phase post-deploy` explicitamente,
# depois que o artefato existe — é a peça que faltava para o harness distinguir "o código está
# certo" de "o que vai para produção está certo".
# Saída: uma linha por gate, e a ÚLTIMA linha é o veredito agregado — `OK`, `FAIL` ou
# `NO-GATES` (nenhuma gate declarado para a fase pedida). O `| tail -1` da doc depende disso.
# Exit: 0 quando todos passam ou não há gate declarado para a fase; 1 quando algum reprova, ou
# quando `--phase` foi passado EXPLICITAMENTE e zero gates casaram essa fase sem uma isenção
# declarada (guarda de vacuidade, lib/gate-universe.sh — issue #49 um nível acima: só a chamada
# SEM --phase preserva o silêncio de sempre; pedir uma fase é declarar que ela importa).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export FORGE_ROOT="$ROOT"
# shellcheck source=lib/forge-runtime.sh
. "$SCRIPT_DIR/lib/forge-runtime.sh"
# shellcheck source=lib/gate-universe.sh
. "$SCRIPT_DIR/lib/gate-universe.sh"

PHASE="source"
PHASE_EXPLICIT=0
pos=()
while [ $# -gt 0 ]; do
  case "$1" in
    --phase)
      [ $# -ge 2 ] || { echo "FAIL (usage: --phase requires a value)" >&2; echo "FAIL"; exit 1; }
      PHASE="$2"; PHASE_EXPLICIT=1; shift 2 ;;
    *) pos+=("$1"); shift ;;
  esac
done
ID="${pos[0]:-}"
WAVE="${pos[1]:-}"
[ -n "$ID" ] || { echo "FAIL (usage: run-gates.sh <change-id> [wave-id] [--phase <fase>])" >&2; echo "FAIL"; exit 1; }

label="$ID"
[ -n "$WAVE" ] && label="$ID/$WAVE"

gates=()
while IFS= read -r g; do [ -n "$g" ] && gates+=("$g"); done < <(forge_runtime_gates_phase "$PHASE" "$ROOT")

# Guarda de vacuidade — só quando a fase foi pedida EXPLICITAMENTE. A chamada sem --phase (o
# caminho que todo consumidor já usa hoje) nunca passa por aqui: universo vazio ali continua
# sendo o NO-GATES de sempre, sem exigir isenção nenhuma (LDG-0013 — fechar essa porta para todo
# mundo é decisão de produto, fora do escopo desta mudança). Pedir uma fase é, em si, dizer que
# ela é esperada; zero gates casando essa fase é exatamente o "não examinei nada" que o gate de
# red-first também não podia mais confundir com "examinei e estava limpo".
if [ "$PHASE_EXPLICIT" -eq 1 ]; then
  if ! forge_universe_check "run-gates-phase-$PHASE" "${#gates[@]}" "gate(s)" "change:$label,phase:$PHASE" "$ROOT"; then
    echo "FAIL"
    exit 1
  fi
fi

if [ "${#gates[@]}" -eq 0 ]; then
  # Nenhum gate declarado é estado legítimo (projeto que ainda não adotou), mas tem de ser DITO:
  # "NO-GATES" é auditável, e quem lê o waves.json depois consegue distinguir "passou nos gates" de
  # "não havia gate". `OK` aqui apagaria essa diferença — é a ambiguidade que este script remove.
  if [ "$PHASE_EXPLICIT" -eq 0 ] && [ "$PHASE" = "source" ]; then
    echo "  (nenhum gate declarado em runtime.gates do FORGE.md — nada a executar)"
  else
    echo "  (nenhum gate declarado para a fase '$PHASE' em runtime.gates do FORGE.md — nada a executar)"
  fi
  echo "NO-GATES"
  exit 0
fi

# Diretório de log por EXECUÇÃO, não por nome. Um path fixo `/tmp/forge-gates-<id>-<gate>.log`
# colide entre duas execuções simultâneas do mesmo change — dois processos escrevendo o mesmo
# arquivo produzem veredito cruzado, e o gate que reprova pode não ser o que o log mostra.
LOGDIR="$(mktemp -d /tmp/forge-gates.XXXXXX)"
fail=0
for gate in "${gates[@]}"; do
  script="$SCRIPT_DIR/${gate}.sh"
  log="$LOGDIR/$gate.log"
  if [ ! -f "$script" ]; then
    # Pré-requisito ausente REPROVA. Antes isto era WARN + skip no spec-verify, o que faz um gate
    # declarado e inexistente virar silêncio verde — a forma exata do risco que o harness proíbe.
    echo "  $gate: MISSING ($script não existe)"
    fail=1
    continue
  fi
  # Contrato de invocação único (issue #192) — o mesmo de spec-verify.sh e do pre-push: sem
  # posicional; change-id em FORGE_CHANGE_ID para o gate que precisar dele.
  if forge_run_gate "$gate" "FORGE_CHANGE_ID='$ID' bash '$script' --path '$ROOT'" "$log" "$ROOT"; then
    echo "  $gate: passed (log: $log)"
  else
    echo "  $gate: failed (log: $log)"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then echo "FAIL"; exit 1; fi
echo "OK"
