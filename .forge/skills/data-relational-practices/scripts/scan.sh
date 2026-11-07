#!/usr/bin/env bash
# scan.sh — data-relational-practices: detecção estática relacional (PostgreSQL, SQL Server, MySQL): migrações bloqueantes, tipos, OFFSET, isolamento, PgBouncer, exposição de banco, dinheiro e RLS.
#
# Uso: bash .forge/skills/data-relational-practices/scripts/scan.sh [--root <caminho>]... [--json <arquivo>] [--max <n>]
# Cada regra abaixo corresponde a uma entrada de references/antipatterns.md cuja Detecção é `scan.sh <ID>`; o w250
# confere a bijeção. Toda regra emite uma linha, inclusive as que não acharam nada: OK quer dizer verificado e
# limpo. Todo achado sai com arquivo:linha. Achado é candidato, não veredito: quem revisa lê o trecho e decide.
# Severidade alto só com detector preciso e prática inequívoca na base; detector [Heurística] ou [Interp.] é aviso.
# O scanner lê texto: não conecta em banco, broker, cache nem nuvem (detecção de runtime fica documentada no
# catálogo e é executada por quem tem acesso, nunca por este script).
# Exit: 0 sem achado alto; 1 com achado alto; 2 erro de uso; 3 nada examinado (NADA-EXAMINADO).

SKILL="data-relational-practices"
UNIVERSO="sql codigo iac"

# >>> motor — idêntico nos seis scan.sh das skills data-*-practices (o w250 confere por cmp)
#
# Contrato (design §2.5 do change data-engineer-agent, igual nos seis):
#   Uso: scan.sh [--root <caminho>]... [--json <arquivo>] [--max <n>]
#   --root é repetível e aceita diretório ou arquivo avulso; sem --root a raiz é "."; caminho inexistente é erro de
#   uso (exit 2). O universo é a união dos caminhos, sem duplicata.
#   Saída: uma linha por regra, inclusive as que não acharam nada — "OK <ID> [<sev>] nenhuma ocorrência" ou
#   "FOUND <ID> [<sev>] <n> ocorrência(s) — <por quê>" seguida de "  <arquivo>:<linha>: <trecho>" (até --max,
#   padrão 10). A última linha é "ARQUIVOS-VARRIDOS <n>"; com n = 0 sai "NADA-EXAMINADO" e exit 3, nunca OK.
#   Exit: 0 sem achado alto (aviso não reprova), 1 com achado alto, 2 erro de uso, 3 nada examinado.
#
# Por que o universo é enumerado por `find` e não pelo motor de busca: com `rg` o universo mudaria com o .gitignore do
# consumidor, com arquivo oculto e com arquivo binário, e com `grep -r` não; os dois motores varreriam árvores
# diferentes e o relatório mudaria conforme a máquina. Aqui o `find` decide O QUE é examinado (mesmo filtro de
# diretório nos dois casos, inclusive os worktrees aninhados de .forge/worktrees e .claude/worktrees, que num checkout
# principal somam a maior parte dos arquivos), e o motor só decide ONDE casa, sobre a lista explícita de arquivos.
# A maquinaria do harness também fica fora (.forge/{agents,adapters,capabilities,commands,contracts,evals,graph,hooks,
# ledger,liaison,rules,schemas,scripts,skills,templates}, .claude e .agents): numa instalação nova ela é tudo o que
# existe, e o schema de classificação do próprio harness virava achado de T-02. .forge/specs e .forge/product ficam
# dentro, porque são do projeto. Um --root que aponta explicitamente para dentro de um desses diretórios é respeitado.
# O `rg` roda com --no-unicode (sem ele, uma classe negada não casa byte UTF-8 inválido e o grep em C casa) e
# --no-config (um RIPGREP_CONFIG_PATH do operador mudaria a saída). Padrões sem \b, que o grep BSD não reconhece:
# fronteira sempre por classe explícita. Toda saída passa por LC_ALL=C sort antes de ser contada e emitida.
#
# Sem rede, sem credencial, sem variável de ambiente de conexão, sem interpretador além de bash: só coreutils,
# find, grep, sed, awk, sort, xargs e, quando presente, rg.
set -uo pipefail

