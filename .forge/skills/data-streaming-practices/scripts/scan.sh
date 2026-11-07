#!/usr/bin/env bash
# scan.sh — data-streaming-practices: detecção estática mensageria (RabbitMQ 4.x, Kafka, padrões de integração): ack, confirms, requeue, filas espelhadas, delayed exchange, durabilidade, inbox, gRPC exposto, PAN em evento.
#
# Uso: bash .forge/skills/data-streaming-practices/scripts/scan.sh [--root <caminho>]... [--json <arquivo>] [--max <n>]
# Cada regra abaixo corresponde a uma entrada de references/antipatterns.md cuja Detecção é `scan.sh <ID>`; o w250
# confere a bijeção. Toda regra emite uma linha, inclusive as que não acharam nada: OK quer dizer verificado e
# limpo. Todo achado sai com arquivo:linha. Achado é candidato, não veredito: quem revisa lê o trecho e decide.
# Severidade alto só com detector preciso e prática inequívoca na base; detector [Heurística] ou [Interp.] é aviso.
# O scanner lê texto: não conecta em banco, broker, cache nem nuvem (detecção de runtime fica documentada no
# catálogo e é executada por quem tem acesso, nunca por este script).
# Exit: 0 sem achado alto; 1 com achado alto; 2 erro de uso; 3 nada examinado (NADA-EXAMINADO).

SKILL="data-streaming-practices"
UNIVERSO="codigo iac proto avsc"

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

# Padrão de publicação reaproveitado por RMQ-AP-08 e RMQ-AP-12 (Java, pika, amqplib, Go, .NET).
PUBLICA='basicPublish\(|basic_publish\(|\.publish\(|PublishWithContext\(|BasicPublish(Async)?\('

# >>> RMQ-AP-01
r_RMQ_AP_01() {
  # Go (amqp091): Consume(fila, consumidor, autoAck, ...) — o terceiro argumento posicional é o auto-ack.
  linhas 'codigo iac' '[Bb]asicConsume(Async)?\([^,]+,[[:space:]]*(autoAck:[[:space:]]*)?true|auto_ack[[:space:]]*=[[:space:]]*True|noAck[[:space:]]*:[[:space:]]*true|autoAck[[:space:]]*:[[:space:]]*true|AcknowledgeMode\.NONE|acknowledge-mode[[:space:]]*:[[:space:]]*none|\.Consume\([^,()]+,[^,()]*,[[:space:]]*true[[:space:]]*,'
}
regra RMQ-AP-01 alto "auto-ack: a mensagem é dada como entregue antes do efeito persistir e se perde na queda do consumidor" r_RMQ_AP_01
# <<< RMQ-AP-01

# >>> RMQ-AP-03
r_RMQ_AP_03() {
  linhas codigo 'newConnection\(|BlockingConnection\(|amqp\.connect\(|amqp\.Dial\(|CreateConnection(Async)?\('
}
regra RMQ-AP-03 aviso "criação de conexão AMQP: fora da inicialização, conexão por mensagem esgota o broker; confira que é conexão longa e única por processo" r_RMQ_AP_03
# <<< RMQ-AP-03

# >>> RMQ-AP-04
r_RMQ_AP_04() {
  linhas codigo 'basicGet\(|basic_get\(|(^|[^A-Za-z0-9_])(ch|channel|canal)\.(get|Get)\(|BasicGet(Async)?\('
}
regra RMQ-AP-04 aviso "polling com basic.get: uma ida ao broker por mensagem; use basic.consume com prefetch" r_RMQ_AP_04
# <<< RMQ-AP-04

# >>> RMQ-AP-06
r_RMQ_AP_06() {
  linhas 'codigo iac' '(^|[^A-Za-z0-9_-])ha-(mode|params|sync-mode)'
}
regra RMQ-AP-06 alto "filas espelhadas clássicas foram removidas no RabbitMQ 4.0; HA de fila é quorum queue" r_RMQ_AP_06
# <<< RMQ-AP-06

# >>> RMQ-AP-07
r_RMQ_AP_07() {
  linhas 'codigo iac' 'x-queue-mode|(^|[^A-Za-z0-9_-])queue-mode'
}
regra RMQ-AP-07 aviso "queue-mode lazy não tem efeito desde o 3.12" r_RMQ_AP_07
# <<< RMQ-AP-07

