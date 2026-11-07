#!/usr/bin/env bash
# check-secrets.sh — reprova segredo hardcoded em arquivo VERSIONADO (rule conventions/no-hardcoded-secrets.md).
#
# O modo de falha que este gate ataca é característico: uma credencial entra num arquivo de
# configuração durante o desenvolvimento inicial, o build funciona, nada quebra, e ela permanece
# rastreada indefinidamente porque nenhum gate acusa. A descoberta acaba acontecendo por auditoria,
# por varredura externa ou por acidente — sempre tarde, e sempre depois de o valor já estar no
# histórico e em todos os clones. Detectar no commit custa perto de zero; descobrir depois custa
# rotação de credencial, análise de exposição e, em contexto regulado (PCI DSS, LGPD), evidência.
#
# Opera sobre o conjunto VERSIONADO (`git ls-files`), não sobre o working tree: o que está no
# .gitignore não é o problema — o problema é o que todo mundo com acesso de leitura já tem.
#
# Modos:
#   check-secrets.sh staged              # hook pre-commit: o que vai entrar no commit
#   check-secrets.sh range <rev-range>   # CI sobre o diff do PR
#   check-secrets.sh path <path>         # varredura pontual (dir ou arquivo)
#   check-secrets.sh --path <path>       # alias de `path`, para runtime.gates do pre-push
#   check-secrets.sh report [<path>]     # INVENTÁRIO do passivo, sem reprovar (exit 0)
#   FORGE_SECRETS_ENFORCE=warn|block     # sobrepõe secrets.enforce do forge.yaml nesta invocação
#
# DUAS PROPRIEDADES QUE DEFINEM ESTE GATE, e o porquê de cada uma:
#
#   1. NUNCA passa por vacuidade. Se o conjunto varrido vier vazio — path errado, glob que não
#      casa, arquivo ausente, range que não resolve — o resultado é FAIL explícito, jamais OK.
#      "Não encontrei violação" e "não procurei" são estados distintos e não podem colapsar no
#      mesmo verde; um gate que aprova por não ter olhado é pior que gate nenhum, porque compra
#      confiança sem entregar verificação.
#   2. Falha de INTEGRIDADE ignora o modo. `enforce: warn` rebaixa ACHADO (o passivo do brownfield
#      que se quer medir antes de travar o time), nunca rebaixa conjunto vazio nem allowlist
#      malformada — essas duas dizem que o gate não rodou direito, e um gate que não rodou não
#      pode reportar-se como verde em nenhum modo.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIBDIR="$SCRIPT_DIR/lib"
RULE="rules/conventions/no-hardcoded-secrets.md"

mode="${1:-}"; shift 2>/dev/null || true
case "$mode" in
  --path) mode="path" ;;
esac
case "$mode" in
  staged|range|path|report) : ;;
  "") echo "FAIL secrets — uso: check-secrets.sh staged | range <rev-range> | path <path> | report [<path>]" >&2; exit 2 ;;
  *)  echo "FAIL secrets — modo desconhecido '$mode' (use staged | range | path | report)" >&2; exit 2 ;;
esac

command -v node >/dev/null 2>&1 || { echo "FAIL secrets — node >= 20 necessário para a varredura" >&2; exit 2; }

target="${1:-}"

# ── raiz do repositório ──────────────────────────────────────────────────────────────────────
# FORGE_ROOT vence (é como o harness injeta a raiz em worktree e em CI); senão deriva do próprio
# alvo, para que uma varredura apontada a outro repositório leia a config DAQUELE repositório.
_toplevel_of() { # _toplevel_of <path>
  local d="$1"
  [ -d "$d" ] || d="$(dirname "$d")"
  git -C "$d" rev-parse --show-toplevel 2>/dev/null
}

ROOT="${FORGE_ROOT:-}"
if [ -z "$ROOT" ]; then
  if [ -n "$target" ] && [ -e "$target" ]; then ROOT="$(_toplevel_of "$target")"; else ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; fi