RAIZES=()
JSON=""
MAX=10
while [ $# -gt 0 ]; do
  case "$1" in
    --root) [ $# -ge 2 ] || { echo "ERRO uso: --root exige um caminho" >&2; exit 2; }; RAIZES+=("$2"); shift 2 ;;
    --json) [ $# -ge 2 ] || { echo "ERRO uso: --json exige um arquivo" >&2; exit 2; }; JSON="$2"; shift 2 ;;
    --max)
      [ $# -ge 2 ] || { echo "ERRO uso: --max exige um número" >&2; exit 2; }
      case "$2" in ''|*[!0-9]*) echo "ERRO uso: --max '$2' não é inteiro" >&2; exit 2 ;; esac
      MAX="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "ERRO uso: argumento desconhecido '$1'" >&2; exit 2 ;;
  esac
done
[ "${#RAIZES[@]}" -gt 0 ] || RAIZES=(".")
for _r in "${RAIZES[@]}"; do
  [ -e "$_r" ] || { echo "ERRO uso: --root inexistente: $_r" >&2; exit 2; }
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/scan-data.XXXXXX")" || { echo "ERRO sem diretório temporário" >&2; exit 2; }
trap 'rm -rf "$TMP"' EXIT
TAB="$(printf '\t')"
MOTOR="grep"
command -v rg >/dev/null 2>&1 && MOTOR="rg"
: > "$TMP/json-regras"

# universo: find sobre cada raiz, com o mesmo filtro de diretório para os dois motores.
for _r in "${RAIZES[@]}"; do
  if [ -f "$_r" ]; then
    printf '%s\n' "$_r"
  else
    find "$_r" -mindepth 1 \( -type d \( -name node_modules -o -name dist -o -name build -o -name .git -o -name vendor \
      -o -name target -o -name .venv -o -name coverage -o -name generated -o -path '*/.forge/worktrees' \
      -o -path '*/.claude' -o -path '*/.agents' -o -path '*/.forge/agents' -o -path '*/.forge/adapters' \
      -o -path '*/.forge/capabilities' -o -path '*/.forge/commands' -o -path '*/.forge/contracts' \
      -o -path '*/.forge/evals' -o -path '*/.forge/graph' -o -path '*/.forge/hooks' -o -path '*/.forge/ledger' \
      -o -path '*/.forge/liaison' -o -path '*/.forge/rules' -o -path '*/.forge/schemas' -o -path '*/.forge/scripts' \
      -o -path '*/.forge/skills' -o -path '*/.forge/templates' \) -prune \) -o -type f -print
  fi
done > "$TMP/brutos"
sed -e 's#^\./##' -e 's#//*#/#g' "$TMP/brutos" | LC_ALL=C sort -u > "$TMP/todos"

_classe() { # _classe <nome> — grava a lista de arquivos da classe (uma vez) e a devolve em CLASSE, sem subshell
  local n="$1" re
  CLASSE="$TMP/classe-$n"
  [ -f "$CLASSE" ] && return 0
  case "$n" in
    sql) re='\.sql$' ;;
    cql) re='\.cql$' ;;
    cypher) re='\.cypher$' ;;
    codigo) re='\.(ts|tsx|js|jsx|mjs|cjs|py|rb|java|kt|go|cs)$' ;;
    iac) re='(\.(tf|yaml|yml|json|conf|properties|toml|hcl)$|(^|/)(Dockerfile[^/]*|enabled_plugins)$)' ;;
    yml) re='\.(yml|yaml)$' ;;
    proto) re='\.proto$' ;;
    avsc) re='\.avsc$' ;;
    jsonschema) re='\.schema\.json$' ;;
    *) echo "ERRO interno: classe desconhecida '$n'" >&2; exit 2 ;;
  esac
  grep -aE "$re" "$TMP/todos" > "$CLASSE" || true
}

