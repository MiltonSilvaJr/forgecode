#!/usr/bin/env bash
# check-push-ahead — mede e INFORMA quando o tronco local está à frente do remoto real (issue #67).
#
# Uso:  check-push-ahead.sh <nome-ou-url-do-remoto> [url]   (stdin = o mesmo do hook pre-push)
#
# O problema: a disciplina de "não deixar commit sem empurrar" é auto-violável por construção — o
# ato de registrar a disciplina produz o commit que a viola. E o dano não é local: tronco local à
# frente do servidor infla o PR de OUTRA frente sem sinal nenhum para quem rebaseou, porque o
# GitHub congela `baseRefOid` e só recalcula por evento. Medido em campo: um PR mostrando 59
# arquivos para qualquer revisor, dos quais só 27 eram do autor.
#
# Entre `commit` e `push` existe uma janela em que "zero de passivo" é falso, e nenhum procedimento
# a elimina — só medição NO MOMENTO do push. É o que este script faz.
#
# ── ESTE SCRIPT NUNCA BLOQUEIA. Sai 0 em todo caminho. ───────────────────────────────────────────
# Decisão de projeto, tomada em revisão adversarial e registrada aqui para não ser reaberta por
# engano. Não existe chave para bloquear, e três razões sustentam isso:
#
#   1. Bloquear `feat/x` porque o TRONCO está adiantado é bloquear pela ref ALHEIA — exatamente o
#      que o comentário de `liaison.enforce` já proíbe no forge.yaml: "cada participante bloqueia
#      pelo próprio ack pendente, nunca pelo dos outros, senão o participante mais lento trava o
#      trabalho de todo mundo".
#   2. Seria DEADLOCK. Com tronco divergido, ou com branch protegida, `git push origin <tronco>` é
#      RECUSADO — então não se empurra a feature sem empurrar o tronco, e não se empurra o tronco.
#      A única saída viraria `--no-verify`, que desliga os outros nove checks do hook junto.
#   3. Num fluxo onde tudo entra por PR, um gate cuja saída canônica é "empurre direto no tronco"
#      institucionaliza a violação de processo que ele deveria ajudar a evitar.
#
# Se a linha se provar inerte, a escalada NÃO é bloquear aqui: é `/forge:ship` e `/forge:handoff`
# recusarem fechar com tronco não empurrado — lugar onde o tronco É o assunto e o operador ESTÁ no
# contexto certo. Medir antes de escalar.
#
# ── As três classes de saída, sempre com prefixo greppável e carimbo de horário ──────────────────
# Quem opera o push nestes repositórios é frequentemente um agente, e a linha existe para ser
# consumida no mesmo turno. "Em dia", "não medido" e "adiantado" NUNCA compartilham texto: se
# "não verifiquei" e "verifiquei e está limpo" terminam no mesmo lugar, o check informa nada com
# ar de rigor — o defeito canônico deste repositório.
set -uo pipefail

PREFIX="forge-push-ahead:"
now() { date '+%Y-%m-%d %H:%M:%S %z'; }
say_ok()      { printf '%s %s (medido %s)\n'    "$PREFIX" "$1" "$(now)"; }
say_nao()     { printf '%s NÃO MEDIDO — %s (%s)\n' "$PREFIX" "$1" "$(now)"; }
fim() { exit 0; }   # jamais outro código: este script informa, não julga

ROOT="${FORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -n "$ROOT" ] || { say_nao "fora de um repositório git"; fim; }

INPUT="$(cat 2>/dev/null || true)"

