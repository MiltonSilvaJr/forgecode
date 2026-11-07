#!/usr/bin/env bash
# check-bats-assertion-abort.sh - LDG-1626: bats só usa o exit code da ÚLTIMA instrução do
# corpo de um @test pra decidir pass/fail. Uma asserção "[ ]"/"[[ ]]" fora de `run`, que falha
# NO MEIO do teste, não aborta nada por padrão (confirmado com bats 1.13 e um fixture mínimo)  - 
# as linhas seguintes continuam rodando e só a última decide. Um @test com 2+ dessas linhas sem
# "||"/"return"/"exit"/"assert_" tem, por construção, pelo menos uma que nunca é verificada de
# fato. Medido: ~51% dos testes bats em 5 repos do workspace Payments têm esse defeito (passivo
# tratado por fora deste gate - ver `report`).
#
# Idioma correto: terminar toda asserção que não seja a última linha do @test com "|| return 1"
# (ou usar bats-assert, que já resolve isso via run + assert_*).
#   [ "$status" -eq 0 ] || return 1
#   [[ "$output" == *"x"* ]] || return 1
#
# Modos:
#   check-bats-assertion-abort.sh range <rev-range>   # CI: só @test cujo corpo tem linha NOVA no diff
#   check-bats-assertion-abort.sh --path <dir>        # auditoria ad-hoc, varre tudo, vacuidade reprova
#   check-bats-assertion-abort.sh report [<path>]     # inventário do passivo inteiro, nunca reprova
#   check-bats-assertion-abort.sh --fix <dir>         # injeta "|| return 1" nas linhas sem guarda
#
# --fix é transformação puramente SINTÁTICA (o mesmo idioma seguro provado no cenário [2] do
# w324) - não decide se a asserção, depois de guardada, passa a reprovar um defeito real que
# estava escondido. Rode a suíte real (bats) depois do --fix e trie cada teste que passar a
# falhar: pode ser defeito de teste (mock frouxo, asserção fraca) ou defeito REAL no código sob
# teste, nunca reescreva a asserção pra fazer voltar a passar sem entender qual dos dois é.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDIR="$SCRIPT_DIR/lib"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# shellcheck disable=SC1090
. "$LIBDIR/gate-universe.sh"

command -v node >/dev/null 2>&1 || { echo "FAIL bats-assertion-abort - node >= 20 necessário" >&2; exit 2; }

MODE="${1:-}"
case "$MODE" in
  range) NODE_MODE="range"; ARG="${2:-}"; [ -n "$ARG" ] || { echo "FAIL bats-assertion-abort - uso: range <rev-range>" >&2; exit 2; } ;;
  --path) NODE_MODE="path"; ARG="${2:-}"; [ -n "$ARG" ] || { echo "FAIL bats-assertion-abort - uso: --path <dir>" >&2; exit 2; } ;;
  report) NODE_MODE="report"; ARG="${2:-$ROOT}" ;;
  --fix) NODE_MODE="fix"; ARG="${2:-}"; [ -n "$ARG" ] || { echo "FAIL bats-assertion-abort - uso: --fix <dir>" >&2; exit 2; } ;;
  *) echo "FAIL bats-assertion-abort - uso: range <rev-range> | --path <dir> | report [<path>] | --fix <dir>" >&2; exit 2 ;;
esac

TMP="$(mktemp -d /tmp/forge-bats-assert.XXXXXX)" || { echo "FAIL bats-assertion-abort - mktemp falhou" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT

node "$LIBDIR/check-bats-assertion-abort-cli.mjs" "$NODE_MODE" "$ARG" "$ROOT" > "$TMP/out.txt" 2>"$TMP/err.txt"
node_rc=$?
if [ "$node_rc" -ne 0 ]; then
  echo "FAIL bats-assertion-abort - a varredura abortou (rc=$node_rc); um lint que não rodou não pode reportar-se verde:" >&2
  sed 's/^/      /' "$TMP/err.txt" >&2
  exit 1
fi

OUT="$TMP/out.txt"
scanned="$(awk -F'\t' '$1=="SCANNED"{print $2}' "$OUT" | tail -1)"; : "${scanned:=0}"
hits="$(awk -F'\t' '$1=="HIT"' "$OUT" | awk 'END{print NR+0}')"

if [ "$NODE_MODE" = "report" ]; then
  echo "REPORT bats-assertion-abort - $hits teste(s) vulnerável(is) em $scanned arquivo(s) .bats:"
  awk -F'\t' '$1=="HIT"{printf "      %s:%s: %s (%s asserção(ões) sem guarda)\n", $2, $3, $4, $5}' "$OUT"
  exit 0
fi

if [ "$NODE_MODE" = "fix" ]; then
  total_fixed="$(awk -F'\t' '$1=="TOTALFIXED"{print $2}' "$OUT" | tail -1)"; : "${total_fixed:=0}"
  files_changed="$(awk -F'\t' '$1=="TOTALFIXED"{print $3}' "$OUT" | tail -1)"; : "${files_changed:=0}"
  echo "FIX bats-assertion-abort - $total_fixed asserção(ões) guardada(s) com '|| return 1' em $files_changed arquivo(s):"
  awk -F'\t' '$1=="FIXED"{printf "      %s: %s asserção(ões)\n", $2, $3}' "$OUT"
  echo "      Transformação SINTÁTICA só - rode a suíte real e trie cada teste que passar a" >&2
  echo "      falhar: pode ser defeito de teste ou defeito real que a asserção escondia." >&2
  exit 0
fi

if [ "$NODE_MODE" = "path" ]; then
  if ! forge_universe_check "bats-assertion-abort" "$scanned" "arquivo(s) .bats" "$ARG" "$ROOT"; then
    exit 1
  fi
fi

if [ "${hits:-0}" -ne 0 ]; then
  if [ "$NODE_MODE" = "range" ]; then
    echo "FAIL bats-assertion-abort - $hits @test novo(s)/alterado(s) com asserção que bats nunca verifica de fato:" >&2
  else
    echo "FAIL bats-assertion-abort - $hits @test com asserção que bats nunca verifica de fato:" >&2
  fi
  awk -F'\t' '$1=="HIT"{printf "      %s:%s: %s (%s asserção(ões) sem guarda)\n", $2, $3, $4, $5}' "$OUT" >&2
  echo "      bats só usa o exit code da ÚLTIMA instrução do corpo do @test pra decidir pass/fail  - " >&2
  echo "      uma asserção anterior que falha não aborta nada. Termine cada asserção que não seja" >&2
  echo "      a última linha com '|| return 1':" >&2
  echo "        [ \"\$status\" -eq 0 ] || return 1" >&2
  echo "        [[ \"\$output\" == *\"x\"* ]] || return 1" >&2
  exit 1
fi

if [ "$NODE_MODE" = "range" ]; then
  echo "OK bats-assertion-abort - nenhum @test novo/alterado com o defeito, em $scanned arquivo(s) .bats tocado(s)"
else
  echo "OK bats-assertion-abort - nenhuma ocorrência em $scanned arquivo(s) .bats"
fi
