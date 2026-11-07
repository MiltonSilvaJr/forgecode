#!/usr/bin/env bash
# check-heavy-mutex.sh — gate ESTÁTICO de consumo do mutex de carga pesada (issue #52).
#
# Composição em runtime não basta: o defeito real do `ci-local.sh` foi um `trap … EXIT` instalado
# DEPOIS do nosso, e nenhuma composição defende disso. Este gate cobre o que está versionado.
#
# O que ele NÃO alcança está declarado: um `dotnet test` digitado à mão continua fora da fila.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# shellcheck disable=SC1090
. "$SCRIPT_DIR/lib/gate-universe.sh"

TARGET="$ROOT"
while [ $# -gt 0 ]; do
  case "$1" in
    --path|--root) TARGET="$2"; shift 2 ;;
    *) echo "FAIL: argumento desconhecido '$1'" >&2; exit 2 ;;
  esac
done

# A lista é capturada ANTES, numa variável: `$(find …)` dentro de heredoc mistura duas camadas de
# expansão e o resultado chegou vazio — e um universo vazio aqui é indistinguível de "varri tudo e
# estava limpo" se ninguém contar. Quem conta é o contador de controle logo abaixo.
# `cd` e caminhos RELATIVOS de propósito: um filtro `-not -path '*/worktrees/*'` sobre caminho
# absoluto exclui o repositório INTEIRO quando ele mesmo vive dentro de um worktree — medido, o
# universo chegou a zero e só o contador de controle denunciou.
# `.forge/evals/` (issue #176) guarda fixtures e outputs da metodologia de eval de skill/agente —
# cópias inteiras de um consumidor do harness (via `forge init`) ou snapshots do que um agente
# produziu. Elas trazem `.forge/scripts/lib/heavy-mutex.sh` e afins junto, e sem a exclusão este
# gate reprovaria o PRÓPRIO repositório (e o de qualquer consumidor que rode a mesma metodologia)
# por conteúdo de fixture, não por maquinaria de verdade.
FILES="$(cd "$TARGET" 2>/dev/null && find . -type f -name '*.sh' -not -path './.git/*' -not -path '*/node_modules/*' -not -path './.forge/worktrees/*' -not -path './.forge/evals/*' 2>/dev/null | sort)
$(cd "$TARGET" 2>/dev/null && find . -type f \( -name 'pre-push' -o -name 'pre-commit' -o -name 'post-merge' -o -name 'commit-msg' \) -not -path './.git/*' -not -path './.forge/worktrees/*' -not -path './.forge/evals/*' 2>/dev/null | sort)"
n=0
for _f in $FILES; do [ -n "$_f" ] && n=$((n + 1)); done

# Contador de controle (issue #49): universo vazio não pode terminar no mesmo verde de "varri tudo
# e estava limpo".
if ! forge_universe_check "heavy-mutex" "$n" "arquivo(s)" "$TARGET" "$ROOT"; then
  exit 1
fi

viol=0
report() { echo "FAIL heavy-mutex: $1" >&2; viol=$((viol + 1)); }

