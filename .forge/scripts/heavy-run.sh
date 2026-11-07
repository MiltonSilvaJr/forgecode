#!/usr/bin/env bash
# heavy-run.sh — executa um comando sob o mutex de carga pesada da MÁQUINA (issue #52).
#
# Existe porque a carga que mais disputa CPU e daemon Docker nasce FORA do `git push` e nunca
# passaria por um hook: `dotnet test` da suíte completa, `gradle`, `docker compose up --build`.
#
# Superset estrito do contrato publicado no canal `axis-contracts` (`axis-go-cloud-0127`):
#   - `--` obrigatório antes do comando;
#   - stdout pertence INTEIRAMENTE ao comando, telemetria só em stderr — a saída de suíte pesada é
#     parseada por terceiros, e uma linha nossa no meio quebra quem consome;
#   - exit code do comando propagado sem tradução;
#   - `64` uso inválido · `69` âncora inutilizável · `70` disposição de sinal herdada não pôde
#     ser resetada (sem `perl`) · `75` timeout com o comando NÃO executado ·
#     `130`/`143`/`129` para INT/TERM/HUP, com o comando morto antes e o lock liberado na hora.
#
# `69` e `75` são deliberadamente distintos: um diz "espere", o outro diz "conserte a máquina".
#
# O shebang passou de `sh` para `bash`: a biblioteca usa `[ -O ]`, `[ -k ]`, `BASH_SUBSHELL`,
# `trap -p` e `10#`. É item explícito da migração.
set -uo pipefail

# Argumentos ORIGINAIS, capturados antes de qualquer `shift` do parser abaixo — é o que
# `_hr_reset_ignored_signals` reexecuta quando precisa resetar disposição de sinal herdada
# (issue #146). Sob `set -u` e bash < 4.4, `"${_HR_ORIG_ARGV[@]}"` com array vazio dispara
# "unbound variable" (medido em `/bin/bash` 3.2.57) — por isso todo uso abaixo é
# `${_HR_ORIG_ARGV[@]+"${_HR_ORIG_ARGV[@]}"}`, a forma portátil que expande para nada sem erro
# em qualquer versão.
_HR_ORIG_ARGV=("$@")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$SCRIPT_DIR/lib/heavy-mutex.sh"
# Delegação em alvo ausente é ERRO, não no-op (issue #49, instância 4): se o diretório da
# biblioteca existe e o arquivo não, a instalação está pela metade e seguir sem mutex é rodar
# carga pesada desprotegida em silêncio.
if [ ! -f "$LIB" ] && [ -d "$SCRIPT_DIR/lib" ]; then
  echo "heavy-run: $SCRIPT_DIR/lib/ existe e heavy-mutex.sh não — delegação em alvo ausente." >&2
  exit 69
fi
[ -f "$LIB" ] || { echo "heavy-run: biblioteca do mutex não encontrada em $LIB" >&2; exit 69; }
# shellcheck disable=SC1090
. "$LIB"

_hr_usage() {
  echo "uso: heavy-run.sh [--resource <n>] [--label <t>] -- <comando> [args...]" >&2
  echo "     heavy-run.sh status|sweep [--resource <n>] [--legacy]" >&2
  echo "     heavy-run.sh queue enable|disable|state [--resource <n>]" >&2
}

# Aliases de compatibilidade. Existem para não exigir reescrita da memória muscular de quem opera
# as máquinas — mas dois nomes da MESMA grandeza com valores diferentes é ERRO, nunca precedência
# silenciosa: escolher um em silêncio é como uma configuração deixa de ser lida sem ninguém notar.
_hr_alias() {  # _hr_alias <destino> <nome-a> <valor-a> <nome-b> <valor-b> [multiplicador-b]
  local dest="$1" na="$2" va="$3" nb="$4" vb="$5" mult="${6:-1}" vbn
  if [ -n "$vb" ]; then vbn=$(( vb * mult )); else vbn=""; fi
  if [ -n "$va" ] && [ -n "$vbn" ] && [ "$va" != "$vbn" ]; then
    echo "heavy-run: $na=$va e $nb=$vb dizem a mesma coisa com valores diferentes — corrija um dos dois." >&2
    return 64
  fi
  if [ -n "$va" ]; then printf '%s' "$va"; elif [ -n "$vbn" ]; then printf '%s' "$vbn"; fi
  return 0
}

