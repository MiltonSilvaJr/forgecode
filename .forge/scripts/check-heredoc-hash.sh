#!/usr/bin/env bash
# check-heredoc-hash.sh — reprova sustenido avulso dentro de heredoc aninhado em `$( )` (LDG-0052).
#
# A armadilha: um heredoc — QUALQUER forma de delimitador, `<<EOF`, `<<'EOF'`, `<<"EOF"` ou
# `<<\EOF`, a quotação não protege nada — cujo corpo vive dentro de `$( … )` (o idioma que todo
# script do harness usa para chamar `node`) não é imune ao próprio sustenido. Uma linha do corpo
# com um `(` sem aspas, seguido, na MESMA linha, de um `#` sem aspas, seguido de um `)` sem
# aspas — tipicamente um comentário em prosa "(issue #49, instância 1)" — faz o `bash` que
# escaneia o `$( )` por fora tratar o sustenido como início de comentário e descartar o resto da
# linha, levando o `)` que fecharia o `(` anterior. O parêntese externo nunca conta o fechamento
# perdido: o script morre em RUNTIME com "bad substitution: no closing `)`" — e `bash -n` não vê
# nada, porque a sintaxe crua é válida; só o balanceamento pós-heredoc quebra. Reproduzido
# ponta-a-ponta em check-liaison-acks.sh (ver lib/heredoc-hash-lint.mjs para a medição completa).
#
# Idioma correto: nunca deixar `(…#…)` cru no corpo — reescrever sem o parêntese, ou tirar o
# sustenido, ou envolver o trecho entre aspas (aspeado, o sustenido nunca é "visto" avulso).
#
# Uso:
#   check-heredoc-hash.sh --path <dir|arquivo> [--path <...>]   # varredura
#   check-heredoc-hash.sh <dir|arquivo> [...]                   # forma posicional
#
# Como todo gate do harness, tem contador de controle: varrer ZERO arquivo reprova, porque um
# lint que aprova por não ter olhado é a mesma classe de falha que este lint persegue.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDIR="$SCRIPT_DIR/lib"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# shellcheck disable=SC1090
. "$LIBDIR/gate-universe.sh"

command -v node >/dev/null 2>&1 || { echo "FAIL heredoc-hash — node >= 20 necessário" >&2; exit 2; }

targets=()
while [ $# -gt 0 ]; do
  case "$1" in
    --path) shift; [ $# -gt 0 ] || { echo "FAIL heredoc-hash — --path exige um argumento" >&2; exit 2; }
            targets+=("$1"); shift ;;
    --) shift ;;
    *) targets+=("$1"); shift ;;
  esac
done
[ "${#targets[@]}" -gt 0 ] || targets=("$ROOT")

TMP="$(mktemp -d /tmp/forge-heredochash.XXXXXX)" || { echo "FAIL heredoc-hash — mktemp falhou" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT

node - "$LIBDIR" "${targets[@]}" > "$TMP/out.txt" 2>"$TMP/err.txt" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, ...targets] = process.argv;
  const { readFileSync } = require('fs');
  const L = await import(pathToFileURL(join(lib, 'heredoc-hash-lint.mjs')).href);
  const files = L.collectShellFiles(targets);
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const v of L.lintText(text)) {
      console.log(`HIT\t${f}\t${v.openLine}\t${v.lineNo}\t${v.delimiter}\t${v.line}`);
    }
  }
  console.log(`SCANNED\t${files.length}`);
})();
NODEEOF
node_rc=$?
if [ "$node_rc" -ne 0 ]; then
  echo "FAIL heredoc-hash — a varredura abortou (rc=$node_rc); um lint que não rodou não pode reportar-se verde:" >&2
  sed 's/^/      /' "$TMP/err.txt" >&2
  exit 1
fi

OUT="$TMP/out.txt"
scanned="$(awk -F'\t' '$1=="SCANNED"{print $2}' "$OUT" | tail -1)"; : "${scanned:=0}"

# Contador de controle ANTES do veredito: sem arquivo varrido não há veredito a dar.
if ! forge_universe_check "heredoc-hash" "$scanned" "arquivo(s) .sh" "$(printf '%s ' "${targets[@]}")" "$ROOT"; then
  exit 1
fi

hits="$(awk -F'\t' '$1=="HIT"' "$OUT" | awk 'END{print NR+0}')"
if [ "${hits:-0}" -ne 0 ]; then
  echo "FAIL heredoc-hash — $hits ocorrência(s) de '(…#…)' cru dentro de heredoc aninhado em \$( ):" >&2
  awk -F'\t' '$1=="HIT"{printf "      %s: heredoc <<%s aberto na linha %s, sustenido perigoso na linha %s\n        %s\n", $2, $5, $3, $4, $6}' "$OUT" >&2
  echo "      um '(' sem aspas antes do '#' e um ')' sem aspas depois: o bash trata o '#' como" >&2
  echo "      início de comentário, engole o ')' que fecharia o '(' anterior, e o \$( ) externo" >&2
  echo "      nunca fecha — 'bad substitution: no closing )' em runtime; bash -n não vê nada." >&2
  echo "      Corrija tirando o parêntese, tirando o sustenido, ou aspeando o trecho." >&2
  exit 1
fi

echo "OK heredoc-hash — nenhuma ocorrência em $scanned arquivo(s) .sh"
