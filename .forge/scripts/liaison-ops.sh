#!/usr/bin/env bash
# forge-liaison: own-log-lock v1
# liaison-ops.sh — operações deterministas do subsistema liaison: canal de mensagens ORDENADAS
# entre agentes de repositórios distintos (ex.: dono do .proto/gRPC e app cliente), sem drift de
# handoff manual. Onda 2: transporte plugável (`transport` + `sync`) sobre o núcleo da Onda 1 —
# export/import continuam sendo a primitiva manual, e o transporte `manual` é literalmente ela.
#
# A sentinela acima (literal, conferida por `doctor.sh`) marca que esta cópia de liaison-ops.sh
# grava o log próprio sob trava (appendOwn/liaison-lock.mjs, design §2.4). Uma worktree criada de
# branch ANTERIOR a este change não tem a linha e continua gravando sem trava — limite declarado
# ("escritor de versão antiga"), detectável por `doctor.sh` listando `git worktree list` e
# avisando quando a cópia de alguma delas não contém esta sentinela.
#
# Modelo (ver rationale completo em lib/liaison-merge.mjs):
#   - Store: um JSONL append-only POR REMETENTE — .forge/liaison/<channel>/log/<sender>.jsonl,
#     um único escritor por arquivo. É esse invariante que torna o merge livre de conflito.
#   - Thread é campo da mensagem (thread_id), não arquivo — várias threads convivem no mesmo log.
#   - Lamport é POR THREAD (não por canal): participação parcial não exige ver threads alheias.
#   - Abertura de thread (kind: thread-open) e entrada de participante (kind: join) são
#     MENSAGENS, não configuração editada por fora.
#   - Visibilidade: a lista de participantes de uma thread ROTEIA (quem é cobrado por ack) — NÃO
#     confina leitura. Com hub compartilhado, quem alcança o transporte lê tudo.
#
# Uso:
#   liaison-ops.sh open     <channel> [--self <id>] --participants <a,b,c>
#   liaison-ops.sh thread   open  <channel> <thread-id> --subject "<txt>" --participants <a,b,c> [--body "<txt>"] [--requires-ack]
#   liaison-ops.sh thread   join  <channel> <thread-id> [--subject "<txt>"] [--body "<txt>"] [--requires-ack]
#   liaison-ops.sh thread   list  <channel>
#   liaison-ops.sh send     <channel> --thread <id> --kind note|question|answer|contract-change \
#                            --subject "<txt>" [--body "<txt>" | --body-file <path>] [--requires-ack] \
#                            [--in-reply-to <msg_id>] [--change <id>] [--contract-files <a,b>] [--commit <sha>]
#   liaison-ops.sh ack      <channel> <msg_id> [--subject "<txt>"] [--body "<txt>" | --body-file <path>] \
#                            [--reason wont-adopt|acknowledged]
#   liaison-ops.sh inbox    <channel> [--thread <id>]
#   liaison-ops.sh read     <channel> --upto <msg_id>
#   liaison-ops.sh status   [<channel>]
#   liaison-ops.sh export   <channel> --out <dir>
#   liaison-ops.sh import   <channel> --from <dir>
#   liaison-ops.sh conflicts list <channel>
#   liaison-ops.sh conflicts resolve <channel> <sender> <seq>
#   liaison-ops.sh peer     set <channel> <participante> --path <dir>
#   liaison-ops.sh peer-path <channel> <participante>
#   liaison-ops.sh transport set   <channel> --kind manual|fs|git|gh [--path <dir>] [--remote <url>] [--branch <b>]
#   liaison-ops.sh transport show  <channel>
#   liaison-ops.sh transport probe <channel>
#   liaison-ops.sh sync     <channel> [--push-only | --pull-only] [--repair-own-log]
#   liaison-ops.sh render   <channel>
#   liaison-ops.sh notify   <channel> <msg_id> --to <destino>
#   liaison-ops.sh native check [--session <id>] [--transcript <path>] [--report] [--pending]
#   liaison-ops.sh native dispose <fingerprint> --ephemeral <class>
#   liaison-ops.sh native allow <identidade> --reason "<motivo>"
#   liaison-ops.sh native revoke <identidade> --reason "<motivo>"
#   liaison-ops.sh native pin
#   liaison-ops.sh native containment [--range <a>..<b>] [--format text|markdown]
#   liaison-ops.sh baton offer    <channel> --thread <id> --subject "<txt>" \
#                            [--body "<txt>" | --body-file <path> | --from-handoff] \
#                            [--for <a,b>] [--max-lease <s>] [--session <id>]
#   liaison-ops.sh baton claim    <channel> <baton_id> [--lease <s>] [--session <id>]
#   liaison-ops.sh baton renew    <channel> <baton_id> [--lease <s>] [--session <id>]
#                            rc do renew (ARCH-001): 0 renovado; 4 PERDA REAL (não é a titular
#                            corrente, ou o lease venceu, e a retomada é 'baton claim'); 5 ainda não
#                            é hora (só com FORGE_BATON_RENEW_IF_DUE=1, antes da metade do prazo);
#                            1 erro ou transitório (trava ocupada, trava perdida, oferta
#                            desconhecida, argumento inválido, exceção). O gancho de renovação só
#                            trata como perda o rc 4.
#   liaison-ops.sh baton release  <channel> <baton_id> [--session <id>] [--body "<txt>" | --body-file <path>]
#   liaison-ops.sh baton complete <channel> <baton_id> [--session <id>] [--body "<txt>" | --body-file <path>]
#   liaison-ops.sh baton withdraw <channel> <baton_id> [--session <id>] [--body "<txt>" | --body-file <path>]
#   liaison-ops.sh baton status   <channel> [<baton_id>] [--json]
#   liaison-ops.sh baton list     <channel> [--json]
#

# TRANSPORTE (Onda 2): plugável, em lib/transports/<kind>.sh, com o contrato t_probe/t_push/t_pull.
# Move ARQUIVOS OPACOS — nunca parseia mensagem, nunca sabe o que é thread, nunca decide merge. A
# política de merge é uma só, em lib/liaison-import.mjs, compartilhada por `import` e `sync`: se
# houvesse uma por porta de entrada, a mais frouxa viraria o caminho de menor resistência.
# Topologia de hub único por canal (cada participante publica o próprio log e puxa os N-1
# restantes) — configuração cresce como N, não como N².
#
# Determinístico: created_at = data do commit HEAD (nunca wall clock; exceções declaradas:
# state.json — cursores locais de leitura — e baton.stamped_at — relógio de parede de quem
# grava uma mensagem de bastão, usado só para vencimento de lease, nunca para ordenar; a ordem
# continua sendo lamport/sender/seq em qualquer caso, inclusive para mensagens de bastão).
# content_sha cobre o envelope canônico menos content_sha/trust. trust é carimbado no IMPORT, nunca pelo remetente —
# e, por ser excluído do hash, é o único campo que verificação por integridade não alcança: a
# derivação dele a partir do arquivo que carrega a linha é conferida por lib/liaison-trust.mjs,
# chamada no pre-push por check-liaison-acks.sh.
#
# Nenhum subcomando aceita flag que não conheça: argumento desconhecido REPROVA nomeando a flag,
# o subcomando e as flags aceitas por ele (ver _reject_unknown). O `ack` aceita corpo (--body /
# --body-file, issue #83) pelo MESMO caminho do `send` — _scan_secret_or_fail/_write_body_blob são
# funções compartilhadas, não uma segunda implementação: duas portas para o mesmo efeito é
# exatamente o que este comentário avisava antes de existirem funções para reusar. Medido em
# campo: 1138 de 1138 mensagens kind=ack sem body_ref, porque a ferramenta não oferecia onde
# escrever — o ack é, por desenho do protocolo, a mensagem que carrega POSIÇÃO (concorda/discorda/
# não se aplica), e sem corpo um recibo não informa nada a quem esperava a decisão.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# ROOT é o CHECKOUT PRINCIPAL, nunca o worktree de onde o script foi chamado. O canal do liaison é
# estado durável de PROJETO, não de branch — mesma classe do ledger, e a mesma rule
# (conventions/machinery-propagation.md). Resolvido por `--show-toplevel`, cada worktree linkado
# ganha a SUA cópia de `log/<self>.jsonl` com o SEU contador de seq: é literalmente a causa-raiz da
# issue #36 ("duas cópias do mesmo log de remetente escrevendo em paralelo, cada uma com seu
# contador local"), com a agravante de que a colisão só aparece do outro lado, no import de quem
# recebe as duas versões da mesma posição. O invariante do store é UM ESCRITOR por arquivo de
# remetente; um único ROOT por clone é o que o torna verdadeiro dentro do clone.
#
# `--git-common-dir` devolve o `.git` compartilhado por TODOS os worktrees; o diretório que o
# contém é o tronco. `--path-format=absolute` é necessário porque, no próprio checkout principal,
# `--git-common-dir` devolveria `.git` relativo — e `dirname .git` daria `.`, que é justamente o
# worktree corrente que se quer evitar. Mesmo idioma de ledger-ops.sh e de hooks/git/pre-commit.
# Resolução do checkout principal e o aviso de divergência vivem em lib/forge-root.sh — UM sítio,
# consumido pelos quatro scripts que antes carregavam este corpo copiado (LDG-0068). Delegação em
# alvo ausente é erro: sem a lib, o script não segue resolvendo ROOT por conta própria.
if [ -f "$SCRIPT_DIR/lib/forge-root.sh" ]; then
  # shellcheck source=lib/forge-root.sh
  . "$SCRIPT_DIR/lib/forge-root.sh"
else
  echo "FAIL: $SCRIPT_DIR/lib/forge-root.sh ausente — é a resolução única do checkout principal; sem ela o script gravaria estado durável num lugar que ninguém declarou." >&2
  exit 1
fi

# Disciplina de flag engolida como valor (issue #103), só nos quatro sítios que gravam no log
# append-only — thread open/join, send e ack. NÃO substitui `_reject_unknown` (cópia local logo
# abaixo): consolidar as duas é trabalho próprio, fora do escopo desta correção.
if [ -f "$SCRIPT_DIR/lib/arg-guards.sh" ]; then
  # shellcheck source=lib/arg-guards.sh
  . "$SCRIPT_DIR/lib/arg-guards.sh"
else
  echo "FAIL: $SCRIPT_DIR/lib/arg-guards.sh ausente — a guarda de flag engolida como valor é parte do contrato de thread open/join, send e ack; sem ela esses quatro sítios voltam a aceitar flag como valor em silêncio." >&2
  exit 1
fi
ROOT="$(forge_resolve_root)"
export FORGE_ROOT="$ROOT"
LIBDIR="$SCRIPT_DIR/lib"
LIAISON_DIR="$ROOT/.forge/liaison"
CONFIG="$LIAISON_DIR/liaison.yaml"
TPL="$(cd "$SCRIPT_DIR/.." && pwd)/templates/liaison/CHANNEL.md"

cmd="${1:-}"; shift || true
case "$cmd" in
  -h|--help|help) echo "Usage: liaison-ops.sh open|thread|send|inbox|read|ack|status|export|import|conflicts|peer|peer-path|transport|sync|render|notify [args...]"; exit 0 ;;
esac
[ -n "$cmd" ] || { echo "Usage: liaison-ops.sh open|thread|send|inbox|read|ack|status|export|import|conflicts|peer|peer-path|transport|sync|render|notify [args...]" >&2; exit 1; }

_git_date() { git -C "$ROOT" log -1 --format=%cI 2>/dev/null || echo ""; }
_id_ok() { printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9._-]*$'; }
_chan_ok() { printf '%s' "$1" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; }

# Argumento que o subcomando não conhece REPROVA — nunca é descartado. Todo parser de flags
# terminava num caso curinga que apenas descartava o argumento, e o descarte silencioso publicava
# mensagem incompleta com rc 0 e sem aviso: um `ack ... --body-file corpo.md` (o `--body-file`
# só existe no `send`) publicava o ack SEM corpo
# nenhum, e a sessão que o escreveu acreditou ter anexado o relatório; um `--subjet` publicava
# mensagem sem assunto. Três linhas acima o script já sabia reprovar o VALOR inválido de uma flag
# conhecida (`--reason`) — só não reprovava a flag que não conhece.
#
# O conjunto de flags varia POR SUBCOMANDO, então a mensagem nomeia qual subcomando recusa: sem
# isso, quem escreveu `--body-file` num `ack` conclui que a flag não existe em lugar nenhum.
_reject_unknown() {  # _reject_unknown <subcomando> <flags aceitas> <argumento> [dica]
  local sub="$1" accepted="$2" arg="$3" hint="${4:-}"
  case "$arg" in
    -*) echo "FAIL: flag desconhecida '$arg' para o subcomando '$sub'" >&2 ;;
    *)  echo "FAIL: argumento inesperado '$arg' para o subcomando '$sub'" >&2 ;;
  esac
  echo "  flags aceitas em '$sub': $accepted" >&2
  [ -z "$hint" ] || echo "  $hint" >&2
  exit 1
}

# _baton_resolve_session <--session-value-ou-vazio> — REQ-10: --session ou, na ausência,
# CLAUDE_CODE_SESSION_ID; sem nenhum dos dois, recusa dizendo que agentes sem essa variável
# (Codex, Cursor, Gemini) precisam passar --session. Valida o padrão
# ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ nos dois casos — autodeclarado, não autentica (a defesa é
# que quem falsifica já tem escrita no repositório).
_baton_resolve_session() {
  local explicit="$1" session=""
  if [ -n "$explicit" ]; then
    session="$explicit"
  elif [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    session="$CLAUDE_CODE_SESSION_ID"
  else
    echo "FAIL: nenhuma sessão — passe --session <id> (agentes sem CLAUDE_CODE_SESSION_ID, como Codex, Cursor ou Gemini, precisam declarar a sessão explicitamente)" >&2
    return 1
  fi
  case "$session" in
    [A-Za-z0-9]*) : ;;
    *) echo "FAIL: session fora do padrão (precisa começar com letra ou dígito): '$session'" >&2; return 1 ;;
  esac
  if [ "${#session}" -gt 128 ]; then
    echo "FAIL: session excede 128 caracteres: '$session'" >&2
    return 1
  fi
  case "$session" in
    *[!A-Za-z0-9._-]*) echo "FAIL: session fora do padrão (só [A-Za-z0-9._-] após o primeiro caractere): '$session'" >&2; return 1 ;;
  esac
  printf '%s' "$session"
}

# _baton_flags <verbo> — devolve, separado por ", ", as flags aceitas do verbo, lidas de
# BATON_VERB_FLAGS em liaison-baton.mjs (design §2.2/§2.7: fonte única, sem segunda tabela
# aqui — o gate de documentação, REQ-16, confere que esta função nunca diverge do módulo).
_baton_flags() {
  node - "$LIBDIR" "$1" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, verb] = process.argv;
  const { BATON_VERB_FLAGS } = await import(pathToFileURL(join(lib, 'liaison-baton.mjs')).href);
  process.stdout.write((BATON_VERB_FLAGS[verb] || []).join(', '));
})();
NODEEOF
}

_read_self() {
  [ -f "$CONFIG" ] || { printf ''; return 0; }
  node - "$LIBDIR" "$CONFIG" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, cfg] = process.argv;
  const { readConfig } = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const doc = readConfig(cfg);
  process.stdout.write((doc.self && doc.self.id) || '');
})();
NODEEOF
}

# Emite, uma variável por linha (KIND/PATH/REMOTE/BRANCH), o transporte configurado do canal.
# Vazio quando não há transporte — o caller decide se isso é erro (sync) ou informação (show).
_read_transport() {
  [ -f "$CONFIG" ] || { printf ''; return 0; }
  node - "$LIBDIR" "$CONFIG" "$1" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, cfg, channel] = process.argv;
  const C = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const t = C.getTransport(C.readConfig(cfg), channel);
  if (!t) return;
  const errs = C.validateTransport(t);
  if (errs.length) { console.error(`transporte inválido em liaison.yaml: ${errs.join('; ')}`); process.exit(1); }
  const out = [`KIND=${t.kind}`];
  for (const [k, v] of [['PATH', t.path], ['REMOTE', t.remote], ['BRANCH', t.branch]]) {
    if (v) out.push(`${k}=${v}`);
  }
  process.stdout.write(out.join('\n') + '\n');
})();
NODEEOF
}

# Carrega o transporte do canal em LIAISON_T_* e faz source do backend. Reprova (rc 1) quando o
# canal não tem transporte configurado — pré-requisito faltando REPROVA, nunca desliga o sync em
# silêncio contra um default inventado.
_load_transport() {
  local channel="$1"
  local conf; conf="$(_read_transport "$channel")" || exit 1
  if [ -z "$conf" ]; then
    echo "FAIL: transporte não configurado para o canal '$channel' — rode: liaison-ops.sh transport set $channel --kind fs --path <dir>" >&2
    return 1
  fi
  LIAISON_T_KIND=""; LIAISON_T_PATH=""; LIAISON_T_REMOTE=""; LIAISON_T_BRANCH=""
  local line key val
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key="${line%%=*}"; val="${line#*=}"
    case "$key" in
      KIND) LIAISON_T_KIND="$val" ;;
      PATH) LIAISON_T_PATH="$val" ;;
      REMOTE) LIAISON_T_REMOTE="$val" ;;
      BRANCH) LIAISON_T_BRANCH="$val" ;;
    esac
  done <<< "$conf"
  local backend="$LIBDIR/transports/$LIAISON_T_KIND.sh"
  [ -f "$backend" ] || { echo "FAIL: backend de transporte ausente: $backend" >&2; return 1; }
  LIAISON_SELF="$(_read_self)"
  [ -n "$LIAISON_SELF" ] || { echo "FAIL: self não configurado (rode 'open' primeiro)" >&2; return 1; }
  export LIAISON_ROOT="$ROOT" LIAISON_CHANNEL="$channel" LIAISON_CHANNEL_DIR="$LIAISON_DIR/$channel"
  export LIAISON_SELF LIAISON_T_KIND LIAISON_T_PATH LIAISON_T_REMOTE LIAISON_T_BRANCH
  # shellcheck disable=SC1090
  . "$backend"
}

