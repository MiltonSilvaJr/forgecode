#!/usr/bin/env bash
# gate-ordinal.sh — ordinal de gate (`wNNN`) derivado do TRONCO REMOTO, e detecção de colisão (LDG-0067).
#
# Quem escolhe o próximo ordinal olhava `ls tests/*-gate.sh` da PRÓPRIA árvore. Duas branches
# paralelas escolhem o mesmo número, e um dos dois arquivos perde a identidade no merge —
# aconteceu duas vezes numa única rodada (uma branch criou `w153`/`w154` enquanto outra já os
# tinha; outra criou `w155`/`w156` depois de o PR que os trouxe ter mergeado em `develop`).
#
# Por que NÃO é a mesma decisão do id de ledger. O ledger tem UM arquivo físico que vive no tronco
# por desenho (`--git-common-dir`), e `add` calcula `max + 1` sobre esse arquivo único: a
# serialização é por construção. Ordinais de gate são N arquivos que vivem POR BRANCH, em
# `tests/`, sem autoridade compartilhada onde escrever. Não há para onde transferir a decisão.
#
# Duas peças, ambas necessárias e nenhuma delas replicando o mecanismo do ledger:
#
#   next  — deriva o próximo ordinal do tronco REMOTO (`git ls-tree`), o que já contempla o que
#           outra branch mergeou, e DEGRADA COM ELEGÂNCIA quando não há remoto, dizendo que
#           degradou. Silêncio aqui seria pior que o defeito: quem lê não distinguiria "derivei do
#           tronco" de "derivei do que eu tinha à mão".
#   check — dois arquivos com o mesmo ordinal em `tests/` REPROVAM. É barato, é determinista, e é
#           a única peça que funciona sem rede.
#
# LIMITAÇÃO, registrada por escrito porque o contrário seria vender mais do que se entrega: nada
# disto IMPEDE duas branches que nunca se viram de escolher o mesmo número. O que se ganha é que a
# colisão para de ser descoberta no merge — o autor da segunda branch descobre no próprio push.
#
# Uso:
#   gate-ordinal.sh check [--path <dir>]              # colisão de ordinal reprova
#   gate-ordinal.sh next  [--path <dir>] [--remote <ref>]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDIR="$SCRIPT_DIR/lib"
# Ordinal de gate é decisão POR BRANCH (`tests/` vive na árvore de quem invoca, não no tronco) — a
# raiz certa é `forge_worktree_root`, nunca `forge_resolve_root` (LDG-0171, lib/forge-root.sh).
if [ -f "$LIBDIR/forge-root.sh" ]; then
  # shellcheck source=lib/forge-root.sh
  . "$LIBDIR/forge-root.sh"
else
  echo "FAIL gate-ordinal — $LIBDIR/forge-root.sh ausente: sem forge_worktree_root o script cairia de volta na subida cega de diretórios que gerou 'w1' no layout de dogfood." >&2
  exit 2
fi
ROOT="${FORGE_ROOT:-$(forge_worktree_root "$SCRIPT_DIR")}"
if [ -f "$LIBDIR/gate-universe.sh" ]; then
  # shellcheck source=lib/gate-universe.sh
  . "$LIBDIR/gate-universe.sh"
else
  echo "FAIL gate-ordinal — $LIBDIR/gate-universe.sh ausente: sem contador de controle o check não distingue 'examinei e estava limpo' de 'não examinei nada'." >&2
  exit 2
fi

cmd="${1:-}"; shift || true
[ -n "$cmd" ] || { echo "Usage: gate-ordinal.sh check|next [--path <dir>] [--remote <ref>]" >&2; exit 2; }

TESTS_DIR=""
REMOTE_REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --path)   shift; [ $# -gt 0 ] || { echo "FAIL gate-ordinal — --path exige um argumento" >&2; exit 2; }; TESTS_DIR="$1"; shift ;;
    --remote) shift; [ $# -gt 0 ] || { echo "FAIL gate-ordinal — --remote exige um argumento" >&2; exit 2; }; REMOTE_REF="$1"; shift ;;
    *) echo "FAIL gate-ordinal — argumento desconhecido '$1'" >&2; exit 2 ;;
  esac
done

if [ -z "$TESTS_DIR" ]; then
  if [ -d "$ROOT/tests" ]; then TESTS_DIR="$ROOT/tests"
  else TESTS_DIR="$ROOT/.forge/scripts/tests"; fi
fi