# >>> RMQ-AP-08
r_RMQ_AP_08() {
  local conf; conf="$(tmpf)"
  arquivos_com codigo 'confirmSelect|confirm_delivery|createConfirmChannel|\.Confirm\(|ConfirmSelect|publisher-confirm-type' > "$conf"
  linhas codigo "$PUBLICA" | exceto_arquivos "$conf"
}
regra RMQ-AP-08 aviso "arquivo que publica sem publisher confirms: o broker pode perder a mensagem sem o produtor saber (Spring configura confirms em arquivo separado: confira)" r_RMQ_AP_08
# <<< RMQ-AP-08

# >>> RMQ-AP-09
r_RMQ_AP_09() {
  linhas codigo 'waitForConfirms'
}
regra RMQ-AP-09 aviso "confirm síncrono por mensagem limita a centenas de mensagens por segundo; use confirms assíncronos ou em lote" r_RMQ_AP_09
# <<< RMQ-AP-09

# >>> RMQ-AP-10
r_RMQ_AP_10() {
  # Java/.NET basicNack(tag, múltiplo, requeue=true) e basicReject(tag, true); Go Nack(múltiplo, true) e Reject(true);
  # amqplib nack(msg), nack(msg, allUpTo) — o segundo argumento é allUpTo, não requeue, e o requeue fica true —,
  # nack(msg, x, true) e reject(msg) ou reject(msg, true) sobre o canal; Spring default-requeue-rejected: true.
  linhas 'codigo iac' '[Bb]asicNack(Async)?\([^,]+,[[:space:]]*(true|false),[[:space:]]*true[[:space:]]*\)|[Bb]asicReject(Async)?\([^,]+,[[:space:]]*true[[:space:]]*\)|\.nack\([[:space:]]*[A-Za-z_][A-Za-z0-9_.]*[[:space:]]*\)|\.nack\([^,)]+,[[:space:]]*(true|false)[[:space:]]*\)|\.nack\([^,)]+,[^,)]+,[[:space:]]*true[[:space:]]*\)|\.Nack\([[:space:]]*(true|false)[[:space:]]*,[[:space:]]*true[[:space:]]*\)|\.Reject\([[:space:]]*true[[:space:]]*\)|(^|[^A-Za-z0-9_])(ch|chan|channel|canal)\.reject\([[:space:]]*[A-Za-z_][A-Za-z0-9_.]*[[:space:]]*(,[[:space:]]*true[[:space:]]*)?\)|default-requeue-rejected[[:space:]]*[:=][[:space:]]*true'
  # pika: requeue=True por padrão em basic_nack(tag, multiple, requeue) e basic_reject(tag, requeue).
  linhas -X 'requeue[[:space:]]*=[[:space:]]*false|basic_nack\([^,)]*,[^,)]*,[[:space:]]*false' codigo 'basic_nack\('
  linhas -X 'requeue[[:space:]]*=[[:space:]]*false|basic_reject\([^,)]*,[[:space:]]*false' codigo 'basic_reject\('
}
regra RMQ-AP-10 alto "requeue infinito: nack ou reject com requeue (default true no amqplib, no pika e no Spring) volta a mensagem à fila, e basic.nack não conta para o delivery-limit da quorum" r_RMQ_AP_10
# <<< RMQ-AP-10

# >>> RMQ-AP-12
r_RMQ_AP_12() {
  local pers; pers="$(tmpf)"
  arquivos_com codigo 'delivery_mode[[:space:]]*=[[:space:]]*2|PERSISTENT_|persistent[[:space:]]*:[[:space:]]*true|amqp\.Persistent|DeliveryMode[[:space:]]*=[[:space:]]*(2|DeliveryModes\.Persistent)|setDeliveryMode|MessageDeliveryMode\.PERSISTENT|Persistent[[:space:]]*=[[:space:]]*true' > "$pers"
  linhas codigo "$PUBLICA" | exceto_arquivos "$pers"
}
regra RMQ-AP-12 aviso "arquivo que publica sem marcar a mensagem persistente: fila durável descarta mensagem transiente na recuperação" r_RMQ_AP_12
# <<< RMQ-AP-12

# >>> RMQ-AP-14
r_RMQ_AP_14() {
  linhas codigo 'x-dead-letter-exchange|x-message-ttl|x-max-length|x-delivery-limit|x-overflow'
}
regra RMQ-AP-14 aviso "x-arguments fixos no código não mudam sem redeclarar a fila; configure por policy (exceto x-queue-type)" r_RMQ_AP_14
# <<< RMQ-AP-14