# Aplica um bundle cru (dir com log/ + blobs/) sobre o canal, pela política única de merge.
# Ecoa a linha de resultado e devolve rc 1 quando algum remetente reescreveu história.
_apply_bundle() {
  local channel="$1" from_dir="$2" label="$3"
  local ch_dir="$LIAISON_DIR/$channel"
  local self; self="$(_read_self)"
  mkdir -p "$ch_dir/conflicts" "$ch_dir/blobs"
  local out rc=0
  out="$(node - "$LIBDIR" "$ch_dir" "$from_dir" "$self" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, chDir, fromDir, self] = process.argv;
  const { applyBundle } = await import(pathToFileURL(join(lib, 'liaison-import.mjs')).href);
  const M = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  const r = applyBundle({ chDir, fromDir, self });
  const div = r.divergences.map((d) => `${d.sender}@seq=${d.seq} (${d.incoming ? d.incoming.msg_id : '?'})`).join(', ');
  const missingBoth = r.blobsMissingBoth.join(',');
  const rejectedOversize = r.blobsRejected.filter((x) => x.kind === 'oversize').map((x) => x.msg_id).join(',');
  const rejectedShaMismatch = r.blobsRejected.filter((x) => x.kind === 'sha-mismatch').map((x) => x.msg_id).join(',');
  const rejectedIoError = r.blobsRejected.filter((x) => x.kind === 'io-error').map((x) => x.msg_id).join(',');
  // Deduplicado: a mensagem NOVA cujo blob é recusado entra no log sem corpo, e a passada de
  // recuperação a revisita na mesma chamada e recusa o mesmo blob de novo — um blob, uma linha.
  const rejectedUnsafe = [...new Set(r.blobsRejected.filter((x) => x.kind === 'unsafe').map((x) => x.msg_id))].join(',');
  // Separador \x1f (US, não-espaço): um campo vazio no MEIO da lista (`div` sem divergência,
  // `missingBoth` sem perda) não pode colapsar com o vizinho. TAB é "IFS whitespace" para o `read`
  // do bash mesmo quando é o único caractere em IFS — sequências dele se fundem e campo vazio some,
  // desalinhando todos os campos depois. \x1f nunca aparece em sender, msg_id ou texto livre.
  process.stdout.write([r.accepted, r.dup, r.conflicts, r.quarantined, r.remaining, M.IMPORT_MAX_MESSAGES, div, r.blobsRecovered, missingBoth, rejectedOversize, rejectedShaMismatch, rejectedIoError, rejectedUnsafe].join('\x1f'));
})();
NODEEOF
)" || return 1
  local n_new n_dup n_conf n_quar n_rest n_max div n_recovered missing_both rejected_oversize rejected_sha rejected_io rejected_unsafe
  IFS=$'\x1f' read -r n_new n_dup n_conf n_quar n_rest n_max div n_recovered missing_both rejected_oversize rejected_sha rejected_io rejected_unsafe <<< "$out"
  _render "$channel"
  if [ -n "$div" ]; then
    # Fail-loud continua: reescrita de história exige ação humana na ORIGEM. O que mudou é o
    # escopo do dano — só as posições nomeadas ficam retidas, o resto do log é aplicado.
    echo "FAIL: divergência de log em $div — log append-only não reescreve história; essas POSIÇÕES ficaram em quarentena (ver conflicts/) e as demais mensagens foram aplicadas" >&2
    rc=1
  fi
  # Rótulo da fonte do conteúdo: `sync` fala do hub (o transporte configurado); `import` fala do
  # bundle que o operador apontou com `--from`. Nenhum dos dois consultou o outro, então afirmar
  # "do hub" num `import` manual seria alegar uma checagem que não existe.
  local src_word="hub"
  [ "$label" = "import" ] && src_word="bundle"
  # Recuperação de blob (issue #107): mensagem já conhecida que tinha perdido o corpo. Não é
  # candidato a FAIL — o conteúdo voltou —, mas precisa aparecer, senão a recuperação é tão
  # silenciosa quanto a perda que ela conserta.
  if [ "${n_recovered:-0}" -gt 0 ]; then
    echo "  $n_recovered blob(s) recuperado(s) do $src_word (mensagem já conhecida sem corpo local)"
  fi
  # Blob candidato à recuperação, mas rejeitado por não conferir com o compromisso que a mensagem
  # já tinha aceitado (teto de tamanho ou sha256 do nome — achado da revisão do #107, severidade
  # HIGH): NUNCA reportado como "recuperado", porque o corpo instalado seria, por definição, outro
  # conteúdo. Aviso, não recusa do sync inteiro — o resto do import continua íntegro. Duas linhas,
  # não uma: a causa (teto vs. sha) é o que permite ao operador agir — "o hub está corrompido" e "o
  # bundle tem um blob grande demais" pedem investigações diferentes.
  if [ -n "${rejected_oversize:-}" ]; then
    local n_ro; n_ro="$(tr ',' '\n' <<< "$rejected_oversize" | grep -c .)"
    echo "WARN: $n_ro blob(s) do $src_word excede(m) o teto de tamanho (rejeitado(s), mensagem mantida sem corpo local): $rejected_oversize" >&2
  fi
  if [ -n "${rejected_sha:-}" ]; then
    local n_rs; n_rs="$(tr ',' '\n' <<< "$rejected_sha" | grep -c .)"
    echo "WARN: $n_rs blob(s) do $src_word não confere(m) com o body_ref (rejeitado(s), mensagem mantida sem corpo local): $rejected_sha" >&2
  fi
  # Falha de E/S ao instalar o blob (achado de correção MEDIUM: nome temporário longo demais
  # estourava ENAMETOOLONG e derrubava o sync inteiro). Um único blob problemático nunca aborta a
  # recuperação dos demais — nomeia a mensagem e segue, sem dizer "recuperado".
  if [ -n "${rejected_io:-}" ]; then
    local n_rio; n_rio="$(tr ',' '\n' <<< "$rejected_io" | grep -c .)"
    echo "WARN: $n_rio blob(s) do $src_word falharam ao instalar por erro de E/S (rejeitado(s), mensagem mantida sem corpo local): $rejected_io" >&2
  fi
  # Blob que não é arquivo regular de um vínculo — link simbólico, FIFO, dispositivo ou hardlink
  # (NODE-201): lido sem seguir link, conferido no descritor, e recusado. Aviso com a causa, porque
  # é sinal de bundle ou hub adulterado — um blob legítimo nunca é link.
  if [ -n "${rejected_unsafe:-}" ]; then
    local n_ru; n_ru="$(tr ',' '\n' <<< "$rejected_unsafe" | grep -c .)"
    echo "WARN: $n_ru blob(s) do $src_word não é(são) arquivo regular de um vínculo (link simbólico, FIFO ou hardlink) — recusado(s) sem seguir o link (SEC-001), mensagem mantida sem corpo local: $rejected_unsafe" >&2
  fi
  # Blob ausente nos DOIS lados (local e hub/bundle desta chamada): aviso, não recusa — o resto do
  # import continua íntegro —, mas é perda real que merece nome e contagem, nunca rc 0 calado.
  if [ -n "${missing_both:-}" ]; then
    local n_missing; n_missing="$(tr ',' '\n' <<< "$missing_both" | grep -c .)"
    echo "WARN: $n_missing body_ref sem blob (local e $src_word): $missing_both" >&2
  fi
  local tail=""
  # Backlog acima do teto não é erro: é o próximo lote. Sem esta linha, um sync que aplicou 200 de
  # 205 pareceria ter terminado o trabalho.
  if [ "${n_rest:-0}" -gt 0 ]; then
    tail=" — $n_rest restante(s) acima do teto de $n_max por lote; rode sync novamente para aplicar o próximo"
  fi
  echo "OK $label — $n_new nova(s), $n_dup duplicata(s) (no-op), $n_conf conflito(s), $n_quar em quarentena${tail}"
  return $rc
}

_render() {
  local ch="$1"
  local ch_dir="$LIAISON_DIR/$ch"
  [ -f "$TPL" ] || { echo "WARN: template ausente ($TPL) — CHANNEL.md não regenerado" >&2; return 0; }
  local self; self="$(_read_self)"
  LIAISON_ROOT="$ROOT" LIAISON_CHANNEL="$ch" LIAISON_CHANNEL_DIR="$ch_dir" LIAISON_TPL="$TPL" \
    LIAISON_OUT="$ch_dir/CHANNEL.md" LIAISON_SELF="$self" \
    node "$LIBDIR/liaison-render.mjs"
}

# Segredo no corpo é segredo vazado: a mensagem sai do repositório e, com transporte por hub
# compartilhado ou branch remota, não volta atrás. Barra antes de escrever no log, não depois.
# Compartilhada por `send` e `ack` (issue #83) — um único ponto de varredura, nunca dois: se cada
# porta de escrita de corpo reimplementasse a checagem, bastaria uma esquecer para virar a mais
# frouxa, exatamente o raciocínio já registrado acima sobre por que o `ack` não tinha porta própria.
_scan_secret_or_fail() {  # _scan_secret_or_fail <body> <body_file>
  local body="$1" body_file="$2"
  [ -n "$body" ] || [ -n "$body_file" ] || return 0
  local scan_target="$body"
  [ -n "$body_file" ] && scan_target="$(cat "$body_file" 2>/dev/null || true)"
  local hits
  hits="$(SCAN_TEXT="$scan_target" node - "$LIBDIR" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib] = process.argv;
  const { findSecrets } = await import(pathToFileURL(join(lib, 'secret-scan.mjs')).href);
  process.stdout.write(findSecrets(process.env.SCAN_TEXT || '').join(', '));
})();
NODEEOF
)"
  if [ -n "$hits" ]; then
    echo "FAIL: possível segredo no corpo da mensagem ($hits) — o liaison publica fora deste repositório; use uma referência (--change, --commit) em vez do valor" >&2
    return 1
  fi
  return 0
}

# Grava --body-file como blob (teto de tamanho + dedup por sha) e imprime `blobs/<nome>` em
# stdout. Compartilhada por `send` e `ack` pelo mesmo motivo do scan acima.
_write_body_blob() {  # _write_body_blob <ch_dir> <body_file>
  local ch_dir="$1" body_file="$2"
  [ -f "$body_file" ] || { echo "FAIL: --body-file '$body_file' não encontrado" >&2; return 1; }
  mkdir -p "$ch_dir/blobs"
  node - "$LIBDIR" "$body_file" "$ch_dir/blobs" <<'NODEEOF'
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join, basename } = require('path');
const { pathToFileURL } = require('url');
const { createHash } = require('crypto');
(async () => {
  const [, , lib, file, blobsDir] = process.argv;
  const M = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  const buf = readFileSync(file);
  if (buf.length > M.BLOB_MAX_BYTES) { console.error(`blob excede ${M.BLOB_MAX_BYTES} bytes (${buf.length})`); process.exit(1); }
  // Issue #117: nome do blob é o sha256 dos BYTES do arquivo, nunca do texto. Antes disto,
  // `M.sha256Hex(buf.toString('binary'))` interpretava o buffer como latin1, produzia uma string
  // JS e a reidratava em UTF-8 antes de hashear — para todo byte acima de 0x7F (qualquer conteúdo
  // acentuado) o resultado diverge de `shasum -a 256` do arquivo real. `createHash` sobre o
  // BUFFER, sem conversão de texto no meio, é o único caminho que hasheia os bytes reais.
  const sha = createHash('sha256').update(buf).digest('hex');
  const safeBase = basename(file).replace(/[^A-Za-z0-9._-]/g, '_');
  const name = `${sha}-${safeBase}`;
  const dest = join(blobsDir, name);
  if (!existsSync(dest)) writeFileSync(dest, buf);
  process.stdout.write(`blobs/${name}`);
})();
NODEEOF
}

# Registro de mensagem nativa recebida (REQ-02, REQ-03, design §2.4 passos 2 a 6), chamado só por
# `send --via cross-session`. NENHUMA escrita acontece aqui — só leitura e validação; a recusa C1
# e qualquer falha de leitura/extração/origem devolvem rc 1 sem tocar liaison.yaml, log, blobs ou
# cursor. Em sucesso, ecoa "from_addr\x1ffrom_name\x1ffrom_mode\x1forigin_verified" em stdout.
#
# Reusa os leitores únicos da Wave 2 (native-transcript.mjs, native-registry.mjs,
# native-workspace.mjs) e as constantes da Wave 1 (native-classes.mjs) — nunca duplica a lógica
# de parsing de transcript, resolução de registro ou cálculo de identidade de workspace.
_resolve_cross_session() {  # _resolve_cross_session <channel> <authored_by> <native_ref> <session_arg>
  local channel="$1" authored_by="$2" native_ref="$3" session_arg="$4"
  node - "$LIBDIR" "$CONFIG" "$channel" "$authored_by" "$native_ref" "$session_arg" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, cfg, channel, authoredBy, nativeRef, sessionArg] = process.argv;
  const Config = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const Transcript = await import(pathToFileURL(join(lib, 'native-transcript.mjs')).href);
  const Registry = await import(pathToFileURL(join(lib, 'native-registry.mjs')).href);
  const Workspace = await import(pathToFileURL(join(lib, 'native-workspace.mjs')).href);
  const Classes = await import(pathToFileURL(join(lib, 'native-classes.mjs')).href);
  const { findSecrets } = await import(pathToFileURL(join(lib, 'secret-scan.mjs')).href);

  // C1 (REQ-03, design §2.4 passo 2): authored_by precisa participar do canal — recusa ANTES de
  // tocar o transcript ou o registro, nomeando os dois caminhos de resolução com os ids
  // preenchidos (open <channel> --participants <peer>; ou open <novo-canal> + transport set).
  const doc = Config.readConfig(cfg);
  const ch = doc.channels[channel];
  const participants = (ch && ch.participants) || [];
  if (!participants.includes(authoredBy)) {
    console.error(`FAIL: '${authoredBy}' não participa do canal '${channel}' (REQ-03/C1) — nada gravado`);
    console.error(`  opção 1: liaison-ops.sh open ${channel} --participants ${authoredBy}`);
    console.error(`  opção 2: liaison-ops.sh open <novo-canal> --participants ${authoredBy}  (e liaison-ops.sh transport set <novo-canal> --kind <kind>)`);
    console.error(`  o peer '${authoredBy}' precisa fazer o mesmo (abrir ou entrar no canal) do lado dele`);
    process.exit(1);
  }

  // Localização + leitura do transcript (design §2.4 passo 3/4) pelo MESMO leitor do native check
  // (native-transcript.mjs): roda a fixture de controle embutida, localiza por --session ou
  // CLAUDE_CODE_SESSION_ID, e decide "instrumento quebrado" quando há candidata sem extração.
  const sessionId = sessionArg || process.env.CLAUDE_CODE_SESSION_ID || '';
  const read = Transcript.readTranscript({ sessionId: sessionId || undefined });
  if (!read.ok) {
    console.error(`FAIL: ${read.reason}`);
    process.exit(1);
  }
  const rec = (read.receptions || []).find((r) => r.fingerprint === nativeRef);
  if (!rec) {
    console.error(`FAIL: fingerprint '${nativeRef}' não encontrado no transcript (cross-session/native-ref) — nada gravado`);
    process.exit(1);
  }

  // Valores extraídos da tag (design §2.4 passo 5): teto de 128 caracteres, caractere de
  // controle, segredo — qualquer falha recusa sem gravar.
  const checks = [['from', rec.from], ['from-name', rec.fromName], ['from-mode', rec.fromMode]];
  for (const [field, value] of checks) {
    if (String(value).length > Classes.NATIVE_FIELD_MAX) {
      console.error(`FAIL: ${field} extraído da tag excede ${Classes.NATIVE_FIELD_MAX} caracteres (cross-session)`);
      process.exit(1);
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) {
      console.error(`FAIL: ${field} extraído da tag contém caractere de controle (cross-session)`);
      process.exit(1);
    }
    const hits = findSecrets(value);
    if (hits.length) {
      console.error(`FAIL: possível segredo em ${field} extraído da tag (${hits.join(', ')}) (cross-session)`);
      process.exit(1);
    }
  }

  // Conferência de origem (design §2.4 passo 6): registro consultado pelo socket de `from`;
  // quando a linha traz verifiedPeerPid, pid divergente DESCARTA o registro (cai em "ausente",
  // nunca em origin_verified:true). Achado o registro, compara o repositório principal do `cwd`
  // dele com o repositório principal do peer-path do authored_by — divergência recusa nomeando os
  // dois caminhos; ausência de registro ou de peer-path é origin_verified:false (aceito).
  let originVerified = false;
  // `rec.from` traz o prefixo `uds:` (forma da tag — evidência b); o registro de sessões guarda
  // `messagingSocketPath` SEM prefixo (evidência c). Despir o prefixo antes de consultar o
  // registro por socket é o que torna a resolução possível.
  const sockFile = rec.from.startsWith('uds:') ? rec.from.slice(4) : rec.from;
  const bySocket = Registry.resolveBySocket({ sockFile });
  let entry = bySocket.ok ? bySocket.entry : null;
  // Sem verifiedPeerPid na linha, o `from` vem só do texto da tag — que um subagente ou um texto
  // colado também escrevem — e um socket vivo no caminho previsível não prova quem enviou: o
  // registro é descartado e a origem fica não verificada (code-evaluator PR #245, SEC-001).
  if (entry && (typeof rec.verifiedPeerPid !== 'number' || entry.pid !== rec.verifiedPeerPid)) {
    entry = null; // pid ausente ou divergente (socket reutilizado) — cai no caso "registro ausente"
  }
  if (entry) {
    const originRepo = Workspace.mainRepoRoot(entry.cwd);
    const peerPath = Config.getPeerPath(doc, channel, authoredBy);
    if (peerPath) {
      const peerRepo = Workspace.mainRepoRoot(peerPath);
      if (originRepo && peerRepo && originRepo === peerRepo) {
        originVerified = true;
      } else {
        console.error(`FAIL: origem diverge (cross-session/origem) — registro de '${authoredBy}' aponta para repositório '${originRepo}', peer-path aponta para '${peerRepo}' — nada gravado`);
        process.exit(1);
      }
    }
    // peerPath ausente: authored_by sem peer-path configurado → origin_verified fica false.
  }
  // registro ausente (sessão encerrada, Remote Control, nuvem) → origin_verified fica false.

  process.stdout.write([rec.from, rec.fromName, rec.fromMode, String(originVerified)].join('\x1f'));
})();
NODEEOF
}

# _native_state_dir — <git-common-dir>/forge-native/, o estado local NÃO VERSIONADO da
# mensageria nativa (REQ-08, design §2.6): dispositions.jsonl e reports/<session-id>.json. Fora
# da árvore de trabalho (nunca sob um .gitignore de branch) e compartilhado por todas as
# worktrees do repositório, porque é o MESMO <git-common-dir> que o visitante de qualquer uma
# delas resolve.
_native_state_dir() {
  local common
  common="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" \
    || { echo "FAIL: não foi possível resolver o git-common-dir de '$ROOT'" >&2; return 1; }
  printf '%s/forge-native\n' "$common"
}

# _native_ancestor_is_claude — percorre a cadeia de PPID a partir do pai deste processo, até o
# pid 1, com `ps` resolvido pelo PATH (nunca por caminho absoluto — design §2.7: o produtor não
# precisa de variável de escape própria, que o agente também usaria). Teto de 64 saltos, mesmo
# idioma de lib/heavy-mutex.sh::_fhm_is_ancestor, contra uma cadeia de PPID corrompida.
_native_ancestor_is_claude() {
  local cur="$PPID" hops=0 comm
  while [ -n "$cur" ] && [ "$hops" -lt 64 ]; do
    comm="$(ps -o comm= -p "$cur" 2>/dev/null | tr -d '[:space:]')"
    case "$comm" in
      claude|*/claude) return 0 ;;
    esac
    [ "$cur" = "1" ] && break
    cur="$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d '[:space:]')"
    hops=$((hops + 1))
  done
  return 1
}

# _native_operator_guard — recusa com rc 1 (achado A-01 do /forge:analyze, design §2.7) quando:
# (a) o ambiente tem qualquer marcador de sessão do Claude Code; ou (b) algum ancestral do
# processo é o executável do Claude Code. Nenhuma das duas é fronteira — o agente remove
# variáveis com `env -u` e o `ps` é resolvido pelo PATH —, e a doc registra isso (REQ-12,
# rules/conventions/liaison-untrusted-input.md). Chamada sempre DEPOIS do parsing de flags (a
# flag desconhecida reprova por conta própria, independente de sessão) e ANTES de qualquer
# escrita em disco.
_native_operator_guard() {
  local marker
  for marker in CLAUDECODE CLAUDE_CODE_SESSION_ID CLAUDE_PID CLAUDE_CODE_ENTRYPOINT; do
    if eval "[ -n \"\${$marker-}\" ]"; then
      echo "FAIL: variável de ambiente '$marker' detectada — o cadastro de workspaces é ato do operador humano, num terminal fora de qualquer sessão do Claude Code" >&2
      return 1
    fi
  done
  if _native_ancestor_is_claude; then
    echo "FAIL: processo ancestral do Claude Code detectado — o cadastro de workspaces é ato do operador humano, num terminal fora de qualquer sessão do Claude Code" >&2
    return 1
  fi
  return 0
}

case "$cmd" in

# ---------------------------------------------------------------------------------------------
open)
  channel="${1:-}"; shift || true
  [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
  _chan_ok "$channel" || { echo "FAIL: nome de canal inválido '$channel' (use [a-z0-9][a-z0-9-]*)" >&2; exit 1; }
  self_arg=""; participants=""
  while [ $# -gt 0 ]; do case "$1" in
    --self) forge_reject_flag_as_value open --self "${2-}" "--self, --participants"; self_arg="$2"; shift 2 ;;
    --participants) forge_reject_flag_as_value open --participants "${2-}" "--self, --participants"; participants="$2"; shift 2 ;;
    *) _reject_unknown "open" "--self, --participants" "$1" ;;
  esac; done
  [ -n "$participants" ] || { echo "FAIL: --participants obrigatório (lista separada por vírgula)" >&2; exit 1; }
  [ -z "$self_arg" ] || _id_ok "$self_arg" || { echo "FAIL: --self inválido '$self_arg'" >&2; exit 1; }

  mkdir -p "$LIAISON_DIR" "$LIAISON_DIR/$channel/log" "$LIAISON_DIR/$channel/blobs" "$LIAISON_DIR/$channel/conflicts"
  [ -f "$LIAISON_DIR/$channel/state.json" ] || printf '{"cursors":{}}\n' > "$LIAISON_DIR/$channel/state.json"

  IFS=',' read -ra parts <<< "$participants"
  result="$(node - "$LIBDIR" "$CONFIG" "$self_arg" "$channel" "${parts[*]}" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, cfg, selfArg, channel, partsRaw] = process.argv;
  const C = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const newParts = partsRaw.split(' ').filter(Boolean);
  for (const p of newParts) if (!C.ID_RE.test(p)) { console.error(`participante inválido: ${p}`); process.exit(1); }

  const doc = C.readConfig(cfg);

  if (selfArg) {
    if (doc.self.id && doc.self.id !== selfArg) {
      console.error(`identidade local já fixada como '${doc.self.id}' — não pode virar '${selfArg}'`);
      process.exit(1);
    }
    doc.self.id = selfArg;
  }
  if (!doc.self.id) { console.error('self.id não configurado — passe --self na primeira chamada de open'); process.exit(1); }
  if (!newParts.includes(doc.self.id)) newParts.push(doc.self.id);

  const prev = doc.channels[channel] || {};
  const existing = Array.isArray(prev.participants) ? prev.participants : [];
  const merged = [...new Set([...existing, ...newParts])].sort();
  // Reabrir um canal acrescenta participantes; NUNCA descarta o transporte já configurado —
  // `open` é idempotente e é chamado de novo sempre que a lista de participantes cresce.
  doc.channels[channel] = { participants: merged, ...(prev.transport ? { transport: prev.transport } : {}) };

  C.writeConfig(cfg, doc);
  console.log(doc.self.id);
  console.log(merged.join(','));
})();
NODEEOF
)"
  self_id="$(printf '%s\n' "$result" | sed -n '1p')"
  final_parts="$(printf '%s\n' "$result" | sed -n '2p')"
  _render "$channel"
  echo "OK open — canal $channel (self=$self_id, participantes: $final_parts)"
  ;;