_lista() { # _lista <classe>... — união das classes, separada por NUL, calculada uma vez por conjunto; devolve em LISTA
  local c chave="$*"
  LISTA="$TMP/lista-${chave// /_}"
  [ -f "$LISTA" ] && return 0
  for c in "$@"; do _classe "$c"; cat "$CLASSE"; done | LC_ALL=C sort -u | tr '\n' '\0' > "$LISTA"
}

# O processo mais caro do scanner é o fork: por isso a lista de arquivos é calculada uma vez por conjunto de classes,
# já separada por NUL, e cada regra custa um motor mais um awk de filtro, não uma dúzia de processos.
_buscar() { # _buscar <lista-NUL> <padrão> <ci> <linhas|arquivos> — motor sobre a lista explícita de arquivos
  local lista="$1" pad="$2" ci="$3" modo="$4"
  [ -s "$lista" ] || return 0
  if [ "$MOTOR" = "rg" ]; then
    if [ "$modo" = "arquivos" ]; then
      if [ "$ci" = 1 ]; then xargs -0 rg --hidden --no-ignore --text --no-unicode --no-config --no-messages --files-with-matches --ignore-case -e "$pad" -- < "$lista" 2>/dev/null
      else xargs -0 rg --hidden --no-ignore --text --no-unicode --no-config --no-messages --files-with-matches -e "$pad" -- < "$lista" 2>/dev/null; fi
    else
      if [ "$ci" = 1 ]; then xargs -0 rg --hidden --no-ignore --text --no-unicode --no-config --no-messages --no-heading --with-filename --line-number --ignore-case -e "$pad" -- < "$lista" 2>/dev/null
      else xargs -0 rg --hidden --no-ignore --text --no-unicode --no-config --no-messages --no-heading --with-filename --line-number -e "$pad" -- < "$lista" 2>/dev/null; fi
    fi
  else
    if [ "$modo" = "arquivos" ]; then
      if [ "$ci" = 1 ]; then LC_ALL=C xargs -0 grep -alEi -e "$pad" -- < "$lista" 2>/dev/null
      else LC_ALL=C xargs -0 grep -alE -e "$pad" -- < "$lista" 2>/dev/null; fi
    else
      if [ "$ci" = 1 ]; then LC_ALL=C xargs -0 grep -aHnEi -e "$pad" -- < "$lista" 2>/dev/null
      else LC_ALL=C xargs -0 grep -aHnE -e "$pad" -- < "$lista" 2>/dev/null; fi
    fi
  fi
  return 0
}

# linhas [-i] [-x re] [-X re] [-e re] [-E re] [-p re] [-q re] <classes> <padrão>
#   Ocorrências "arquivo<TAB>linha<TAB>trecho". -i: padrão sem caixa. Filtros sobre o trecho: -x exclui (com caixa),
#   -X exclui (sem caixa; re em minúsculas), -e exige (com caixa), -E exige (sem caixa; re em minúsculas). Filtros
#   sobre o caminho: -p exige, -q exclui. Lookahead não existe em ERE: o que a regra nega sai por filtro.
linhas() {
  local ci=0 fx="" fX="" fe="" fE="" fp="" fq="" classes pad
  while [ $# -gt 2 ]; do
    case "$1" in
      -i) ci=1; shift ;;
      -x) fx="$2"; shift 2 ;; -X) fX="$2"; shift 2 ;;
      -e) fe="$2"; shift 2 ;; -E) fE="$2"; shift 2 ;;
      -p) fp="$2"; shift 2 ;; -q) fq="$2"; shift 2 ;;
      *) break ;;
    esac
  done
  classes="$1"; pad="$2"
  # shellcheck disable=SC2086
  _lista $classes
  _buscar "$LISTA" "$pad" "$ci" linhas \
    | LC_ALL=C tr -d '\000-\010\013\014\016-\037' \
    | F_x="$fx" F_X="$fX" F_e="$fe" F_E="$fE" F_p="$fp" F_q="$fq" LC_ALL=C awk '
        BEGIN { x = ENVIRON["F_x"]; X = ENVIRON["F_X"]; e = ENVIRON["F_e"]; E = ENVIRON["F_E"]; p = ENVIRON["F_p"]; q = ENVIRON["F_q"] }
        {
          i = index($0, ":"); if (i == 0) next
          arq = substr($0, 1, i - 1); resto = substr($0, i + 1)
          j = index(resto, ":"); if (j == 0) next
          lin = substr(resto, 1, j - 1); t = substr(resto, j + 1)
          if (lin !~ /^[0-9]+$/) next
          tl = tolower(t)
          if (x != "" && t ~ x) next
          if (X != "" && tl ~ X) next
          if (e != "" && t !~ e) next
          if (E != "" && tl !~ E) next
          if (p != "" && arq !~ p) next
          if (q != "" && arq ~ q) next
          gsub(/[\t\r]/, " ", t); sub(/^ +/, "", t); sub(/ +$/, "", t)
          if (length(t) > 160) t = substr(t, 1, 160) "..."
          printf "%s\t%s\t%s\n", arq, lin, t
        }'
}