# ── bordas de stdin: aqui não se gasta rede ──────────────────────────────────────────────────────
# "Everything up-to-date" INVOCA o hook com stdin vazio: nada está sendo publicado, então medir
# seria cobrar rede por um push que não existe. `--delete` chega com o literal `(delete)` como ref
# local, que não é um rev e não pode ir para `rev-parse`. `--mirror` chega com `refs/remotes/*`
# entre as refs locais. Tag não tem tronco a comparar.
[ -n "$INPUT" ] || { say_nao "nada sendo publicado (stdin vazio)"; fim; }
# O DESTINO de cada ref importa tanto quanto a origem, e ignorá-lo produziu o pior defeito desta
# entrega em revisão: `grep` do sha do tronco entre os shas empurrados dizia "passivo sendo
# resolvido" quando uma branch NOVA apontava para o tronco, ou num `git push origin develop:outro`,
# ou num `--all` — casos em que `refs/heads/<tronco>` no servidor NÃO avança. Era a única das três
# classes que diz "não há nada a fazer", dita sobre o estado exato que este check existe para
# denunciar. Por isso o par (sha, destino) é guardado, não só o sha.
CR="$(printf '\r')"   # uma vez, fora do laço
PUSHED_PAIRS=""
SKIP_WHY=""
while IFS=' ' read -r lref lsha rref _rsha; do
  # CR removido por FORMA, não por substituição de comando: dois forks por linha custam ~6,7s num
  # push de 800 refs (medido), e um `git push --all` num repositório grande pagaria minutos por uma
  # linha informativa.
  case "$lref" in *"$CR") lref="${lref%"$CR"}" ;; esac
  case "$rref" in *"$CR") rref="${rref%"$CR"}" ;; esac
  [ -n "${lref:-}" ] || continue
  case "$lref" in
    '(delete)') SKIP_WHY="${SKIP_WHY:-remoção de ref}"; continue ;;
    # Tag NÃO é inofensiva: ela arrasta os objetos que alcança, então um `git push origin v1.0.0`
    # publica commits do tronco enquanto `refs/heads/<tronco>` no servidor continua atrás. Medir
    # aqui custaria rede em todo push de tag; dizer NADA seria certificar o silêncio como correto,
    # que é a vacuidade canônica deste repositório aplicada ao check que existe para combatê-la.
    refs/tags/*) SKIP_WHY="${SKIP_WHY:-push de tag; ela pode arrastar commits do tronco sem avançar refs/heads}"; continue ;;
    refs/remotes/*) SKIP_WHY="${SKIP_WHY:-push de refs/remotes (mirror)}"; continue ;;
    HEAD) SKIP_WHY="${SKIP_WHY:-push a partir de detached HEAD}"; continue ;;
    refs/heads/*) : ;;
    *) SKIP_WHY="${SKIP_WHY:-ref local '$lref' fora de refs/heads}"; continue ;;
  esac
  case "${lsha:-}" in
    ''|*[!0-9a-f]*) continue ;;
    0000000000000000000000000000000000000000) SKIP_WHY="${SKIP_WHY:-remoção de ref}"; continue ;;
  esac
  PUSHED_PAIRS="$PUSHED_PAIRS $lsha:${rref:-?}"
done <<EOF_IN
$INPUT
EOF_IN
[ -n "${PUSHED_PAIRS# }" ] || { say_nao "${SKIP_WHY:-nada a medir neste push}"; fim; }

FORGE_YAML="$ROOT/.forge/forge.yaml"
# Mesmo idioma awk do `_yaml_auto` do hook de sessão e do `check-liaison-acks.sh`. Um leitor por
# `grep` devolve vazio em chave aninhada ou comentada e cai no default SEM DIZER NADA.
yaml_field() {  # yaml_field <bloco> <chave>
  [ -f "$FORGE_YAML" ] || { echo ""; return; }
  awk -v blk="$1" -v key="$2" '
    $0 ~ "^"blk":" { inblk=1; next }
    inblk && /^[a-z_]+:/ { exit }
    inblk && $0 ~ "^[ ]+"key":" { sub("^[ ]+"key":[ ]*",""); sub(/[ ]*#.*$/,""); sub(/[ ]+$/,""); print; exit }
  ' "$FORGE_YAML"
}

# Desabilitado NÃO é silêncio: é a terceira classe com motivo. Uma chave que produz um caminho mudo
# torna "desligado" indistinguível de "quebrado" — foi assim que o gate de acks do liaison passou
# meses sem rodar, sem ninguém ter desligado nada.
[ "$(yaml_field push_ahead enabled)" = "false" ] && { say_nao "desabilitado em forge.yaml (push_ahead.enabled: false)"; fim; }

# ── teto de tempo ────────────────────────────────────────────────────────────────────────────────
# Valor inválido NÃO pode desligar o teto em silêncio: `perl -e 'alarm shift'` com "abc", "" ou "0"
# executa SEM teto algum. É a lição literal da issue #52 — timeout cru que faz o teto nunca disparar
# e o push nunca terminar — no idioma que este harness já usa.
TIMEOUT_S="$(yaml_field push_ahead timeout_s)"
_t_raw="$TIMEOUT_S"
case "${TIMEOUT_S:-}" in
  '') TIMEOUT_S=5 ;;
  *[!0-9]*)
    printf '%s aviso: push_ahead.timeout_s inválido (%s) — exigido inteiro de 1 a 60; usando 5s\n' "$PREFIX" "$_t_raw" >&2
    TIMEOUT_S=5 ;;
  *)
    # Só dígitos daqui para baixo, e ainda assim há três armadilhas, todas medidas em revisão:
    #  · `08` e `09` são zero-padding plausível e MATAM o script em aritmética — o bash lê zero à
    #    esquerda como octal e `8` não existe em base 8 ("value too great for base"). O `set -u` na
    #    linha seguinte então aborta com MAXI unbound, e o push perde as três classes de saída.
    #  · `00` passa por qualquer teste de "só dígitos" e vale ZERO: teto pela metade, sem aviso.
    #  · um número de 20 dígitos estoura o inteiro do shell, `[ -gt ]` falha com "integer expression
    #    expected", o cap de 60 NÃO é aplicado e o teto fica DESLIGADO.
    # Limitar o comprimento ANTES de qualquer aritmética é o que fecha as três de uma vez, e o `10#`
    # é o que impede a leitura octal.
    # Zeros à esquerda são removidos ANTES do cap de comprimento: `0000` é zero, não um número
    # grande, e clampá-lo para 60 daria o diagnóstico errado ("acima do máximo") sobre um valor
    # nulo. O que o cap de comprimento existe para pegar é magnitude real.
    _t_trim="${TIMEOUT_S#"${TIMEOUT_S%%[!0]*}"}"; [ -n "$_t_trim" ] || _t_trim=0
    TIMEOUT_S="$_t_trim"
    if [ "${#TIMEOUT_S}" -gt 3 ]; then
      printf '%s aviso: push_ahead.timeout_s (%s) acima do máximo; usando 60s\n' "$PREFIX" "$_t_raw" >&2
      TIMEOUT_S=60
    else
      TIMEOUT_S=$(( 10#$TIMEOUT_S ))
      if [ "$TIMEOUT_S" -lt 1 ]; then
        printf '%s aviso: push_ahead.timeout_s inválido (%s) — exigido inteiro de 1 a 60; usando 5s\n' "$PREFIX" "$_t_raw" >&2
        TIMEOUT_S=5
      elif [ "$TIMEOUT_S" -gt 60 ]; then
        printf '%s aviso: push_ahead.timeout_s %ss acima do máximo; usando 60s\n' "$PREFIX" "$_t_raw" >&2
        TIMEOUT_S=60
      fi
    fi ;;
esac

# ── qual remoto ──────────────────────────────────────────────────────────────────────────────────
# O hook recebe NOME e URL do remoto em $1/$2. Medir sempre `origin` erraria em `git push outro`, e
# erraria em fluxo de fork, onde origin é o fork e o tronco de verdade mora no upstream.
REMOTE="${1:-}"
if [ -z "$REMOTE" ] || ! git -C "$ROOT" remote get-url "$REMOTE" >/dev/null 2>&1; then
  REMOTE="${2:-$REMOTE}"
fi
[ -n "$REMOTE" ] || { say_nao "não foi possível determinar o remoto do push"; fim; }
git -C "$ROOT" remote get-url "$REMOTE" >/dev/null 2>&1 || \
  case "$REMOTE" in *:*|*/*) : ;; *) say_nao "remoto '$REMOTE' não configurado"; fim ;; esac