# ---------------------------------------------------------------------------------------------
thread)
  sub="${1:-}"; shift || true
  channel="${1:-}"; shift || true
  [ -n "$sub" ] && [ -n "$channel" ] || { echo "FAIL: uso: thread open|join|list <channel> [...]" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
  self="$(_read_self)"
  [ -n "$self" ] || { echo "FAIL: self não configurado (rode 'open' primeiro)" >&2; exit 1; }

  case "$sub" in
  open)
    thread_id="${1:-}"; shift || true
    [ -n "$thread_id" ] || { echo "FAIL: <thread-id> obrigatório" >&2; exit 1; }
    _chan_ok "$thread_id" || { echo "FAIL: thread-id inválido '$thread_id'" >&2; exit 1; }
    subject=""; body=""; participants=""; requires_ack="false"
    THREAD_OPEN_FLAGS="--subject, --body, --participants, --requires-ack"
    while [ $# -gt 0 ]; do case "$1" in
      --subject) forge_reject_flag_as_value "thread open" --subject "${2-}" "$THREAD_OPEN_FLAGS"; subject="$2"; shift 2 ;;
      --body) forge_reject_flag_as_value "thread open" --body "${2-}" "$THREAD_OPEN_FLAGS"; body="$2"; shift 2 ;;
      --participants) forge_reject_flag_as_value "thread open" --participants "${2-}" "$THREAD_OPEN_FLAGS"; participants="$2"; shift 2 ;;
      --requires-ack) requires_ack="true"; shift ;;
      *) _reject_unknown "thread open" "$THREAD_OPEN_FLAGS" "$1" ;;
    esac; done
    [ -n "$subject" ] || { echo "FAIL: --subject obrigatório" >&2; exit 1; }
    [ -n "$participants" ] || { echo "FAIL: --participants obrigatório" >&2; exit 1; }
    IFS=',' read -ra parts <<< "$participants"
    out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$thread_id" "$subject" "$body" "${parts[*]}" "$requires_ack" "$(_git_date)" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, threadId, subject, body, partsRaw, requiresAck, now] = process.argv;
  const { appendOwn, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  try {
    const { msg } = await appendOwn({
      root, chDir, channel, self,
      build: (all) => {
        if (all.some((m) => m.thread_id === threadId && m.kind === 'thread-open')) {
          throw new Error(`thread '${threadId}' já está aberta`);
        }
        const participants = [...new Set(partsRaw.split(' ').filter(Boolean))];
        if (!participants.includes(self)) participants.push(self);
        return {
          channel, thread_id: threadId, kind: 'thread-open', in_reply_to: null,
          requires_ack: requiresAck === 'true', subject, ...(body ? { body } : {}),
          refs: { change_id: null, contract_files: [], commit: null },
          participants: participants.sort(),
          created_at: now, trust: 'self',
          // abertura: primeira mensagem lógica da thread. appendOwn calcula o lamport por
          // nextLamport sobre as mensagens já existentes desta thread_id, que aqui são zero
          // (thread nova) — nextLamport([]) já dá 1 sozinho, sem precisar fixar à mão.
        };
      },
    });
    process.stdout.write(msg.msg_id);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error(err.message);
    else console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
NODEEOF
)"
    _render "$channel"
    echo "OK thread open — $thread_id aberta em $channel por $self ($out)"
    ;;

  join)
    thread_id="${1:-}"; shift || true
    [ -n "$thread_id" ] || { echo "FAIL: <thread-id> obrigatório" >&2; exit 1; }
    subject=""; body=""; requires_ack="false"
    THREAD_JOIN_FLAGS="--subject, --body, --requires-ack"
    while [ $# -gt 0 ]; do case "$1" in
      --subject) forge_reject_flag_as_value "thread join" --subject "${2-}" "$THREAD_JOIN_FLAGS"; subject="$2"; shift 2 ;;
      --body) forge_reject_flag_as_value "thread join" --body "${2-}" "$THREAD_JOIN_FLAGS"; body="$2"; shift 2 ;;
      --requires-ack) requires_ack="true"; shift ;;
      *) _reject_unknown "thread join" "$THREAD_JOIN_FLAGS" "$1" ;;
    esac; done
    [ -n "$subject" ] || subject="$self entrou na thread"
    out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$thread_id" "$subject" "$body" "$requires_ack" "$(_git_date)" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, threadId, subject, body, requiresAck, now] = process.argv;
  const { appendOwn, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  try {
    const { msg } = await appendOwn({
      root, chDir, channel, self,
      build: (all) => {
        const threadMsgs = all.filter((m) => m.thread_id === threadId);
        if (!threadMsgs.some((m) => m.kind === 'thread-open')) {
          throw new Error(`thread '${threadId}' desconhecida localmente (aguarde o thread-open chegar)`);
        }
        return {
          channel, thread_id: threadId, kind: 'join', in_reply_to: null,
          requires_ack: requiresAck === 'true', subject, ...(body ? { body } : {}),
          refs: { change_id: null, contract_files: [], commit: null },
          created_at: now, trust: 'self',
        };
      },
    });
    process.stdout.write(msg.msg_id);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error(err.message);
    else console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
NODEEOF
)"
    _render "$channel"
    echo "OK thread join — $self entrou em $thread_id ($out)"
    ;;

  list)
    [ $# -eq 0 ] || _reject_unknown "thread list" "(nenhuma)" "$1"
    node - "$LIBDIR" "$ch_dir" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, chDir] = process.argv;
  const { mergeLogs } = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  const logDir = join(chDir, 'log');
  const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
  const all = [];
  for (const f of files) {
    const text = readFileSync(join(logDir, f), 'utf8');
    for (const line of text.split('\n')) { const t = line.trim(); if (t) all.push(JSON.parse(t)); }
  }
  const { threads } = mergeLogs(all);
  const ids = Object.keys(threads).sort();
  if (!ids.length) { console.log('(nenhuma thread aberta)'); return; }
  for (const id of ids) {
    const t = threads[id];
    console.log(`${id} — ${t.subject || '(sem assunto)'} · participantes: ${t.participants.join(', ')} · ${t.order.length} mensagem(ns)`);
  }
})();
NODEEOF
    ;;

  *) echo "FAIL: subcomando desconhecido 'thread $sub'" >&2; exit 1 ;;
  esac
  ;;

# ---------------------------------------------------------------------------------------------
send)
  channel="${1:-}"; shift || true
  [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
  self="$(_read_self)"
  [ -n "$self" ] || { echo "FAIL: self não configurado (rode 'open' primeiro)" >&2; exit 1; }

  thread_id=""; kind=""; subject=""; body=""; body_file=""; requires_ack="false"; authored_by=""; via=""
  in_reply_to=""; change=""; contract_files=""; commit=""; native_ref=""; session_arg=""
  SEND_FLAGS="--thread, --kind, --subject, --body, --body-file, --requires-ack, --in-reply-to, --change, --contract-files, --commit, --authored-by, --via, --native-ref, --session"
  while [ $# -gt 0 ]; do case "$1" in
    --thread) forge_reject_flag_as_value send --thread "${2-}" "$SEND_FLAGS"; thread_id="$2"; shift 2 ;;
    --kind) forge_reject_flag_as_value send --kind "${2-}" "$SEND_FLAGS"; kind="$2"; shift 2 ;;
    --subject) forge_reject_flag_as_value send --subject "${2-}" "$SEND_FLAGS"; subject="$2"; shift 2 ;;
    --body) forge_reject_flag_as_value send --body "${2-}" "$SEND_FLAGS" "Corpo real que coincide com o nome de uma flag? use --body-file <path> — o arquivo escapa do pertencimento porque o conteúdo não passa pela linha de comando."; body="$2"; shift 2 ;;
    --body-file) forge_reject_flag_as_value send --body-file "${2-}" "$SEND_FLAGS"; body_file="$2"; shift 2 ;;
    --requires-ack) requires_ack="true"; shift ;;
    --in-reply-to) forge_reject_flag_as_value send --in-reply-to "${2-}" "$SEND_FLAGS"; in_reply_to="$2"; shift 2 ;;
    --change) forge_reject_flag_as_value send --change "${2-}" "$SEND_FLAGS"; change="$2"; shift 2 ;;
    --contract-files) forge_reject_flag_as_value send --contract-files "${2-}" "$SEND_FLAGS"; contract_files="$2"; shift 2 ;;
    --commit) forge_reject_flag_as_value send --commit "${2-}" "$SEND_FLAGS"; commit="$2"; shift 2 ;;
    --authored-by) forge_reject_flag_as_value send --authored-by "${2-}" "$SEND_FLAGS"; authored_by="$2"; shift 2 ;;
    --via) forge_reject_flag_as_value send --via "${2-}" "$SEND_FLAGS"; via="$2"; shift 2 ;;
    --native-ref) forge_reject_flag_as_value send --native-ref "${2-}" "$SEND_FLAGS"; native_ref="$2"; shift 2 ;;
    --session) forge_reject_flag_as_value send --session "${2-}" "$SEND_FLAGS"; session_arg="$2"; shift 2 ;;
    *) _reject_unknown "send" "$SEND_FLAGS" "$1" ;;
  esac; done
  # Coerência de flags do REQ-02/design §2.4 passo 1 — ANTES de qualquer outra validação ou
  # escrita: --native-ref/--session só fazem sentido com --via cross-session, e --via
  # cross-session exige os dois (--native-ref e --authored-by, checado mais abaixo).
  if [ "$via" != "cross-session" ]; then
    [ -z "$native_ref" ] || { echo "FAIL: --native-ref exige --via cross-session" >&2; exit 1; }
    [ -z "$session_arg" ] || { echo "FAIL: --session exige --via cross-session" >&2; exit 1; }
  fi
  if [ "$via" = "cross-session" ]; then
    [ -n "$native_ref" ] || { echo "FAIL: --via cross-session exige --native-ref <fingerprint>" >&2; exit 1; }
    [ -n "$authored_by" ] || { echo "FAIL: --via cross-session exige --authored-by <repo-do-peer>" >&2; exit 1; }
    printf '%s' "$native_ref" | grep -Eq '^[0-9a-f]{64}$' || { echo "FAIL: --native-ref fora do padrão sha256 hex: '$native_ref'" >&2; exit 1; }
  fi
  # authored_by registra a autoria REAL quando o conteúdo veio de outro repositório (o caso do
  # /forge:liaison ask). O sender continua sendo este repositório — é o invariante de um escritor por
  # arquivo que torna o merge livre de conflito; gravar no log alheio faria o log dele divergir do
  # nosso e o import do outro lado reprovaria por reescrita de história.
  if [ -n "${authored_by:-}" ]; then
    self_local="$(_read_self)"
    [ "$authored_by" != "$self_local" ] || { echo "FAIL: --authored-by igual ao self ($self_local) — omita a flag" >&2; exit 1; }
  fi
  # Registro de mensagem nativa recebida (REQ-02/REQ-03, design §2.4 passos 2 a 6): recusa C1,
  # localização/leitura do transcript pelo leitor único (native-transcript.mjs), tetos/controle/
  # segredo nos valores extraídos e conferência de origem pelo registro de sessões — tudo ANTES de
  # qualquer escrita. Em sucesso, ecoa from_addr/from_name/from_mode/origin_verified.
  cs_from=""; cs_from_name=""; cs_from_mode=""; cs_origin_verified=""
  if [ "$via" = "cross-session" ]; then
    resolved="$(_resolve_cross_session "$channel" "$authored_by" "$native_ref" "$session_arg")" || exit 1
    IFS=$'\x1f' read -r cs_from cs_from_name cs_from_mode cs_origin_verified <<< "$resolved"
  fi
  [ -n "$thread_id" ] || { echo "FAIL: --thread obrigatório" >&2; exit 1; }
  [ -n "$kind" ] || { echo "FAIL: --kind obrigatório (note|question|answer|contract-change)" >&2; exit 1; }
  case "$kind" in
    note|question|answer|contract-change) ;;
    ack|thread-open|join) echo "FAIL: kind '$kind' tem subcomando dedicado (ack / thread open / thread join)" >&2; exit 1 ;;
    *) echo "FAIL: kind inválido '$kind'" >&2; exit 1 ;;
  esac
  [ -n "$subject" ] || { echo "FAIL: --subject obrigatório" >&2; exit 1; }
  if [ -n "$body" ] && [ -n "$body_file" ]; then echo "FAIL: use --body OU --body-file, não os dois" >&2; exit 1; fi
  if [ "$kind" = "answer" ] && [ "$requires_ack" = "true" ]; then
    echo "FAIL: requires_ack proibido em kind=answer" >&2; exit 1
  fi

  _scan_secret_or_fail "$body" "$body_file" || exit 1

  body_ref=""
  if [ -n "$body_file" ]; then
    body_ref="$(_write_body_blob "$ch_dir" "$body_file")" || exit 1
    body=""
  fi

  IFS=',' read -ra cfiles <<< "${contract_files:-}"
  out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$thread_id" "$kind" "$subject" "$body" "$body_ref" \
    "$requires_ack" "${in_reply_to:-}" "${change:-}" "${cfiles[*]:-}" "${commit:-}" "$(_git_date)" \
    "${authored_by:-}" "${via:-}" "${cs_from:-}" "${cs_from_name:-}" "${cs_from_mode:-}" \
    "${native_ref:-}" "${cs_origin_verified:-}" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, threadId, kind, subject, body, bodyRef,
    requiresAck, inReplyTo, change, cfilesRaw, commit, now, authoredBy, via,
    csFrom, csFromName, csFromMode, csNativeRef, csOriginVerified] = process.argv;
  const { appendOwn, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const cfiles = cfilesRaw ? cfilesRaw.split(' ').filter(Boolean) : [];
  try {
    const { msg } = await appendOwn({
      root, chDir, channel, self,
      build: (all) => {
        const threadMsgs = all.filter((m) => m.thread_id === threadId);
        if (!threadMsgs.some((m) => m.kind === 'thread-open')) {
          throw new Error(`thread '${threadId}' desconhecida localmente (abra ou aguarde o thread-open chegar)`);
        }
        return {
          channel, thread_id: threadId, kind, in_reply_to: inReplyTo || null,
          requires_ack: requiresAck === 'true', subject,
          ...(body ? { body } : {}), ...(bodyRef ? { body_ref: bodyRef } : {}),
          refs: { change_id: change || null, contract_files: cfiles, commit: commit || null },
          ...(authoredBy ? { authored_by: authoredBy } : {}),
          ...(via ? { via } : {}),
          // REQ-02/design §2.4 passo 8 — cross_session só quando via=cross-session; os cinco
          // subcampos já vieram calculados e validados por _resolve_cross_session (origem,
          // tetos, segredo).
          ...(via === 'cross-session' ? {
            cross_session: {
              from_addr: csFrom, from_name: csFromName, from_mode: csFromMode,
              native_ref: csNativeRef, origin_verified: csOriginVerified === 'true',
            },
          } : {}),
          created_at: now,
          // Conteúdo cuja autoria é de outro repositório NUNCA é 'self', mesmo tendo sido
          // escrito no nosso arquivo: quem lê precisa saber que a procedência é externa antes
          // de agir sobre ele.
          trust: authoredBy ? 'untrusted-peer' : 'self',
        };
      },
    });
    process.stdout.write(msg.msg_id);
  } catch (err) {
    // Parâmetro de catch deliberadamente diferente de "e": o gate w258 muta textualmente o
    // PRIMEIRO catch do arquivo que use esse nome de parâmetro específico, que é o do verbo
    // ack. Nomear o catch daqui com a mesma letra seria casado primeiro pela mutação e
    // corromperia o mutante — regressão real, observada nesta mesma rodada, não hipotética.
    // NUNCA usar parênteses dentro deste comentário: bash 3.2 conta parênteses através do
    // heredoc inteiro para achar o fechamento do $(...) externo, e um comentário com parênteses
    // desbalanceados entre linhas quebra esse cálculo (mesma causa raiz, achada por biseção).
    if (err instanceof AppendValidationError) console.error('envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error(err.message);
    else console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
NODEEOF
)"
  _render "$channel"
  echo "OK send — $out em $thread_id ($kind)"
  ;;

# ---------------------------------------------------------------------------------------------
ack)
  channel="${1:-}"; shift || true
  msg_id="${1:-}"; shift || true
  [ -n "$channel" ] && [ -n "$msg_id" ] || { echo "FAIL: uso: ack <channel> <msg_id> [--subject <txt>] [--body <txt> | --body-file <path>] [--reason wont-adopt|acknowledged]" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado" >&2; exit 1; }
  self="$(_read_self)"
  [ -n "$self" ] || { echo "FAIL: self não configurado" >&2; exit 1; }
  subject=""; reason=""; body=""; body_file=""
  ACK_FLAGS="--subject, --body, --body-file, --reason"
  while [ $# -gt 0 ]; do case "$1" in
    --subject) forge_reject_flag_as_value ack --subject "${2-}" "$ACK_FLAGS"; subject="$2"; shift 2 ;;
    --reason) forge_reject_flag_as_value ack --reason "${2-}" "$ACK_FLAGS"; reason="$2"; shift 2 ;;
    --body) forge_reject_flag_as_value ack --body "${2-}" "$ACK_FLAGS" "Corpo real que coincide com o nome de uma flag? use --body-file <path> — o arquivo escapa do pertencimento porque o conteúdo não passa pela linha de comando."; body="$2"; shift 2 ;;
    --body-file) forge_reject_flag_as_value ack --body-file "${2-}" "$ACK_FLAGS"; body_file="$2"; shift 2 ;;
    *) _reject_unknown "ack" "$ACK_FLAGS" "$1" ;;
  esac; done
  case "${reason:-}" in
    ''|wont-adopt|acknowledged) ;;
    *) echo "FAIL: --reason inválido '$reason' (use wont-adopt | acknowledged)" >&2; exit 1 ;;
  esac
  [ -n "$subject" ] || [ -z "$reason" ] || subject="ack ($reason)"
  if [ -n "$body" ] && [ -n "$body_file" ]; then echo "FAIL: use --body OU --body-file, não os dois" >&2; exit 1; fi
  # `wont-adopt` sem corpo é exatamente o caso em que a ausência de justificativa É o defeito
  # (issue #83): o --reason distingue "reconheço e recuso" de "recebido, sem posição a tomar", e só
  # o primeiro exige posição por escrito. `acknowledged` e ack sem --reason continuam aceitando
  # recibo puro — não existe obrigação geral de corpo, só condicionada à recusa.
  if [ "${reason:-}" = "wont-adopt" ] && [ -z "$body" ] && [ -z "$body_file" ]; then
    echo "FAIL: --reason wont-adopt exige --body ou --body-file — recusa sem justificativa é o drift que este canal existe para evitar" >&2
    exit 1
  fi

  _scan_secret_or_fail "$body" "$body_file" || exit 1
  body_ref=""
  if [ -n "$body_file" ]; then
    body_ref="$(_write_body_blob "$ch_dir" "$body_file")" || exit 1
    body=""
  fi

  out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$msg_id" "$subject" "$body" "$body_ref" "$(_git_date)" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, targetId, subjectArg, body, bodyRef, now] = process.argv;
  const { appendOwn, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  let target = null;
  try {
    const { msg, all } = await appendOwn({
      root, chDir, channel, self,
      build: (allMsgs) => {
        target = allMsgs.find((m) => m.msg_id === targetId);
        if (!target) throw new Error(`mensagem '${targetId}' desconhecida localmente`);
        const subject = subjectArg || `ack: ${target.subject || target.msg_id}`;
        return {
          channel, thread_id: target.thread_id, kind: 'ack', in_reply_to: targetId,
          requires_ack: false, subject, ...(body ? { body } : {}), ...(bodyRef ? { body_ref: bodyRef } : {}),
          refs: { change_id: null, contract_files: [], commit: null },
          created_at: now, trust: 'self',
        };
      },
    });

    // O ack AVANÇA o cursor da thread até a mensagem ackada — issue #102. Antes desta linha, o
    // ato mais forte de leitura do protocolo não marcava nada como lido, e `read --upto` era o
    // único caminho por onde um cursor avançava — toda mensagem ackada permanecia não lida.
    //
    // Só para mensagem de TERCEIRO. Ackar a própria mensagem é PARTICIPAÇÃO, não leitura: mover
    // o cursor ali marcaria como lidas as mensagens alheias que ficaram entre o cursor e a
    // própria, que ninguém leu. É a invariante que separa os dois atos.
    //
    // Não-regressão em modo NÃO estrito: ackar algo já lido é legítimo, e transformar isso em
    // erro faria um ato de protocolo falhar por um cursor que já estava adiante.
  if (target.sender !== self) {
    try {
      const M = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
      const { threads } = M.mergeLogs(all);
      if (threads[target.thread_id] && threads[target.thread_id].order.includes(targetId)) {
        const { advanceCursor } = await import(pathToFileURL(join(lib, 'liaison-cursor.mjs')).href);
        await advanceCursor({
          root, channel, chDir, threads, threadId: target.thread_id, upto: targetId,
          nowWall: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), strict: false,
        });
      }
    } catch (e) {
      // issue #108: o catch ficava vazio e o `OK ack` saía como se o cursor tivesse avançado —
      // o efeito colateral falhava em silêncio. O ack em si é um ato de protocolo já PUBLICADO
      // (a escrita do log próprio acima já aconteceu); reportar falha aqui reprovaria um ato que
      // funcionou por causa de um efeito colateral que não é o ato. Por isso WARN em stderr com
      // rc 0, nunca process.exit(1).
      const motivo = (e && e.message) ? e.message : String(e);
      console.error(`WARN: ack publicado, mas o cursor não avançou (${motivo})`);
    }
  }
    process.stdout.write(msg.msg_id);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error(err.message);
    else console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
NODEEOF
)"
  _render "$channel"
  # `wont-adopt` acka E registra dívida: a recusa vira item durável no ledger em vez de silêncio.
  # Silêncio é exatamente o que produz drift de contrato — o outro lado não distingue "não vi" de
  # "vi e decidi não adotar", e a decisão some com a sessão. Com o item no ledger, a recusa fica
  # atribuível, consultável e reaparece no planejamento.
  if [ "${reason:-}" = "wont-adopt" ]; then
    ledger_ops="$SCRIPT_DIR/ledger-ops.sh"
    if [ -f "$ledger_ops" ]; then
      FORGE_ROOT="$ROOT" bash "$ledger_ops" add --type tech-debt --priority P2 \
        --title "Contract-change recusado no liaison: $msg_id" \
        --detail "Este repositório ackou $msg_id (canal $channel) com --reason wont-adopt: reconheceu a mudança de contrato e decidiu NÃO adotá-la. A divergência resultante é conhecida e assumida, não acidental. Reabra quando a adoção entrar em roadmap, ou feche registrando por que a divergência é permanente." >/dev/null \
        || echo "WARN: ack gravado, mas o registro no ledger falhou — registre a dívida à mão" >&2
    else
      echo "WARN: ledger-ops.sh ausente — a recusa não foi registrada como dívida" >&2
    fi
  fi
  echo "OK ack — $out confirma $msg_id${reason:+ (motivo: $reason)}"
  ;;