# >>> RMQ-AP-15
r_RMQ_AP_15() {
  linhas codigo 'queueDeclare\([^,]+,[[:space:]]*false,[[:space:]]*false|durable[[:space:]]*[:=][[:space:]]*(false|False)'
}
regra RMQ-AP-15 aviso "fila transiente não exclusiva: depreciada e negada por padrão a partir do 4.3" r_RMQ_AP_15
# <<< RMQ-AP-15

# >>> RMQ-AP-17
r_RMQ_AP_17() {
  linhas 'codigo iac' 'x-delayed-message|x-delayed-type|rabbitmq_delayed_message_exchange'
}
regra RMQ-AP-17 alto "plugin rabbitmq-delayed-message-exchange depreciado e arquivado; use o retry atrasado nativo da quorum (4.3) ou filas de espera" r_RMQ_AP_17
# <<< RMQ-AP-17

# >>> RMQ-AP-18
r_RMQ_AP_18() {
  linhas codigo '[Bb]asicQos\([^)]*,[[:space:]]*true[[:space:]]*\)|basic_qos\([^)]*global_qos[[:space:]]*=[[:space:]]*True|\.prefetch\([^,)]+,[[:space:]]*true'
}
regra RMQ-AP-18 alto "QoS global é depreciado e streams não o suportam; prefetch é por consumidor" r_RMQ_AP_18
# <<< RMQ-AP-18

# >>> RMQ-AP-19
r_RMQ_AP_19() {
  linhas iac 'cluster_partition_handling[[:space:]]*=[[:space:]]*(pause_minority|autoheal|pause_if_all_down)'
}
regra RMQ-AP-19 aviso "estratégia de partition handling removida junto com o Mnesia no 4.3: confirme a migração para Khepri antes do upgrade" r_RMQ_AP_19
# <<< RMQ-AP-19

# >>> RMQ-AP-20
r_RMQ_AP_20() {
  linhas iac 'loopback_users\.guest[[:space:]]*=[[:space:]]*false|loopback_users[[:space:]]*=[[:space:]]*none|default_user[[:space:]]*=[[:space:]]*guest|RABBITMQ_DEFAULT_USER"?[[:space:]]*[:=][[:space:]]*"?guest'
}
regra RMQ-AP-20 aviso "usuário guest liberado fora do loopback: remova o guest e use usuário por aplicação (T-05; regra de integração)" r_RMQ_AP_20
# <<< RMQ-AP-20

# >>> RMQ-AP-22
r_RMQ_AP_22() {
  local ret; ret="$(tmpf)"
  arquivos_com 'codigo iac' 'x-max-age|x-max-length-bytes|max-age|max-length-bytes|MaxAge|MaxLengthBytes' > "$ret"
  linhas 'codigo iac' 'x-queue-type"?'"'"'?[^A-Za-z0-9]{1,6}stream([^A-Za-z0-9_]|$)|queue-type"?[[:space:]]*[:=][[:space:]]*"?stream([^A-Za-z0-9_]|$)' | exceto_arquivos "$ret"
}
regra RMQ-AP-22 aviso "stream declarado sem retenção (x-max-age ou x-max-length-bytes) no arquivo: o log cresce sem limite de disco e retém dado pessoal indefinidamente (LGPD); confira se há policy" r_RMQ_AP_22
# <<< RMQ-AP-22

# >>> RMQ-AP-28
r_RMQ_AP_28() {
  local drr; drr="$(tmpf)"
  arquivos_com iac 'default-requeue-rejected|defaultRequeueRejected' > "$drr"
  linhas -p '(^|/)application[^/]*\.(ya?ml|properties)$' iac 'spring\.rabbitmq|^[[:space:]]+rabbitmq:' | exceto_arquivos "$drr"
}
regra RMQ-AP-28 aviso "projeto Spring AMQP sem default-requeue-rejected: false no application.*: o default é true, e exceção no listener volta a mensagem à fila em laço (RMQ-AP-10 implícito)" r_RMQ_AP_28
# <<< RMQ-AP-28

# >>> KFK-AP-01
r_KFK_AP_01() {
  linhas 'codigo iac' 'enable\.auto\.commit"?[[:space:]]*[=:][[:space:]]*"?true|enableAutoCommit[[:space:]]*[=:][[:space:]]*true|EnableAutoCommit[[:space:]]*=[[:space:]]*true|ENABLE_AUTO_COMMIT_CONFIG[[:space:]]*,[[:space:]]*"?true'
}
regra KFK-AP-01 alto "auto-commit com efeito colateral: o offset avança antes do efeito persistir" r_KFK_AP_01
# <<< KFK-AP-01