RES=""; LABEL=""; SUB=""; TMO_NAME=""
case "${1:-}" in
  status|sweep|queue) SUB="$1"; shift ;;
esac

LEGACY=0; QACT=""
if [ "$SUB" = "queue" ]; then
  QACT="${1:-}"; shift || true
  case "$QACT" in enable|disable|state) : ;; *) _hr_usage; exit 64 ;; esac
fi

ARGS_OK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --resource) RES="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --legacy) LEGACY=1; shift ;;
    --) shift; ARGS_OK=1; break ;;
    -*) echo "heavy-run: flag desconhecida '$1'" >&2; _hr_usage; exit 64 ;;
    *) echo "heavy-run: argumento inesperado '$1' (o comando vem depois de '--')" >&2; _hr_usage; exit 64 ;;
  esac
done

[ -n "$RES" ] && { FORGE_HEAVY_MUTEX_RESOURCE="$RES"; export FORGE_HEAVY_MUTEX_RESOURCE; }

# Resolve o caminho dos sidecars para os subcomandos de operação.
_hr_paths() {
  local pp; pp="$(forge_heavy_mutex_path)" || return 69
  HR_LOCK="${pp%%	*}"
  HR_BASE="${HR_LOCK%.lock}"
}

case "$SUB" in
  status)
    _hr_paths || exit 69
    forge_heavy_mutex_status
    exit $?
    ;;
  queue)
    _hr_paths || exit 69
    case "$QACT" in
      enable)  : > "$HR_BASE.q.enabled" && echo "heavy-run: fila LIGADA para $HR_BASE" >&2 ;;
      disable) rm -f "$HR_BASE.q.enabled" && echo "heavy-run: fila DESLIGADA para $HR_BASE" >&2 ;;
      state)   [ -f "$HR_BASE.q.enabled" ] && echo "LIGADA" || echo "DESLIGADA" ;;
    esac
    exit 0
    ;;
  sweep)
    _hr_paths || exit 69
    n=0
    if [ -d "$HR_LOCK" ]; then
      hp="$(cat "$HR_LOCK/pid" 2>/dev/null || echo '')"
      ht="$(cat "$HR_LOCK/token" 2>/dev/null || echo '')"
      if [ -n "$hp" ] && ! _fhm_alive "$hp" "$ht"; then
        _FHM_LOCK="$HR_LOCK" _fhm_reclaim_orphan "$hp" && n=$((n+1))
      fi
    fi
    # Evidências de reivindicação atropelada (`<lock>.reaping.<pid>.<ts>.<rand>`): preservadas na
    # hora para não repetir o defeito de apagar o que não se provou ser lixo, e recolhidas aqui
    # quando o processo que as criou já morreu. Sem isto, elas ficam em /tmp para sempre.
    nr=0
    for rp in "$HR_LOCK".reaping.*; do
      [ -d "$rp" ] || continue
      rpid="$(printf '%s' "${rp##*.reaping.}" | cut -d. -f1)"
      if [ -n "$rpid" ] && [ -z "$(LC_ALL=C ps -o lstart= -p "$rpid" 2>/dev/null)" ]; then
        rm -rf "$rp" 2>/dev/null && nr=$((nr + 1))
      fi
    done
    echo "heavy-run: sweep — $n lock(s) órfão(s) e $nr evidência(s) de reivindicação recolhida(s)" >&2
    if [ "$LEGACY" = "1" ]; then
      # Caminhos LEGADOS derivados de TMPDIR. É o instrumento que teria transformado catorze horas
      # de bloqueio invisível numa linha: um lock em `$TMPDIR/...` não é visto por quem resolve
      # `/tmp/...`, e nenhuma detecção de órfão alcança o arquivo que ela não está olhando.
      base="$(basename "$HR_BASE")"
      for cand in "${TMPDIR:-/tmp}/$base.lock" "/tmp/$base.lock"; do
        [ "$cand" = "$HR_LOCK" ] && continue
        [ -d "$cand" ] || continue
        lp="$(cat "$cand/pid" 2>/dev/null || echo '?')"
        echo "heavy-run: LEGADO vivo em $cand (pid $lp) — este caminho NÃO serializa com $HR_LOCK" >&2
      done
    fi
    exit 0
    ;;
esac

[ "$ARGS_OK" = "1" ] && [ $# -gt 0 ] || { echo "heavy-run: comando obrigatório após '--'" >&2; _hr_usage; exit 64; }

# Confronto de TODOS contra TODOS, em segundos. Dois nomes da mesma grandeza com valores
# diferentes é ERRO — escolher um em silêncio é como uma configuração deixa de ser lida sem
# ninguém notar. `AXIS_HEAVY_SUITE_WAIT` é em MINUTOS e entra normalizado.
_hr_num() {  # _hr_num <nome> <valor> — ecoa o valor, ou reprova se não for inteiro
  case "${2:-}" in
    '') return 0 ;;
    *[!0-9]*) echo "heavy-run: $1='$2' não é um número inteiro de segundos" >&2; return 64 ;;
    *) printf '%s' "$2" ;;
  esac
}
_a="$(_hr_num FORGE_HEAVY_MUTEX_TIMEOUT_S "${FORGE_HEAVY_MUTEX_TIMEOUT_S:-}")" || exit 64
_b="$(_hr_num HEAVY_RUN_TIMEOUT_SECONDS "${HEAVY_RUN_TIMEOUT_SECONDS:-}")" || exit 64
_c_raw="$(_hr_num AXIS_HEAVY_SUITE_WAIT "${AXIS_HEAVY_SUITE_WAIT:-}")" || exit 64
_c=""; [ -n "$_c_raw" ] && _c=$(( _c_raw * 60 ))
TMO=""
for _pair in "FORGE_HEAVY_MUTEX_TIMEOUT_S:$_a" "HEAVY_RUN_TIMEOUT_SECONDS:$_b" "AXIS_HEAVY_SUITE_WAIT:$_c"; do
  _n="${_pair%%:*}"; _v="${_pair#*:}"
  [ -n "$_v" ] || continue
  if [ -n "$TMO" ] && [ "$TMO" != "$_v" ]; then
    echo "heavy-run: $_n e $TMO_NAME dizem a mesma coisa com valores diferentes ($_v contra $TMO segundos) — corrija um dos dois." >&2
    exit 64
  fi
  TMO="$_v"; TMO_NAME="$_n"