# ---------------------------------------------------------------------------------------------
inbox)
  channel="${1:-}"; shift || true
  [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado" >&2; exit 1; }
  filter_thread=""; show_body="false"; titles_only="false"
  while [ $# -gt 0 ]; do case "$1" in
    --thread) forge_reject_flag_as_value inbox --thread "${2-}" "--thread, --show, --titles-only"; filter_thread="$2"; shift 2 ;;
    --show) show_body="true"; shift ;;
    --titles-only) titles_only="true"; shift ;;
    *) _reject_unknown "inbox" "--thread, --show, --titles-only" "$1" ;;
  esac; done

  self="$(_read_self)"
  node - "$LIBDIR" "$ch_dir" "$filter_thread" "$show_body" "$titles_only" "$self" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib2, chDir, filterThread, showBody, titlesOnly, self] = process.argv;
  const M = await import(pathToFileURL(join(lib2, 'liaison-merge.mjs')).href);
  // untrusted-render, não liaison-render: aquele é um SCRIPT (roda o render inteiro ao ser
  // carregado), então importá-lo só pela função quebraria justamente este caminho.
  const R = await import(pathToFileURL(join(lib2, 'untrusted-render.mjs')).href);
  const logDir = join(chDir, 'log');
  const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
  const all = [];
  for (const f of files) {
    const text = readFileSync(join(logDir, f), 'utf8');
    for (const line of text.split('\n')) { const t = line.trim(); if (t) all.push(JSON.parse(t)); }
  }
  const { threads } = M.mergeLogs(all);
  const state = existsSync(join(chDir, 'state.json')) ? JSON.parse(readFileSync(join(chDir, 'state.json'), 'utf8')) : { cursors: {} };
  const cursors = state.cursors || {};
  let ids = Object.keys(threads).sort();
  if (filterThread) ids = ids.filter((id) => id === filterThread);
  if (!ids.length) { if (titlesOnly !== 'true') console.log('(nenhuma thread)'); return; }
  for (const id of ids) {
    const t = threads[id];
    const cursorMsgId = cursors[id] && cursors[id].msg_id;
    const cursorIdx = cursorMsgId ? t.order.indexOf(cursorMsgId) : -1;
    const unread = t.messages.slice(cursorIdx + 1);
    if (titlesOnly === 'true' && !unread.length) continue;
    console.log(`${id} — ${t.subject || '(sem assunto)'}: ${unread.length} não lida(s)`);
    // Condensação de renovações de bastão de PEER (design S2.9): avançam o cursor como qualquer
    // mensagem, mas a listagem as agrupa numa linha por bastão em vez de uma por renovação — sem
    // isso, 30 renovações de um bastão calado inundam a inbox e escondem as mensagens que
    // realmente precisam de atenção.
    const renewByBaton = new Map();
    const other = [];
    for (const m of unread) {
      if (m.baton && m.baton.op === 'renew' && m.sender !== self) {
        const list = renewByBaton.get(m.in_reply_to) || [];
        list.push(m);
        renewByBaton.set(m.in_reply_to, list);
      } else {
        other.push(m);
      }
    }
    for (const m of other) {
      console.log(`  ${m.msg_id} [${m.kind}] \`${m.sender}\` — ${m.subject || '(sem assunto)'}`);
      // O corpo só sai com --show, e nunca cru: vai dentro do banner UNTRUSTED, em fence, com
      // `/forge:` neutralizado. Assunto e metadados são gerados por nós a partir do envelope;
      // o corpo é texto arbitrário de outro repositório.
      //
      // REQ-02/design §2.4: mensagem via=cross-session ganha, DENTRO da mesma moldura, as linhas
      // `via: cross-session`, nome e modo declarados (autodeclarados, não provam repositório) e,
      // quando origin_verified é false, "origem não verificada" — tudo neutralizado pela mesma
      // função que embrulha o corpo.
      if (showBody === 'true') {
        const cs = m.via === 'cross-session' && m.cross_session ? m.cross_session : null;
        const extra = [];
        if (cs) {
          extra.push('via: cross-session');
          extra.push(`nome declarado (autodeclarado): ${cs.from_name}`);
          extra.push(`modo declarado: ${cs.from_mode}`);
          if (cs.origin_verified === false) extra.push('origem não verificada');
        }
        if (m.body) {
          const composite = extra.length ? `${extra.join('\n')}\n\n${m.body}` : m.body;
          for (const line of R.renderUntrusted(composite, m.sender).split('\n')) console.log(`  ${line}`);
        } else if (m.body_ref) {
          if (extra.length) for (const line of R.renderUntrusted(extra.join('\n'), m.sender).split('\n')) console.log(`  ${line}`);
          console.log(`    corpo em \`${m.body_ref}\` (blob — abra deliberadamente)`);
        } else if (extra.length) {
          for (const line of R.renderUntrusted(extra.join('\n'), m.sender).split('\n')) console.log(`  ${line}`);
        }
      }
    }
    for (const [batonId, msgs] of renewByBaton) {
      const offerMsg = all.find((x) => x.msg_id === batonId);
      const subject = offerMsg ? (offerMsg.subject || '(sem assunto)') : '(oferta desconhecida)';
      console.log(`  ${msgs.length} renovação(ões) de ${batonId}: ${subject}`);
    }
  }
})();
NODEEOF
  ;;

# ---------------------------------------------------------------------------------------------
read)
  channel="${1:-}"; shift || true
  [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado" >&2; exit 1; }
  upto=""
  while [ $# -gt 0 ]; do case "$1" in --upto) forge_reject_flag_as_value read --upto "${2-}" "--upto"; upto="$2"; shift 2 ;; *) _reject_unknown "read" "--upto" "$1" ;; esac; done
  [ -n "$upto" ] || { echo "FAIL: --upto <msg_id> obrigatório" >&2; exit 1; }

  now_wall="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$channel" "$upto" "$now_wall" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, channel, upto, nowWall] = process.argv;
  const { mergeLogs } = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  const logDir = join(chDir, 'log');
  const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
  const all = [];
  for (const f of files) {
    const text = readFileSync(join(logDir, f), 'utf8');
    for (const line of text.split('\n')) { const t = line.trim(); if (t) all.push(JSON.parse(t)); }
  }
  const { threads } = mergeLogs(all);
  const threadId = Object.keys(threads).find((id) => threads[id].order.includes(upto));
  if (!threadId) { console.error(`mensagem '${upto}' desconhecida localmente (fora de qualquer thread resolvida)`); process.exit(1); }
  // A regra de não-regressão vive em lib/liaison-cursor.mjs, e é a MESMA que `ack` usa. Aqui em
  // modo estrito: o operador PEDIU um alvo, e um pedido inválido tem de ser dito.
  const { advanceCursor } = await import(pathToFileURL(join(lib, 'liaison-cursor.mjs')).href);
  try {
    await advanceCursor({ root, channel, chDir, threads, threadId, upto, nowWall, strict: true });
  } catch (e) { console.error(e.message); process.exit(1); }
  process.stdout.write(threadId);
})();
NODEEOF
)"
  echo "OK read — cursor de $out avançado até $upto"
  ;;

# ---------------------------------------------------------------------------------------------
status)
  channel="${1:-}"; shift || true
  [ $# -eq 0 ] || _reject_unknown "status" "(nenhuma)" "$1"
  if [ -n "$channel" ]; then
    ch_dir="$LIAISON_DIR/$channel"
    [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado" >&2; exit 1; }
    self="$(_read_self)"
    now_wall="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    node - "$LIBDIR" "$ROOT" "$ch_dir" "$channel" "$self" "$now_wall" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, channel, self, nowWall] = process.argv;
  const { mergeLogs, formatSkew } = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  const { readQuarantinedPositions, findMissingLocalBlobs } = await import(pathToFileURL(join(lib, 'liaison-import.mjs')).href);
  const { unpublishedCount } = await import(pathToFileURL(join(lib, 'liaison-publish.mjs')).href);
  const { checkJournalIntegrity } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const { foldBatons } = await import(pathToFileURL(join(lib, 'liaison-baton.mjs')).href);
  const logDir = join(chDir, 'log');
  const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
  const all = [];
  for (const f of files) {
    const text = readFileSync(join(logDir, f), 'utf8');
    for (const line of text.split('\n')) { const t = line.trim(); if (t) all.push(JSON.parse(t)); }
  }
  const { threads, quarantined, gaps, forks, clockSkews } = mergeLogs(all);
  // Bastões (design S2.7): "· bastões: N disponível(is), M nosso(s), K perdido(s)" na linha do
  // canal. "nosso(s)" = detidos por este repositório agora; "perdido(s)" = alguma claim PRÓPRIA
  // perdeu (lost-held) em algum momento, independente do estado atual.
  let batonBit = '';
  if (self) {
    const { batons: batonFold } = foldBatons(all);
    let avail = 0, ours = 0, lost = 0;
    for (const [, b] of batonFold) {
      if (b.state === 'available') avail++;
      if (b.state === 'held' && b.holder && b.holder.sender === self) ours++;
      if (b.history.some((h) => h.sender === self && h.op === 'claim' && h.verdict === 'lost-held')) lost++;
    }
    if (batonFold.size) batonBit = ` · bastões: ${avail} disponível(is), ${ours} nosso(s), ${lost} perdido(s)`;
  }
  const state = existsSync(join(chDir, 'state.json')) ? JSON.parse(readFileSync(join(chDir, 'state.json'), 'utf8')) : { cursors: {} };
  const cursors = state.cursors || {};
  let unread = 0;
  for (const id of Object.keys(threads)) {
    const cur = cursors[id] && cursors[id].msg_id;
    const idx = cur ? threads[id].order.indexOf(cur) : -1;
    unread += threads[id].order.length - (idx + 1);
  }
  // created_at incoerente entra na linha E é nomeado abaixo: um contador não diz qual mensagem
  // nem contra qual referência, que é o único dado sobre o qual dá para agir (issue #36).
  const skewBit = clockSkews.length ? ` · ${clockSkews.length} created_at incoerente(s)` : '';
  const diag = gaps.length || forks.length ? ` · ${gaps.length} buraco(s) · ${forks.length} fork(s)` : '';
  // Posições retidas por divergência entram na linha E são NOMEADAS abaixo. Só o contador
  // esconderia o defeito da issue #48: um remetente calado é indistinguível de um quieto, e
  // "N em quarentena" não diz de quem nem de onde, que é o que permite agir.
  const pos = readQuarantinedPositions(chDir);
  const posBit = pos.length ? ` · ${pos.length} posição(ões) retida(s) por divergência` : '';
  // body_ref sem blob local (issue #107, "o que resolveria" do corpo da issue): sem este
  // contador, a perda só aparecia numa rodada de `sync`, nunca numa medição parada — exatamente a
  // classe de dano que a issue descreve ("sem aparecer em nenhuma medição de rodada").
  const missingBlobs = findMissingLocalBlobs(chDir);
  const missingBlobsBit = missingBlobs.length ? ` · ${missingBlobs.length} body_ref sem blob local` : '';
  // issue #109: mensagens PRÓPRIAS `send`adas mas nunca `sync`adas não apareciam em NENHUMA
  // medição parada — só um `sync` bem-sucedido (ou seu ausência) revelava o defeito. `self` pode
  // vir vazio (canal aberto sem `open` local, ou config ausente) — sem identidade não há "log
  // próprio" a medir, então o bit fica ausente em vez de arriscar um remetente errado.
  let pubBit = '';
  if (self) {
    const { count, publishedAt } = unpublishedCount({ chDir, self });
    if (count > 0) {
      let timeBit = '';
      if (publishedAt) {
        const elapsedMs = Date.parse(nowWall) - Date.parse(publishedAt);
        // DA-23: a distância é contra published_at (carimbo do push), NUNCA contra created_at
        // (data do HEAD do commit) — só entra quando o cálculo faz sentido (não-negativo).
        if (Number.isFinite(elapsedMs) && elapsedMs >= 0) timeBit = ` (há ${formatSkew(elapsedMs)})`;
      }
      pubBit = ` · ${count} própria(s) não publicada(s)${timeBit}`;
    }
  }
  console.log(`LIAISON/${channel}: ${Object.keys(threads).length} thread(s) · ${unread} não lida(s) · ${quarantined.length} em quarentena${posBit}${skewBit}${diag}${missingBlobsBit}${pubBit}${batonBit}`);
  const sh = (v) => (v ? String(v).slice(0, 12) : '?');
  for (const p of pos) console.log(`  ! quarentena por divergência: ${p.sender}@seq=${p.seq} — recebida ${p.msg_id || '?'}/${sh(p.content_sha)}, conhecida ${p.known_msg_id || '?'}/${sh(p.known_content_sha)} (conflicts/${p.file})`);
  for (const c of clockSkews) console.log(`  ! created_at incoerente: ${c.msg_id} (${c.sender}, thread ${c.thread_id}) tem created_at ${c.created_at}, ${formatSkew(c.behind_ms)} ANTES de ${c.in_reply_to} (${c.ref_created_at}) que ela responde — relógio de parede da origem, ou duas cópias do mesmo log escrevendo em paralelo`);
  for (const m of missingBlobs) console.log(`  ! body_ref sem blob local: ${m.sender}/${m.msg_id} (${m.body_ref}) — rode 'sync' ou 'import' para tentar recuperar`);
  // Escritor de versão antiga (design §2.4, limite declarado): diário de appendOwn conferido
  // contra o log próprio atual — uma entrada cujo content_sha mudou foi reescrita por uma cópia
  // de liaison-ops.sh sem a trava do log (worktree de branch anterior a este change).
  if (self) {
    for (const bad of checkJournalIntegrity({ root, channel, chDir, self })) {
      console.log(`  ! log próprio reescrito por escritor sem trava: ${bad.msg_id}`);
    }
  }
})();
NODEEOF
    # Rebaixamento da marca de publicação nos transportes de diretório (design §2.4, resíduo da
    # publicação sem trava): relê o arquivo do próprio self no hub e, se estiver ATRÁS da marca
    # gravada, rebaixa pela MESMA markPublished({ observedFile }) e avisa. Melhor esforço total —
    # canal sem transporte configurado, transporte não-diretório (git/gh), ou qualquer erro de
    # leitura NUNCA interrompem o status nem mudam a linha principal acima; é um bit a mais, não
    # um requisito do comando.
    if [ -n "$self" ]; then
      _status_hub_conf="$(_read_transport "$channel" 2>/dev/null)" && [ -n "$_status_hub_conf" ] || _status_hub_conf=""
      _status_hub_kind=""; _status_hub_path=""
      while IFS= read -r _shl; do
        case "${_shl%%=*}" in KIND) _status_hub_kind="${_shl#*=}" ;; PATH) _status_hub_path="${_shl#*=}" ;; esac
      done <<< "$_status_hub_conf"
      case "$_status_hub_kind" in
        fs|fs-union|manual)
          # PLAT-204 (checklist SEC-001): o log próprio do hub é escrito por terceiros. Ele era
          # conferido com `[ -f ]` (que segue link) e lido por caminho pelo markPublished — um link
          # para um arquivo da vítima virava observação, e um FIFO podia travar. Agora a releitura é
          # a mesma do push (`_dir_read_hub_own_log`: dentro de `_dir_anchor`, O_NOFOLLOW|O_NONBLOCK,
          # arquivo regular de um vínculo, teto) para um diretório PRIVADO, e só a cópia vai ao
          # markPublished. Leitura recusada não rebaixa nada: o markPublished nem roda.
          _status_obsdir=""; _status_hubf=""; _status_read_ok=1
          if [ -n "$_status_hub_path" ] && _status_obsdir="$(mktemp -d "${TMPDIR:-/tmp}/liaison-status-obs.XXXXXX")"; then
            if ! _status_read_err="$(
              # shellcheck source=lib/transports/_common.sh
              . "$LIBDIR/transports/_common.sh"
              LIAISON_SELF="$self"
              _status_raiz="$(CDPATH='' cd -P -- "$_status_hub_path" 2>/dev/null && pwd -P)" || exit 0
              # canal ainda sem `log/` no hub (nunca publicado): mesma ausência de antes, sem recusa.
              [ -e "$_status_raiz/$channel/log" ] || [ -L "$_status_raiz/$channel/log" ] || exit 0
              _dir_read_hub_own_log "$_status_raiz/$channel" "$_status_obsdir/hub-$self.jsonl" 2>&1 >/dev/null
            )"; then
              _status_read_ok=0
              echo "  ! log próprio no hub recusado pelo leitor seguro (SEC-001) — marca de publicação não alterada: ${_status_read_err%%$'\n'*}"
            fi
            if [ -f "$_status_obsdir/hub-$self.jsonl" ]; then _status_hubf="$_status_obsdir/hub-$self.jsonl"; fi
          fi
          if [ -n "$_status_hub_path" ] && [ "$_status_read_ok" -eq 1 ]; then
            node - "$LIBDIR" "$ROOT" "$ch_dir" "$channel" "$self" "$now_wall" "$_status_hubf" <<'NODEEOF2' 2>/dev/null || true
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, channel, self, nowWall, observedFile] = process.argv;
  const P = await import(pathToFileURL(join(lib, 'liaison-publish.mjs')).href);
  const { readFileSync, existsSync } = await import('node:fs');
  const stateFile = join(chDir, 'state.json');
  const before = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')).published || {})[self] : undefined;
  const result = await P.markPublished({ root, channel, chDir, self, nowWall, observedFile: observedFile || undefined });
  const after = result ? result.msgId : undefined;
  if (before && before !== after) {
    console.log('  ! hub atrás do log próprio: rode sync');
  }
})();
NODEEOF2
          fi
          if [ -n "$_status_obsdir" ]; then rm -rf -- "$_status_obsdir"; fi
          ;;
        *) : ;;
      esac
    fi
  else
    self="$(_read_self)"
    if [ ! -d "$LIAISON_DIR" ]; then echo "LIAISON: não inicializado"; exit 0; fi
    channels=()
    while IFS= read -r d; do [ -n "$d" ] && channels+=("$(basename "$d")"); done \
      < <(find "$LIAISON_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | LC_ALL=C sort)
    if [ "${#channels[@]}" -eq 0 ]; then echo "LIAISON: self=${self:-?} · 0 canal(is)"; exit 0; fi
    now_wall="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    node - "$LIBDIR" "$LIAISON_DIR" "${channels[*]}" "$self" "$now_wall" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, liaisonDir, channelsRaw, self, nowWall] = process.argv;
  const { mergeLogs, formatSkew } = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  const { readQuarantinedPositions, findMissingLocalBlobs } = await import(pathToFileURL(join(lib, 'liaison-import.mjs')).href);
  const { unpublishedCount } = await import(pathToFileURL(join(lib, 'liaison-publish.mjs')).href);
  const channels = channelsRaw.split(' ').filter(Boolean);
  const positions = [];
  const skews = [];
  const missingBlobs = [];
  let threadsTotal = 0, unreadTotal = 0, quarantinedTotal = 0, unpublishedTotal = 0;
  // Entre canais, "(há Xmin)" mostra o publish MAIS ATRASADO (o pior caso é o que precisa de
  // ação primeiro) — nunca uma média, que esconderia justamente o canal mais parado.
  let oldestPublishedAt = null;
  for (const channel of channels) {
    const chDir = join(liaisonDir, channel);
    const logDir = join(chDir, 'log');
    const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
    const all = [];
    for (const f of files) {
      const text = readFileSync(join(logDir, f), 'utf8');
      for (const line of text.split('\n')) { const t = line.trim(); if (t) all.push(JSON.parse(t)); }
    }
    const { threads, quarantined, clockSkews } = mergeLogs(all);
    for (const c of clockSkews) skews.push({ channel, ...c });
    const state = existsSync(join(chDir, 'state.json')) ? JSON.parse(readFileSync(join(chDir, 'state.json'), 'utf8')) : { cursors: {} };
    const cursors = state.cursors || {};
    threadsTotal += Object.keys(threads).length;
    quarantinedTotal += quarantined.length;
    for (const p of readQuarantinedPositions(chDir)) positions.push({ channel, ...p });
    for (const m of findMissingLocalBlobs(chDir)) missingBlobs.push({ channel, ...m });
    for (const id of Object.keys(threads)) {
      const cur = cursors[id] && cursors[id].msg_id;
      const idx = cur ? threads[id].order.indexOf(cur) : -1;
      unreadTotal += threads[id].order.length - (idx + 1);
    }
    if (self) {
      const { count, publishedAt } = unpublishedCount({ chDir, self });
      unpublishedTotal += count;
      if (count > 0 && publishedAt) {
        if (!oldestPublishedAt || Date.parse(publishedAt) < Date.parse(oldestPublishedAt)) oldestPublishedAt = publishedAt;
      }
    }
  }
  const posBit = positions.length ? ` · ${positions.length} posição(ões) retida(s) por divergência` : '';
  const skewBit = skews.length ? ` · ${skews.length} created_at incoerente(s)` : '';
  const missingBlobsBit = missingBlobs.length ? ` · ${missingBlobs.length} body_ref sem blob local` : '';
  let pubBit = '';
  if (unpublishedTotal > 0) {
    let timeBit = '';
    if (oldestPublishedAt) {
      const elapsedMs = Date.parse(nowWall) - Date.parse(oldestPublishedAt);
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0) timeBit = ` (há ${formatSkew(elapsedMs)})`;
    }
    pubBit = ` · ${unpublishedTotal} própria(s) não publicada(s)${timeBit}`;
  }
  console.log(`LIAISON: self=${self || '?'} · ${channels.length} canal(is) · ${threadsTotal} thread(s) · ${unreadTotal} não lida(s) · ${quarantinedTotal} em quarentena${posBit}${skewBit}${missingBlobsBit}${pubBit}`);
  const sh = (v) => (v ? String(v).slice(0, 12) : '?');
  for (const p of positions) console.log(`  ! quarentena por divergência em ${p.channel}: ${p.sender}@seq=${p.seq} — recebida ${p.msg_id || '?'}/${sh(p.content_sha)}, conhecida ${p.known_msg_id || '?'}/${sh(p.known_content_sha)}`);
  for (const c of skews) console.log(`  ! created_at incoerente em ${c.channel}: ${c.msg_id} (${c.sender}) tem created_at ${c.created_at}, ${formatSkew(c.behind_ms)} ANTES de ${c.in_reply_to} (${c.ref_created_at}) que ela responde`);
  for (const m of missingBlobs) console.log(`  ! body_ref sem blob local em ${m.channel}: ${m.sender}/${m.msg_id} (${m.body_ref})`);
})();
NODEEOF
  fi
  ;;

