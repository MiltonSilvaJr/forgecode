#!/usr/bin/env bash
# scan.sh — data-nosql-practices: detecção estática NoSQL (MongoDB, DynamoDB, Cosmos DB, Cassandra, Neo4j): arrays sem teto, chave de partição, write concern, Scan, GSI, ALLOW FILTERING, exposição.
#
# Uso: bash .forge/skills/data-nosql-practices/scripts/scan.sh [--root <caminho>]... [--json <arquivo>] [--max <n>]
# Cada regra abaixo corresponde a uma entrada de references/antipatterns.md cuja Detecção é `scan.sh <ID>`; o w250
# confere a bijeção. Toda regra emite uma linha, inclusive as que não acharam nada: OK quer dizer verificado e
# limpo. Todo achado sai com arquivo:linha. Achado é candidato, não veredito: quem revisa lê o trecho e decide.
# Severidade alto só com detector preciso e prática inequívoca na base; detector [Heurística] ou [Interp.] é aviso.
# O scanner lê texto: não conecta em banco, broker, cache nem nuvem (detecção de runtime fica documentada no
# catálogo e é executada por quem tem acesso, nunca por este script).
# Exit: 0 sem achado alto; 1 com achado alto; 2 erro de uso; 3 nada examinado (NADA-EXAMINADO).

SKILL="data-nosql-practices"
UNIVERSO="codigo iac cql cypher"

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

# >>> N-01
r_N_01() {
  linhas -x '\$slice' codigo '\$push'
}
regra N-01 aviso "\$push sem \$slice na mesma linha: array sem teto cresce até o limite de 16 MiB do documento" r_N_01
# <<< N-01

# >>> N-04
r_N_04() {
  linhas codigo '\$lookup'
}
regra N-04 aviso "\$lookup no caminho quente é join em document store; modele pelo que é lido junto" r_N_04
# <<< N-04

# >>> N-06
r_N_06() {
  linhas -i iac '(hash_key|partition_key_paths?|partitionkeypath|partition_key_path)"?[[:space:]]*[=:][[:space:]]*.*"/?(status|type|date|country|state|category)"'
}
regra N-06 aviso "chave de partição de baixa cardinalidade (status, tipo, data, país, categoria) concentra carga em poucas partições" r_N_06
# <<< N-06

# >>> N-07
# Contexto de MongoDB no arquivo: `w: 1` sozinho casa largura de caixa, coordenada e afins (`{ w: 1, h: 2 }`).
MONGO_MARCAS='mongo|writeconcern|write_concern|readconcern|read_concern|startsession|start_session|withtransaction|with_transaction'
r_N_07() {
  local mg; mg="$(tmpf)"
  arquivos_com -i codigo "$MONGO_MARCAS" > "$mg"
  linhas codigo '(^|[^A-Za-z0-9_])w[[:space:]]*[:=][[:space:]]*['"'"'"]?1([^0-9]|$)|WriteConcern\.(W1|ACKNOWLEDGED)' | so_arquivos "$mg"
}
regra N-07 alto "write concern w:1 em dado crítico perde escrita confirmada no failover; use majority e P-S-S" r_N_07
# <<< N-07

# >>> N-08
r_N_08() {
  # só a API do DynamoDB: `redis.scan(` (SCAN incremental, o que a skill de cache recomenda) e `rows.Scan(` do Go não casam.
  linhas codigo 'ScanCommand|ScanInput|ScanRequest|(^|[^A-Za-z0-9_])[Ss]can\([[:space:]]*\{?[[:space:]]*"?TableName|(^|[^A-Za-z0-9_])(table|tabela|[a-z_]*_table)\.scan\('
}
regra N-08 aviso "Scan do DynamoDB no caminho da requisição lê a tabela inteira e consome capacidade de todas as partições; use Query" r_N_08
# <<< N-08

# >>> N-09
r_N_09() {
  linhas codigo 'list_append'
}
regra N-09 aviso "list_append faz o item crescer sem teto até o limite de 400 KB do DynamoDB" r_N_09
# <<< N-09

# >>> N-10
r_N_10() {
  linhas iac 'projection_type"?[[:space:]]*[=:][[:space:]]*"ALL"'
}
regra N-10 aviso "GSI com projeção ALL duplica o item inteiro e cobra escrita de tudo; projete KEYS_ONLY ou INCLUDE" r_N_10
# <<< N-10