fi
[ -n "$ROOT" ] && [ -d "$ROOT" ] && ROOT="$(cd "$ROOT" && pwd -P)"
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then
  echo "FAIL secrets/scan-set — não foi possível resolver a raiz do repositório (alvo '${target:-.}' fora de um repositório git)" >&2
  exit 1
fi

FORGE_YAML="$ROOT/.forge/forge.yaml"
ALLOWLIST="${FORGE_SECRETS_ALLOWLIST:-$ROOT/.forge/secrets-allowlist.txt}"

# ── enforce: warn|block (awk portável, mesmo idioma de check-liaison-acks.sh) ────────────────
# Ausência do bloco resolve para `warn`, e a razão é de rollout, não de rigor.
#
# Este gate NÃO é opt-in: ele está fiado no pre-commit e no CI, então todo projeto que atualizar o
# harness passa a tê-lo sem ter pedido. Um repositório brownfield com passivo — credencial que já
# está versionada há meses — teria, no dia da atualização, todo commit que encostasse naquele
# arquivo bloqueado, sem aviso prévio e sem janela para medir o tamanho do problema. Gate que
# chega travando o time no primeiro dia é gate que vira `--no-verify` de hábito, e aí ele não
# protege mais nada. É a mesma decisão que `check-liaison-acks.sh` já toma, pelo mesmo motivo.
#
# O default brando vale só para quem HERDA o gate. Projeto novo nasce com `enforce: block`
# explícito no forge.yaml do template, e um brownfield que rodou `check-secrets.sh report`, sanear
# o passivo e quer fechar a porta declara `block` — que é o estado final esperado de todo mundo.
enforce="warn"
if [ -f "$FORGE_YAML" ]; then
  _found="$(awk '
    $0 ~ /^secrets:/ { inblk=1; next }
    inblk && /^[a-z_]+:/ { exit }
    inblk && /^[ ]+enforce:[ ]*(warn|block)/ { sub(/^[ ]+enforce:[ ]*/, ""); print; exit }
  ' "$FORGE_YAML")"
  [ -n "$_found" ] && enforce="$_found"
fi
# `FORGE_SECRETS_ENFORCE` (warn|block) sobrepõe o forge.yaml POR INVOCAÇÃO, e existe por ESCOPO, não por rigor (Refs #174, conserto devolvido por um consumidor). `block` global num brownfield reprovaria todo push que encostasse no passivo herdado, por um defeito que o autor do push não introduziu; `warn` global nunca impede a ocorrência seguinte. A saída é a assimetria: o forge.yaml fica em `warn` para o passivo e o hook de push invoca `FORGE_SECRETS_ENFORCE=block check-secrets.sh range <push>`, então o que ENTRA bloqueia. Valor fora de warn|block reprova com rc 2 em vez de cair no forge.yaml: uma política que o chamador pediu e o gate ignorou em silêncio é o defeito que este bloco corrige. Vazia equivale a ausente. O modo report continua inventário, qualquer que seja o valor.
if [ -n "${FORGE_SECRETS_ENFORCE:-}" ]; then
  case "$FORGE_SECRETS_ENFORCE" in
    warn|block) enforce="$FORGE_SECRETS_ENFORCE" ;;
    *) echo "FAIL secrets — FORGE_SECRETS_ENFORCE='$FORGE_SECRETS_ENFORCE' inválido (use warn|block)" >&2; exit 2 ;;
  esac