# ---------------------------------------------------------------------------------------------
export)
  channel="${1:-}"; shift || true
  [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado" >&2; exit 1; }
  out_dir=""
  while [ $# -gt 0 ]; do case "$1" in --out) forge_reject_flag_as_value export --out "${2-}" "--out"; out_dir="$2"; shift 2 ;; *) _reject_unknown "export" "--out" "$1" ;; esac; done
  [ -n "$out_dir" ] || { echo "FAIL: --out <dir> obrigatório" >&2; exit 1; }
  # ARCH-201 (SEC-001): o diretório de saída tem o layout do transporte `manual` e costuma ser
  # compartilhado (pendrive, diretório de VPN) — `log/` e `blobs/` dentro dele podem ter sido
  # escritos por terceiros. O `mkdir -p` + `cp` que havia aqui seguia um symlink plantado em
  # `blobs/` e escrevia fora (execução de código na máquina de quem exporta). Agora o export publica
  # pelos MESMOS helpers do `_dir_push`: a raiz `--out` é configuração do operador, confiável e
  # resolvida por `cd -P`; abaixo dela, guarda de symlink, subdiretório criado por nome relativo no
  # diretório ancorado e publicação exclusiva + rename por arquivo, pelo módulo node. Sem a união:
  # o bundle é a fotografia da réplica, inclusive dos logs alheios.
  # shellcheck source=lib/transports/_common.sh
  . "$LIBDIR/transports/_common.sh"
  mkdir -p -- "$out_dir" 2>/dev/null || true
  out_phys="$(CDPATH='' cd -P -- "$out_dir" 2>/dev/null && pwd -P)" \
    || { echo "FAIL: diretório de saída inacessível: $out_dir" >&2; exit 1; }
  _dir_reject_symlink "$out_phys/log" || exit 1
  _dir_reject_symlink "$out_phys/blobs" || exit 1
  _dir_ensure_subdir "$out_phys" log || exit 1
  _dir_ensure_subdir "$out_phys" blobs || exit 1
  _dir_publish_dir "$ch_dir/log" "$out_phys/log" log substitui || { echo "FAIL: export do canal $channel interrompido — log não publicado em $out_dir" >&2; exit 1; }
  if [ -d "$ch_dir/blobs" ]; then
    _dir_publish_dir "$ch_dir/blobs" "$out_phys/blobs" blobs substitui || { echo "FAIL: export do canal $channel interrompido — blobs não publicados em $out_dir" >&2; exit 1; }
  fi
  n="$(find "$out_phys/log" -type f -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')" || n=0
  echo "OK export — canal $channel exportado para $out_dir ($n arquivo(s) de log)"
  ;;

# ---------------------------------------------------------------------------------------------
import)
  channel="${1:-}"; shift || true
  [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
  from_dir=""
  while [ $# -gt 0 ]; do case "$1" in --from) forge_reject_flag_as_value import --from "${2-}" "--from"; from_dir="$2"; shift 2 ;; *) _reject_unknown "import" "--from" "$1" ;; esac; done
  [ -n "$from_dir" ] || { echo "FAIL: --from <dir> obrigatório" >&2; exit 1; }
  [ -d "$from_dir/log" ] || { echo "FAIL: '$from_dir/log' não encontrado" >&2; exit 1; }
  [ -n "$(_read_self)" ] || { echo "FAIL: self não configurado" >&2; exit 1; }
  # NODE-201 (LDG-0233): o bundle de `--from` é escrito por terceiros tanto quanto o hub — chega por
  # pendrive, diretório compartilhado ou anexo de outro participante. Aplicá-lo cru fazia
  # `applyBundle` seguir um symlink em `blobs/` para um arquivo da vítima (`~/.ssh/id_rsa`): o
  # conteúdo entrava na réplica e o próximo `sync` o publicava no hub; um FIFO travava o comando.
  # Agora o bundle é PUXADO como um hub, pelo mesmo `_dir_pull` do `sync` (leitor seguro de
  # `liaison-hub-io.mjs`: `readdirSync`, nome por regex estrita, O_NOFOLLOW|O_NONBLOCK, arquivo
  # regular de um vínculo conferido no descritor, cópia do mesmo fd) para um staging PRIVADO, e só
  # o staging chega a `_apply_bundle`.
  #
  # A RAIZ do `--from` segue o mesmo contrato do hub (`_dir_phys_expected`): o caminho até o PAI é escolha do operador e é resolvido por `cd -P` (pode conter symlink legítimo); o ÚLTIMO componente é conteúdo entregue por terceiros (a pasta extraída do anexo, do pendrive ou do diretório compartilhado) e nunca é seguido. Resolvê-lo por `cd -P` inteiro, como na versão do PR #261, deixava o autor do bundle entregar um link para `.forge/liaison/<outro-canal>` da vítima: a guarda `_dir_reject_symlink` do `_dir_pull` via a raiz já resolvida, o anexo confidencial do outro canal entrava no canal importado e o próximo `sync` o publicava (w321 [I3], [M10]). Com o último componente literal, `_dir_pull` recusa a raiz que é link e ancora `log/` e `blobs/` por `pwd -P`, o que fecha também a troca da raiz por link entre a conferência e a leitura. Barras finais saem antes (`bundle/` não pode virar basename vazio); `.`, `..` e `/` não nomeiam entrada que um terceiro possa plantar como link, e por isso só eles são resolvidos por `cd -P` inteiro.
  # shellcheck source=lib/transports/_common.sh
  . "$LIBDIR/transports/_common.sh"
  from_trim="$from_dir"
  while [ "${#from_trim}" -gt 1 ] && [ "${from_trim%/}" != "$from_trim" ]; do from_trim="${from_trim%/}"; done
  case "$(basename -- "$from_trim")" in
    .|..|/) from_phys="$(CDPATH='' cd -P -- "$from_trim" 2>/dev/null && pwd -P)" || from_phys="" ;;
    *)      from_phys="$(_dir_phys_expected "$from_trim")" || from_phys="" ;;
  esac
  [ -n "$from_phys" ] || { echo "FAIL: diretório do bundle inacessível: $from_dir" >&2; exit 1; }
  LIAISON_SELF="$(_read_self)"; export LIAISON_SELF
  staging="$(mktemp -d "${TMPDIR:-/tmp}/forge-liaison-import.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '$staging'" EXIT
  _dir_pull "$from_phys" "$staging" \
    || { echo "FAIL: import do canal $channel RECUSADO — o bundle em $from_dir não pôde ser lido pelo leitor seguro; nada foi aplicado" >&2; exit 1; }
  _apply_bundle "$channel" "$staging" "import"
  ;;

# ---------------------------------------------------------------------------------------------
# conflicts — posições retidas por divergência (reescrita de história na origem) e a recuperação
# assistida delas. A retenção por posição foi entregue na issue #48; o que faltava era o caminho de
# volta: o conteúdo retido NUNCA entra no log local, então para o destinatário ele simplesmente não
# existe — no caso reportado, um ack legítimo. Até aqui só dava para lê-lo abrindo
# conflicts/*.divergence.json à mão e comparando com o log.
#
# `resolve` republica esse conteúdo numa sequência NOVA, que é o único caminho legítimo num log
# append-only. A republicação sai do NOSSO log, com `authored_by` do autor real e `resolves`
# apontando a posição de origem: escrever no log alheio quebraria o invariante de um escritor por
# arquivo — exatamente a causa-raiz da colisão de seq que a issue relata — e o import do outro lado
# reprovaria a linha por reescrita de história.
#
# `kind` vira `note`, nunca o kind original. Reemitir um `ack` ou um `contract-change` como se
# fosse nosso falsificaria autoria de decisão: quem acka é quem decidiu ackar, e a cobrança de ack
# (check-liaison-acks.sh) conta exatamente isso. `resolves.kind` preserva o que a mensagem era.
conflicts)
  sub="${1:-}"; shift || true
  case "$sub" in
    list)
      channel="${1:-}"; shift || true
      [ $# -eq 0 ] || _reject_unknown "conflicts list" "(nenhuma)" "$1"
      [ -n "$channel" ] || { echo "FAIL: uso: conflicts list <channel>" >&2; exit 1; }
      ch_dir="$LIAISON_DIR/$channel"
      [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado" >&2; exit 1; }
      node - "$LIBDIR" "$ch_dir" "$channel" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, chDir, channel] = process.argv;
  const { readQuarantinedPositions } = await import(pathToFileURL(join(lib, 'liaison-import.mjs')).href);
  const pos = readQuarantinedPositions(chDir);
  // Conjunto vazio responde EXPLICITAMENTE. Silêncio seria indistinguível de comando quebrado, e
  // este é justamente o comando que alguém roda para saber se há algo preso.
  if (!pos.length) { console.log(`LIAISON/${channel}: nenhuma posição retida por divergência`); return; }
  console.log(`LIAISON/${channel}: ${pos.length} posição(ões) retida(s) por divergência`);
  const sh = (v) => (v ? String(v).slice(0, 12) : '?');
  for (const p of pos) {
    console.log(`  ! ${p.sender}@seq=${p.seq} — recebida ${p.msg_id || '?'}/${sh(p.content_sha)}, conhecida ${p.known_msg_id || '?'}/${sh(p.known_content_sha)}${p.thread_id ? ` · thread ${p.thread_id}` : ''}${p.subject ? ` · "${p.subject}"` : ''} (conflicts/${p.file})`);
    if (p.resolved_as) console.log(`      republicada como ${p.resolved_as.msg_id} — a divergência na origem CONTINUA; corrigi-la é com quem escreveu o log`);
    else console.log(`      recuperar: liaison-ops.sh conflicts resolve ${channel} ${p.sender} ${p.seq}`);
  }
})();
NODEEOF
      ;;
    resolve)
      channel="${1:-}"; shift || true
      div_sender="${1:-}"; shift || true
      div_seq="${1:-}"; shift || true
      [ $# -eq 0 ] || _reject_unknown "conflicts resolve" "(nenhuma)" "$1"
      [ -n "$channel" ] && [ -n "$div_sender" ] && [ -n "$div_seq" ] \
        || { echo "FAIL: uso: conflicts resolve <channel> <sender> <seq>" >&2; exit 1; }
      printf '%s' "$div_seq" | grep -Eq '^[0-9]+$' || { echo "FAIL: <seq> deve ser inteiro, recebido '$div_seq'" >&2; exit 1; }
      _id_ok "$div_sender" || { echo "FAIL: <sender> inválido '$div_sender'" >&2; exit 1; }
      ch_dir="$LIAISON_DIR/$channel"
      [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado" >&2; exit 1; }
      self="$(_read_self)"
      [ -n "$self" ] || { echo "FAIL: self não configurado" >&2; exit 1; }
      out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$div_sender" "$div_seq" "$(_git_date)" <<'NODEEOF'
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, divSender, divSeqRaw, now] = process.argv;
  const { appendOwn, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const I = await import(pathToFileURL(join(lib, 'liaison-import.mjs')).href);
  const divSeq = Number(divSeqRaw);
  const pos = I.readQuarantinedPositions(chDir).find((p) => p.sender === divSender && p.seq === divSeq);
  if (!pos) { console.error(`nenhuma posição retida em ${divSender}@seq=${divSeq} (veja: conflicts list ${channel})`); process.exit(1); }
  if (pos.resolved_as) { console.error(`${divSender}@seq=${divSeq} já foi republicada como ${pos.resolved_as.msg_id} — republicar de novo duplicaria o conteúdo no canal`); process.exit(1); }
  const rec = JSON.parse(readFileSync(join(chDir, 'conflicts', pos.file), 'utf8'));
  const inc = rec.incoming;
  if (!inc || !inc.thread_id) { console.error(`o registro conflicts/${pos.file} não carrega a mensagem recebida — nada a republicar`); process.exit(1); }
  // Corpo em blob: o blob de uma posição RETIDA não é copiado pelo import (só o das mensagens
  // aplicadas), então pode não existir aqui. Republicar sem o corpo seria entregar um envelope
  // vazio dizendo que recuperou o conteúdo.
  if (inc.body_ref && !existsSync(join(chDir, 'blobs', inc.body_ref.slice('blobs/'.length)))) {
    console.error(`o corpo da posição está em ${inc.body_ref}, ausente em blobs/ — peça à origem o blob (ou republique você mesmo o conteúdo com 'send')`); process.exit(1);
  }

  try {
    const { msg } = await appendOwn({
      root, chDir, channel, self,
      build: (all) => {
        const threadMsgs = all.filter((m) => m.thread_id === inc.thread_id);
        if (!threadMsgs.some((m) => m.kind === 'thread-open')) {
          throw new Error(`thread '${inc.thread_id}' desconhecida localmente — sincronize a abertura da thread antes de republicar`);
        }
        return {
          channel, thread_id: inc.thread_id, kind: 'note', in_reply_to: inc.in_reply_to || null,
          requires_ack: false, subject: inc.subject,
          ...(inc.body ? { body: inc.body } : {}),
          ...(inc.body_ref ? { body_ref: inc.body_ref } : {}),
          refs: inc.refs || { change_id: null, contract_files: [], commit: null },
          authored_by: inc.sender,
          via: 'divergence-resolve',
          resolves: { sender: inc.sender, seq: divSeq, msg_id: inc.msg_id || null, content_sha: inc.content_sha || null, kind: inc.kind || null },
          created_at: now,
          trust: 'untrusted-peer',
        };
      },
    });
    I.markResolved(chDir, divSender, divSeq, { msg_id: msg.msg_id, created_at: now });
    process.stdout.write(`${msg.msg_id}\t${inc.msg_id || '?'}`);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error(err.message);
    else console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
NODEEOF
)" || exit 1
      IFS=$'\t' read -r new_id orig_id <<< "$out"
      _render "$channel"
      echo "OK conflicts resolve — $new_id republica o conteúdo de $orig_id ($div_sender@seq=$div_seq) em sequência nova; a divergência na origem continua e só ela pode corrigi-la"
      ;;
    *)
      echo "FAIL: uso: conflicts list <channel> | conflicts resolve <channel> <sender> <seq>" >&2; exit 1 ;;
  esac
  ;;

# ---------------------------------------------------------------------------------------------
# peer — caminho LOCAL do repositório de um participante, para o subcomando síncrono `liaison ask`.
# Fica no liaison.yaml e não numa mensagem porque é informação de máquina: o mesmo participante
# mora em diretórios diferentes em cada estação. Quem não tem o peer clonado não usa o atalho.
peer)
  sub="${1:-}"; shift || true
  channel="${1:-}"; shift || true
  participant="${1:-}"; shift || true
  [ "$sub" = "set" ] || { echo "FAIL: uso: peer set <channel> <participante> --path <dir>" >&2; exit 1; }
  [ -n "$channel" ] && [ -n "$participant" ] || { echo "FAIL: <channel> e <participante> obrigatórios" >&2; exit 1; }
  peer_path=""
  while [ $# -gt 0 ]; do case "$1" in --path) forge_reject_flag_as_value "peer set" --path "${2-}" "--path"; peer_path="$2"; shift 2 ;; *) _reject_unknown "peer set" "--path" "$1" ;; esac; done
  [ -n "$peer_path" ] || { echo "FAIL: --path obrigatório" >&2; exit 1; }
  node - "$LIBDIR" "$CONFIG" "$channel" "$participant" "$peer_path" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, cfg, channel, participant, path] = process.argv;
  const C = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const doc = C.readConfig(cfg);
  if (!doc.channels[channel]) { console.error(`canal '${channel}' não registrado — rode 'open' primeiro`); process.exit(1); }
  if (!C.ID_RE.test(participant)) { console.error(`participante inválido: ${participant}`); process.exit(1); }
  if (!doc.channels[channel].peers) doc.channels[channel].peers = {};
  doc.channels[channel].peers[participant] = path;
  C.writeConfig(cfg, doc);
})();
NODEEOF
  echo "OK peer set — $participant → $peer_path (canal $channel)"
  ;;

peer-path)
  channel="${1:-}"; shift || true
  participant="${1:-}"; shift || true
  [ $# -eq 0 ] || _reject_unknown "peer-path" "(nenhuma)" "$1"
  [ -n "$channel" ] && [ -n "$participant" ] || { echo "FAIL: uso: peer-path <channel> <participante>" >&2; exit 1; }
  out="$(node - "$LIBDIR" "$CONFIG" "$channel" "$participant" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, cfg, channel, participant] = process.argv;
  const C = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const p = C.getPeerPath(C.readConfig(cfg), channel, participant);
  if (!p) {
    console.error(`caminho local de '${participant}' não configurado no canal '${channel}' — rode: liaison-ops.sh peer set ${channel} ${participant} --path <dir>`);
    console.error('(sem ele, o subcomando síncrono `liaison ask` não se aplica; use o fluxo assíncrono)');
    process.exit(1);
  }
  process.stdout.write(p);
})();
NODEEOF
)" || exit 1
  printf '%s\n' "$out"
  ;;

# ---------------------------------------------------------------------------------------------
transport)
  sub="${1:-}"; shift || true
  channel="${1:-}"; shift || true
  [ -n "$sub" ] && [ -n "$channel" ] || { echo "FAIL: uso: transport set|show|probe <channel> [...]" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }

  case "$sub" in
  set)
    t_kind=""; t_path=""; t_remote=""; t_branch=""
    while [ $# -gt 0 ]; do case "$1" in
      --kind) forge_reject_flag_as_value "transport set" --kind "${2-}" "--kind, --path, --remote, --branch"; t_kind="$2"; shift 2 ;;
      --path) forge_reject_flag_as_value "transport set" --path "${2-}" "--kind, --path, --remote, --branch"; t_path="$2"; shift 2 ;;
      --remote) forge_reject_flag_as_value "transport set" --remote "${2-}" "--kind, --path, --remote, --branch"; t_remote="$2"; shift 2 ;;
      --branch) forge_reject_flag_as_value "transport set" --branch "${2-}" "--kind, --path, --remote, --branch"; t_branch="$2"; shift 2 ;;
      *) _reject_unknown "transport set" "--kind, --path, --remote, --branch" "$1" ;;
    esac; done
    [ -n "$t_kind" ] || { echo "FAIL: --kind obrigatório (manual|fs|git|gh)" >&2; exit 1; }
    node - "$LIBDIR" "$CONFIG" "$channel" "$t_kind" "$t_path" "$t_remote" "$t_branch" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, cfg, channel, kind, path, remote, branch] = process.argv;
  const C = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const doc = C.readConfig(cfg);
  if (!doc.self.id) { console.error('self.id não configurado — rode `open` primeiro'); process.exit(1); }
  if (!doc.channels[channel]) { console.error(`canal '${channel}' não registrado no liaison.yaml — rode \`open\` primeiro`); process.exit(1); }
  const transport = { kind };
  if (path) transport.path = path;
  if (remote) transport.remote = remote;
  if (branch) transport.branch = branch;
  const errs = C.validateTransport(transport);
  if (errs.length) { console.error(errs.join('; ')); process.exit(1); }
  doc.channels[channel].transport = transport;
  C.writeConfig(cfg, doc);
})();
NODEEOF
    echo "OK transport set — canal $channel usa transporte $t_kind"
    ;;

  show)
    [ $# -eq 0 ] || _reject_unknown "transport show" "(nenhuma)" "$1"
    conf="$(_read_transport "$channel")" || exit 1
    if [ -z "$conf" ]; then echo "LIAISON/$channel: transporte não configurado"; exit 0; fi
    echo "LIAISON/$channel: $(printf '%s' "$conf" | tr '\n' ' ' | sed 's/ *$//')"
    ;;

  probe)
    [ $# -eq 0 ] || _reject_unknown "transport probe" "(nenhuma)" "$1"
    _load_transport "$channel" || exit 1
    t_probe || exit 1
    echo "OK transport probe — $LIAISON_T_KIND alcançável para o canal $channel"
    ;;

  *) echo "FAIL: subcomando desconhecido 'transport $sub'" >&2; exit 1 ;;
  esac
  ;;