done
[ -n "$TMO" ] && { FORGE_HEAVY_MUTEX_TIMEOUT_S="$TMO"; export FORGE_HEAVY_MUTEX_TIMEOUT_S; }

_pa="$(_hr_num FORGE_HEAVY_MUTEX_POLL_S "${FORGE_HEAVY_MUTEX_POLL_S:-}")" || exit 64
_pb="$(_hr_num HEAVY_RUN_POLL_SECONDS "${HEAVY_RUN_POLL_SECONDS:-}")" || exit 64
if [ -n "$_pa" ] && [ -n "$_pb" ] && [ "$_pa" != "$_pb" ]; then
  echo "heavy-run: FORGE_HEAVY_MUTEX_POLL_S e HEAVY_RUN_POLL_SECONDS dizem a mesma coisa com valores diferentes ($_pa contra $_pb) — corrija um dos dois." >&2
  exit 64
fi
POLL="${_pa:-$_pb}"
[ -n "$POLL" ] && { FORGE_HEAVY_MUTEX_POLL_S="$POLL"; export FORGE_HEAVY_MUTEX_POLL_S; }

# Sinais ignorados na entrada de um shell não interativo NÃO PODEM ser armados nem resetados pelo
# próprio bash — é política documentada, não bug: "signals ignored upon entry ... cannot be
# trapped or reset". Sob push detached via nohup duplo-fork sem tty (o padrão que este próprio
# ecossistema recomenda para sobreviver ao watchdog do harness), o processo que lança
# heavy-run.sh pode entregar INT ou TERM já ignorado, e nenhuma reordenação do `trap` mais abaixo
# resolveria isso — a disposição já estava fechada antes da primeira linha executável (issue
# #146). A prova é por TENTATIVA, mas por CONTEÚDO, não por presença: um `trap` de descarte em
# INT/TERM só "pega" de verdade se a disposição de entrada não era SIG_IGN, e a única forma
# confiável de saber isso é conferir se `trap -p` devolve o COMANDO-SONDA que acabamos de armar —
# nunca só "devolveu algo": bash 3.2 imprime vazio quando a tentativa
# de armar falhou (então checar só "não-vazio" funcionava por acidente), mas bash >=4 devolve o
# TRAP ANTIGO (a disposição SIG_IGN herdada, com o comando vazio de quem a armou) em vez de vazio
# — `[ -n "$p_int" ]` dá verdadeiro mesmo com o sinal ainda ignorado, e o reset nunca dispara.
# Medido: `sh -c "trap '' INT; exec bash5 -c 'trap true INT; trap -p INT'"` imprime
# `trap -- '' SIGINT` (o trap ORIGINAL, não o `true` que acabamos de tentar armar) — não-vazio,
# mas errado. Por isso a sonda usa um comando sentinela DISTINGUÍVEL e o veredito é por
# substring, não por `-n`.
#
# A sonda também nunca chama `trap - SIG` sobre um sinal que ainda pode estar ignorado (mesmo
# achado): no bash >=4, medido, `trap - INT` sobre INT herdado como ignorado MUDA a disposição de
# verdade (de SIG_IGN para o padrão do processo) mesmo com `trap -p` continuando a imprimir o
# texto antigo — um efeito colateral silencioso que faria a sonda destravar o sinal por acidente,
# sem que o reset por `perl` (que precisa rodar num processo NÃO-bash, ver abaixo) tenha ocorrido.
# `trap - SIG` só é chamado no ramo em que JÁ SABEMOS que o sinal não veio ignorado.
#
# HUP fica DE FORA deste reset, deliberadamente: resetar HUP mataria, no fechamento do terminal
# que o lançamento via `nohup` existe para proteger, exatamente o processo que o operador queria
# sobreviver — o invariante que a Onda 3/#144 exige preservar (dono em `nohup` sem beneficiário
# declarado não é reclamado). Se HUP precisar de tratamento próprio, é decisão separada, fora
# deste item.
#
# O reset só é possível por um processo que NÃO seja bash: `exec` preserva a disposição herdada
# quando o alvo é bash (a mesma política acima), mas um processo não-bash pode alterar a PRÓPRIA
# disposição para DEFAULT antes de `exec`'ar o alvo real, e essa disposição sobrevive ao exec
# seguinte porque deixou de ser SIG_IGN. `_HR_SIG_RESET` é a variável de guarda contra laço: se,
# mesmo depois de reexecutado uma vez, o sinal continuar sem poder ser armado, a função recusa em
# vez de reexecutar de novo — e em vez de rodar a carga sem trap. A guarda é `unset` assim que
# deixa de ser necessária (ramo armável, logo abaixo), porque `VAR=1 exec` a exporta para todo o
# resto da árvore de processos — inclusive a CARGA — e um heavy-run.sh aninhado dentro do próprio
# payload (um payload lançado por `&` sem `set -m`, como o próprio
# comentário abaixo de `set -m` descreve, herda INT ignorado por regra POSIX de lista assíncrona
# sem controle de job) leria a guarda do PAI como se já tivesse tentado resetar a SI MESMO, e
# recusaria com `70` sem nunca ter tentado.
_hr_reset_ignored_signals() {
  local sentinel=': hr146_probe_armavel'
  trap "$sentinel" INT TERM
  local p_int p_term precisa_reset=0
  p_int="$(trap -p INT)"
  p_term="$(trap -p TERM)"
  case "$p_int" in *"$sentinel"*) : ;; *) precisa_reset=1 ;; esac
  case "$p_term" in *"$sentinel"*) : ;; *) precisa_reset=1 ;; esac

  if [ "$precisa_reset" = "0" ]; then
    # As duas disposições vieram armáveis (a sonda foi lida de volta): nada herdado a resetar.
    # Só aqui é seguro devolver o trap à disposição padrão — sabemos que nenhum dos dois estava
    # ignorado na entrada, então `trap - SIG` não tem o efeito colateral descrito acima.
    trap - INT TERM
    unset _HR_SIG_RESET
    return 0
  fi

  if [ "${_HR_SIG_RESET:-0}" = "1" ]; then
    echo "heavy-run: INT ou TERM continua ignorado mesmo depois do reset — abortando em vez de rodar sem trap." >&2
    return 70
  fi
  if ! command -v perl >/dev/null 2>&1; then
    echo "heavy-run: INT ou TERM chega ignorado na entrada (herdado do lançamento detached) e 'perl' não está disponível para resetar a disposição — recusando em vez de rodar sem trap." >&2
    return 70
  fi
  # Reexecuta com o MESMO interpretador que já está rodando ($BASH, resolvido pelo próprio bash
  # na entrada) e o MESMO arquivo ($BASH_SOURCE[0], não um caminho literal): `bash
  # "$SCRIPT_DIR/heavy-run.sh"` resolvia `bash` de novo pelo PATH, e uma máquina
  # com outro bash na frente (ex.: Homebrew) trocaria de interpretador NO MEIO da execução.
  _HR_SIG_RESET=1 exec perl -e '$SIG{INT}="DEFAULT"; $SIG{TERM}="DEFAULT"; exec @ARGV or die "heavy-run: exec falhou ao resetar disposição de sinal: $!\n"' \
    "$BASH" "${BASH_SOURCE[0]}" ${_HR_ORIG_ARGV[@]+"${_HR_ORIG_ARGV[@]}"}
  # `exec` só retorna em falha.
  echo "heavy-run: falha ao reexecutar para resetar disposição de sinal" >&2
  return 70
}
_hr_reset_ignored_signals || exit $?

