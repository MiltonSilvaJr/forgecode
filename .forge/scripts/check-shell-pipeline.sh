#!/usr/bin/env bash
# check-shell-pipeline.sh — reprova `<produtor> | grep -q … || <ação>` nos scripts do harness.
#
# A armadilha (issue #49, instância 3): `grep -q` sai no primeiro casamento; o produtor que ainda
# escreve leva SIGPIPE; o pipeline devolve 141; `pipefail` promove isso a falha; e o `||` na
# sequência executa a ação de "não casou" para uma linha que CASAVA. Com `&&`, a asserção do lado
# direito simplesmente não roda. Nos dois casos o script segue verde tendo pulado o trabalho —
# a mesma família de "não executei e executei limpo terminam no mesmo exit 0" que esta issue ataca.
#
# Idioma correto: capturar antes do pipe e casar sem pipeline.
#   out="$(cmd 2>&1 || true)"
#   grep -q 'pat' <<<"$out" || { … }         # here-string é comando único: o rc é o do grep
#   case "$out" in *pat*) … ;; esac          # sem pipeline nenhum
#
# Uso:
#   check-shell-pipeline.sh --path <dir|arquivo> [--path <...>]   # varredura
#   check-shell-pipeline.sh <dir|arquivo> [...]                   # forma posicional
#
# Como todo gate do harness, tem contador de controle: varrer ZERO arquivo reprova, porque um
# lint que aprova por não ter olhado é a instância 1 desta mesma issue dentro da correção da 3.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDIR="$SCRIPT_DIR/lib"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# shellcheck disable=SC1090
. "$LIBDIR/gate-universe.sh"

command -v node >/dev/null 2>&1 || { echo "FAIL shell-pipeline — node >= 20 necessário" >&2; exit 2; }

targets=()
while [ $# -gt 0 ]; do
  case "$1" in
    --path) shift; [ $# -gt 0 ] || { echo "FAIL shell-pipeline — --path exige um argumento" >&2; exit 2; }
            targets+=("$1"); shift ;;
    --) shift ;;
    *) targets+=("$1"); shift ;;
  esac
done
[ "${#targets[@]}" -gt 0 ] || targets=("$ROOT")

TMP="$(mktemp -d /tmp/forge-shpipe.XXXXXX)" || { echo "FAIL shell-pipeline — mktemp falhou" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT

node - "$LIBDIR" "${targets[@]}" > "$TMP/out.txt" 2>"$TMP/err.txt" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, ...targets] = process.argv;
  const { readFileSync } = require('fs');
  const L = await import(pathToFileURL(join(lib, 'shell-pipeline-lint.mjs')).href);
  const files = L.collectShellFiles(targets);
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const v of L.lintText(text)) {
      console.log(`HIT\t${f}\t${v.lineNo}\t${v.producer}\t${v.op}\t${v.line}`);
    }
    for (const v of L.lintCmdSubst(text)) {
      console.log(`SUBST\t${f}\t${v.lineNo}\t${v.producer}\t${v.line}`);
    }
  }
  console.log(`SCANNED\t${files.length}`);
})();
NODEEOF
node_rc=$?
if [ "$node_rc" -ne 0 ]; then
  echo "FAIL shell-pipeline — a varredura abortou (rc=$node_rc); um lint que não rodou não pode reportar-se verde:" >&2
  sed 's/^/      /' "$TMP/err.txt" >&2
  exit 1
fi

OUT="$TMP/out.txt"
scanned="$(awk -F'\t' '$1=="SCANNED"{print $2}' "$OUT" | tail -1)"; : "${scanned:=0}"

# Contador de controle ANTES do veredito: sem arquivo varrido não há veredito a dar.
if ! forge_universe_check "shell-pipeline" "$scanned" "arquivo(s) .sh" "$(printf '%s ' "${targets[@]}")" "$ROOT"; then
  exit 1
fi

substs="$(awk -F'\t' '$1=="SUBST"' "$OUT" | awk 'END{print NR+0}')"
if [ "${substs:-0}" -ne 0 ]; then
  echo "FAIL shell-pipeline — $substs atribuição(ões) por substituição de comando cujo pipeline tem produtor falível silenciado, em arquivo com 'set -e' E 'pipefail':" >&2
  awk -F'\t' '$1=="SUBST"{printf "      %s:%s: produtor \"%s\" com 2>/dev/null dentro de $( ) com pipeline\n        %s\n", $2, $3, $4, $5}' "$OUT" >&2
  echo "      Sob 'set -e' + 'pipefail' a falha do produtor mata o script SEM UMA LINHA de saída —" >&2
  echo "      foi assim que o w20-spec-gate morreu no CI três execuções seguidas. O 2>/dev/null é a" >&2
  echo "      assinatura: o autor espera falha ali e, no mesmo gesto, esconde a única pista que" >&2
  echo "      restaria. Corrija com um escape que governe a PRÓPRIA substituição:" >&2
  echo "        X=\"\$(ls -1 \"\$D\" 2>/dev/null | sort)\" || true" >&2
  echo "      Atenção: um '||' que governa um TESTE anterior ('[ -n \"\$x\" ] || X=\"\$( … )\"') NÃO" >&2
  echo "      protege — ali a atribuição é o último comando da lista OR e o script morre igual." >&2
  exit 1
fi

hits="$(awk -F'\t' '$1=="HIT"' "$OUT" | awk 'END{print NR+0}')"
if [ "${hits:-0}" -ne 0 ]; then
  echo "FAIL shell-pipeline — $hits pipeline(s) terminando em 'grep -q' com '||'/'&&' na sequência, sob pipefail:" >&2
  awk -F'\t' '$1=="HIT"{printf "      %s:%s: produtor \"%s\" antes de grep -q, seguido de %s\n        %s\n", $2, $3, $4, $5, $6}' "$OUT" >&2
  echo "      grep -q sai no 1º casamento; o produtor leva SIGPIPE, o pipeline devolve 141 e pipefail" >&2
  echo "      promove a falha — a ação do ||/&& roda (ou deixa de rodar) pelo motivo errado." >&2
  echo "      Corrija capturando antes do pipe: out=\"\$(cmd 2>&1 || true)\"; grep -q 'pat' <<<\"\$out\" || { … }" >&2
  exit 1
fi

echo "OK shell-pipeline — nenhuma ocorrência em $scanned arquivo(s) .sh"