# ---------------------------------------------------------------------------------------------
# sync — publica o próprio log no ponto de encontro e aplica o que os demais publicaram.
# Ordem deliberada: PUSH antes de PULL. Publicar primeiro garante que o que já escrevemos fica
# disponível mesmo que a aplicação do bundle alheio reprove (divergência, teto excedido); e evita
# o caso em que uma réplica atrasada puxa, aprende o estado novo, e então republica logs de
# terceiros — o push só toca o próprio arquivo, mas a ordem torna o invariante evidente.
sync)
  channel="${1:-}"; shift || true
  [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
  do_push=1; do_pull=1; repair_own=0
  while [ $# -gt 0 ]; do case "$1" in
    --push-only) do_pull=0; shift ;;
    --pull-only) do_push=0; shift ;;
    # --repair-own-log: ato EXPLÍCITO do dono sobre o próprio log. Quando o hub tem conteúdo
    # diferente num msg_id que esta árvore também tem, nada nos dois logs distingue "um terceiro
    # reescreveu a história" de "outra réplica minha publicou mensagem distinta no mesmo seq" — o
    # primeiro se repara republicando, o segundo se DESTRÓI republicando. Só o dono sabe qual é,
    # e por isso a saída é uma declaração dele, nunca uma inferência do transporte.
    #
    # NÃO é um --force: réplica ATRASADA (o hub tem mensagem que esta árvore não tem) continua
    # recusada mesmo com a flag. Aquilo é perda de dado, não ambiguidade — a propriedade da
    # issue #101 não é negociável por flag.
    --repair-own-log) repair_own=1; shift ;;
    *) _reject_unknown "sync" "--push-only, --pull-only, --repair-own-log" "$1" ;;
  esac; done
  export LIAISON_PUSH_REPAIR="$repair_own"

  _load_transport "$channel" || exit 1
  t_probe || { echo "FAIL: transporte $LIAISON_T_KIND indisponível — sync abortado" >&2; exit 1; }

  if [ "$do_push" -eq 1 ]; then
    LIAISON_OBSERVED_FILE=""
    push_rc=0
    t_push || push_rc=$?
    # publish-result-<pid>.json (design §2.4): registrado SEMPRE que o push foi tentado,
    # sucesso ou não — é o que o processo destacado da renovação (TASK-27) e o `baton status`
    # consolidam depois, sob a trava local. `sync` interativo também grava: um `sync` manual que
    # falhou por teto de tempo não deve desaparecer sem rastro.
    result_dir="$ROOT/.forge/cache/liaison-baton/$channel"
    mkdir -p "$result_dir" 2>/dev/null || true
    now_wall="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    node -e "
      const fs = require('fs');
      const out = {
        rc: $push_rc, at: '$now_wall',
        attempts: Number('${LIAISON_PUSH_ATTEMPTS:-0}') || 0,
        repairs: Number('${LIAISON_PUSH_REPAIRS:-0}') || 0,
      };
      fs.writeFileSync('$result_dir/publish-result-$$.json', JSON.stringify(out));
    " 2>/dev/null || true
    [ "$push_rc" -eq 0 ] || { echo "FAIL: push pelo transporte $LIAISON_T_KIND" >&2; exit 1; }
    # issue #109 / design §2.4: a marca é do que foi OBSERVADO no hub depois do push (nunca do
    # que o processo local acha que escreveu) — `_dir_push` exporta `LIAISON_OBSERVED_FILE` só
    # quando a conferência pós-mv passou. published_at é wall clock de propósito (DA-23):
    # created_at é a data do HEAD, e mediria "publicada há dias" para uma mensagem cujo push
    # acabou de acontecer.
    node - "$LIBDIR" "$ROOT" "$ch_dir" "$channel" "$LIAISON_SELF" "$now_wall" "${LIAISON_OBSERVED_FILE:-}" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, channel, self, nowWall, observedFile] = process.argv;
  const { markPublished } = await import(pathToFileURL(join(lib, 'liaison-publish.mjs')).href);
  await markPublished({ root, channel, chDir, self, nowWall, observedFile: observedFile || undefined });
})();
NODEEOF
  fi

  if [ "$do_pull" -eq 0 ]; then
    echo "OK sync — push-only via $LIAISON_T_KIND (log de $LIAISON_SELF publicado)"
    exit 0
  fi

  staging="$(mktemp -d "${TMPDIR:-/tmp}/forge-liaison-sync.XXXXXX")"
  # shellcheck disable=SC2064
  trap "rm -rf '$staging'" EXIT
  t_pull "$staging" || { echo "FAIL: pull pelo transporte $LIAISON_T_KIND" >&2; exit 1; }
  _apply_bundle "$channel" "$staging" "sync via $LIAISON_T_KIND"
  # pulled_at (design §2.4/§2.7): instante do último pull BEM-SUCEDIDO, gravado pelo próprio
  # sync — usado pela TASK-19 (tomada de bastão por vencimento) para distinguir "não vejo
  # renovação porque não sincronizei" de "não vejo renovação porque ela não veio". Melhor
  # esforço: falhar aqui nunca desfaz um pull que já aconteceu.
  pull_result_dir="$ROOT/.forge/cache/liaison-baton/$channel"
  mkdir -p "$pull_result_dir" 2>/dev/null || true
  node -e "
    const fs = require('fs');
    const f = '$pull_result_dir/sync-local.json';
    let state = {};
    try { state = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    state.pulled_at = '$(date -u +%Y-%m-%dT%H:%M:%SZ)';
    const tmp = f + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, f);
  " 2>/dev/null || true
  ;;

# ---------------------------------------------------------------------------------------------
render)
  channel="${1:-}"; shift || true
  [ $# -eq 0 ] || _reject_unknown "render" "(nenhuma)" "$1"
  [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
  ch_dir="$LIAISON_DIR/$channel"
  [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado" >&2; exit 1; }
  _render "$channel"
  echo "OK $ch_dir/CHANNEL.md"
  ;;

# ---------------------------------------------------------------------------------------------
# notify — ponteiro canônico (REQ-01, design §2.3): imprime, em stdout, o ponteiro
# `liaison:<channel>/<msg_id>` só se a mensagem existir no log próprio, for mensagem própria e já
# tiver sido publicada por um `sync` com push bem-sucedido. NÃO envia nada — a doc do comando
# instrui o agente a colar o bloco impresso no `message` do SendMessage. `--to` é só informativo.
notify)
  channel="${1:-}"; shift || true
  msg_id="${1:-}"; shift || true
  [ -n "$channel" ] && [ -n "$msg_id" ] || { echo "FAIL: uso: notify <channel> <msg_id> --to <destino>" >&2; exit 1; }
  to=""
  NOTIFY_FLAGS="--to"
  while [ $# -gt 0 ]; do case "$1" in
    --to) forge_reject_flag_as_value notify --to "${2-}" "$NOTIFY_FLAGS"; to="$2"; shift 2 ;;
    *) _reject_unknown "notify" "$NOTIFY_FLAGS" "$1" ;;
  esac; done
  [ -n "$to" ] || { echo "FAIL: '--to' obrigatório no subcomando 'notify'" >&2; echo "  flags aceitas em 'notify': $NOTIFY_FLAGS" >&2; exit 1; }

  pointer_out="$(node - "$LIBDIR" "$ROOT" "$channel" "$msg_id" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, channel, msgId] = process.argv;
  const { resolvePointer } = await import(pathToFileURL(join(lib, 'liaison-pointer.mjs')).href);
  const r = resolvePointer({ root, channel, msgId });
  if (!r.ok) { console.error(`FAIL: ${r.reason}`); process.exit(1); }
  console.log(`liaison:${channel}/${msgId}`);
  console.log(`thread_id: ${r.thread_id}`);
  console.log(`content_sha: ${r.content_sha}`);
  console.log(`subject: ${r.subject}`);
})();
NODEEOF
)" || exit 1
  echo "$pointer_out"
  echo "to: $to"
  ;;

# ---------------------------------------------------------------------------------------------
# baton — bastão de dono único sobre o liaison (add-liaison-handoff-baton, REQ-01..REQ-11,
# design §2.7). Verbos offer/claim nesta revisão (TASK-19/20); renew/release/complete/withdraw
# (TASK-21/22) e status/list (TASK-23/24) ainda não existem — recusam nomeando a task.
baton)
  baton_verb="${1:-}"; shift || true
  case "$baton_verb" in

  offer)
    channel="${1:-}"; shift || true
    [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
    ch_dir="$LIAISON_DIR/$channel"
    [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
    self="$(_read_self)"
    [ -n "$self" ] || { echo "FAIL: self não configurado (rode 'open' primeiro)" >&2; exit 1; }

    thread_id=""; subject=""; body=""; body_file=""; from_handoff="false"; for_arg=""; max_lease_arg=""; session_arg=""
    OFFER_FLAGS="$(_baton_flags offer)"
    while [ $# -gt 0 ]; do case "$1" in
      --thread) forge_reject_flag_as_value "baton offer" --thread "${2-}" "$OFFER_FLAGS"; thread_id="$2"; shift 2 ;;
      --subject) forge_reject_flag_as_value "baton offer" --subject "${2-}" "$OFFER_FLAGS"; subject="$2"; shift 2 ;;
      --body) forge_reject_flag_as_value "baton offer" --body "${2-}" "$OFFER_FLAGS"; body="$2"; shift 2 ;;
      --body-file) forge_reject_flag_as_value "baton offer" --body-file "${2-}" "$OFFER_FLAGS"; body_file="$2"; shift 2 ;;
      --from-handoff) from_handoff="true"; shift ;;
      --for) forge_reject_flag_as_value "baton offer" --for "${2-}" "$OFFER_FLAGS"; for_arg="$2"; shift 2 ;;
      --max-lease) forge_reject_flag_as_value "baton offer" --max-lease "${2-}" "$OFFER_FLAGS"; max_lease_arg="$2"; shift 2 ;;
      --session) forge_reject_flag_as_value "baton offer" --session "${2-}" "$OFFER_FLAGS"; session_arg="$2"; shift 2 ;;
      *) _reject_unknown "baton offer" "$OFFER_FLAGS" "$1" ;;
    esac; done

    session="$(_baton_resolve_session "$session_arg")" || exit 1
    [ -n "$thread_id" ] || { echo "FAIL: --thread obrigatório" >&2; exit 1; }
    [ -n "$subject" ] || { echo "FAIL: --subject obrigatório" >&2; exit 1; }
    if [ -n "$body" ] && [ -n "$body_file" ]; then echo "FAIL: use --body OU --body-file, não os dois" >&2; exit 1; fi
    if [ "$from_handoff" = "true" ]; then
      if [ -n "$body" ] || [ -n "$body_file" ]; then
        echo "FAIL: --from-handoff é exclusivo de --body/--body-file" >&2; exit 1
      fi
      # REQ-14, design §2.10: usa o HANDOFF.md da worktree corrente — gerado na hora, pelo
      # mesmo handoff-gen.sh do /forge:handoff, se ainda não existir. A partir daqui o corpo
      # segue o MESMO caminho de --body-file (teto de 64 KB + varredura de segredo, abaixo):
      # nenhuma regra nova, só uma origem nova para body_file. Tudo isto corre ANTES de
      # qualquer gravação (appendOwn só acontece mais abaixo) — qualquer recusa aqui, inclusive
      # a geração falhando, não deixa rastro.
      handoff_path="$ROOT/.forge/HANDOFF.md"
      if [ ! -f "$handoff_path" ]; then
        if ! handoff_out="$(FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/handoff-gen.sh" 2>&1)"; then
          echo "FAIL: --from-handoff não conseguiu gerar o HANDOFF.md — $handoff_out" >&2
          exit 1
        fi
      fi
      body_file="$handoff_path"
    fi

    _scan_secret_or_fail "$body" "$body_file" || exit 1
    body_ref=""
    if [ -n "$body_file" ]; then
      body_ref="$(_write_body_blob "$ch_dir" "$body_file")" || exit 1
      body=""
    fi

    FORGE_YAML="$ROOT/.forge/forge.yaml"
    out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$thread_id" "$subject" "$body" "$body_ref" \
      "${for_arg:-}" "${max_lease_arg:-}" "$session" "$(_git_date)" "$FORGE_YAML" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, threadId, subject, body, bodyRef,
    forArg, maxLeaseArg, session, now, forgeYamlPath] = process.argv;
  const { appendOwn, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const { mergeLogs } = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  const { readBatonConfig } = await import(pathToFileURL(join(lib, 'liaison-baton.mjs')).href);
  function nowWall() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  try {
    const { msg } = await appendOwn({
      root, chDir, channel, self,
      build: (all) => {
        const threadMsgs = all.filter((m) => m.thread_id === threadId);
        if (!threadMsgs.some((m) => m.kind === 'thread-open')) {
          throw new Error(`thread '${threadId}' desconhecida localmente (abra ou aguarde o thread-open chegar)`);
        }
        const { threads } = mergeLogs(all);
        const participants = (threads[threadId] && threads[threadId].participants) || [self];
        let eligible;
        if (forArg) {
          const ids = forArg.split(',').map((s) => s.trim()).filter(Boolean);
          for (const id of ids) {
            if (!participants.includes(id)) {
              throw new Error(`--for cita '${id}', que não é participante da thread '${threadId}'`);
            }
          }
          eligible = [...new Set(ids)];
        } else {
          eligible = [...participants];
        }
        if (!eligible.some((id) => id !== self)) {
          throw new Error(`eligible resultante sem nenhum repositório além de '${self}' — coordenação só dentro do repositório não é material de liaison (ver rule liaison-protocol)`);
        }
        const cfg = readBatonConfig(forgeYamlPath);
        if (cfg.errors.length) throw new Error(cfg.errors.join('; '));
        let maxLease = cfg.maxLeaseSeconds;
        if (maxLeaseArg) {
          maxLease = Number(maxLeaseArg);
          if (!Number.isInteger(maxLease) || maxLease < 60 || maxLease > cfg.maxLeaseSeconds) {
            throw new Error(`--max-lease fora de [60, ${cfg.maxLeaseSeconds}]: ${maxLeaseArg}`);
          }
        }
        return {
          channel, thread_id: threadId, kind: 'note', requires_ack: false,
          in_reply_to: null, subject,
          ...(body ? { body } : {}), ...(bodyRef ? { body_ref: bodyRef } : {}),
          created_at: now, trust: 'self',
          baton: {
            op: 'offer', session, stamped_at: nowWall(),
            eligible, max_lease_seconds: maxLease, skew_tolerance_seconds: cfg.skewToleranceSeconds,
          },
        };
      },
    });
    process.stdout.write(msg.msg_id);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error(err.message);
    else console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
NODEEOF
)" || exit 1
    _render "$channel"
    echo "OK baton offer — $out"
    echo "liaison-ops.sh sync $channel"
    transport_line="$(_read_transport "$channel" 2>/dev/null || true)"
    if [ -n "$transport_line" ]; then
      echo "liaison-ops.sh notify $channel $out --to <destino>"
    fi
    ;;

  claim)
    channel="${1:-}"; shift || true
    baton_id="${1:-}"; shift || true
    [ -n "$channel" ] && [ -n "$baton_id" ] || { echo "FAIL: uso: baton claim <channel> <baton_id> [--lease <s>] [--session <id>]" >&2; exit 1; }
    ch_dir="$LIAISON_DIR/$channel"
    [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
    self="$(_read_self)"
    [ -n "$self" ] || { echo "FAIL: self não configurado (rode 'open' primeiro)" >&2; exit 1; }

    lease_arg=""; session_arg=""
    CLAIM_FLAGS="$(_baton_flags claim)"
    while [ $# -gt 0 ]; do case "$1" in
      --lease) forge_reject_flag_as_value "baton claim" --lease "${2-}" "$CLAIM_FLAGS"; lease_arg="$2"; shift 2 ;;
      --session) forge_reject_flag_as_value "baton claim" --session "${2-}" "$CLAIM_FLAGS"; session_arg="$2"; shift 2 ;;
      *) _reject_unknown "baton claim" "$CLAIM_FLAGS" "$1" ;;
    esac; done

    session="$(_baton_resolve_session "$session_arg")" || exit 1
    if [ -n "$lease_arg" ]; then
      printf '%s' "$lease_arg" | grep -Eq '^[0-9]+$' || { echo "FAIL: --lease precisa ser inteiro positivo: '$lease_arg'" >&2; exit 1; }
    fi

    FORGE_YAML="$ROOT/.forge/forge.yaml"
    PULLED_AT_FILE="$ROOT/.forge/cache/liaison-baton/$channel/sync-local.json"
    set +e
    claim_out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$baton_id" "$session" "${lease_arg:-}" \
      "$(_git_date)" "$FORGE_YAML" "$PULLED_AT_FILE" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