fi
[ "$mode" = "report" ] && enforce="report"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/forge-secrets.XXXXXX")" || { echo "FAIL secrets — não foi possível criar diretório temporário" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT
FILELIST="$TMP/files.txt"

# ── resolução do conjunto a varrer ───────────────────────────────────────────────────────────
# Sempre paths relativos à raiz, sempre saídos do índice do git (`ls-files` / `diff`), nunca do
# working tree: arquivo não rastreado não é passivo versionado.
scope=""
case "$mode" in
  staged)
    scope="índice (staged)"
    git -C "$ROOT" diff --cached --name-only --diff-filter=ACMR > "$FILELIST" 2>/dev/null
    ;;
  range)
    [ -n "$target" ] || { echo "FAIL secrets — <rev-range> obrigatório no modo range" >&2; exit 2; }
    scope="range $target"
    if ! git -C "$ROOT" rev-list --max-count=1 "$target" >/dev/null 2>&1; then
      echo "FAIL secrets/scan-set — rev-range '$target' não resolve neste repositório — o gate não varreria nada" >&2
      exit 1
    fi
    git -C "$ROOT" diff --name-only --diff-filter=ACMR "$target" > "$FILELIST" 2>/dev/null
    ;;
  path|report)
    [ -n "$target" ] || target="$ROOT"
    if [ ! -e "$target" ]; then
      echo "FAIL secrets/scan-set — alvo '$target' não existe — o gate não varreria nada (path errado não pode virar verde)" >&2
      exit 1
    fi
    # `pwd -P` e não `pwd`: no macOS /tmp é symlink para /private/tmp, e o
    # `git rev-parse --show-toplevel` devolve sempre o caminho FÍSICO. Com o caminho lógico de um
    # lado e o físico do outro o prefixo não casa, o path relativo sai errado e o `ls-files`
    # devolve conjunto vazio — que este gate reportaria como vacuidade em vez de varrer o alvo.
    _abs="$(cd "$(dirname "$target")" 2>/dev/null && pwd -P)/$(basename "$target")"
    [ -d "$target" ] && _abs="$(cd "$target" && pwd -P)"
    _rel="${_abs#"$ROOT"}"; _rel="${_rel#/}"
    scope="path ${_rel:-.}"
    if [ -n "$_rel" ]; then
      git -C "$ROOT" ls-files -- "$_rel" > "$FILELIST" 2>/dev/null
    else
      git -C "$ROOT" ls-files > "$FILELIST" 2>/dev/null
    fi
    ;;
esac

n_files="$(grep -c . "$FILELIST" 2>/dev/null)"; : "${n_files:=0}"

# Propriedade 1 — anti-vacuidade. Ignora o `enforce` de propósito (propriedade 2).
if [ "${n_files:-0}" -eq 0 ]; then
  echo "FAIL secrets/scan-set — nenhum arquivo VERSIONADO em '$scope': o gate não varreu nada" >&2
  echo "      Conjunto vazio não é ausência de segredo, é ausência de verificação. Confira o alvo," >&2
  echo "      o glob e se os arquivos estão de fato rastreados pelo git (git ls-files)." >&2
  exit 1
fi

# ── varredura ────────────────────────────────────────────────────────────────────────────────
# O node lê a lista por ARQUIVO, não por argv: um repositório grande estoura o limite de argumentos
# do exec (E2BIG), e um gate que morre por tamanho de argv falha de forma indistinguível de um
# gate que rodou — é o mesmo modo de falha que o FORGE_PUSH_REFS_FILE evita no pre-push.
node - "$LIBDIR" "$ROOT" "$FILELIST" "$ALLOWLIST" > "$TMP/out.txt" 2>"$TMP/err.txt" <<'NODEEOF'
const { readFileSync, existsSync, statSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, fileList, allowPath] = process.argv;
  const S = await import(pathToFileURL(join(lib, 'secret-scan.mjs')).href);

  let entries = [];
  if (existsSync(allowPath)) {
    const parsed = S.parseAllowlist(readFileSync(allowPath, 'utf8'));
    entries = parsed.entries;
    for (const e of parsed.errors) console.log(`ALLOWERR\t${e.lineNo}\t${e.reason}`);
  }

  const files = readFileSync(fileList, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  let scanned = 0;
  let allowed = 0;
  const MAX_BYTES = 2 * 1024 * 1024;

  for (const rel of files) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;                       // removido no range/índice
    let st; try { st = statSync(abs); } catch { continue; }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const hit = S.allowlistMatch(rel, entries);
    if (hit) { allowed++; console.log(`SKIPPED\t${rel}\t${hit.motivo}`); continue; }
    let text; try { text = readFileSync(abs, 'utf8'); } catch { continue; }
    if (text.indexOf('\u0000') !== -1) continue;          // binário
    scanned++;
    for (const f of S.scanLines(rel, text)) console.log(`HIT\t${f.cls}\t${rel}\t${f.lineNo}\t${f.reason}`);
  }
  console.log(`SCANNED\t${scanned}\t${allowed}`);
})();
NODEEOF
node_rc=$?
if [ "$node_rc" -ne 0 ]; then
  echo "FAIL secrets — a varredura abortou (rc=$node_rc); o gate não pode reportar-se verde sem ter rodado:" >&2
  sed 's/^/      /' "$TMP/err.txt" >&2
  exit 1