arquivos_com() { # arquivos_com [-i] <classes> <padrão> — arquivos (ordenados) que contêm o padrão
  local ci=0
  [ "$1" = "-i" ] && { ci=1; shift; }
  # shellcheck disable=SC2086
  _lista $1
  _buscar "$LISTA" "$2" "$ci" arquivos | LC_ALL=C sort -u
}

# A lista é lida no BEGIN, não pelo idioma NR == FNR: com a lista vazia esse idioma trataria a entrada inteira como
# lista e não emitiria nada — exatamente o caso "nenhum arquivo tem a proteção", o que mais importa reportar.
so_arquivos() { # so_arquivos <lista> — mantém ocorrências cujo arquivo está na lista
  L="$1" LC_ALL=C awk -F'\t' 'BEGIN { while ((getline l < ENVIRON["L"]) > 0) ok[l] = 1 } ($1 in ok)'
}
exceto_arquivos() { # exceto_arquivos <lista> — mantém ocorrências cujo arquivo NÃO está na lista
  L="$1" LC_ALL=C awk -F'\t' 'BEGIN { while ((getline l < ENVIRON["L"]) > 0) ok[l] = 1 } !($1 in ok)'
}
tmpf() { mktemp "$TMP/aux.XXXXXX"; }

regra() { # regra <ID> <alto|aviso> <por quê> <função-detectora> — uma linha por regra, mais o registro JSON
  "$4" | LC_ALL=C sort -t "$TAB" -k1,1 -k2,2n -u | LC_ALL=C awk -F'\t' -v id="$1" -v sev="$2" -v pq="$3" -v max="$MAX" \
      -v js="$TMP/json-regras" -v alto="$TMP/alto" '
    function esc(s,   o, k, c) { o = ""; for (k = 1; k <= length(s); k++) { c = substr(s, k, 1)
        if (c == "\\") o = o "\\\\"; else if (c == "\"") o = o "\\\""; else o = o c }
      return o }
    { n++; if (n <= max + 0) { loc[n] = "  " $1 ":" $2 ": " $3
        jl = jl (n > 1 ? "," : "") "{\"arquivo\":\"" esc($1) "\",\"linha\":" ($2 + 0) ",\"trecho\":\"" esc($3) "\"}" } }
    END {
      if (n == 0) { print "OK " id " [" sev "] nenhuma ocorrência"; st = "OK" }
      else {
        print "FOUND " id " [" sev "] " n " ocorrência(s) — " pq
        for (i = 1; i <= n && i <= max + 0; i++) print loc[i]
        if (n > max + 0) print "  (+" (n - max) " além de --max)"
        st = "FOUND"; if (sev == "alto") print "1" > alto
      }
      printf "{\"id\":\"%s\",\"severidade\":\"%s\",\"status\":\"%s\",\"ocorrencias\":%d,\"localizacoes\":[%s]}\n", id, sev, st, n + 0, jl >> js
    }'
  return 0
}