const { existsSync, readFileSync } = require('fs');
(async () => {
  const [, , lib, root, chDir, self, channel, batonId, session, leaseArg, now, forgeYamlPath, pulledAtPath] = process.argv;
  const { appendOwnDecided, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const { foldBatons, validateBaton, readBatonConfig, stability } = await import(pathToFileURL(join(lib, 'liaison-baton.mjs')).href);
  const { recordWon } = await import(pathToFileURL(join(lib, 'liaison-baton-local.mjs')).href);
  function nowWall() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  let reduced = false;
  let syncWarning = '';
  let wonLeaseSeconds = null;
  let wonLeaseUntil = null;
  try {
    const result = await appendOwnDecided({
      root, chDir, channel, self,
      decide: (all) => {
        const offerMsg = all.find((m) => m.msg_id === batonId && m.baton && m.baton.op === 'offer');
        if (!offerMsg) return { refuse: true, rc: 1, reason: `oferta '${batonId}' desconhecida localmente` };
        const cfg = readBatonConfig(forgeYamlPath);
        if (cfg.errors.length) return { refuse: true, rc: 1, reason: cfg.errors.join('; ') };
        let leaseSeconds;
        if (leaseArg) {
          leaseSeconds = Number(leaseArg);
          if (!Number.isInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > offerMsg.baton.max_lease_seconds) {
            return { refuse: true, rc: 1, reason: `--lease fora de [60, ${offerMsg.baton.max_lease_seconds}]: ${leaseArg}` };
          }
        } else {
          leaseSeconds = cfg.defaultLeaseSeconds;
          if (leaseSeconds > offerMsg.baton.max_lease_seconds) {
            leaseSeconds = offerMsg.baton.max_lease_seconds;
            reduced = true;
          }
        }
        const { batons } = foldBatons(all);
        const baton = batons.get(batonId);
        if (baton && baton.state === 'held' && baton.holder && baton.holder.sender === self && baton.holder.session === session) {
          const T = Date.parse(baton.leaseUntil);
          if (Date.now() <= T) {
            return { refuse: true, rc: 0, reason: `sessão já detém o bastão '${batonId}' (lease até ${baton.leaseUntil}) — use 'baton renew' para renovar`, already: true };
          }
        }
        if (baton && baton.state === 'held' && baton.holder && baton.holder.sender !== self) {
          const T = Date.parse(baton.leaseUntil);
          const skew = (offerMsg.baton.skew_tolerance_seconds || 0) * 1000;
          if (Date.now() >= T + skew) {
            let pulledAt = null;
            if (existsSync(pulledAtPath)) {
              try { pulledAt = JSON.parse(readFileSync(pulledAtPath, 'utf8')).pulled_at || null; } catch { /* sem registro */ }
            }
            if (!pulledAt || Date.parse(pulledAt) < T) {
              syncWarning = `aviso: uma renovação de '${baton.holder.sender}' pode estar publicada e ainda não importada — rode 'sync' antes de reivindicar por vencimento`;
            }
          }
        }
        const stampedAt = nowWall();
        const leaseUntil = new Date(Date.parse(stampedAt) + leaseSeconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
        const envelope = {
          channel, thread_id: offerMsg.thread_id, kind: 'note', requires_ack: false,
          in_reply_to: batonId, subject: `baton claim: ${offerMsg.subject}`.slice(0, 200),
          created_at: now, trust: 'self',
          baton: { op: 'claim', session, stamped_at: stampedAt, lease_seconds: leaseSeconds, lease_until: leaseUntil },
        };
        const verrs = validateBaton(envelope);
        if (verrs.length) return { refuse: true, rc: 1, reason: verrs.join('; ') };
        wonLeaseSeconds = leaseSeconds;
        wonLeaseUntil = leaseUntil;
        return { envelope, afterWrite: (allWithNew) => foldBatons(allWithNew) };
      },
    });
    if (result.refused) {
      if (result.already) {
        console.log(result.reason);
        process.exit(0);
      }
      console.error('FAIL: ' + result.reason);
      process.exit(typeof result.rc === 'number' ? result.rc : 1);
    }
    const { batons } = result.fold;
    const baton = batons.get(batonId);
    const hist = baton.history.find((h) => h.msgId === result.msg.msg_id);
    if (hist.verdict === 'won') {
      await recordWon({
        root, channel, chDir, self, batonId, msgId: result.msg.msg_id, session,
        leaseSeconds: wonLeaseSeconds, leaseUntil: wonLeaseUntil,
      });
      const stab = stability(baton, result.all);
      console.log(`OK baton claim — ${result.msg.msg_id} won (${stab.stable ? 'stable' : 'provisional'})`);
      if (!stab.stable) console.error(`provisional — faltam: ${stab.missing.join(', ')}`);
      if (reduced) console.error('aviso: lease reduzido ao máximo da oferta');
      if (syncWarning) console.error(syncWarning);
      process.exit(0);
    }
    const holderTxt = baton.holder ? `${baton.holder.sender}/${baton.holder.session}` : 'nenhuma';
    console.error(`FAIL: baton claim — veredito '${hist.verdict}', titular: ${holderTxt} (${hist.reason})`);
    process.exit(3);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('FAIL: envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error('FAIL: ' + err.message);
    else console.error('FAIL: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
})();
NODEEOF
)"
    claim_rc=$?
    set -e
    _render "$channel" >/dev/null 2>&1 || true
    echo "$claim_out"
    exit "$claim_rc"
    ;;

  renew)
    channel="${1:-}"; shift || true
    baton_id="${1:-}"; shift || true
    [ -n "$channel" ] && [ -n "$baton_id" ] || { echo "FAIL: uso: baton renew <channel> <baton_id> [--lease <s>] [--session <id>]" >&2; exit 1; }
    ch_dir="$LIAISON_DIR/$channel"
    [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
    self="$(_read_self)"
    [ -n "$self" ] || { echo "FAIL: self não configurado (rode 'open' primeiro)" >&2; exit 1; }

    lease_arg=""; session_arg=""
    RENEW_FLAGS="$(_baton_flags renew)"
    while [ $# -gt 0 ]; do case "$1" in
      --lease) forge_reject_flag_as_value "baton renew" --lease "${2-}" "$RENEW_FLAGS"; lease_arg="$2"; shift 2 ;;
      --session) forge_reject_flag_as_value "baton renew" --session "${2-}" "$RENEW_FLAGS"; session_arg="$2"; shift 2 ;;
      *) _reject_unknown "baton renew" "$RENEW_FLAGS" "$1" ;;
    esac; done
    session="$(_baton_resolve_session "$session_arg")" || exit 1
    if [ -n "$lease_arg" ]; then
      printf '%s' "$lease_arg" | grep -Eq '^[0-9]+$' || { echo "FAIL: --lease precisa ser inteiro positivo: '$lease_arg'" >&2; exit 1; }
    fi
    transport_line="$(_read_transport "$channel" 2>/dev/null || true)"

    set +e
    renew_out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$baton_id" "$session" "${lease_arg:-}" \
      "$(_git_date)" "${FORGE_BATON_RENEW_IF_DUE:-}" "${transport_line:+1}" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, batonId, session, leaseArg, now, ifDue, hasTransport] = process.argv;
  const { appendOwnDecided, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const { foldBatons, validateBaton } = await import(pathToFileURL(join(lib, 'liaison-baton.mjs')).href);
  const { recordWon } = await import(pathToFileURL(join(lib, 'liaison-baton-local.mjs')).href);
  const { mergeLogs } = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  function nowWall() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  let wonLeaseSeconds = null;
  let wonLeaseUntil = null;
  try {
    const result = await appendOwnDecided({
      root, chDir, channel, self,
      decide: (all) => {
        const offerMsg = all.find((m) => m.msg_id === batonId && m.baton && m.baton.op === 'offer');
        if (!offerMsg) return { refuse: true, rc: 1, reason: `oferta '${batonId}' desconhecida localmente` };
        const { batons } = foldBatons(all);
        const baton = batons.get(batonId);
        const isHolder = baton && baton.state === 'held' && baton.holder && baton.holder.sender === self && baton.holder.session === session;
        if (!isHolder) {
          const holderTxt = baton && baton.holder ? `${baton.holder.sender}/${baton.holder.session}` : 'nenhuma';
          return { refuse: true, rc: 4, reason: `não é a titular corrente (titular: ${holderTxt})` };
        }
        const T = Date.parse(baton.leaseUntil);
        if (Date.now() > T) {
          return { refuse: true, rc: 4, reason: `lease venceu em ${baton.leaseUntil} — a retomada é 'baton claim'` };
        }
        let leaseSeconds;
        if (leaseArg) {
          leaseSeconds = Number(leaseArg);
          if (!Number.isInteger(leaseSeconds) || leaseSeconds < 60 || leaseSeconds > offerMsg.baton.max_lease_seconds) {
            return { refuse: true, rc: 1, reason: `--lease fora de [60, ${offerMsg.baton.max_lease_seconds}]: ${leaseArg}` };
          }
        } else {
          leaseSeconds = baton.leaseSeconds;
        }
        if (ifDue === '1') {
          const half = T - (baton.leaseSeconds * 1000) / 2;
          if (Date.now() < half) {
            return { refuse: true, rc: 5, reason: `ainda não é hora de renovar (metade do prazo em ${new Date(half).toISOString().replace(/\.\d+Z$/, 'Z')})` };
          }
        }
        const stampedAt = nowWall();
        const leaseUntil = new Date(Date.parse(stampedAt) + leaseSeconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
        const envelope = {
          channel, thread_id: offerMsg.thread_id, kind: 'note', requires_ack: false,
          in_reply_to: batonId, subject: `baton renew: ${offerMsg.subject}`.slice(0, 200),
          created_at: now, trust: 'self',
          baton: { op: 'renew', session, stamped_at: stampedAt, lease_seconds: leaseSeconds, lease_until: leaseUntil },
        };
        const verrs = validateBaton(envelope);
        if (verrs.length) return { refuse: true, rc: 1, reason: verrs.join('; ') };
        wonLeaseSeconds = leaseSeconds;
        wonLeaseUntil = leaseUntil;
        return { envelope, afterWrite: (allWithNew) => ({ fold: foldBatons(allWithNew), threads: mergeLogs(allWithNew).threads }) };
      },
    });
    if (result.refused) {
      console.error('FAIL: ' + result.reason);
      process.exit(typeof result.rc === 'number' ? result.rc : 1);
    }
    // LGC-002: a claim registrada é a C da dobra (a renovação não muda C), nunca o msg_id da
    // própria renovação — senão a perda tardia acusaria a sessão de ter perdido para si mesma.
    const renewedBaton = result.fold.fold.batons.get(batonId);
    await recordWon({
      root, channel, chDir, self, batonId, msgId: (renewedBaton && renewedBaton.holderClaimMsgId) || result.msg.msg_id, session,
      leaseSeconds: wonLeaseSeconds, leaseUntil: wonLeaseUntil,
    });
    const offerMsgAfter = result.all.find((m) => m.msg_id === batonId);
    const thread = result.fold.threads[offerMsgAfter.thread_id];
    const externalParticipant = thread && thread.participants.some((p) => p !== self);
    console.log(`OK baton renew — ${result.msg.msg_id} novo lease_until ${wonLeaseUntil}`);
    if (externalParticipant && hasTransport === '1') {
      console.log(`liaison-ops.sh sync ${channel} --push-only`);
      console.error('sem publicar, outro repositório pode considerar o lease vencido');
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('FAIL: envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error('FAIL: ' + err.message);
    else console.error('FAIL: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
})();
NODEEOF
)"
    renew_rc=$?
    set -e
    _render "$channel" >/dev/null 2>&1 || true
    echo "$renew_out"
    exit "$renew_rc"
    ;;

  release|complete)
    baton_op="$baton_verb"
    channel="${1:-}"; shift || true
    baton_id="${1:-}"; shift || true
    [ -n "$channel" ] && [ -n "$baton_id" ] || { echo "FAIL: uso: baton $baton_op <channel> <baton_id> [--session <id>] [--body <txt>|--body-file <path>]" >&2; exit 1; }
    ch_dir="$LIAISON_DIR/$channel"
    [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
    self="$(_read_self)"
    [ -n "$self" ] || { echo "FAIL: self não configurado (rode 'open' primeiro)" >&2; exit 1; }

    session_arg=""; body=""; body_file=""
    VERB_FLAGS="$(_baton_flags "$baton_op")"
    while [ $# -gt 0 ]; do case "$1" in
      --session) forge_reject_flag_as_value "baton $baton_op" --session "${2-}" "$VERB_FLAGS"; session_arg="$2"; shift 2 ;;
      --body) forge_reject_flag_as_value "baton $baton_op" --body "${2-}" "$VERB_FLAGS"; body="$2"; shift 2 ;;
      --body-file) forge_reject_flag_as_value "baton $baton_op" --body-file "${2-}" "$VERB_FLAGS"; body_file="$2"; shift 2 ;;
      *) _reject_unknown "baton $baton_op" "$VERB_FLAGS" "$1" ;;
    esac; done
    session="$(_baton_resolve_session "$session_arg")" || exit 1
    if [ -n "$body" ] && [ -n "$body_file" ]; then echo "FAIL: use --body OU --body-file, não os dois" >&2; exit 1; fi
    _scan_secret_or_fail "$body" "$body_file" || exit 1
    body_ref=""
    if [ -n "$body_file" ]; then
      body_ref="$(_write_body_blob "$ch_dir" "$body_file")" || exit 1
      body=""
    fi

    set +e
    rc_out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$baton_id" "$session" "$baton_op" "$body" "$body_ref" "$(_git_date)" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, batonId, session, op, body, bodyRef, now] = process.argv;
  const { appendOwnDecided, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const { foldBatons, validateBaton } = await import(pathToFileURL(join(lib, 'liaison-baton.mjs')).href);
  const { removeHolder } = await import(pathToFileURL(join(lib, 'liaison-baton-local.mjs')).href);
  function nowWall() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  try {
    const result = await appendOwnDecided({
      root, chDir, channel, self,
      decide: (all) => {
        const offerMsg = all.find((m) => m.msg_id === batonId && m.baton && m.baton.op === 'offer');
        if (!offerMsg) return { refuse: true, rc: 1, reason: `oferta '${batonId}' desconhecida localmente` };
        const { batons } = foldBatons(all);
        const baton = batons.get(batonId);
        const isHolder = baton && baton.state === 'held' && baton.holder && baton.holder.sender === self && baton.holder.session === session;
        if (!isHolder) {
          const holderTxt = baton && baton.holder ? `${baton.holder.sender}/${baton.holder.session}` : 'nenhuma';
          return { refuse: true, rc: 1, reason: `não é a titular corrente (titular: ${holderTxt})` };
        }
        const envelope = {
          channel, thread_id: offerMsg.thread_id, kind: 'note', requires_ack: false,
          in_reply_to: batonId, subject: `baton ${op}: ${offerMsg.subject}`.slice(0, 200),
          ...(body ? { body } : {}), ...(bodyRef ? { body_ref: bodyRef } : {}),
          created_at: now, trust: 'self',
          baton: { op, session, stamped_at: nowWall() },
        };
        const verrs = validateBaton(envelope);
        if (verrs.length) return { refuse: true, rc: 1, reason: verrs.join('; ') };
        return { envelope, afterWrite: (allWithNew) => foldBatons(allWithNew) };
      },
    });
    if (result.refused) {
      console.error('FAIL: ' + result.reason);
      process.exit(typeof result.rc === 'number' ? result.rc : 1);
    }
    await removeHolder({ root, channel, self, batonId, dropClaim: true });
    console.log(`OK baton ${op} — ${result.msg.msg_id}`);
    process.exit(0);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('FAIL: envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error('FAIL: ' + err.message);
    else console.error('FAIL: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
})();
NODEEOF
)"
    rc_rc=$?
    set -e
    _render "$channel" >/dev/null 2>&1 || true
    echo "$rc_out"
    exit "$rc_rc"
    ;;

  withdraw)
    channel="${1:-}"; shift || true
    baton_id="${1:-}"; shift || true
    [ -n "$channel" ] && [ -n "$baton_id" ] || { echo "FAIL: uso: baton withdraw <channel> <baton_id> [--session <id>] [--body <txt>|--body-file <path>]" >&2; exit 1; }
    ch_dir="$LIAISON_DIR/$channel"
    [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
    self="$(_read_self)"
    [ -n "$self" ] || { echo "FAIL: self não configurado (rode 'open' primeiro)" >&2; exit 1; }

    session_arg=""; body=""; body_file=""
    WITHDRAW_FLAGS="$(_baton_flags withdraw)"
    while [ $# -gt 0 ]; do case "$1" in
      --session) forge_reject_flag_as_value "baton withdraw" --session "${2-}" "$WITHDRAW_FLAGS"; session_arg="$2"; shift 2 ;;
      --body) forge_reject_flag_as_value "baton withdraw" --body "${2-}" "$WITHDRAW_FLAGS"; body="$2"; shift 2 ;;
      --body-file) forge_reject_flag_as_value "baton withdraw" --body-file "${2-}" "$WITHDRAW_FLAGS"; body_file="$2"; shift 2 ;;
      *) _reject_unknown "baton withdraw" "$WITHDRAW_FLAGS" "$1" ;;
    esac; done
    session="$(_baton_resolve_session "$session_arg")" || exit 1
    if [ -n "$body" ] && [ -n "$body_file" ]; then echo "FAIL: use --body OU --body-file, não os dois" >&2; exit 1; fi
    _scan_secret_or_fail "$body" "$body_file" || exit 1
    body_ref=""
    if [ -n "$body_file" ]; then
      body_ref="$(_write_body_blob "$ch_dir" "$body_file")" || exit 1
      body=""
    fi

    set +e
    wd_out="$(node - "$LIBDIR" "$ROOT" "$ch_dir" "$self" "$channel" "$baton_id" "$session" "$body" "$body_ref" "$(_git_date)" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, self, channel, batonId, session, body, bodyRef, now] = process.argv;
  const { appendOwnDecided, AppendValidationError, LockLostError } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const { foldBatons, validateBaton } = await import(pathToFileURL(join(lib, 'liaison-baton.mjs')).href);
  const { removeHolder } = await import(pathToFileURL(join(lib, 'liaison-baton-local.mjs')).href);
  function nowWall() { return new Date().toISOString().replace(/\.\d+Z$/, 'Z'); }
  try {
    const result = await appendOwnDecided({
      root, chDir, channel, self,
      decide: (all) => {
        const offerMsg = all.find((m) => m.msg_id === batonId && m.baton && m.baton.op === 'offer');
        if (!offerMsg) return { refuse: true, rc: 1, reason: `oferta '${batonId}' desconhecida localmente` };
        if (self !== offerMsg.sender) {
          return { refuse: true, rc: 1, reason: `apenas o ofertante '${offerMsg.sender}' pode retirar` };
        }
        const { batons } = foldBatons(all);
        const baton = batons.get(batonId);
        if (baton.state === 'completed' || baton.state === 'withdrawn') {
          return { refuse: true, rc: 1, reason: `bastão já ${baton.state}` };
        }
        const skew = (offerMsg.baton.skew_tolerance_seconds || 0) * 1000;
        const T = baton.leaseUntil ? Date.parse(baton.leaseUntil) : null;
        const expiredEnough = baton.state === 'available' || (baton.state === 'held' && T !== null && Date.now() >= T + skew);
        if (!expiredEnough) {
          const holderTxt = baton.holder ? `${baton.holder.sender}/${baton.holder.session}` : 'nenhuma';
          return { refuse: true, rc: 1, reason: `titular corrente (${holderTxt}) ainda dentro do lease ou da folga (lease_until ${baton.leaseUntil})` };
        }
        const envelope = {
          channel, thread_id: offerMsg.thread_id, kind: 'note', requires_ack: false,
          in_reply_to: batonId, subject: `baton withdraw: ${offerMsg.subject}`.slice(0, 200),
          ...(body ? { body } : {}), ...(bodyRef ? { body_ref: bodyRef } : {}),
          created_at: now, trust: 'self',
          baton: { op: 'withdraw', session, stamped_at: nowWall() },
        };
        const verrs = validateBaton(envelope);
        if (verrs.length) return { refuse: true, rc: 1, reason: verrs.join('; ') };
        return { envelope, afterWrite: (allWithNew) => foldBatons(allWithNew) };
      },
    });
    if (result.refused) {
      console.error('FAIL: ' + result.reason);
      process.exit(typeof result.rc === 'number' ? result.rc : 1);
    }
    await removeHolder({ root, channel, self, batonId, dropClaim: true });
    console.log(`OK baton withdraw — ${result.msg.msg_id}`);
    process.exit(0);
  } catch (err) {
    if (err instanceof AppendValidationError) console.error('FAIL: envelope inválido: ' + err.errors.join('; '));
    else if (err instanceof LockLostError) console.error('FAIL: ' + err.message);
    else console.error('FAIL: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
})();
NODEEOF
)"
    wd_rc=$?
    set -e
    _render "$channel" >/dev/null 2>&1 || true
    echo "$wd_out"
    exit "$wd_rc"
    ;;

  status|list)
    channel="${1:-}"; shift || true
    baton_id_filter=""
    json_flag="false"
    QL_FLAGS="$(_baton_flags "$baton_verb")"
    # status aceita <baton_id> opcional como argumento posicional (não é flag).
    if [ "$baton_verb" = "status" ] && [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
      baton_id_filter="$1"; shift
    fi
    while [ $# -gt 0 ]; do case "$1" in
      --json) json_flag="true"; shift ;;
      *) _reject_unknown "baton $baton_verb" "$QL_FLAGS" "$1" ;;
    esac; done
    [ -n "$channel" ] || { echo "FAIL: <channel> obrigatório" >&2; exit 1; }
    ch_dir="$LIAISON_DIR/$channel"
    [ -d "$ch_dir/log" ] || { echo "FAIL: canal '$channel' não inicializado (rode 'open' primeiro)" >&2; exit 1; }
    self="$(_read_self)"
    now_wall="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    node - "$LIBDIR" "$ROOT" "$ch_dir" "$channel" "$self" "$baton_verb" "$baton_id_filter" "$([ "$json_flag" = "true" ] && echo 1 || echo 0)" "$now_wall" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, chDir, channel, self, mode, batonIdFilter, jsonFlag, nowWall] = process.argv;
  const { foldBatons, stability, isWallClock } = await import(pathToFileURL(join(lib, 'liaison-baton.mjs')).href);
  const { renderUntrusted } = await import(pathToFileURL(join(lib, 'untrusted-render.mjs')).href);
  const { checkJournalIntegrity } = await import(pathToFileURL(join(lib, 'liaison-append.mjs')).href);
  const { readBatonLocal } = await import(pathToFileURL(join(lib, 'liaison-baton-local.mjs')).href);

  const logDir = join(chDir, 'log');
  const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
  const all = [];
  for (const f of files) {
    const text = readFileSync(join(logDir, f), 'utf8');
    for (const line of text.split('\n')) { const t = line.trim(); if (t) all.push(JSON.parse(t)); }
  }
  const { batons } = foldBatons(all);
  const nowMs = Date.parse(nowWall);

  function describe(batonId, b) {
    const stab = b.state === 'held' ? stability(b, all) : null;
    const expired = b.state === 'held' && b.leaseUntil ? nowMs > Date.parse(b.leaseUntil) : false;
    const subjectText = b.offer.subject || '';
    const subjectOut = b.offer.sender !== self ? renderUntrusted(subjectText, b.offer.sender) : subjectText;
    return {
      baton_id: batonId,
      state: b.state,
      subject: subjectOut,
      offerer: b.offer.sender,
      eligible: b.offer.baton.eligible || [],
      holder: b.holder,
      lease_until: b.leaseUntil,
      lease_seconds: b.leaseSeconds,
      expired,
      stable: stab ? stab.stable : null,
      missing: stab ? stab.missing : [],
      history: b.history.map((h) => ({
        msg_id: h.msgId, sender: h.sender,
        session: h.sender !== self ? renderUntrusted(String(h.session), h.sender) : h.session,
        // NODE-003: stamped_at vem do peer — só sai (texto e --json) com a forma de relógio de
        // parede; fora dela vai null (o texto mostra '?'). O reason sai cru, então a dobra só
        // interpola nele valor de peer já conferido contra padrão fechado: validateBaton só nomeia
        // o campo, e thread_id/in_reply_to passam por `reasonId` em liaison-baton.mjs (fora do
        // padrão de id, vira '?' — NODE-202/SEC-202).
        op: h.op, stamped_at: isWallClock(h.stampedAt) ? h.stampedAt : null, verdict: h.verdict, reason: h.reason,
      })),
    };
  }

  let ids = [...batons.keys()];
  if (mode === 'list') ids = ids.filter((id) => { const st = batons.get(id).state; return st !== 'completed' && st !== 'withdrawn'; });
  if (batonIdFilter) {
    if (!batons.has(batonIdFilter)) {
      console.error(`FAIL: bastão '${batonIdFilter}' desconhecido localmente`);
      process.exit(1);
    }
    ids = ids.filter((id) => id === batonIdFilter);
  }
  ids.sort();
  const descs = ids.map((id) => describe(id, batons.get(id)));

  // Perda tardia (REQ-05): claim PRÓPRIA com rc 0 cujo msg_id já não é a titular corrente —
  // venceu localmente e perdeu depois de importar mais réplicas.
  const local = readBatonLocal(root, channel);
  const lateLosses = [];
  if (self) {
    for (const [batonId, claim] of Object.entries(local.claims || {})) {
      const b = batons.get(batonId);
      if (!b) continue;
      if (b.holder && b.holderClaimMsgId === claim.msgId) continue;
      // LGC-002: a própria sessão ainda é a titular (cache gravado por versão anterior, em que o
      // renew sobrescrevia o msgId da claim com o da renovação) — não é perda.
      if (b.holder && b.holder.sender === self && b.holder.session === claim.session) continue;
      // LGC-002: a mesma sessão liberou, concluiu ou retirou DEPOIS da claim registrada — abriu
      // mão por ato próprio (design §2.5), não perdeu.
      const claimIdx = b.history.findIndex((h) => h.msgId === claim.msgId);
      const ownExit = b.history.some((h, i) => i > claimIdx && h.sender === self && h.session === claim.session
        && (h.verdict === 'released' || h.verdict === 'completed' || h.verdict === 'withdrawn'));
      if (claimIdx >= 0 && ownExit) continue;
      const winnerTxt = b.holder ? `${b.holder.sender}/${b.holder.session}` : 'nenhuma';
      lateLosses.push({ baton_id: batonId, our_msg_id: claim.msgId, winner: winnerTxt });
    }
  }

  // Carimbo no futuro (REQ-06): stamped_at de uma mensagem de bastão mais de
  // skew_tolerance_seconds (da oferta dela) à frente do relógio de quem lê. Nunca no CHANNEL.md
  // (que não pode depender do relógio de quem gera) — só aqui.
  const futureStamps = [];
  for (const [batonId, b] of batons) {
    const skewMs = (b.offer.baton.skew_tolerance_seconds || 0) * 1000;
    for (const h of b.history) {
      // NODE-003: só carimbo com forma de relógio de parede — Date.parse aceita texto arbitrário.
      if (!isWallClock(h.stampedAt)) continue;
      const diff = Date.parse(h.stampedAt) - nowMs;
      if (Number.isFinite(diff) && diff > skewMs) futureStamps.push({ baton_id: batonId, msg_id: h.msgId, stamped_at: h.stampedAt });
    }
  }

  // Escritor de versão antiga (design S2.4): mesma checagem do status geral do canal, mas
  // nomeando o bastão quando a mensagem reescrita é a claim vencedora de algum bastão.
  const rewritten = self ? checkJournalIntegrity({ root, channel, chDir, self }) : [];
  const rewrittenOut = rewritten.map((r) => {
    const affected = [...batons.entries()].find(([, b]) => b.holderClaimMsgId === r.msg_id);
    return { msg_id: r.msg_id, baton_id: affected ? affected[0] : null };
  });

  if (jsonFlag === '1') {
    console.log(JSON.stringify({ channel, self, mode, batons: descs, late_losses: lateLosses, future_stamps: futureStamps, rewritten: rewrittenOut }, null, 2));
    return;
  }

  if (!descs.length) {
    console.log(mode === 'list' ? '(nenhum bastão não terminal)' : '(nenhum bastão)');
  }
  for (const d of descs) {
    const holderTxt = d.holder ? `${d.holder.sender}/${d.holder.session}` : 'nenhuma';
    const stabTxt = d.stable === null ? '' : d.stable ? ' · stable' : ` · provisional (faltam: ${d.missing.join(', ')})`;
    const expTxt = d.expired ? ' · expired' : '';
    console.log(`bastão ${d.baton_id} — ${d.state}${expTxt}${stabTxt}`);
    console.log('  assunto:');
    for (const line of String(d.subject).split('\n')) console.log(`    ${line}`);
    console.log(`  titular: ${holderTxt}${d.lease_until ? ` (lease até ${d.lease_until})` : ''}`);
    if (mode === 'status') {
      console.log('  histórico:');
      for (const h of d.history) {
        console.log(`    ${h.msg_id} ${h.sender} ${h.op} ${h.stamped_at || '?'} -> ${h.verdict}${h.reason ? ` (${h.reason})` : ''}`);
        if (String(h.session).includes('\n')) for (const l of String(h.session).split('\n')) console.log(`      ${l}`);
      }
    }
  }
  for (const l of lateLosses) console.log(`! perda tardia: ${l.baton_id} (nossa claim ${l.our_msg_id}), titular agora: ${l.winner}`);
  for (const f of futureStamps) console.log(`! carimbo de bastão no futuro: ${f.msg_id} (${f.stamped_at})`);
  for (const r of rewrittenOut) console.log(`! log próprio reescrito por escritor sem trava: ${r.msg_id}${r.baton_id ? ` (bastão ${r.baton_id})` : ''}`);
})();
NODEEOF
    ;;

  "")
    echo "FAIL: uso: baton offer|claim|renew|release|complete|withdraw|status|list ..." >&2
    exit 1
    ;;

  *)
    echo "FAIL: verbo de bastão desconhecido '$baton_verb' (offer|claim|renew|release|complete|withdraw|status|list)" >&2
    exit 1
    ;;
  esac
  ;;