# >>> N-11
r_N_11() {
  linhas -e 'IndexName' codigo 'ConsistentRead[[:space:]]*:[[:space:]]*true'
}
regra N-11 alto "ConsistentRead em leitura de GSI: índice global só oferece leitura eventual" r_N_11
# <<< N-11

# >>> N-13
r_N_13() {
  linhas -i 'cql codigo' 'allow[[:space:]]+filtering'
  # SAI (StorageAttachedIndex) é o índice secundário que a skill admite, restrito a consulta que já filtra a partição.
  linhas -i -X 'storageattachedindex|using[[:space:]]+.sai.' cql 'create[[:space:]]+(custom[[:space:]]+)?index'
}
regra N-13 alto "ALLOW FILTERING ou índice secundário legado (2i/SASI) como consulta principal no Cassandra varre partições; uma tabela por consulta" r_N_13
# <<< N-13

# >>> N-15
r_N_15() {
  linhas -i 'cql codigo' 'begin[[:space:]]+(unlogged[[:space:]]+)?batch'
}
regra N-15 aviso "BATCH multi-partição como otimização sobrecarrega o coordenador (limites batch_size_warn/fail)" r_N_15
# <<< N-15

# >>> N-17
r_N_17() {
  linhas 'cypher codigo' '-\[[A-Za-z_]*:(RELATED_TO|HAS|LINK|CONNECTED)\]'
}
regra N-17 aviso "relacionamento genérico no grafo (RELATED_TO, HAS, LINK, CONNECTED) esconde o significado; use tipo específico" r_N_17
# <<< N-17

# >>> N-18
r_N_18() {
  linhas iac 'bindIp[[:space:]]*:[[:space:]]*"?0\.0\.0\.0|bind_ip[[:space:]]*=[[:space:]]*0\.0\.0\.0|bindIpAll[[:space:]]*:[[:space:]]*true|--bind_ip_all'
}
regra N-18 aviso "MongoDB escutando em todas as interfaces: nenhum terceiro recebe rota de rede para banco interno (regra de integração)" r_N_18
# <<< N-18

# >>> N-19
r_N_19() {
  local porta; porta="$(tmpf)"
  arquivos_com iac '(from_port|to_port|port)"?[[:space:]]*[=:][[:space:]]*"?27017([^0-9]|$)' > "$porta"
  linhas iac '0\.0\.0\.0/0' | so_arquivos "$porta"
}
regra N-19 aviso "regra de rede aberta a 0.0.0.0/0 no mesmo arquivo que a porta 27017: rota de terceiro para banco interno" r_N_19
# <<< N-19

# >>> N-20
r_N_20() {
  linhas -i codigo 'readconcern\.(local|available)|readconcern[[:space:]]*\([[:space:]]*["'"'"'](local|available)|read_concern[[:space:]]*=[[:space:]]*readconcern\([[:space:]]*["'"'"']?(local|available)|readconcern[[:space:]]*:[[:space:]]*\{[[:space:]]*level[[:space:]]*:[[:space:]]*["'"'"'](local|available)|readconcernlevel\.(local|available)'
}
regra N-20 aviso "read concern local/available em transação ou leitura do transacional de negócio: lê dado que o failover pode desfazer; use snapshot (ou majority) com w majority" r_N_20
# <<< N-20

# >>> N-21
r_N_21() {
  linhas codigo 'Decimal128|NumberDecimal\(|\$numberDecimal|Decimal128Codec|BsonDecimal128'
}
regra N-21 aviso "Decimal128 em documento: valor monetário é inteiro na menor unidade (money-as-cents.md), nunca Decimal128 nem ponto flutuante" r_N_21
# <<< N-21

# >>> N-23
r_N_23() {
  local ok; ok="$(tmpf)"
  arquivos_com codigo 'UnknownTransactionCommitResult|withTransaction|with_transaction|WithTransaction' > "$ok"
  linhas codigo 'commitTransaction(Async)?\(|commit_transaction\(|CommitTransaction(Async)?\(' | exceto_arquivos "$ok"
}
regra N-23 aviso "commit de transação MongoDB pela API core sem tratar UnknownTransactionCommitResult: o commit precisa de retry próprio, separado do retry da transação inteira; prefira withTransaction" r_N_23
# <<< N-23

fim