_escrever_json() { # _escrever_json <n-arquivos>
  [ -n "$JSON" ] || return 0
  { printf '{"skill":"%s","arquivos_varridos":%s,"regras":[' "$SKILL" "$1"
    awk 'NR > 1 { printf "," } { printf "%s", $0 }' "$TMP/json-regras"
    printf ']}\n'; } > "$JSON" || { echo "ERRO não foi possível gravar --json $JSON" >&2; exit 2; }
}

inicio() { # inicio — contador de controle: sem arquivo do universo da skill, nada é OK
  # shellcheck disable=SC2086
  _lista $UNIVERSO
  N_ARQ="$(tr -cd '\000' < "$LISTA" | wc -c | tr -d ' ')"
  echo "INFO $SKILL motor=$MOTOR raizes=${#RAIZES[@]} universo=$UNIVERSO" >&2
  if [ "$N_ARQ" -eq 0 ]; then
    echo "NADA-EXAMINADO — nenhum arquivo do universo da skill ($UNIVERSO) sob as raízes; isto não é aprovação"
    echo "ARQUIVOS-VARRIDOS 0"
    _escrever_json 0
    exit 3
  fi
}

fim() {
  echo "ARQUIVOS-VARRIDOS $N_ARQ"
  _escrever_json "$N_ARQ"
  [ -f "$TMP/alto" ] && exit 1
  exit 0
}
# <<< motor

inicio