# >>> KFK-AP-02
# Arquivo com marca de Kafka: `retries: 0` e `acks: 1` sozinhos são comuns fora do Kafka (Playwright, async-retry).
MARCAS_KAFKA='kafka|bootstrap[._-]servers|producerconfig'
r_KFK_AP_02() {
  local kf; kf="$(tmpf)"
  arquivos_com -i 'codigo iac' "$MARCAS_KAFKA" > "$kf"
  linhas 'codigo iac' '(^|[^A-Za-z0-9_])acks"?[[:space:]]*[=:][[:space:]]*"?(0|1)"?([^0-9]|$)|ACKS_CONFIG[[:space:]]*,[[:space:]]*"(0|1)"|enable\.idempotence"?[[:space:]]*[=:][[:space:]]*"?false|(^|[^A-Za-z0-9_])retries"?[[:space:]]*[=:][[:space:]]*"?0"?([^0-9]|$)' | so_arquivos "$kf"
}
regra KFK-AP-02 alto "acks 0/1, idempotência desligada ou retries=0 em arquivo de Kafka: com idempotência implícita, acks diferente de all ou retries=0 a desligam em silêncio" r_KFK_AP_02
# <<< KFK-AP-02

# >>> KFK-AP-03
r_KFK_AP_03() {
  linhas codigo 'new[[:space:]]+ProducerRecord(<[^>]*>)?\([[:space:]]*[A-Za-z0-9_."]+[[:space:]]*,[[:space:]]*[A-Za-z0-9_."]+[[:space:]]*\)'
}
regra KFK-AP-03 aviso "ProducerRecord sem chave: sem chave não há ordem por entidade" r_KFK_AP_03
# <<< KFK-AP-03

# >>> KFK-AP-06
r_KFK_AP_06() {
  linhas iac '(^|[^A-Za-z0-9_.])(replication_factor|default\.replication\.factor)"?[[:space:]]*[=:][[:space:]]*"?1([^0-9]|$)|min\.insync\.replicas"?[[:space:]]*[=:][[:space:]]*"?1"?([^0-9]|$)|unclean\.leader\.election\.enable"?[[:space:]]*[=:][[:space:]]*"?true'
}
regra KFK-AP-06 alto "durabilidade fraca: RF 1, min.insync.replicas 1 ou eleição de líder não limpa perdem escrita confirmada" r_KFK_AP_06
# <<< KFK-AP-06

# >>> KFK-AP-09
r_KFK_AP_09() {
  linhas 'codigo iac' '(listeners|LISTENERS)[^#]*PLAINTEXT://0\.0\.0\.0'
}
regra KFK-AP-09 aviso "listener Kafka PLAINTEXT em todas as interfaces: sem TLS nem autenticação e com rota aberta (T-05; regra de integração)" r_KFK_AP_09
# <<< KFK-AP-09

# >>> KFK-AP-10
r_KFK_AP_10() {
  local ac; ac="$(tmpf)"
  arquivos_com 'codigo iac' 'enable\.auto\.commit|enableAutoCommit|EnableAutoCommit|ENABLE_AUTO_COMMIT' > "$ac"
  # Spring Kafka (@KafkaListener, spring.kafka.*) já usa enable.auto.commit=false por padrão desde o 2.3.
  linhas -x '@KafkaListener|spring\.kafka' 'codigo iac' 'group\.id|groupId|GroupId|GROUP_ID_CONFIG' | exceto_arquivos "$ac"
}
regra KFK-AP-10 aviso "configuração de consumidor sem enable.auto.commit no arquivo: o default do cliente é true (KFK-AP-01 implícito; Spring Kafka excluído)" r_KFK_AP_10
# <<< KFK-AP-10

# >>> KFK-AP-14
r_KFK_AP_14() {
  linhas iac 'zookeeper\.connect|ZOOKEEPER_CONNECT|zookeeper[[:space:]]*[:=]'
}
regra KFK-AP-14 aviso "Kafka com ZooKeeper: o Kafka 4.0 removeu o ZooKeeper (só KRaft); cluster novo nasce em KRaft e o existente migra antes do upgrade" r_KFK_AP_14
# <<< KFK-AP-14

# >>> INB-AP-01
r_INB_AP_01() {
  linhas codigo 'processedIds|seenMessages|processed_ids|seen_messages'
}
regra INB-AP-01 aviso "dedupe em memória perde o estado no restart e não vale entre réplicas; use inbox transacional" r_INB_AP_01
# <<< INB-AP-01