# Ordinais presentes num diretório: uma linha "NNN<TAB>arquivo" por gate. Sem pipeline sob
# `set -e` (o próprio harness tem lint contra isso) — laço de glob puro.
_local_ordinals() { # _local_ordinals <dir>
  local d="$1" f base ord
  [ -d "$d" ] || return 0
  for f in "$d"/w[0-9]*.sh; do
    [ -f "$f" ] || continue
    base="${f##*/}"
    ord="${base#w}"; ord="${ord%%-*}"
    case "$ord" in ''|*[!0-9]*) continue ;; esac
    printf '%s\t%s\n' "$ord" "${base%.sh}"
  done
}

case "$cmd" in

check)
  listing="$(_local_ordinals "$TESTS_DIR")"
  n=0
  [ -z "$listing" ] || n="$(printf '%s\n' "$listing" | grep -c . || true)"
  if ! forge_universe_check "gate-ordinal" "$n" "ordinal(is) de gate" "$TESTS_DIR" "$ROOT"; then
    exit 1
  fi
  # Colisão: mesmo ordinal em dois arquivos distintos.
  dups="$(printf '%s\n' "$listing" | awk -F'\t' '{c[$1]=c[$1] " " $2; n[$1]++} END{for (o in n) if (n[o] > 1) printf "w%s:%s\n", o, c[o]}' | sort)"
  if [ -n "$dups" ]; then
    cnt="$(printf '%s\n' "$dups" | grep -c . || true)"
    echo "FAIL gate-ordinal — $cnt ordinal(is) usado(s) por mais de um gate em $TESTS_DIR:" >&2
    printf '%s\n' "$dups" | sed 's/^/      /' >&2
    echo "      Dois gates com o mesmo ordinal: um dos dois perde a identidade no merge, e" >&2
    echo "      'tests/run-all.sh' os executa em ordem de nome sem notar. Renomeie um deles —" >&2
    echo "      'gate-ordinal.sh next' devolve o próximo livre derivado do tronco remoto." >&2
    exit 1
  fi
  echo "OK gate-ordinal — $n ordinal(is) de gate examinado(s) em $TESTS_DIR, 0 colisão(ões)"
  ;;

next)
  local_max=0
  listing="$(_local_ordinals "$TESTS_DIR")"
  if [ -n "$listing" ]; then
    local_max="$(printf '%s\n' "$listing" | awk -F'\t' '{o=$1+0; if (o>m) m=o} END{print m+0}')"
  fi

  # Tronco remoto. A ORDEM importa: o remoto é a autoridade porque contempla o que outra branch já
  # mergeou; a árvore local só contempla o que ESTA branch por acaso contém.
  remote_max=0
  remote_src=""
  rel="${TESTS_DIR#"$ROOT"/}"
  [ "$rel" != "$TESTS_DIR" ] || rel="tests"
  refs="$REMOTE_REF"
  [ -n "$refs" ] || refs="origin/dev origin/develop origin/main origin/master"
  for ref in $refs; do
    git rev-parse --verify --quiet "$ref" >/dev/null 2>&1 || continue
    tree="$(git ls-tree --name-only "$ref" "$rel/" 2>/dev/null)" || continue
    [ -n "$tree" ] || continue
    remote_max="$(printf '%s\n' "$tree" | awk -F/ '{b=$NF; if (b ~ /^w[0-9]+/) {sub(/^w/,"",b); sub(/-.*$/,"",b); o=b+0; if (o>m) m=o}} END{print m+0}')"
    remote_src="$ref"
    break
  done

  max="$local_max"
  [ "$remote_max" -gt "$max" ] && max="$remote_max"
  next=$((max + 1))
  printf 'w%s\n' "$next"
  if [ -n "$remote_src" ]; then
    echo "  derivado do tronco remoto '$remote_src' (máximo remoto w$remote_max) e da árvore local (máximo local w$local_max)"
  else
    # Degradação DECLARADA. Um número devolvido em silêncio aqui é indistinguível de um número
    # que contemplou o tronco — e é exatamente por essa indistinção que os ordinais colidiram.
    echo "  ATENÇÃO: nenhum tronco remoto acessível ($refs) — derivado SÓ DA ÁRVORE LOCAL (máximo local w$local_max)." >&2
    echo "  Outra branch pode já ter usado este número. Rode 'git fetch' e repita antes de nomear o arquivo." >&2
  fi
  ;;

*)
  echo "FAIL gate-ordinal — comando desconhecido '$cmd' (use 'check' ou 'next')" >&2; exit 2
  ;;
esac