fi

OUT="$TMP/out.txt"
scanned="$(awk -F'\t' '$1=="SCANNED"{print $2}' "$OUT" | tail -1)"
allowed="$(awk -F'\t' '$1=="SCANNED"{print $3}' "$OUT" | tail -1)"
: "${scanned:=0}"; : "${allowed:=0}"

fail=0

# Allowlist malformada é falha de INTEGRIDADE: uma entrada sem justificativa seria isenção
# anônima, e é exatamente por aí que gates de segredo são esvaziados na prática.
if grep -q '^ALLOWERR' "$OUT"; then
  n_err="$(grep -c '^ALLOWERR' "$OUT")"
  echo "FAIL secrets/allowlist — $n_err entrada(s) inválida(s) em $ALLOWLIST:" >&2
  awk -F'\t' '$1=="ALLOWERR"{printf "      linha %s: %s\n", $2, $3}' "$OUT" >&2
  echo "      Formato: <glob>  # motivo: <justificativa auditável>" >&2
  fail=1
else
  echo "OK secrets/allowlist — $(printf '%s' "$allowed") arquivo(s) isento(s) com justificativa"
fi

if [ "${scanned:-0}" -eq 0 ]; then
  echo "FAIL secrets/scan-set — $n_files arquivo(s) no alvo, 0 efetivamente varrido(s) (binários, grandes demais ou todos isentos)" >&2
  echo "      Um conjunto varrido vazio não pode virar OK — ver rule $RULE." >&2
  exit 1
fi
echo "OK secrets/scan-set — $scanned arquivo(s) versionado(s) varrido(s) em $scope"

CLASSES="conn-cred private-key provider-token basic-auth"
findings=0
for cls in $CLASSES; do
  n="$(awk -F'\t' -v c="$cls" '$1=="HIT" && $2==c' "$OUT" | grep -c . )"
  if [ "$n" -eq 0 ]; then
    echo "OK secrets/$cls — nenhuma ocorrência"
    continue
  fi
  findings=$((findings + n))
  if [ "$enforce" = "block" ]; then
    echo "FAIL secrets/$cls — $n ocorrência(s):" >&2
    awk -F'\t' -v c="$cls" '$1=="HIT" && $2==c {printf "      %s:%s: %s\n", $3, $4, $5}' "$OUT" >&2
    fail=1
  else
    echo "WARN secrets/$cls — $n ocorrência(s):"
    awk -F'\t' -v c="$cls" '$1=="HIT" && $2==c {printf "      %s:%s: %s\n", $3, $4, $5}' "$OUT"
  fi
done

if [ "$mode" = "report" ]; then
  echo "REPORT secrets — $findings ocorrência(s) em $scanned arquivo(s) versionado(s) ($scope); inventário, não reprovação"
  [ "$fail" -eq 0 ] || exit 1
  exit 0
fi

if [ "$fail" -ne 0 ]; then
  echo "FAIL secrets — $findings ocorrência(s) de segredo em arquivo versionado (enforce: $enforce, rule $RULE)" >&2
  echo "      Remover a linha NÃO basta: o valor continua no histórico e em todos os clones — ROTACIONE a credencial." >&2
  echo "      Falso positivo? Registre em $ALLOWLIST no formato '<glob>  # motivo: <justificativa>'." >&2
  exit 1
fi

if [ "$findings" -ne 0 ]; then
  echo "WARN secrets — $findings ocorrência(s) (enforce: warn, não bloqueia; rule $RULE)"
  exit 0
fi

echo "OK secrets — nenhum segredo em $scanned arquivo(s) versionado(s) ($scope)"