# ── qual tronco ──────────────────────────────────────────────────────────────────────────────────
# `project.default_branch` do FORGE.md vem PRIMEIRO porque já é a fonte de verdade declarada deste
# harness — inventar uma segunda chave no forge.yaml criaria duas verdades para o mesmo fato.
# `origin/HEAD` vem depois e não basta sozinho: neste próprio repositório ele aponta para `main`
# enquanto o tronco de trabalho é `develop`, e medir a ref errada produz um número correto sobre
# uma branch irrelevante.
TRUNK=""
FMD="$ROOT/.forge/FORGE.md"
[ -f "$FMD" ] && TRUNK="$(awk '
  /^project:/ { inblk=1; next }
  inblk && /^[a-z_]+:/ { exit }
  inblk && /^[ ]+default_branch:/ { sub(/^[ ]+default_branch:[ ]*/,""); sub(/[ ]*#.*$/,""); sub(/[ ]+$/,""); print; exit }
' "$FMD" 2>/dev/null)"
if [ -z "$TRUNK" ]; then
  TRUNK="$(git -C "$ROOT" symbolic-ref --short "refs/remotes/$REMOTE/HEAD" 2>/dev/null | sed "s|^$REMOTE/||")"
fi
if [ -z "$TRUNK" ]; then
  for cand in develop main master; do
    git -C "$ROOT" rev-parse --verify -q "refs/heads/$cand" >/dev/null 2>&1 && { TRUNK="$cand"; break; }
  done
fi
[ -n "$TRUNK" ] || { say_nao "não foi possível determinar o tronco"; fim; }

TRUNK_LOCAL="$(git -C "$ROOT" rev-parse --verify -q "refs/heads/$TRUNK" 2>/dev/null)"
[ -n "$TRUNK_LOCAL" ] || { say_nao "tronco '$TRUNK' não existe localmente"; fim; }

# ── a leitura de rede, com teto REAL ─────────────────────────────────────────────────────────────
# Três armadilhas, todas medidas, todas fatais se ignoradas:
#
# (1) A captura NUNCA pode ser por pipe. Medido: contra host que não responde, o teto dispara em 5s
#     mas a SUBSTITUIÇÃO DE COMANDO só retorna aos 75s, porque o neto `git-remote-https` sobrevive
#     ao sinal e segura o pipe aberto. Com redirecionamento para ARQUIVO, os mesmos 5s valem.
# (2) O sinal vai para o grupo do FILHO, jamais para o nosso. Medido: dentro de um hook do git, o
#     líder do grupo é o SHELL QUE INVOCOU o push — um `kill -- -$$` aqui mataria o `git push` e o
#     job do usuário. `set -m` dá pgid próprio ao job em background, e só esse pgid é sinalizado.
# (3) Se o isolamento falhar, NÃO se sinaliza nada. Um `curl` órfão de 75s é o pior desfecho
#     aceitável; matar o push que se prometeu apenas informar nunca é.
# Os traps são registrados ANTES do mktemp, de propósito: entre "o arquivo existe" e "o trap está
# de pé" não pode haver janela nenhuma — um sinal chegando bem no meio dessa janela usaria a
# disposição padrão do sinal (sem trap nenhum ainda registrado) e vazaria o arquivo do mesmo jeito
# que a correção existe para evitar. `${OUT:-}` cobre o instante entre o registro do trap e a
# atribuição de OUT: `rm -f ""` é no-op seguro, e `set -u` não aborta por causa de uma variável
# ainda não atribuída dentro de um trap que só roda depois.
trap 'rm -f "${OUT:-}"' EXIT
# EXIT sozinho cobre saída normal, mas Ctrl-C (INT) no meio do push mata este script sem passar
# por ali (LDG-0058) — lixo pequeno (uma linha de sha) que acumula em silêncio em quem interrompe
# push com frequência. TERM e HUP entram pela mesma razão (defesa em profundidade: nem toda shell
# que executa este script garante o mesmo comportamento de EXIT-ao-morrer-por-sinal).
#
# Cada sinal precisa do PRÓPRIO `exit` explícito — medido: um trap registrado para um SINAL (não
# para EXIT) que só limpa e não sai deixa o processo VIVO, retomando de onde foi interrompido; é a
# shell que decide encerrar sozinha ao herdar a disposição padrão de um sinal SEM trap nenhum, não
# ao rodar um trap custom. `exit N` aqui dispara o trap de EXIT acima também (idempotente).
trap 'rm -f "${OUT:-}"; exit 130' INT
trap 'rm -f "${OUT:-}"; exit 143' TERM
trap 'rm -f "${OUT:-}"; exit 129' HUP
# Resíduo medido e aceito, não corrigido: mesmo com os traps de pé, existe uma corrida estreita
# (dezenas de ms) entre a entrega do sinal e a transição de `set -m` logo abaixo, que isola o
# filho de rede em pgid próprio — sinalizar EXATAMENTE nesse instante pode matar o processo pela
# disposição padrão antes de qualquer trap correr. Confirmado PRÉ-EXISTENTE: o código só-EXIT (de
# antes desta correção) mostra a MESMA corrida, na mesma ordem de grandeza, sob a mesma sonda.
# Nenhum Ctrl-C humano nem sinal de hook de git chega sincronizado a essa janela; fechá-la por
# completo exigiria abrir mão do `set -m` (perdendo o isolamento de pgid do parágrafo acima) ou
# bloqueio de sinal em nível de processo que bash não expõe por trap. Ver tests/w152 [29].
OUT="$(mktemp "${TMPDIR:-/tmp}/forge-pushahead-XXXXXX")"

set -m
(
  # Ambiente não interativo imposto. `GIT_TERMINAL_PROMPT=0` cobre só o prompt do próprio git: não
  # cobre passphrase de chave ssh, host key desconhecida, nem askpass gráfico. O comando ssh é
  # DERIVADO do que já existir — sobrescrever cegamente quebraria identidade dedicada e
  # `ProxyCommand` corporativo. `BatchMode=yes` desliga senha E confirmação de host key.
  _ssh="${GIT_SSH_COMMAND:-$(git -C "$ROOT" config --get core.sshCommand 2>/dev/null)}"
  [ -n "$_ssh" ] || _ssh="ssh"
  GIT_SSH_COMMAND="$_ssh -o BatchMode=yes -o ConnectTimeout=$TIMEOUT_S" \
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/echo SSH_ASKPASS_REQUIRE=never \
    git -C "$ROOT" ls-remote --exit-code "$REMOTE" "refs/heads/$TRUNK" > "$OUT" 2>/dev/null
) </dev/null >/dev/null 2>&1 &
NETPID=$!
set +m

CHILD_PGID="$(ps -o pgid= -p "$NETPID" 2>/dev/null | tr -d ' ')"
SELF_PGID="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
ISOLATED=0
[ -n "$CHILD_PGID" ] && [ -n "$SELF_PGID" ] && [ "$CHILD_PGID" != "$SELF_PGID" ] && ISOLATED=1

# Cap de ITERAÇÕES, além do relógio. Se o relógio andar para trás (NTP, laptop suspenso), uma
# espera derivada de `date` fica negativa e o laço NUNCA termina — a issue #52 por outra porta.
i=0; MAXI=$(( TIMEOUT_S * 10 + 20 )); done_net=0
while [ "$i" -lt "$MAXI" ]; do
  kill -0 "$NETPID" 2>/dev/null || { done_net=1; break; }
  sleep 0.1
  i=$((i + 1))
done
if [ "$done_net" -eq 0 ]; then
  if [ "$ISOLATED" -eq 1 ]; then
    # `disown` ANTES do sinal: o "Terminated: 15 (...)" que apareceria aqui é o notificador de job
    # do bash no processo PAI, não o stderr do filho — que já é descartado na linha do ls-remote.
    # Sem isso o usuário vê três linhas com o corpo inteiro do subshell logo abaixo de um
    # "NÃO MEDIDO" limpo, e o que é uma degradação prevista parece um crash.
    disown "$NETPID" 2>/dev/null || true
    kill -TERM -- "-$CHILD_PGID" 2>/dev/null
    sleep 0.3
    kill -KILL -- "-$CHILD_PGID" 2>/dev/null
  fi
  # Sem isolamento comprovado, o processo fica órfão de propósito: ver armadilha (3) acima.
  say_nao "leitura do remoto excedeu ${TIMEOUT_S}s"
  fim
fi
wait "$NETPID" 2>/dev/null; NETRC=$?

RSHA="$(cut -f1 < "$OUT" 2>/dev/null | head -1 | tr -d ' \n')"
# `ls-remote` de ref inexistente devolve rc 0 e saída VAZIA. Com o sha vazio o range vira
# "..<tronco>", que o git lê como HEAD..<tronco> e responde 0 COM RC 0 — "não mediu" e "em dia"
# terminando no mesmo lugar, com número plausível. A validação por FORMA é o que separa os dois.
case "$RSHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
  *) say_nao "não foi possível ler '$TRUNK' em '$REMOTE' (rc $NETRC)"; fim ;;
esac
[ "${#RSHA}" -eq 40 ] || [ "${#RSHA}" -eq 64 ] || { say_nao "sha remoto com forma inesperada"; fim; }

# O objeto remoto pode ser desconhecido localmente (clone sem fetch, remoto à frente). Sem esta
# guarda, `rev-list` sai rc 128 com saída vazia, o número vira "" e o check diria "em dia".
git -C "$ROOT" cat-file -e "$RSHA^{commit}" 2>/dev/null \
  || { say_nao "o commit $(echo "$RSHA" | cut -c1-7) de '$TRUNK' não existe localmente — rode: git fetch $REMOTE $TRUNK"; fim; }

AHEAD="$(git -C "$ROOT" rev-list --count "$RSHA..$TRUNK_LOCAL" 2>/dev/null)"
case "$AHEAD" in ''|*[!0-9]*) say_nao "não foi possível contar a diferença"; fim ;; esac