# ---------------------------------------------------------------------------------------------
# native — diagnóstico de cobertura (REQ-08, design §2.6) e declaração de descarte. Estado local
# NÃO VERSIONADO em <git-common-dir>/forge-native/ (dispositions.jsonl + reports/<session-id>.json)
# — fora da árvore de trabalho, compartilhado por todas as worktrees do repositório.
native)
  native_sub="${1:-}"; shift || true
  case "$native_sub" in

  check)
    native_session=""; native_transcript=""; native_report="false"; native_pending="false"
    NATIVE_CHECK_FLAGS="--session, --transcript, --report, --pending"
    while [ $# -gt 0 ]; do case "$1" in
      --session) forge_reject_flag_as_value "native check" --session "${2-}" "$NATIVE_CHECK_FLAGS"; native_session="$2"; shift 2 ;;
      --transcript) forge_reject_flag_as_value "native check" --transcript "${2-}" "$NATIVE_CHECK_FLAGS"; native_transcript="$2"; shift 2 ;;
      --report) native_report="true"; shift ;;
      --pending) native_pending="true"; shift ;;
      *) _reject_unknown "native check" "$NATIVE_CHECK_FLAGS" "$1" ;;
    esac; done

    native_state_dir="$(_native_state_dir)" || exit 1
    mkdir -p "$native_state_dir/reports"

    if [ "$native_pending" = "true" ]; then
      node - "$LIBDIR" "$native_state_dir" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync, writeFileSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, stateDir] = process.argv;
  const R = await import(pathToFileURL(join(lib, 'untrusted-render.mjs')).href);
  const reportsDir = join(stateDir, 'reports');
  const files = existsSync(reportsDir) ? readdirSync(reportsDir).filter((f) => f.endsWith('.json')) : [];
  const reports = [];
  for (const f of files) {
    const full = join(reportsDir, f);
    let r;
    try { r = JSON.parse(readFileSync(full, 'utf8')); } catch { continue; }
    if (r.delivered === true) continue;
    reports.push({ file: full, data: r });
  }
  if (!reports.length) { console.log('native check --pending: nenhum relatório pendente'); return; }
  reports.sort((a, b) => String(b.data.generatedAt || '').localeCompare(String(a.data.generatedAt || '')));
  const shown = reports.slice(0, 5);
  const rest = reports.length - shown.length;
  for (const r of shown) {
    const d = r.data;
    const shortId = String(d.sessionId || '?').slice(0, 8);
    const date = String(d.generatedAt || '?').slice(0, 10);
    if (d.brokenInstrument) {
      console.log(`${date} · sessão ${shortId} · instrumento quebrado — native check --session ${d.sessionId}`);
    } else {
      const c = d.counts || {};
      console.log(`${date} · sessão ${shortId} · ${c.pending || 0} pendente(s), ${c.otherWorkspace || 0} de outro workspace, ${c.unknownWorkspace || 0} de workspace desconhecido — native check --session ${d.sessionId}`);
    }
  }
  if (rest > 0) console.log(`+${rest} relatório(s)`);
  // Entrega única (REQ-08): todo relatório visto aqui (os exibidos individualmente e os só
  // contados em "+N") é marcado entregue — a próxima chamada de --pending não o repete.
  for (const r of reports) {
    r.data.delivered = true;
    writeFileSync(r.file, JSON.stringify(r.data));
  }
})();
NODEEOF
      exit 0
    fi

    node - "$LIBDIR" "$ROOT" "$native_state_dir" "${native_session:-}" "${native_transcript:-}" "$native_report" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync, writeFileSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, stateDir, sessionArg, transcriptArg, reportMode, nowWall] = process.argv;
  const Transcript = await import(pathToFileURL(join(lib, 'native-transcript.mjs')).href);
  const Registry = await import(pathToFileURL(join(lib, 'native-registry.mjs')).href);
  const Workspace = await import(pathToFileURL(join(lib, 'native-workspace.mjs')).href);
  const R = await import(pathToFileURL(join(lib, 'untrusted-render.mjs')).href);

  const sessionId = sessionArg || process.env.CLAUDE_CODE_SESSION_ID || '';
  // Único caso de rc != 0 (REQ-08): sessão não identificável — nem --transcript, nem --session,
  // nem CLAUDE_CODE_SESSION_ID.
  if (!transcriptArg && !sessionId) {
    console.error('FAIL: sessão não identificável — informe --session <id>, --transcript <path> ou exporte CLAUDE_CODE_SESSION_ID');
    process.exit(1);
  }

  function persist(data) {
    if (reportMode !== 'true') return;
    const reportsDir = join(stateDir, 'reports');
    const name = (sessionId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_');
    writeFileSync(join(reportsDir, `${name}.json`), JSON.stringify({
      sessionId: sessionId || null, generatedAt: nowWall, delivered: false, ...data,
    }));
  }

  const read = Transcript.readTranscript({ sessionId: sessionId || undefined, transcriptPath: transcriptArg || undefined });
  if (!read.ok) {
    // Diagnóstico é AVISO (REQ-08): nunca bloqueia o fim nem o início de sessão — "instrumento
    // quebrado" ou leitura impossível sai com rc 0, nunca "nada pendente".
    console.log(`native check: ${read.reason}`);
    persist({ brokenInstrument: true, reason: read.reason, counts: { total: 0, pending: 0, otherWorkspace: 0, unknownWorkspace: 0 } });
    return;
  }

  // Destinação (design §2.6): registro no liaison com cross_session.native_ref igual ao
  // fingerprint EM QUALQUER CANAL DO TRONCO, ou declaração via `native dispose`.
  const liaisonDir = join(root, '.forge', 'liaison');
  const registeredRefs = new Set();
  if (existsSync(liaisonDir)) {
    for (const ch of readdirSync(liaisonDir, { withFileTypes: true })) {
      if (!ch.isDirectory()) continue;
      const logDir = join(liaisonDir, ch.name, 'log');
      if (!existsSync(logDir)) continue;
      for (const f of readdirSync(logDir).filter((x) => x.endsWith('.jsonl'))) {
        const text = readFileSync(join(logDir, f), 'utf8');
        for (const line of text.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          let m;
          try { m = JSON.parse(t); } catch { continue; }
          if (m && m.cross_session && m.cross_session.native_ref) registeredRefs.add(m.cross_session.native_ref);
        }
      }
    }
  }
  const dispositionsFile = join(stateDir, 'dispositions.jsonl');
  const disposedRefs = new Set();
  if (existsSync(dispositionsFile)) {
    for (const line of readFileSync(dispositionsFile, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let d;
      try { d = JSON.parse(t); } catch { continue; }
      if (d && d.fingerprint) disposedRefs.add(d.fingerprint);
    }
  }

  // Workspace do remetente (design §2.6): resolvido pelo socket de `from` e por verifiedPeerPid
  // no registro — NUNCA "mesmo workspace" por omissão (registro ausente -> desconhecido).
  const selfRoot = Workspace.mainRepoRoot(root) || root;
  const selfWorkspace = Workspace.workspaceIdentity(selfRoot);
  const items = [];
  let otherWorkspace = 0;
  let unknownWorkspace = 0;
  let pendingCount = 0;
  for (const rec of read.receptions) {
    const destined = registeredRefs.has(rec.fingerprint) || disposedRefs.has(rec.fingerprint);
    const sockFile = rec.from.startsWith('uds:') ? rec.from.slice(4) : rec.from;
    const bySocket = Registry.resolveBySocket({ sockFile });
    let entry = bySocket.ok ? bySocket.entry : null;
    if (entry && typeof rec.verifiedPeerPid === 'number' && entry.pid !== rec.verifiedPeerPid) entry = null;
    let workspace = 'unknown';
    if (entry) {
      const senderRoot = Workspace.mainRepoRoot(entry.cwd);
      const senderWorkspace = senderRoot ? Workspace.workspaceIdentity(senderRoot) : null;
      workspace = senderWorkspace && senderWorkspace === selfWorkspace ? 'same' : 'other';
    }
    if (workspace === 'other') otherWorkspace += 1;
    if (workspace === 'unknown') unknownWorkspace += 1;
    if (!destined) {
      pendingCount += 1;
      items.push({ fingerprint: rec.fingerprint, fromName: rec.fromName, workspace });
    }
  }

  const wsLabel = (w) => (w === 'other' ? 'outro workspace' : w === 'unknown' ? 'workspace desconhecido' : 'mesmo workspace');
  console.log(`native check — ${read.receptions.length} recepção(ões), ${pendingCount} pendente(s), ${otherWorkspace} de outro workspace, ${unknownWorkspace} de workspace desconhecido`);
  const body = items.length
    ? items.map((it) => `${it.fingerprint} — ${it.fromName} (${wsLabel(it.workspace)})`).join('\n')
    : '(nenhuma recepção pendente)';
  // from-name é autodeclarado e texto de peer — passa por untrusted-render (moldura e
  // neutralização), nunca cru (REQ-08, rule conventions/liaison-untrusted-input.md).
  for (const line of R.renderUntrusted(body, 'peer').split('\n')) console.log(line);

  persist({
    brokenInstrument: false,
    counts: { total: read.receptions.length, pending: pendingCount, otherWorkspace, unknownWorkspace },
    pending: items,
  });
})();
NODEEOF
    ;;

  dispose)
    native_fp="${1:-}"; shift || true
    native_ephemeral=""
    NATIVE_DISPOSE_FLAGS="--ephemeral"
    while [ $# -gt 0 ]; do case "$1" in
      --ephemeral) forge_reject_flag_as_value "native dispose" --ephemeral "${2-}" "$NATIVE_DISPOSE_FLAGS"; native_ephemeral="$2"; shift 2 ;;
      *) _reject_unknown "native dispose" "$NATIVE_DISPOSE_FLAGS" "$1" ;;
    esac; done
    [ -n "$native_fp" ] || { echo "FAIL: uso: native dispose <fingerprint> --ephemeral <class>" >&2; exit 1; }
    printf '%s' "$native_fp" | grep -Eq '^[0-9a-f]{64}$' || { echo "FAIL: fingerprint fora do padrão sha256 hex: '$native_fp'" >&2; exit 1; }
    [ -n "$native_ephemeral" ] || { echo "FAIL: --ephemeral <class> obrigatório" >&2; exit 1; }

    native_state_dir="$(_native_state_dir)" || exit 1
    mkdir -p "$native_state_dir"
    node - "$LIBDIR" "$native_state_dir" "$native_fp" "$native_ephemeral" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" <<'NODEEOF'
const { appendFileSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, stateDir, fingerprint, ephemeralClass, nowWall] = process.argv;
  const Classes = await import(pathToFileURL(join(lib, 'native-classes.mjs')).href);
  if (!Classes.EPHEMERAL_CLASSES.includes(ephemeralClass)) {
    console.error(`FAIL: classe efêmera inválida '${ephemeralClass}' (use: ${Classes.EPHEMERAL_CLASSES.join('|')})`);
    process.exit(1);
  }
  appendFileSync(join(stateDir, 'dispositions.jsonl'), JSON.stringify({ fingerprint, class: ephemeralClass, at: nowWall }) + '\n');
})();
NODEEOF
    echo "OK native dispose — $native_fp declarado $native_ephemeral"
    ;;

  # ---------------------------------------------------------------------------------------------
  # native allow|revoke|pin — cadastro de workspaces permitidos (REQ-12, design §2.7). Recusam
  # com rc 1, SEM tocar o arquivo, quando a flag é desconhecida (checagem independente de sessão,
  # dentro do parsing) ou quando `_native_operator_guard` detecta sessão de agente — SEMPRE depois
  # do parsing e ANTES de qualquer leitura/escrita do cadastro. A lógica de escrita mora em
  # lib/native-allowlist.mjs; este bloco só valida flags, resolve `granted_by`/`revoked_by` (git
  # config user.email) e repassa.
  allow)
    native_id="${1:-}"; shift || true
    native_reason=""
    NATIVE_ALLOW_FLAGS="--reason"
    while [ $# -gt 0 ]; do case "$1" in
      --reason) forge_reject_flag_as_value "native allow" --reason "${2-}" "$NATIVE_ALLOW_FLAGS"; native_reason="$2"; shift 2 ;;
      *) _reject_unknown "native allow" "$NATIVE_ALLOW_FLAGS" "$1" ;;
    esac; done
    _native_operator_guard || exit 1
    [ -n "$native_id" ] || { echo "FAIL: uso: native allow <identidade> --reason \"<motivo>\"" >&2; exit 1; }
    [ -n "$native_reason" ] || { echo "FAIL: '--reason' obrigatório no subcomando 'native allow'" >&2; exit 1; }
    native_granted_by="$(git -C "$ROOT" config user.email 2>/dev/null || true)"
    [ -n "$native_granted_by" ] || { echo "FAIL: git config user.email não configurado em '$ROOT' — obrigatório para granted_by" >&2; exit 1; }
    node - "$LIBDIR" "$ROOT" "$native_id" "$native_reason" "$native_granted_by" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, id, reason, grantedBy, now] = process.argv;
  const A = await import(pathToFileURL(join(lib, 'native-allowlist.mjs')).href);
  const r = A.allow({ root, id, reason, grantedBy, now });
  if (!r.ok) { console.error(`FAIL: ${r.error}`); process.exit(1); }
  console.log(`OK native allow — ${id} cadastrado (${r.reminder})`);
})();
NODEEOF
    ;;

  revoke)
    native_id="${1:-}"; shift || true
    native_reason=""
    NATIVE_REVOKE_FLAGS="--reason"
    while [ $# -gt 0 ]; do case "$1" in
      --reason) forge_reject_flag_as_value "native revoke" --reason "${2-}" "$NATIVE_REVOKE_FLAGS"; native_reason="$2"; shift 2 ;;
      *) _reject_unknown "native revoke" "$NATIVE_REVOKE_FLAGS" "$1" ;;
    esac; done
    _native_operator_guard || exit 1
    [ -n "$native_id" ] || { echo "FAIL: uso: native revoke <identidade> --reason \"<motivo>\"" >&2; exit 1; }
    [ -n "$native_reason" ] || { echo "FAIL: '--reason' obrigatório no subcomando 'native revoke'" >&2; exit 1; }
    native_revoked_by="$(git -C "$ROOT" config user.email 2>/dev/null || true)"
    [ -n "$native_revoked_by" ] || { echo "FAIL: git config user.email não configurado em '$ROOT' — obrigatório para revoked_by" >&2; exit 1; }
    node - "$LIBDIR" "$ROOT" "$native_id" "$native_reason" "$native_revoked_by" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, id, reason, revokedBy, now] = process.argv;
  const A = await import(pathToFileURL(join(lib, 'native-allowlist.mjs')).href);
  const r = A.revoke({ root, id, reason, revokedBy, now });
  if (!r.ok) { console.error(`FAIL: ${r.error}`); process.exit(1); }
  console.log(`OK native revoke — ${id} revogado (${r.reminder})`);
})();
NODEEOF
    ;;

  pin)
    NATIVE_PIN_FLAGS=""
    while [ $# -gt 0 ]; do case "$1" in
      *) _reject_unknown "native pin" "$NATIVE_PIN_FLAGS" "$1" ;;
    esac; done
    _native_operator_guard || exit 1
    node - "$LIBDIR" "$ROOT" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root] = process.argv;
  const A = await import(pathToFileURL(join(lib, 'native-allowlist.mjs')).href);
  const r = A.pin({ root });
  if (!r.ok) { console.error(`FAIL: ${r.error}`); process.exit(1); }
  console.log(`OK native pin — self_identity fixado em '${r.doc.self_identity}' (${r.reminder})`);
})();
NODEEOF
    ;;

  # ---------------------------------------------------------------------------------------------
  # native containment — detector único de mudanças de contenção (REQ-12, design §2.7). rc 0
  # sempre que conseguiu medir (lista vazia = "nada mudou" é resultado, não falha); rc 2 quando
  # NÃO conseguiu medir (git indisponível, intervalo inválido, hooks.manifest do consumidor
  # corrompido) — para o chamador (pre-push, doctor, prepare-pr, ship) nunca confundir os dois.
  containment)
    native_range=""; native_format="text"
    NATIVE_CONTAINMENT_FLAGS="--range, --format"
    while [ $# -gt 0 ]; do case "$1" in
      --range) forge_reject_flag_as_value "native containment" --range "${2-}" "$NATIVE_CONTAINMENT_FLAGS"; native_range="$2"; shift 2 ;;
      --format) forge_reject_flag_as_value "native containment" --format "${2-}" "$NATIVE_CONTAINMENT_FLAGS"; native_format="$2"; shift 2 ;;
      *) _reject_unknown "native containment" "$NATIVE_CONTAINMENT_FLAGS" "$1" ;;
    esac; done
    case "$native_format" in
      text|markdown) ;;
      *) echo "FAIL: --format inválido '$native_format' no subcomando 'native containment' (use: text, markdown)" >&2; exit 1 ;;
    esac
    node - "$LIBDIR" "$ROOT" "$native_range" "$native_format" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, root, range, format] = process.argv;
  const C = await import(pathToFileURL(join(lib, 'native-containment.mjs')).href);
  const r = C.detectContainment({ root, range: range || undefined });
  if (!r.ok) { console.error(`FAIL: ${r.reason}`); process.exit(2); }
  console.log(C.renderContainment(r.findings, format));
})();
NODEEOF
    ;;

  *) echo "FAIL: subcomando desconhecido 'native $native_sub' (use: check, dispose, allow, revoke, pin, containment)" >&2; exit 1 ;;
  esac
  ;;

*)
  echo "FAIL: comando desconhecido '$cmd'" >&2; exit 1
  ;;
esac
