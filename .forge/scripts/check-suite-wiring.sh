#!/usr/bin/env bash
# check-suite-wiring.sh — prova de INVOCAÇÃO da rede de suítes (issue #49, instância 2).
#
# Um gate entregue e nunca chamado conta como cobertura em todos os relatórios e não cobre nada.
# No axis-device-platform, `grep -rn "run-all.sh" .github .forge/hooks .forge/FORGE.md` devolvia
# vazio: doze suítes de guarda, entregues ao longo de dez rodadas, só rodavam por invocação
# manual. O alvo morto clássico não pega isso — ele mede o gate RODANDO, não o gate sendo CHAMADO.
#
# Este gate mede a fiação, e só a fiação:
#
#   1. Todo RUNNER de suíte encontrado (tests/run-all.sh, .forge/scripts/tests/run-all.sh) tem de
#      ser citado por ao menos um PONTO DE ENTRADA declarado — workflow de CI, hook do git,
#      FORGE.md ou os scripts do package.json.
#   2. Diretório de suítes que EXISTE sem runner é erro, não no-op: apagar o runner deixaria a
#      fiação verde e sem uma linha. É a instância 4 (delegação em alvo ausente) aplicada à
#      própria fiação — as duas correções são a mesma ideia.
#   3. Contador de controle: ZERO ponto de entrada examinado reprova. Um gate de invocação que
#      aprova por não ter olhado para ponto de entrada nenhum é a instância 1 dentro da correção
#      da instância 2 — a auto-ironia mais provável desta entrega.
#
# Uso: check-suite-wiring.sh [--root <dir>]     (default: FORGE_ROOT, senão a raiz do harness)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1090
. "$SCRIPT_DIR/lib/gate-universe.sh"

ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
while [ $# -gt 0 ]; do
  case "$1" in
    --root) shift; [ $# -gt 0 ] || { echo "FAIL suite-wiring — --root exige um argumento" >&2; exit 2; }
            ROOT="$1"; shift ;;
    *) echo "FAIL suite-wiring — argumento desconhecido '$1' (use --root <dir>)" >&2; exit 2 ;;
  esac
done
[ -d "$ROOT" ] || { echo "FAIL suite-wiring — raiz '$ROOT' não existe" >&2; exit 1; }
ROOT="$(cd "$ROOT" && pwd -P)"

TMP="$(mktemp -d /tmp/forge-wiring.XXXXXX)" || { echo "FAIL suite-wiring — mktemp falhou" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT

fail=0

# ── 1. diretórios de suíte conhecidos ────────────────────────────────────────────────────────
# `tests/` na raiz é o layout do próprio harness; `.forge/scripts/tests/` é o layout que os
# repositórios consumidores recebem quando instalam a maquinaria.
SUITE_DIRS="tests .forge/scripts/tests"
runners=""
for d in $SUITE_DIRS; do
  [ -d "$ROOT/$d" ] || continue
  if [ -f "$ROOT/$d/run-all.sh" ]; then
    runners="$runners $d/run-all.sh"
    continue
  fi
  # Diretório de suítes presente sem runner: só é erro se HOUVER suíte lá dentro — um diretório
  # vazio é um repositório que ainda não começou, não uma rede que sumiu.
  n_suites="$(find "$ROOT/$d" -maxdepth 1 -name '*-gate.sh' -o -maxdepth 1 -name '*.bats' 2>/dev/null | awk 'END{print NR+0}')"
  if [ "${n_suites:-0}" -gt 0 ]; then
    echo "FAIL suite-wiring/runner — $d/ tem $n_suites suíte(s) e NENHUM run-all.sh." >&2
    echo "      A existência do diretório de suítes torna a ausência do runner um erro: sem ele a" >&2
    echo "      rede não é executável por ponto de entrada algum, e o placar fica verde por omissão." >&2
    fail=1
  fi
done

# ── 2. pontos de entrada declarados ──────────────────────────────────────────────────────────
ENTRY="$TMP/entry.txt"; : > "$ENTRY"
for f in "$ROOT"/.github/workflows/*.yml "$ROOT"/.github/workflows/*.yaml; do
  [ -f "$f" ] && printf '%s\n' "$f" >> "$ENTRY"
done
for f in "$ROOT"/.forge/hooks/git/*; do
  [ -f "$f" ] && printf '%s\n' "$f" >> "$ENTRY"
done
[ -f "$ROOT/.forge/FORGE.md" ] && printf '%s\n' "$ROOT/.forge/FORGE.md" >> "$ENTRY"
[ -f "$ROOT/package.json" ] && printf '%s\n' "$ROOT/package.json" >> "$ENTRY"

n_entry="$(awk 'END{print NR+0}' "$ENTRY")"
if ! forge_universe_check "suite-wiring" "$n_entry" "ponto(s) de entrada" "workflows de CI, hooks do git, FORGE.md e package.json de $ROOT" "$ROOT"; then
  exit 1
fi

# ── 3. cada runner tem de ser CITADO por algum ponto de entrada ──────────────────────────────
n_runners=0
for r in $runners; do
  n_runners=$((n_runners + 1))
  hits=0
  while IFS= read -r ep; do
    [ -n "$ep" ] || continue
    if grep -Fq "$r" "$ep" 2>/dev/null; then
      hits=$((hits + 1))
      echo "OK suite-wiring — $r invocado em ${ep#"$ROOT"/}"
    fi
  done < "$ENTRY"
  if [ "$hits" -eq 0 ]; then
    echo "FAIL suite-wiring/invocação — $r não é citado por NENHUM dos $n_entry ponto(s) de entrada." >&2
    echo "      Guarda que ninguém roda conta como cobertura nos relatórios e não cobre nada." >&2
    echo "      Fie o runner num workflow de CI, num hook do git ou no script de teste do package.json." >&2
    fail=1
  fi
done

# Contador de controle sobre os RUNNERS: sem runner algum não há invocação a provar, e aprovar
# isso seria exatamente o verde por omissão que este gate existe para eliminar.
if ! forge_universe_check "suite-wiring-runners" "$n_runners" "runner(s) de suíte" "$SUITE_DIRS em $ROOT" "$ROOT"; then
  exit 1
fi

[ "$fail" -eq 0 ] || exit 1
echo "OK suite-wiring — $n_runners runner(s) fiado(s) em $n_entry ponto(s) de entrada examinado(s)"