if [ "$AHEAD" -eq 0 ]; then
  say_ok "$TRUNK em dia com $REMOTE"
  fim
fi

# "Passivo sendo resolvido" exige que ESTE push atualize `refs/heads/<tronco>` NO REMOTO. Conferir
# só o sha de origem dizia isso a `git push origin feat-nova` quando a branch nova apontava para o
# tronco — e o tronco remoto continuava atrás. O destino é o que decide; o quanto sobra depois, o
# que se afirma.
TO_TRUNK=""
for pair in $PUSHED_PAIRS; do
  case "${pair#*:}" in
    "refs/heads/$TRUNK"|"$TRUNK") TO_TRUNK="${pair%%:*}"; break ;;
  esac
done
if [ -n "$TO_TRUNK" ]; then
  rest="$(git -C "$ROOT" rev-list --count "$TO_TRUNK..$TRUNK_LOCAL" 2>/dev/null)"
  # 1, nunca 0: um `rev-list` que FALHOU não pode ser lido como "não sobrou nada", que é a classe
  # tranquilizadora. Falha de medição roteia para a mensagem honesta de publicação parcial.
  case "$rest" in ''|*[!0-9]*) rest=1 ;; esac
  if [ "$rest" -eq 0 ]; then
    say_ok "$TRUNK está $AHEAD commit(s) à frente de $REMOTE e ESTE push os publica — passivo sendo resolvido"
  else
    say_ok "$TRUNK está $AHEAD commit(s) à frente de $REMOTE; este push publica parte deles e $rest continuará(ão) sem publicar"
  fi
  fim