# >>> R-03
# Arquivo de migração MySQL (marcas do dialeto) sai do trecho de índice: no MySQL 8.x o índice secundário é INPLACE e
# online, e quem cobre o MySQL é a R-13 (COPY/LOCK forçado) e a R-22 (ALGORITHM/LOCK não explícitos).
MYSQL_MARCAS='engine[[:space:]]*=|auto_increment|algorithm[[:space:]]*=|`[a-z_][a-z0-9_]*`[[:space:]]*\('
r_R_03() {
  local my criadas vc; my="$(tmpf)"; criadas="$(tmpf)"; vc="$(tmpf)"
  arquivos_com -i sql "$MYSQL_MARCAS" > "$my"
  arquivos_com -i sql 'validate[[:space:]]+constraint' > "$vc"
  # tabelas criadas no próprio arquivo: índice sobre tabela nova não trava ninguém (ela ainda não tem tráfego).
  linhas -i sql 'create[[:space:]]+table[[:space:]]' \
    | LC_ALL=C awk -F'\t' '{ t = tolower($3); sub(/.*create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?/, "", t)
        gsub(/"/, "", t); sub(/[[:space:](].*/, "", t); sub(/.*\./, "", t); if (t != "") print $1 "\t" t }' > "$criadas"
  linhas -i -X 'concurrently' sql 'create[[:space:]]+(unique[[:space:]]+)?index[[:space:]]' | exceto_arquivos "$my" \
    | C="$criadas" LC_ALL=C awk -F'\t' 'BEGIN { while ((getline l < ENVIRON["C"]) > 0) { split(l, a, "\t"); nova[a[1] "\t" a[2]] = 1 } }
        { t = tolower($3); if (match(t, /[[:space:]]on[[:space:]]+(only[[:space:]]+)?[^[:space:](]+/)) {
            u = substr(t, RSTART, RLENGTH); sub(/^[[:space:]]on[[:space:]]+(only[[:space:]]+)?/, "", u); gsub(/"/, "", u); sub(/.*\./, "", u)
            if (($1 "\t" u) in nova) next }
          print }'
  linhas -i sql 'alter[[:space:]]+column[[:space:]]+[^[:space:]]+[[:space:]]+(set[[:space:]]+data[[:space:]]+)?type[[:space:]]|rename[[:space:]]+(column|to)[[:space:]]'
  # SET NOT NULL precedido do padrão seguro (CHECK ... NOT VALID e VALIDATE CONSTRAINT no mesmo arquivo) não varre a
  # tabela sob ACCESS EXCLUSIVE: o PostgreSQL 12+ usa a constraint validada como prova.
  linhas -i sql 'set[[:space:]]+not[[:space:]]+null' | exceto_arquivos "$vc"
}
regra R-03 alto "migração bloqueante: índice sem CONCURRENTLY em tabela existente, troca de tipo, rename in-place ou SET NOT NULL sem VALIDATE CONSTRAINT antes travam a tabela com a aplicação no ar" r_R_03
# <<< R-03

# >>> R-04
r_R_04() {
  # Exclusões além de "timestamp with time zone": coluna CHAMADA "timestamp" tipada TIMESTAMPTZ
  # ("timestamp TIMESTAMPTZ NOT NULL") casava o nome, não o tipo; e referência de coluna dentro de
  # CREATE INDEX ("... ON tbl (timestamp DESC)") casava o identificador, não uma declaração de tipo
  # sem fuso — nenhum dos dois é o antipattern que a regra persegue.
  linhas -i -X 'timestamp[[:space:]]+with[[:space:]]+time[[:space:]]+zone|timestamp[[:space:]]+timestamptz|create[[:space:]]+(unique[[:space:]]+)?index[^;]*\(.*timestamp' sql '(^|[^a-z0-9_])(timestamp|char[[:space:]]*\([0-9]+\)|character[[:space:]]*\([0-9]+\)|money|json|serial|bigserial|smallserial)([^a-z0-9_]|$)'
}
regra R-04 aviso "tipo problemático no PostgreSQL: timestamp sem fuso, char(n), money, json ou serial (use timestamptz, text/varchar, BIGINT em centavos, jsonb, identity)" r_R_04
# <<< R-04

# >>> R-06
r_R_06() {
  linhas -i 'codigo sql' 'offset[[:space:]]+(\$|:|\?|[0-9][0-9][0-9])|\.offset\(|\.skip\('
}
regra R-06 aviso "paginação por OFFSET profundo computa e descarta linhas e duplica ou omite com inserção concorrente; prefira keyset" r_R_06
# <<< R-06

# >>> R-10
r_R_10() {
  linhas -i 'codigo sql' 'with[[:space:]]*\([[:space:]]*nolock[[:space:]]*\)|read[[:space:]]+uncommitted'
}
regra R-10 alto "NOLOCK/READ UNCOMMITTED lê dado não confirmado, linha duplicada ou ausente" r_R_10
# <<< R-10

# >>> R-12
r_R_12() {
  linhas codigo '[Ss][Ee][Tt][[:space:]]+search_path|(^|[^A-Za-z0-9_])LISTEN[[:space:]]+[A-Za-z_"]|pg_advisory_lock\('
  # GUC custom de sessão (app.tenant_id) sem LOCAL, e set_config(..., false), que vale para a sessão inteira: com pool
  # que reaproveita a conexão, o tenant de uma requisição vaza para a próxima e a policy de RLS lê o valor errado.
  linhas codigo '(^|[^A-Za-z0-9_])[Ss][Ee][Tt][[:space:]]+([Ss][Ee][Ss][Ss][Ii][Oo][Nn][[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*[[:space:]]*(=|[Tt][Oo][[:space:]])'
  linhas -i codigo 'set_config\([^)]*,[[:space:]]*false[[:space:]]*\)'
}
regra R-12 aviso "estado de sessão com pool: SET de GUC sem LOCAL, set_config(..., false), search_path, LISTEN e advisory lock de sessão vazam entre requisições (tenant da RLS inclusive) ou quebram atrás de PgBouncer em modo transaction" r_R_12
# <<< R-12

# >>> R-13
r_R_13() {
  linhas -i sql 'algorithm[[:space:]]*=[[:space:]]*copy|lock[[:space:]]*=[[:space:]]*(shared|exclusive)'
}
regra R-13 alto "ALGORITHM=COPY/LOCK forçado no MySQL reescreve a tabela e bloqueia escrita" r_R_13
# <<< R-13

# >>> R-14
r_R_14() {
  linhas -i codigo 'select[[:space:]]+\*'
}
regra R-14 aviso "SELECT * em código de aplicação acopla ao schema e traz colunas que ninguém lê" r_R_14
# <<< R-14

# >>> R-17
r_R_17() {
  linhas -i iac 'publicly_accessible[[:space:]]*[=:][[:space:]]*"?true'
}
regra R-17 aviso "banco gerenciado com endereço público: nenhum terceiro recebe rota de rede para banco interno (regra de integração)" r_R_17
# <<< R-17

# >>> R-18
r_R_18() {
  local porta; porta="$(tmpf)"
  arquivos_com iac '(from_port|to_port|port)"?[[:space:]]*[=:][[:space:]]*"?(5432|3306)([^0-9]|$)' > "$porta"
  linhas iac '0\.0\.0\.0/0' | so_arquivos "$porta"
}
regra R-18 aviso "regra de rede aberta a 0.0.0.0/0 no mesmo arquivo que a porta do banco (5432/3306): rota de terceiro para banco interno" r_R_18
# <<< R-18

# >>> R-19
r_R_19() {
  linhas -i sql '[a-z_]*(valor|amount|price|preco|total|saldo|balance|fee|tarifa)[a-z_]*"?[[:space:]]+(numeric|decimal|real|float[0-9]*|double[[:space:]]+precision)([^a-z0-9_]|$)'
}
regra R-19 aviso "coluna de nome monetário tipada NUMERIC, DECIMAL ou ponto flutuante (real, float, double precision): a regra da casa (money-as-cents.md) manda BIGINT NOT NULL na menor unidade, e flutuante nem é exato" r_R_19
# <<< R-19

# >>> R-20
r_R_20() {
  local ct rls force; ct="$(tmpf)"; rls="$(tmpf)"; force="$(tmpf)"
  arquivos_com -i sql 'create[[:space:]]+table' > "$ct"
  arquivos_com -i sql 'enable[[:space:]]+row[[:space:]]+level[[:space:]]+security' > "$rls"
  arquivos_com -i sql 'force[[:space:]]+row[[:space:]]+level[[:space:]]+security' > "$force"
  linhas -i sql '(^|[^a-z0-9_])tenant_id"?[[:space:]]+[a-z]' | so_arquivos "$ct" | exceto_arquivos "$rls"
  # ENABLE sem FORCE: o dono da tabela (a aplicação, quando conecta com o papel que roda a migração) ignora a policy.
  linhas -i sql 'enable[[:space:]]+row[[:space:]]+level[[:space:]]+security' | exceto_arquivos "$force"
  # papel com BYPASSRLS ignora toda policy (NOBYPASSRLS é o correto e não casa pela fronteira).
  linhas -i sql '(^|[^a-z0-9_])bypassrls([^a-z0-9_]|$)'
}
regra R-20 aviso "RLS incompleto: tabela multi-tenant (tenant_id) sem ENABLE ROW LEVEL SECURITY no arquivo, ENABLE sem FORCE ROW LEVEL SECURITY (o dono da tabela ignora a policy) ou papel com BYPASSRLS; RLS é obrigatório pela data-governance.md (pode estar noutra migração; confira)" r_R_20
# <<< R-20

# >>> R-21
r_R_21() {
  local lt; lt="$(tmpf)"
  arquivos_com -i sql 'lock_timeout' > "$lt"
  linhas -i sql 'alter[[:space:]]+table|create[[:space:]]+(unique[[:space:]]+)?index' | exceto_arquivos "$lt"
}
regra R-21 aviso "migração com ALTER TABLE ou CREATE INDEX sem lock_timeout na sessão: um lock em espera enfileira todo o tráfego atrás dele" r_R_21
# <<< R-21

# >>> R-22
r_R_22() {
  local my; my="$(tmpf)"
  arquivos_com -i sql "$MYSQL_MARCAS" > "$my"
  linhas -i -X 'algorithm[[:space:]]*=|concurrently' sql 'create[[:space:]]+(unique[[:space:]]+)?index[[:space:]]|add[[:space:]]+(unique[[:space:]]+)?(index|key)[[:space:]]' | so_arquivos "$my"
}
regra R-22 aviso "índice em migração MySQL sem ALGORITHM=INPLACE, LOCK=NONE explícitos: com eles o MySQL recusa a DDL em vez de cair em cópia bloqueante em silêncio" r_R_22
# <<< R-22

fim