forge_heavy_mutex_acquire --label "${LABEL:-$*}" || exit $?

# Aqui o wrapper é DONO do próprio processo e não hospeda handler de terceiro — por isso o
# re-raise é incondicional e os códigos 130/143/129 do contrato se mantêm. A biblioteca, que vive
# dentro do processo alheio, não pode ter a mesma regra: lá a transparência manda.
HR_CHILD=""
_hr_sig() {
  # Sinaliza o GRUPO do filho: com job control ele lidera o próprio, e uma suíte pesada tem netos
  # (dotnet, docker) que sobreviveriam a um sinal dirigido só ao pid.
  [ -n "$HR_CHILD" ] && { kill -"$1" "-$HR_CHILD" 2>/dev/null || kill -"$1" "$HR_CHILD" 2>/dev/null; }
  forge_heavy_mutex_release
  trap - "$1"
  kill -"$1" $$
}
trap 'forge_heavy_mutex_release' EXIT
for s in INT TERM HUP; do trap "_hr_sig $s" "$s"; done

# `set -m` ANTES de lançar, e o payload sem a herança de SIG_IGN. Por POSIX, um comando de lista
# assíncrona lançado por shell SEM job control herda SIGINT/SIGQUIT como ignorados — a mesma
# armadilha que a §8.13 catalogou para o consumidor, e que aqui o wrapper infligia à própria carga.
# Medido: com Ctrl-C real (kill -INT no grupo), o wrapper morria com 130, liberava o lock, e o
# payload SEGUIA RODANDO sem lock — o próximo push adquiria e rodava uma segunda suíte por cima,
# que é exatamente o desfecho que este primitivo existe para impedir.
set -m 2>/dev/null || true
"$@" &
HR_CHILD=$!
set +m 2>/dev/null || true
wait "$HR_CHILD"
rc=$?
forge_heavy_mutex_release
exit "$rc"