fi

# A INTERSEÇÃO é o que transforma um aviso genérico em previsão específica: destes commits, quantos
# entram no diff de ESTE push. É o número que prevê o dano de 59-contra-27 relatado na issue.
#
# É a UNIÃO dos commits alcançados por cada ref publicada, não o MÁXIMO entre elas (LDG-0057). Em
# push multi-ref, cada ref pode carregar um subconjunto DIFERENTE do passivo — uma branch que
# divergiu cedo carrega parte, outra que divergiu tarde carrega outra parte, e nenhuma das duas
# sozinha é o total. O máximo SUBESTIMA sempre que os subconjuntos não são um o prefixo do outro
# (ex.: duas branches em lados opostos de um merge do próprio tronco). Conservação: a união nunca
# é menor que a maior parte isolada, e é exatamente o tamanho do conjunto combinado.
#
# Implementação: um merge-base por ref (como antes), mas o rev-list --count final é UM SÓ, sobre
# TODOS os merge-base coletados de uma vez — `git rev-list` deduplica objetos alcançáveis por mais
# de um positivo automaticamente, então a união sai de graça sem contar nada em dobro. Isso também
# elimina metade das invocações de `git` do laço antigo (LDG-0059): de duas por ref (merge-base +
# rev-list) para uma por ref (só merge-base) mais uma única rev-list no final.
INTER=0
MERGE_BASES=""
for pair in $PUSHED_PAIRS; do
  sha="${pair%%:*}"
  mb="$(git -C "$ROOT" merge-base "$TRUNK_LOCAL" "$sha" 2>/dev/null)" || continue
  [ -n "$mb" ] || continue
  MERGE_BASES="$MERGE_BASES $mb"
done
if [ -n "${MERGE_BASES# }" ]; then
  INTER="$(git -C "$ROOT" rev-list --count $MERGE_BASES --not "$RSHA" 2>/dev/null)"
  case "$INTER" in ''|*[!0-9]*) INTER=0 ;; esac
fi

if [ "$INTER" -gt 0 ]; then
  say_ok "$TRUNK está $AHEAD commit(s) à frente de $REMOTE, dos quais $INTER entra(m) NESTE push — eles aparecerão no diff de qualquer PR aberto contra $TRUNK"
else
  say_ok "$TRUNK está $AHEAD commit(s) à frente de $REMOTE (nenhum entra neste push)"
fi
# A remediação NÃO é prescrita cegamente: com tronco divergido, ou com branch protegida,
# `git push` do tronco é RECUSADO — e mandar empurrar direto no tronco, num fluxo onde tudo entra
# por PR, ensina a violar o processo.
printf '%s   se for fast-forward e permitido: git push %s %s — senão, integre por PR\n' "$PREFIX" "$REMOTE" "$TRUNK"
fim