while IFS= read -r f; do
  [ -n "$f" ] || continue
  f="$TARGET/${f#./}"
  # Os arquivos que IMPLEMENTAM o primitivo são isentos por construção: o wrapper cita TMPDIR
  # porque PROCURA caminhos legados no `sweep --legacy`, e instala trap próprio porque é dono do
  # processo. Isentar quem implementa não é abrir exceção — é não confundir o mecanismo com o uso.
  # Isenção por CAMINHO CANÔNICO, nunca por nome: `*/heavy-mutex.sh` casaria as CÓPIAS LOCAIS que a
  # migração manda apagar (`hooks/git/lib/heavy-mutex.sh`, os `heavy-run.sh` de cada repo), e o gate
  # ficaria cego exatamente para o conjunto que existe para vigiar durante a transição.
  case "${f#$TARGET/}" in
    .forge/scripts/lib/heavy-mutex.sh|.forge/scripts/heavy-run.sh|.forge/scripts/check-heavy-mutex.sh) continue ;;
    template/.forge/scripts/lib/heavy-mutex.sh|template/.forge/scripts/heavy-run.sh|template/.forge/scripts/check-heavy-mutex.sh) continue ;;
    tests/w151-heavy-mutex-gate.sh|tests/w253-heavy-mutex-posse-gate.sh) continue ;;
    # Gate da TRAVA DO LOG PRÓPRIO do liaison (lib/liaison-lock.mjs), primitivo distinto do mutex
    # pesado: planta de propósito um `<canal>@<self>@log.lock/` órfão com `mkdir -p` para provar a
    # recuperação de trava abandonada. Não adquire o mutex pesado nem compete pelo mesmo recurso.
    tests/w327-liaison-own-log-lock-gate.sh) continue ;;
  esac

  # 1. Caminho de lock derivado de variável do chamador — o defeito 1 codificado. Mede INTENÇÃO,
  #    não grafia (LDG-0054): a versão anterior procurava a variável e a palavra 'lock' na MESMA
  #    linha, e bastava quebrar a composição em duas atribuições para desarmar a regra sem mudar
  #    uma vírgula da semântica — foi o que o próprio doctor.sh precisou fazer para DETECTAR o
  #    caminho legado sem ser acusado de PRODUZI-lo (ver o comentário ao lado da chamada, abaixo).
  #    Agora a janela também cobre a linha de código seguinte (pulando linha em branco ou
  #    inteiramente comentário), então a composição fatiada continua visível. A válvula é
  #    DECLARADA, nunca por acaso: quem precisa compor esse caminho para DETECTAR — não produzir —
  #    marca a linha com '# heavy-mutex: detecção', e a intenção passa a viver no código, não num
  #    comentário adjacente que o gate não lê.
  hits1="$(awk '
    function codepart(s,   i) { i = index(s, "#"); return (i == 0) ? s : substr(s, 1, i - 1) }
    function blank(s,   t) { t = s; gsub(/[ \t]/, "", t); return t == "" }
    function has_var(s) { return codepart(s) ~ /\$\{?(TMPDIR|HOME|PWD)([:}\/-]|$)/ }
    function has_lock(s) { return tolower(codepart(s)) ~ /lock/ }
    function marked(s) { return s ~ /heavy-mutex: detec/ }
    { if (!blank(codepart($0))) { n++; L[n] = $0; NO[n] = NR } }
    END {
      for (i = 1; i <= n; i++) {
        if (has_var(L[i]) && has_lock(L[i])) {
          if (!marked(L[i])) print NO[i]
          continue
        }
        if (i < n) {
          a = L[i]; b = L[i + 1]
          if ((has_var(a) && has_lock(b)) || (has_lock(a) && has_var(b))) {
            if (!marked(a) && !marked(b)) print NO[i] "-" NO[i + 1]
          }
        }
      }
    }
  ' "$f" 2>/dev/null)"
  if [ -n "$hits1" ]; then
    first1="$(printf '%s\n' "$hits1" | head -1)"
    report "$f:$first1: caminho de lock derivado de variável do chamador — no macOS TMPDIR é por usuário E por contexto, e o lock deixa de ser por máquina. Use lib/heavy-mutex.sh. Se a linha só DETECTA o caminho legado (não produz), marque com '# heavy-mutex: detecção'."
  fi
  # 2. Protocolo paralelo: mkdir/ln -s direto sobre nome de lock. Dois mecanismos diferentes sobre
  #    o mesmo recurso não se excluem — e PARECEM protegidos, que é pior que não ter lock.
  if grep -nE '^[^#]*\b(mkdir|ln -s)\b[^|]*\.lock' "$f" 2>/dev/null | grep -q . \
     || { grep -qE '^[^#]*[A-Za-z_]+=.*\.lock' "$f" 2>/dev/null && grep -qE '^[^#]*\bmkdir\b +"?\$' "$f" 2>/dev/null; }; then
    report "$f: adquire lock por conta própria em vez de passar pela biblioteca — protocolo paralelo sobre o mesmo recurso não exclui nada."
  fi
  # 3. `trap … EXIT` cru DEPOIS do acquire — o defeito medido no ci-local.sh.
  if grep -q 'forge_heavy_mutex_acquire' "$f" 2>/dev/null; then
    aq="$(grep -n 'forge_heavy_mutex_acquire' "$f" | head -1 | cut -d: -f1)"
    tr="$(grep -nE "^[^#]*trap [^-].*(EXIT|INT|TERM)" "$f" | tail -1 | cut -d: -f1)"
    if [ -n "$tr" ] && [ -n "$aq" ] && [ "$tr" -gt "$aq" ]; then
      report "$f:$tr: 'trap' cru depois do acquire SUBSTITUI o handler de liberação — trap não acumula. Registre a limpeza numa função única."
    fi
    # 4. `exit` dentro de trap em arquivo que adquire: normaliza o rc e um push que falhou reporta
    #    sucesso (classe da issue #49). Aqui só reprova; a biblioteca preserva a semântica.
    if grep -qE "^[^#]*trap +['\"][^'\"]*\bexit\b" "$f" 2>/dev/null; then
      report "$f: 'exit' dentro de trap em arquivo que adquire o mutex — um push que falhou reportaria sucesso."
    fi
    # 8. acquire dentro de pipeline: o trap morreria com a subshell.
    if grep -qE 'forge_heavy_mutex_acquire[^|]*\|[^|]' "$f" 2>/dev/null \
       || grep -qE '^[^#]*\{[^}]*forge_heavy_mutex_arm_trap[^}]*\}[^|]*\|' "$f" 2>/dev/null \
       || grep -qE '^[^#]*\( *forge_heavy_mutex_(acquire|arm_trap)' "$f" 2>/dev/null; then
      report "$f: acquire dentro de pipeline — BASH_SUBSHELL != 0 e o trap morreria com a subshell."
    fi
  fi
  # 5. `rm -rf "$var/"` com barra final: sobre symlink destrói o conteúdo do ALVO e preserva o link.
  if grep -nE '^[^#]*rm -rf +("\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/"|"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?"/)' "$f" 2>/dev/null | grep -q .; then
    report "$f: 'rm -rf \"\$var/\"' com barra final — sobre symlink isso destrói o conteúdo do alvo e preserva o link."
  fi
  # 6. Laço sobre a fila sem o guarda `[ -d ]`: glob sem correspondência devolve o LITERAL.
  if grep -A3 -nE '^[^#]*for +[A-Za-z_]+ +in +"[^"]*(\.q|QDIR|queue)[^"]*"?/\*' "$f" 2>/dev/null \
       | grep -qv '\[ -d ' 2>/dev/null \
     && grep -qE '^[^#]*for +[A-Za-z_]+ +in +"[^"]*(\.q|QDIR|queue)[^"]*"?/\*' "$f" 2>/dev/null \
     && ! grep -A3 -E '^[^#]*for +[A-Za-z_]+ +in +"[^"]*(\.q|QDIR|queue)[^"]*"?/\*' "$f" 2>/dev/null | grep -q '\[ -d '; then
    report "$f: laço sobre a fila sem '[ -d ... ] || continue' — glob sem correspondência devolve o literal."
  fi
  # 7. Aritmética sobre ticket zero-padded sem `10#`: bash lê como octal e morre.
  if { grep -nE '^[^#]*\$\(\( *\$\{?[A-Za-z_]*(ticket|stamp|us20)[A-Za-z_]*\}? *\)\)' "$f" 2>/dev/null \
       || grep -nE '^[^#]*printf +[^[:space:]]*%[-0-9.]*d[^[:space:]]* +"?\$\{?[A-Za-z_]*(ticket|stamp|us20)' "$f" 2>/dev/null; } | grep -qv '10#'; then
    report "$f: aritmética sobre ticket sem '10#' — bash lê zeros à esquerda como octal e morre com 'value too great for base'."
  fi
  # 9. `mkdir -p` para materializar a âncora: aceita symlink pré-existente.
  # `$ROOT` genérico NÃO entra: `mkdir -p "$ROOT/..."` é idioma comum em script que nada tem a ver
  # com o mutex, e a regra virou falso positivo em três arquivos do próprio template. A âncora é
  # reconhecida por nome próprio, ou por o arquivo lidar com o mutex.
  if grep -nE '^[^#]*mkdir -p[^|]*(HEAVY_MUTEX_ROOT|\.lock\b|\.q\b)' "$f" 2>/dev/null | grep -q .; then
    report "$f: 'mkdir -p' sobre a âncora — aceita symlink plantado por terceiro e o pwd -P segue o link."
  fi
done <<EOF
$FILES
EOF

[ "$viol" -eq 0 ] || {
  echo "FAIL heavy-mutex — $viol ocorrência(s) em $n arquivo(s) examinado(s)" >&2
  exit 1
}
echo "OK heavy-mutex — nenhuma ocorrência em $n arquivo(s) examinado(s)"