# >>> INB-AP-02
r_INB_AP_02() {
  linhas -e '(^|[^A-Za-z0-9_])if([^A-Za-z0-9_]|$)' codigo 'redelivered|isRedeliver|Redelivered'
}
regra INB-AP-02 aviso "redelivered usado como condição de descarte: é pista, não prova de duplicata" r_INB_AP_02
# <<< INB-AP-02

# >>> D-AP-01
r_D_AP_01() {
  local exp; exp="$(tmpf)"
  arquivos_com iac 'kind:[[:space:]]*(Ingress|Gateway|GRPCRoute|HTTPRoute)|type:[[:space:]]*(LoadBalancer|NodePort)' > "$exp"
  linhas -i iac 'grpc' | so_arquivos "$exp"
  linhas yml '(^|[^0-9])50051:[0-9]'
}
regra D-AP-01 aviso "porta ou backend gRPC publicado para fora (Ingress, Gateway, LoadBalancer, NodePort ou 50051 em compose): gRPC nunca é exposto a terceiro" r_D_AP_01
# <<< D-AP-01

# >>> D-AP-02
r_D_AP_02() {
  linhas iac '"(configure|write|read)"[[:space:]]*:[[:space:]]*"\.\*"|(configure|write|read)[[:space:]]*=[[:space:]]*"\.\*"'
}
regra D-AP-02 aviso "permissão total .* em vhost: se o usuário for de parceiro, é fila interna compartilhada com terceiro (quem é externo é julgamento de revisão)" r_D_AP_02
# <<< D-AP-02

# >>> D-AP-04
r_D_AP_04() {
  local porta; porta="$(tmpf)"
  arquivos_com iac '(from_port|to_port|port)"?[[:space:]]*[=:][[:space:]]*"?(5672|5671|5552|5551|15672|15671|9092|9093)([^0-9]|$)' > "$porta"
  linhas iac '0\.0\.0\.0/0' | so_arquivos "$porta"
}
regra D-AP-04 aviso "regra de rede aberta a 0.0.0.0/0 no mesmo arquivo que a porta do broker (AMQP 5672/5671, streams 5552/5551, API de gestão 15672/15671, Kafka 9092/9093): rota de terceiro para broker interno" r_D_AP_04
# <<< D-AP-04

# >>> D-AP-05
r_D_AP_05() {
  linhas -p '(^|/)[Dd]omain/' -e 'https?://[A-Za-z0-9_-]+(:[0-9]+)?[/"'"'"'`]' codigo 'HttpClient|fetch\(|axios|RestTemplate|WebClient|requests\.|http\.Get\('
}
regra D-AP-05 aviso "cliente HTTP para host interno (sem ponto) em código de domínio: comunicação síncrona interna é gRPC salvo ADR" r_D_AP_05
# <<< D-AP-05

# >>> SCH-AP-01
r_SCH_AP_01() {
  linhas proto '^[[:space:]]*required[[:space:]]'
}
regra SCH-AP-01 alto "campo required em .proto: remover ou tornar opcional depois quebra todo leitor antigo" r_SCH_AP_01
# <<< SCH-AP-01

# >>> T-02
# Fronteira inclui `_`: pan_token, masked_pan e pan_last4 (dado já tratado, o formato que a regra recomenda) não casam.
CARTAO='(^|[^a-z0-9_])(pan|card_number|cardnumber|cvv|cvc|track|track1|track2|pin_block)([^a-z0-9_]|$)'
# No código, `track` sozinho é genérico demais (analytics.track, faixa de áudio): só os nomes inequívocos.
CARTAO_COD='(^|[^a-z0-9_])(pan|card_number|cardnumber|cvv|cvc|track1|track2|track_data|pin_block)([^a-z0-9_]|$)'
r_T_02() {
  linhas -i 'proto avsc jsonschema' "$CARTAO"
  # payload publicado por código: campo de cartão na mesma linha de publish/send/produce/emit, ou no literal de evento.
  linhas -i -E "$CARTAO_COD" codigo '(publish|send|produce|emit)[A-Za-z]*\(|(evt|event|evento|message|mensagem|payload)[A-Za-z0-9_]*[[:space:]]*[:=][[:space:]]*\{'
}
regra T-02 aviso "campo de cartão (PAN/SAD) em schema de evento ou em payload publicado por código: evento carrega token; complemento do check-data-governance.sh" r_T_02
# <<< T-02

fim
