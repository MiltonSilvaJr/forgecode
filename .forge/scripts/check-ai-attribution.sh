#!/usr/bin/env bash
# check-ai-attribution.sh — reprova assinatura de IA em commit, PR e issue.
#
# Regra canônica: rules/conventions/no-ai-attribution.md. O commit é do humano que decidiu,
# revisou e assume a mudança; a ferramenta usada para escrevê-lo não é coautora, do mesmo modo que
# o editor de texto não é. Configuração de cliente (o bloco `attribution` do Claude Code, o
# `--no-gpg-sign` da vida) não substitui esta verificação: configuração é por máquina e por conta,
# some num clone novo ou num runner de CI, e quando alguém percebe o trailer já está no histórico.
#
# Modos:
#   check-ai-attribution.sh msg-file <path>   # hook commit-msg: a mensagem prestes a virar commit
#   check-ai-attribution.sh range <rev-range> # hook pre-push / CI: todos os commits do range
#   check-ai-attribution.sh text <path>       # corpo de PR, issue ou release notes
#
# Saída de uma linha OK/FAIL; em FAIL, uma linha por ocorrência com posição e motivo.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDIR="$SCRIPT_DIR/lib"
# `if` explícito e não `A || B && C`: em shell isso agrupa como `(A || B) && C`, e o `pwd` roda
# mesmo quando o `git rev-parse` já respondeu — ROOT sairia com DUAS linhas, e o caminho da
# allowlist derivado dele nunca casaria com arquivo nenhum.
ROOT="${FORGE_ROOT:-}"
if [ -z "$ROOT" ]; then
  ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
  [ -n "$ROOT" ] || ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi
RULE="rules/conventions/no-ai-attribution.md"
# shellcheck disable=SC1090
. "$LIBDIR/gate-universe.sh"

mode="${1:-}"; shift || true
[ -n "$mode" ] || { echo "Usage: check-ai-attribution.sh msg-file <path> | range <rev-range> | text <path>" >&2; exit 2; }

# Roda a lib sobre o texto de um ARQUIVO. Por arquivo e não por stdin porque `node -` já usa o
# stdin para ler o próprio programa — alimentar dados por ali faz o scanner analisar o vazio e
# aprovar tudo, que é a pior falha possível num gate: silenciosa e sempre verde.
# Ecoa uma linha por violação; rc 1 se houver alguma.
_scan_file() { # _scan_file <arquivo> <rótulo>
  node - "$LIBDIR" "$1" "$2" <<'NODEEOF'
const { readFileSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, file, label] = process.argv;
  const { findAiAttribution } = await import(pathToFileURL(join(lib, 'ai-attribution.mjs')).href);
  const violations = findAiAttribution(readFileSync(file, 'utf8'));
  for (const v of violations) console.log(`${label}:${v.lineNo}: ${v.reason} — ${v.line}`);
  process.exit(violations.length ? 1 : 0);
})();
NODEEOF
}

_tmpfile() { mktemp "${TMPDIR:-/tmp}/forge-aiattr.XXXXXX"; }

_fail_banner() {
  echo "FAIL: assinatura de IA detectada (rule $RULE)." >&2
  echo "      O commit é de quem decidiu e assume a mudança; a ferramenta usada não é coautora." >&2
  echo "      Remova o trailer/marcador e refaça (git commit --amend, ou reescreva a mensagem do PR)." >&2
  echo "      Para não reincidir, zere a atribuição na origem — no Claude Code, \"attribution\": { \"commit\": \"\", \"pr\": \"\" } em settings.json." >&2
}

case "$mode" in

msg-file)
  file="${1:-}"
  [ -n "$file" ] || { echo "FAIL: <path> obrigatório" >&2; exit 2; }
  [ -f "$file" ] || { echo "FAIL: arquivo não encontrado: $file" >&2; exit 2; }
  # Comentários do template do git (linhas '#') não fazem parte da mensagem final.
  clean="$(_tmpfile)"
  # shellcheck disable=SC2064
  trap "rm -f '$clean'" EXIT
  grep -v '^#' "$file" > "$clean" || true
  set +e
  out="$(_scan_file "$clean" "$(basename "$file")")"; rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '%s\n' "$out" >&2
    _fail_banner
    exit 1
  fi
  echo "OK ai-attribution — mensagem limpa"
  ;;

range)
  range="${1:-}"
  [ -n "$range" ] || { echo "FAIL: <rev-range> obrigatório" >&2; exit 2; }
  shas="$(git rev-list "$range" 2>/dev/null || true)"
  # `awk` e não `grep -c`: sob `set -e`, `grep -c` devolve rc 1 quando a contagem é ZERO, e a
  # atribuição mataria o script ANTES de o contador de controle poder reprovar — o gate morreria
  # sem imprimir linha alguma, que é a mesma opacidade que esta correção existe para eliminar.
  n_commits="$(printf '%s\n' "$shas" | awk 'NF{n++} END{print n+0}')"
  # Contador de controle (issue #49). `nenhum commit no range` saía como OK e exit 0 — o mesmo
  # desfecho de "varri 37 commits e todos estavam limpos". Range que não resolve, ref errada e
  # branch já publicado produzem conjunto vazio, e nesse estado o gate não verificou nada.
  if ! forge_universe_check "ai-attribution" "$n_commits" "commit(s)" "range $range" "$ROOT"; then
    exit 1
  fi
  msgtmp="$(_tmpfile)"
  # shellcheck disable=SC2064
  trap "rm -f '$msgtmp'" EXIT
  bad=0
  while IFS= read -r sha; do
    [ -n "$sha" ] || continue
    git show -s --format=%B "$sha" > "$msgtmp"
    set +e
    out="$(_scan_file "$msgtmp" "${sha:0:7}")"; rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then printf '%s\n' "$out" >&2; bad=$((bad + 1)); fi
  done <<EOF_SHAS
$shas
EOF_SHAS
  if [ "$bad" -ne 0 ]; then
    _fail_banner
    echo "      $bad commit(s) do range carregam assinatura de IA — reescreva antes de publicar (git rebase -i / filter-repo)." >&2
    exit 1
  fi
  echo "OK ai-attribution — $n_commits commit(s) limpos"
  ;;

text)
  file="${1:-}"
  [ -n "$file" ] || { echo "FAIL: <path> obrigatório" >&2; exit 2; }
  [ -f "$file" ] || { echo "FAIL: arquivo não encontrado: $file" >&2; exit 2; }
  set +e
  out="$(_scan_file "$file" "$(basename "$file")")"; rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    printf '%s\n' "$out" >&2
    _fail_banner
    exit 1
  fi
  echo "OK ai-attribution — texto limpo"
  ;;

*)
  echo "FAIL: modo desconhecido '$mode' (use msg-file | range | text)" >&2; exit 2
  ;;
esac
