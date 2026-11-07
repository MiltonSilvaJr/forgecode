#!/usr/bin/env bash
# lib/heavy-mutex.sh — mutex por MÁQUINA para carga pesada (issue #52).
#
# ONDA W1 — âncora. A W0 importou o protocolo legado como linha de base; esta onda ancora o
# caminho. Este arquivo nasceu como cópia fiel do protocolo que os quatro
# repositórios do canal `axis-contracts` já usam, importado de `Axis.PadSimulator`
# (`.forge/hooks/git/lib/heavy-mutex.sh`) e de `axis-go-cloud`
# (`.githooks/pre-push.d/06-dotnet-suites.sh:105-129`), com os nomes ajustados à API do harness.
#
# Importar o defeito antes de corrigi-lo é deliberado: a partir daqui todo Vermelho da suíte é
# COMPORTAMENTAL contra código real, e não "arquivo não existe" — que não é Vermelho legítimo,
# porque não distingue "a proteção falta" de "a proteção falhou". É também o que dá a linha de
# base contra a qual medir as correções (rule `testing/regression-red-first.md`).
#
# Os dois defeitos que as ondas seguintes corrigem, ambos medidos em campo:
#
#   1. O lock resolve por `$TMPDIR`, que no macOS é por usuário e por contexto de invocação —
#      quatro valores distintos observados ativos na mesma máquina. Duas suítes pesadas adquirem
#      cada uma o seu lock privado e rodam juntas, contaminando exatamente a medição que o mutex
#      existe para proteger.
#   2. `while ! mkdir` é exclusão mútua sem ORDEM. Quem solta e retoma já está a poucas instruções
#      do `mkdir`; quem espera de fora dorme num intervalo de polling. A janela livre é de
#      microssegundos contra segundos, então a chance não melhora com paciência: é inanição, não
#      lentidão. Medido: 1305 segundos de fila para descobrir um erro de sintaxe de 8 segundos.
#
# A ordem de correção é inegociável — ancorar o caminho ANTES de enfileirar. Uma fila por
# `$TMPDIR` é tão particionada quanto um lock por `$TMPDIR`, e o efeito seria duas filas justas
# disputando o mesmo daemon Docker.
# NÃO exportamos LC_ALL: sourcear uma biblioteca não pode mudar o ambiente do consumidor nem o da
# CARGA — e a carga é justamente a suíte cuja medição o mutex existe para proteger. `ps` é chamado
# com o prefixo `LC_ALL=C` em _fhm_token/_fhm_state1, que é onde a fixação importa (o formato de
# lstart muda com LC_TIME sozinho). Glob de fila usa LC_COLLATE só onde ordena.

_FHM_LOCK=""
_FHM_OWNED="false"
_FHM_NONCE=""
_FHM_QDIR=""
_FHM_QSWITCH=""
_FHM_TICKET=""
_FHM_WAIT_START=""
_FHM_CLOCK="hires"
_FHM_RELEASED=0
_FHM_ANCESTOR=""
_FHM_ROOT_FROM_YAML=0
_FHM_LAST_NOTIFY=0

# 0 quando <pid> é ancestral deste processo. Reentrância por LINHAGEM, não por variável de
# ambiente: quem empurra via `heavy-run.sh -- git push` já detém o lock, e o wrapper não exporta
# marcador algum. Se o hook tentasse readquirir, o push recusaria a si mesmo.
_fhm_is_ancestor() {
  local target="$1" cur="$$" hops=0
  case "$target" in ''|*[!0-9]*) return 1 ;; esac
  # Teto de saltos: uma cadeia de PPID corrompida (ou um PID reciclado apontando para si) não pode
  # transformar a checagem em laço infinito dentro de um hook de push.
  while [ "$cur" -gt 1 ] && [ "$hops" -lt 64 ]; do
    [ "$cur" = "$target" ] && return 0
    cur="$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$cur" ] || return 1
    hops=$((hops + 1))
  done
  return 1
}


# ── âncora (D1) ──────────────────────────────────────────────────────────────────────────────────
# TRÊS alvos, TRÊS regimes, porque duas coisas diferentes estão sendo validadas: validamos POSSE do
# que criamos e PROPRIEDADES do que o sistema fornece. Misturar os dois transforma a trava de
# squatting numa recusa universal — medido: `/tmp` no macOS é symlink para `private/tmp` e nos dois
# SOs pertence ao root, então a regra estrita `-L ⇒ erro; -O falso ⇒ erro` recusaria a própria
# âncora default, em toda instalação.
_fhm_die69() { echo "heavy-mutex: $1" >&2; return 69; }

# Raiz declarada no forge.yaml (issue #75). A variável de ambiente continua sendo a via de
# ISOLAMENTO deliberado — e o código diz isso na proveniência —, enquanto esta chave é a via de
# CONVERGÊNCIA: um host onde N repositórios já se serializam por um protocolo legado não conseguia
# migrar um de cada vez, porque o primeiro a migrar partia a exclusão de todos os outros. Ou os N
# migravam na mesma janela, ou nenhum migrava.
#
# E o modo de falha é o pior que esta biblioteca conhece, descrito no próprio cabeçalho dela: cada
# lado adquire com sucesso, roda, e ACREDITA estar protegido. Medido em campo — quatro repositórios
# resolvendo `$TMPDIR/axis-heavy-suite.lock` (que no macOS é `/var/folders/...`) enquanto o migrado
# passaria a resolver `/tmp/forge-heavy-suite.lock`. Igualar só o `resource` resolve a metade
# errada: os dois lados ficam em diretórios diferentes com o MESMO nome, o que torna o diagnóstico
# ainda mais confuso para quem investigar.
_fhm_yaml_root() {
  local yaml="${FORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}/.forge/forge.yaml"
  [ -f "$yaml" ] || return 0
  awk '/^heavy_mutex:/{f=1;next} f&&/^[a-z]/{f=0} f&&/^[[:space:]]*root:/{sub(/^[[:space:]]*root:[[:space:]]*/,"");sub(/[[:space:]]*#.*$/,"");gsub(/["'"'"']/,"");sub(/[[:space:]]+$/,"");print;exit}' "$yaml" 2>/dev/null
}

_fhm_resolve_root() {  # ecoa "<root>\t<proveniência>"; rc 69 se inutilizável
  # Reset explícito: o global é por RESOLUÇÃO, e herdá-lo faria a segunda chamada anunciar
  # "convergência declarada" sobre uma raiz que veio da variável de ambiente.
  _FHM_ROOT_FROM_YAML=0
  local root="${FORGE_HEAVY_MUTEX_ROOT:-}" tab _yr _yr_tmpdir=0 _rl conv=0
  tab="$(printf '\t')"
  # Precedência: env > forge.yaml > /tmp. A env vence porque é isolamento deliberado (e a suíte
  # depende disso para não tocar o lock real da máquina); o yaml entra quando ninguém isolou.
  if [ -z "$root" ]; then
    _yr="$(_fhm_yaml_root)"
    case "$_yr" in
      '') : ;;
      '${TMPDIR:-/tmp}')
        # A EXPRESSÃO literal, reconhecida como token e resolvida em tempo de execução — nunca
        # avaliada. `eval` sobre string vinda de arquivo VERSIONADO é injeção de comando com o
        # privilégio de quem empurra, e bastaria um PR para obtê-la.
        #
        # E precisa ser a expressão, não o valor expandido: `$TMPDIR` no macOS é por usuário E por
        # contexto de invocação (quatro valores distintos medidos ativos na mesma máquina), então
        # congelar no arquivo versionado o valor de UMA máquina quebraria todas as outras — em
        # silêncio, que é o modo de falha desta biblioteca inteira.
        #
        # É também o único valor que um repositório PODE versionar para convergir com o protocolo
        # legado, que monta o caminho exatamente assim. Recusá-lo empurra esse repositório para o
        # `/tmp` fixo e produz dois locks com o MESMO NOME em diretórios diferentes, cada lado
        # adquirindo com sucesso e se achando protegido.
        root="${TMPDIR:-/tmp}"; _FHM_ROOT_FROM_YAML=1; _yr_tmpdir=1 ;;
      /*) root="$_yr"; _FHM_ROOT_FROM_YAML=1 ;;
      *) printf 'heavy-mutex: heavy_mutex.root inválido no forge.yaml (%s) — exigido caminho ABSOLUTO; usando /tmp\n' "$_yr" >&2 ;;
    esac
  fi
  # TRAVA DE TESTE — asserção POSITIVA, não backstop. Um backstop por "existência antes/depois" não
  # detecta um cenário que crie E remova o lock real, porque "inexistente" bate nas duas pontas.
  # Com esta trava, um cenário que esqueça de montar a caixa falha alto em vez de tocar o /tmp da
  # máquina — e a suíte jamais vira a carga que o mutex existe para impedir. Aconteceu de verdade
  # durante a implementação: os cenários da onda W0 isolavam por TMPDIR, a W1 passou a ignorar
  # TMPDIR, e a suíte criou o sidecar no /tmp real sem que nada reclamasse.
  # A trava vale contra a ENV, não contra o que o forge.yaml do repositório disser: um cenário que
  # esqueça de montar a caixa não pode ser salvo por uma chave que ele não controla.
  if [ "${FORGE_HEAVY_MUTEX_TESTING:-}" = "1" ] && [ -z "${FORGE_HEAVY_MUTEX_ROOT:-}" ]; then
    _fhm_die69 "FORGE_HEAVY_MUTEX_TESTING=1 exige FORGE_HEAVY_MUTEX_ROOT — recusado para não tocar o lock real da máquina."
    return 69
  fi
  # Token `${TMPDIR:-/tmp}`: resolvido AQUI, e não dentro do `case`, de propósito — sair antes da
  # trava de teste acima permitiria que um cenário com FORGE_HEAVY_MUTEX_TESTING=1 e sem
  # FORGE_HEAVY_MUTEX_ROOT resolvesse o $TMPDIR REAL e tocasse o lock da máquina, que é exatamente
  # o acidente que a trava existe para impedir (e que já aconteceu uma vez nesta biblioteca).
  #
  # Regime deliberadamente NÃO estrito, igual ao do default: a âncora é FORNECIDA pelo sistema, não
  # criada por nós, então `-O` recusaria o próprio $TMPDIR em instalação legítima. Validamos o que
  # o uso exige — existir e ser gravável.
  if [ "$_yr_tmpdir" = "1" ]; then
    [ -d "$root" ] || { _fhm_die69 "heavy_mutex.root resolveu '$root', que não existe"; return 69; }
    [ -w "$root" ] || { _fhm_die69 "heavy_mutex.root resolveu '$root', que não é gravável"; return 69; }
    # A barra final que o macOS põe em `$TMPDIR` é PRESERVADA de propósito: o legado monta
    # "${TMPDIR:-/tmp}/<recurso>.lock" e produz `//` no meio. Normalizar daria um caminho que
    # resolve para o mesmo inode e IMPRIME string diferente — e comparar recibos entre migrado e
    # legado é o instrumento de detecção de partição. Recibo IDÊNTICO ao do consumidor, pela mesma
    # razão: divergir aqui acusaria partição onde não há.
    printf '%s%sheavy_mutex.root do forge.yaml (compartilhada com os repositórios legados)\n' "${root%/}/" "$tab"
    return 0
  fi
  # Guarda de symlink ANTES de qualquer resolução, porque a convergência abaixo faz `cd`+`pwd -P` —
  # que SEGUE o link, exatamente a operação que o `-L` do regime estrito existe para preceder. Sem
  # esta linha, um valor do arquivo VERSIONADO que seja symlink apontando para o realpath de `/tmp`
  # nunca chegava ao `-L`: convergia, era aceito, e o recibo ainda creditava o default.
  #
  # `${root%/}`, nunca `$root`: `[ -L "caminho/" ]` é sempre FALSO — a barra final força resolução
  # de diretório —, e a guarda viraria textual, disparando só para quem não escreveu a barra.
  #
  # A exceção é `/tmp` LITERAL, e ela é textual de propósito: `/tmp` é symlink no macOS e é a
  # âncora que o próprio default usa (por isso o bloco do default nunca aplica `-L`). A distinção
  # entre "é o default do sistema" e "resolve para o mesmo lugar do default" é o que fecha o
  # buraco: qualquer OUTRO caminho é recusado antes de ser resolvido, e não adianta apontar para lá.
  _rl="${root%"${root##*[!/]}"}"; [ -n "$_rl" ] || _rl="/"
  if [ "${_FHM_ROOT_FROM_YAML:-0}" = "1" ] && [ "$_rl" != "/tmp" ] && [ -L "$_rl" ]; then
    _fhm_die69 "heavy_mutex.root '$root' do forge.yaml é um symlink — recusado. Um terceiro que plante o nome desvia o lock em silêncio, e apontar o link para o mesmo lugar do default não é exceção: a raiz é aceita pelo que ESTÁ escrita, não pelo que resolve."
    return 69
  fi
  # `/tmp` é SYMLINK no macOS (para `/private/tmp`), e o regime estrito recusa symlink por desenho.
  # Declarar `root: /tmp` — o valor que a documentação chama de default — era portanto recusado com
  # rc 69, que é o oposto do que a chave existe para fazer. Uma raiz do YAML que resolve para o
  # mesmo lugar do default segue o caminho do default, não o estrito.
  if [ "${_FHM_ROOT_FROM_YAML:-0}" = "1" ] && [ "$(cd "$root" 2>/dev/null && pwd -P)" = "$(cd /tmp 2>/dev/null && pwd -P)" ]; then
    root=""; _FHM_ROOT_FROM_YAML=0; conv=1
  fi
  if [ -n "$root" ]; then
    # Declarada por quem chama: regime ESTRITO. `-L` primeiro, porque `-d` e `-O` seguem symlink.
    [ -L "$root" ] && { _fhm_die69 "FORGE_HEAVY_MUTEX_ROOT '$root' é um symlink — recusado. Um terceiro que plante o nome desvia o lock em silêncio, e `mkdir -p` aceitaria."; return 69; }
    if [ ! -d "$root" ]; then
      # `mkdir` simples, nunca `-p` e nunca `-m`: medido, `mkdir -p` ACEITA symlink pré-existente e
      # o `pwd -P` segue o link; e `-p` sobre diretório existente não corrige permissão.
      #
      # O `mkdir` que falha porque OUTRO acabou de criar não é âncora inutilizável — é corrida
      # benigna, e é o caso comum quando N consumidores sobem juntos. Confundir os dois faz o
      # primeiro a chegar vencer e todos os demais receberem 69: medido com cinco concorrentes,
      # quatro morriam assim. Reconferimos o estado antes de reprovar.
      mkdir "$root" 2>/dev/null || [ -d "$root" ] || { _fhm_die69 "não consegui criar FORGE_HEAVY_MUTEX_ROOT '$root'"; return 69; }
      [ -L "$root" ] && { _fhm_die69 "FORGE_HEAVY_MUTEX_ROOT '$root' virou symlink durante a criação — recusado."; return 69; }
    fi
    [ -O "$root" ] || { _fhm_die69 "FORGE_HEAVY_MUTEX_ROOT '$root' não pertence ao uid corrente — recusado."; return 69; }
    if [ "${_FHM_ROOT_FROM_YAML:-0}" = "1" ]; then
      # Proveniência DIFERENTE de propósito: declarar a raiz no forge.yaml é o oposto de isolar —
      # é convergir com quem já usa aquele caminho. Reportar as duas com a mesma frase faria o
      # recibo mentir sobre o que está acontecendo.
      printf '%s%sheavy_mutex.root do forge.yaml (convergência declarada)\n' "$root" "$tab"
    else
      printf '%s%sFORGE_HEAVY_MUTEX_ROOT (isolado — não serializa com o resto da máquina)\n' "$root" "$tab"
    fi
    return 0
  fi
  # Default fornecido pelo sistema: exigir `-d`, `-w` e `-k` (sticky). NUNCA `-L`, NUNCA `-O`.
  # E NÃO normalizar com `pwd -P`: o caminho precisa ser a MESMA STRING que o legado imprime e
  # resolve, porque comparar diagnósticos entre migrado e legado é o instrumento de detecção de
  # partição durante toda a migração.
  root="/tmp"
  [ -d "$root" ] || { _fhm_die69 "'$root' não existe"; return 69; }
  [ -w "$root" ] || { _fhm_die69 "'$root' não é gravável"; return 69; }
  [ -k "$root" ] || { _fhm_die69 "'$root' não tem sticky bit — recusado: um diretório mundialmente gravável sem sticky permite que terceiro remova o lock alheio."; return 69; }
  # Proveniência HONESTA. Uma âncora que veio do forge.yaml e convergiu para o default é reportada
  # como tal: dizer "default fixo /tmp" para um valor DECLARADO faz o recibo mentir justamente sobre
  # a origem que se quer auditar. O comentário acima diz que comparar recibos entre migrado e legado
  # é o INSTRUMENTO de detecção de partição — e quem investigar uma partição real descartaria o
  # forge.yaml como causa, porque o recibo o inocentou.
  if [ "$conv" = "1" ]; then
    printf '%s%sheavy_mutex.root do forge.yaml (convergiu para o default /tmp)\n' "$root" "$tab"
  else
    printf '%s%sdefault fixo /tmp\n' "$root" "$tab"
  fi
  return 0
}

_fhm_resource() {
  local r="${FORGE_HEAVY_MUTEX_RESOURCE:-}" yaml
  if [ -z "$r" ]; then
    # Segunda entrada de precedência: `heavy_mutex.resource` no forge.yaml. Sem ela, um repositório
    # que declara `resource: axis-heavy-suite` — exatamente o que a migração manda escrever —
    # resolveria `forge-heavy-suite.lock` e deixaria de se excluir com o legado. Seria o defeito 1
    # reproduzido pelo código que o corrige, e no modo silencioso: cada lado adquire com sucesso.
    yaml="${FORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}/.forge/forge.yaml"
    if [ -f "$yaml" ]; then
      r="$(awk '/^heavy_mutex:/{f=1;next} f&&/^[a-z]/{f=0} f&&/^[[:space:]]*resource:/{sub(/^[[:space:]]*resource:[[:space:]]*/,"");gsub(/["'"'"']/,"");print;exit}' "$yaml" 2>/dev/null)"
    fi
  fi
  [ -n "$r" ] || r="forge-heavy-suite"
  printf '%s' "$r"
}

# Sidecar que NÓS criamos: regime estrito, igual à âncora declarada.
_fhm_ensure_sidecar() {  # _fhm_ensure_sidecar <caminho>
  local d="$1"
  [ -L "$d" ] && { _fhm_die69 "sidecar '$d' é um symlink — recusado."; return 69; }
  if [ ! -d "$d" ]; then
    # Mesma corrida benigna da âncora declarada: com N consumidores subindo juntos, só um vence o
    # `mkdir` e os demais receberiam 69 sobre um sidecar que existe e é válido.
    mkdir "$d" 2>/dev/null || [ -d "$d" ] || { _fhm_die69 "não consegui criar o sidecar '$d'"; return 69; }
    [ -L "$d" ] && { _fhm_die69 "sidecar '$d' virou symlink durante a criação — recusado."; return 69; }
  fi
  [ -O "$d" ] || { _fhm_die69 "sidecar '$d' não pertence ao uid corrente — recusado."; return 69; }
  return 0
}


# ── identidade e liveness (D3) ───────────────────────────────────────────────────────────────────
# `kill -0` NÃO serve para liveness aqui, e a razão é medida: devolve `Operation not permitted`
# para processo VIVO de outro uid — classificando-o como morto — e devolve 0 para ZUMBI, que já
# não segura recurso nenhum. Uma única chamada de `ps` entrega liveness E token, funciona entre
# uids e elimina as duas assimetrias.
#
# `LC_ALL=C` é obrigatório e `LC_TIME` sozinho basta para quebrar: o mesmo PID rende
# `Thu Aug 20 13:53:00 2026` sob C e `qui 20 ago 13:53:00 2026` sob pt_BR. Sem fixar, o token
# gravado por um processo nunca bateria com o recomputado por outro de locale diferente.
# Há padding à direita em `lstart` e em `state`, daí o trim.
_fhm_token() {  # _fhm_token <pid>
  LC_ALL=C ps -o lstart= -p "$1" 2>/dev/null | tr -s ' ' | sed 's/^ *//;s/ *$//'
}

# Só o PRIMEIRO caractere interessa: medido, o macOS produz `S`, `R`, `Z` e `Ss` para o pid 1, e o
# Linux produz `S` e `Z`. Casar o primeiro caractere funciona nos dois.
_fhm_state1() {  # _fhm_state1 <pid>
  LC_ALL=C ps -o state= -p "$1" 2>/dev/null | sed 's/^ *//' | cut -c1
}

_fhm_alive() {  # _fhm_alive <pid> <token-gravado> — 0 se vivo E é o mesmo processo
  local pid="$1" want="$2" now st
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  now="$(_fhm_token "$pid")"
  [ -n "$now" ] || return 1
  st="$(_fhm_state1 "$pid")"
  [ "$st" = "Z" ] && return 1
  # Token gravado ausente é lock do protocolo LEGADO: ele não grava token. Aí a única identidade
  # disponível é o PID, e tratamos como vivo — recusar seria remover lock legado vivo, que é
  # exatamente o dano que a interoperabilidade existe para impedir.
  [ -n "$want" ] || return 0
  [ "$now" = "$want" ]
}


# ── liberação garantida (D6) ─────────────────────────────────────────────────────────────────────
# INVARIANTE DE TRANSPARÊNCIA, e ela é o contrato desta função:
#
#   `arm_trap` é transparente. O único efeito observável sobre o script do consumidor é que
#   `release` roda EXATAMENTE UMA VEZ. Contagem de execuções, ordem, `$?` visto por cada handler e
#   código de saída final são IDÊNTICOS ao baseline sem a biblioteca, para qualquer disposição de
#   traps do consumidor.
#
# A invariante substituiu uma receita porque as receitas erravam. Medido contra o baseline nas três
# disposições possíveis do consumidor: compor sem cuidado faz o handler dele rodar DUAS vezes;
# limpar o EXIT junto com o sinal APAGA o handler dele; e estender a guarda de idempotência ao
# handler dele SUPRIME o de TERM quando o de EXIT já rodou. As três trocam ainda o código de saída
# de 0 para 143 quando o consumidor tem handler de TERM que só limpa e não re-raise.
_fhm_release_once() {
  # Guarda SÓ o `release`, nunca o handler do consumidor — guardar os dois suprime handler alheio.
  [ "${_FHM_RELEASED:-0}" = "1" ] && return 0
  _FHM_RELEASED=1
  forge_heavy_mutex_release
}

_fhm_on_exit() {
  # `$?` PRIMEIRO: qualquer teste antes disto o destrói, e `rc=$?` na primeira linha do handler é
  # o idioma padrão de cleanup — medido, o handler do consumidor via 0 num script que saiu com 7.
  __fhm_rc=$?
  _fhm_release_once
  _fhm_leave_queue
  if [ -n "${_FHM_PREV_EXIT:-}" ]; then
    # Restaura o `$?` que o handler do consumidor veria sem nós, antes de invocá-lo.
    ( exit "$__fhm_rc" )
    eval "$_FHM_PREV_EXIT"
  fi
  return "$__fhm_rc"
}

_fhm_on_sig() {  # $1 = nome do sinal
  __fhm_rc=$?
  __fhm_sig="$1"
  _fhm_release_once
  # Indireção por nome. `${$var}` é sintaxe inválida e silenciosa; `${!var}` não existe em todo
  # shell alvo. Esta forma foi verificada em bash 3.2.
  eval "__fhm_prev=\"\${_FHM_PREV_$__fhm_sig:-}\""
  if [ -n "$__fhm_prev" ]; then
    # O consumidor TEM handler próprio: rode-o e devolva o controle a ele. Se ele re-raise, o
    # processo morre por sinal e o EXIT roda como no baseline; se ele só limpa, o script continua
    # e sai com o código que sairia sem nós — inclusive 0, que é decisão do autor dele.
    ( exit "$__fhm_rc" )
    eval "$__fhm_prev"
    return "$__fhm_rc"
  fi
  # O consumidor NÃO tinha handler para este sinal: morra pelo sinal, limpando SÓ o sinal. O nosso
  # trap de EXIT permanece armado DE PROPÓSITO — medido nos dois SOs, o bash roda o trap de EXIT
  # ao morrer por sinal fatal não trapado, então é isso que o baseline faz, e limpar o EXIT aqui
  # apagaria o handler do consumidor.
  trap - "$__fhm_sig"
  kill -"$__fhm_sig" $$
}

forge_heavy_mutex_arm_trap() {
  # A razão da guarda é portável e não tem a ver com `trap -p`: um trap instalado dentro de
  # subshell MORRE COM ELA e nunca protege o processo que detém o lock. Medido, `BASH_SUBSHELL`
  # vale 1 no último elemento de um pipeline, o que recusa `{ acquire; arm_trap; work; } | tee`.
  [ "${BASH_SUBSHELL:-0}" -eq 0 ] || {
    echo "heavy-mutex: arm_trap chamado de dentro de subshell — o trap morreria com ela e o lock ficaria para trás." >&2
    return 64
  }
  local p b sig
  p="$(trap -p EXIT)"
  # IDEMPOTÊNCIA: uma segunda chamada capturaria o NOSSO handler como "anterior" e o EXIT passaria
  # a se chamar em laço — medido, o processo trava e precisa ser morto. Note que a guarda de
  # `release` mantém o contador em 1 durante a recursão, então contagem não denuncia: só o
  # TÉRMINO denuncia, e é por isso que o cenário assevera término primeiro.
  case "$p" in *_fhm_on_exit*) return 0 ;; esac
  # Extração por `eval`, nunca por corte de prefixo/sufixo: `trap -p` devolve o comando
  # shell-quotado, e o corte produz comando inválido que morre com `unexpected EOF` — em silêncio,
  # porque o rc do script continua correto.
  if [ -n "$p" ]; then b="${p#trap -- }"; b="${b% EXIT}"; eval "_FHM_PREV_EXIT=$b"; fi
  trap _fhm_on_exit EXIT
  for sig in INT TERM HUP; do
    p="$(trap -p "$sig")"
    case "$p" in *_fhm_on_sig*) continue ;; esac
    if [ -n "$p" ]; then
      # `trap -p TERM` devolve o sufixo COMO SIGTERM, não como TERM (medido nos dois SOs). Cortar
      # " $sig" deixa `SIGTERM` colado no fim e o `eval` monta um comando inválido — em silêncio,
      # porque o handler só quebra na hora do sinal. Corta-se o ÚLTIMO campo, seja qual for o nome.
      b="${p#trap -- }"; b="${b% *}"
      eval "_FHM_PREV_$sig=$b"
    fi
    trap "_fhm_on_sig $sig" "$sig"
  done
  return 0
}



# ── diagnóstico de espera (D5) ───────────────────────────────────────────────────────────────────
# Requisito FUNCIONAL, não cosmético: foi a ausência do CAMINHO na mensagem que escondeu a partição
# por catorze horas — duas mensagens idênticas descreviam locks diferentes, e ninguém tinha como
# saber. A posição e a ETA são a resposta parcial ao teto de espera reintroduzir inanição no rabo
# da fila: quem está atrás estoura o teto DEPOIS de ter investido a espera, e precisa poder decidir
# antes. Sempre em stderr, porque o stdout pertence ao comando.
_fhm_fmt_age() {  # segundos -> "19m46s"
  local t="${1:-0}"
  case "$t" in ''|*[!0-9]*) printf '?'; return 0 ;; esac
  if [ "$t" -ge 60 ]; then printf '%dm%02ds' "$((t / 60))" "$((t % 60))"; else printf '%ds' "$t"; fi
}

_fhm_queue_report() {  # ecoa "<minha-posicao> <total> <espera-do-mais-antigo-em-s>"
  local f base n=0 mine=0 oldest="" now us
  now="$(date +%s)"
  for f in "$_FHM_QDIR"/*; do
    [ -d "$f" ] || continue
    n=$((n + 1))
    base="$(basename "$f")"
    # `10#` obrigatório: o carimbo tem 20 dígitos zero-padded e o bash lê zeros à esquerda como
    # OCTAL — `$(( 000017872… ))` morre com "value too great for base".
    us="${base%%.*}"
    case "$us" in ''|*[!0-9]*) us=0 ;; esac
    [ -z "$oldest" ] && oldest="$us"
    [ "$((10#$us))" -lt "$((10#$oldest))" ] && oldest="$us"
    [ -n "${_FHM_TICKET:-}" ] && [ "$base" = "$(basename "$_FHM_TICKET")" ] && mine="$n"
  done
  local waited_oldest=0
  [ -n "$oldest" ] && waited_oldest=$(( now - (10#$oldest) / 1000000 ))
  [ "$waited_oldest" -lt 0 ] && waited_oldest=0
  printf '%s %s %s' "$mine" "$n" "$waited_oldest"
}

_fhm_diag() {  # _fhm_diag <label> <holder> <prov> <waited> <timeout> <qon>
  local label="$1" holder="$2" prov="$3" waited="$4" timeout="$5" qon="$6"
  local age cmd qr pos tot oldest eta
  echo "heavy-mutex: AGUARDANDO — ${label}" >&2
  echo "  lock ........ $_FHM_LOCK (âncora: $prov)" >&2
  if [ -n "$holder" ] && [ "$holder" != "?" ]; then
    age="$(LC_ALL=C ps -o etime= -p "$holder" 2>/dev/null | tr -d ' ')"
    cmd="$(LC_ALL=C ps -o command= -p "$holder" 2>/dev/null | cut -c1-60)"
    echo "  detentor .... PID $holder há ${age:-?} — ${cmd:-?}" >&2
  else
    echo "  detentor .... (lock sem dono legível — janela de escrita)" >&2
  fi
  if [ "$qon" = "LIGADA" ]; then
    qr="$(_fhm_queue_report)"; pos="${qr%% *}"; qr="${qr#* }"; tot="${qr%% *}"; oldest="${qr##* }"
    echo "  fila ........ LIGADA — meu ticket $pos de $tot ($((pos > 0 ? pos - 1 : 0)) na frente; mais antigo aguarda há $(_fhm_fmt_age "$oldest"))" >&2
    # ETA por posição, com a mediana de posse desta máquina aproximada pela idade do detentor.
    if [ "$pos" -gt 1 ] && [ -n "${age:-}" ]; then
      eta=$(( (pos - 1) * 16 ))
      echo "  ETA ......... ~$((pos - 1)) posse(s) à frente; a 16min de mediana, ~${eta}min" >&2
    fi
  else
    echo "  fila ........ DESLIGADA — disputa sem ordem (todos tentam a cada poll)" >&2
  fi
  echo "  espera ...... $(_fhm_fmt_age "$waited") de $(_fhm_fmt_age "$timeout") (FORGE_HEAVY_MUTEX_TIMEOUT_S)" >&2
  echo "  nota ........ entre na fila só com build local verde — 1305s de fila para achar um erro de 8s foi medido em 2026-08-19." >&2
}

forge_heavy_mutex_status() {
  local res rr root prov tab lock qsw hp ht age n=0 f
  tab="$(printf '\t')"
  res="$(_fhm_resource)"
  while [ $# -gt 0 ]; do
    case "$1" in --resource) res="$2"; shift 2 ;; *) return 64 ;; esac
  done
  rr="$(_fhm_resolve_root)" || return 69
  root="${rr%%$tab*}"; prov="${rr#*$tab}"
  lock="$root/$res.lock"; qsw="$root/$res.q.enabled"
  echo "recurso ..... $res"
  echo "lock ........ $lock (âncora: $prov)"
  for f in "$root/$res.q"/*; do [ -d "$f" ] && n=$((n + 1)); done
  if [ -f "$qsw" ]; then
    echo "fila ........ LIGADA — $n ticket(s)"
  else
    echo "fila ........ DESLIGADA — $n ticket(s) (disputa sem ordem)"
  fi
  if [ -d "$lock" ]; then
    hp="$(cat "$lock/pid" 2>/dev/null || echo '?')"
    ht="$(cat "$lock/token" 2>/dev/null || echo '')"
    age="$(LC_ALL=C ps -o etime= -p "$hp" 2>/dev/null | tr -d ' ')"
    if _fhm_alive "$hp" "$ht"; then
      # Terceiro estado do diagnóstico (D19): posse legítima, órfã por BENEFICIÁRIO, ou ESTAGNADA
      # por idade — a idade impressa vem de `acquired_at` (a POSSE), nunca do `etime` do processo
      # (a linha acima, ${age}, mede o PROCESSO — um detentor recém-nascido pode segurar um lock
      # antigo, e usar `etime` para "estagnada" imprimiria o número errado).
      local _fhm_lock_save="$_FHM_LOCK" _fhm_pose_age _fhm_stale_eff
      _FHM_LOCK="$lock"
      _fhm_stale_eff="$(_fhm_resolve_stale_after 2>/dev/null)"
      if _fhm_beneficiary_orphaned; then
        echo "detentor .... PID $hp há ${age:-?} — ÓRFÃO POR BENEFICIÁRIO (PID ${_FHM_LAST_BENEFICIARY} morto), reclamável"
      elif [ "${_fhm_stale_eff:-0}" -gt 0 ] && _fhm_pose_age="$(_fhm_lock_age)" && [ "$_fhm_pose_age" -gt "$_fhm_stale_eff" ]; then
        echo "detentor .... PID $hp há ${age:-?} — posse ESTAGNADA há ${_fhm_pose_age}s (idade da posse, não do processo; teto declarado ${_fhm_stale_eff}s), reclamável"
      else
        echo "detentor .... PID $hp há ${age:-?}"
      fi
      _FHM_LOCK="$_fhm_lock_save"
    else
      echo "detentor .... PID $hp — ÓRFÃO (processo morto, zumbi ou PID reciclado)"
    fi
    return 1
  fi
  echo "detentor .... (livre)"
  return 0
}

forge_heavy_mutex_path() {
  local res rr root prov tab
  tab="$(printf '\t')"
  res="$(_fhm_resource)"
  while [ $# -gt 0 ]; do
    case "$1" in
      --resource) res="$2"; shift 2 ;;
      *) echo "heavy-mutex: argumento desconhecido '$1'" >&2; return 64 ;;
    esac
  done
  rr="$(_fhm_resolve_root)" || return 69
  root="${rr%%$tab*}"; prov="${rr#*$tab}"
  printf '%s/%s.lock%s%s\n' "$root" "$res" "$tab" "$prov"
  return 0
}


# ── fila FIFO (D4) ───────────────────────────────────────────────────────────────────────────────
# DUAS CAMADAS, e a de justiça nunca enfraquece a de segurança. Segurança é o `mkdir`: se dois
# tentam, um perde, sempre. Justiça é: só TENTA quem é cabeça da fila. No empate, ambos tentam, o
# `mkdir` decide, o perdedor volta a esperar — a injustiça fica confinada a microssegundos, contra
# os minutos que a fila ordena.
#
# Por que a fila NÃO pode ser o mecanismo de exclusão: P1 lê o relógio e é desescalonado antes de
# criar o ticket; P2 lê depois, cria, varre, vê-se sozinho e entra; P1 volta, cria o ticket mais
# antigo, varre, julga-se o menor e TAMBÉM entra. A ordem de leitura do relógio e a ordem de
# visibilidade da criação não são a mesma ordem, e resolução de relógio nenhuma conserta isso.
#
# Por que isso mata a inanição medida: quem solta e retoma é um PROCESSO NOVO — pega ticket novo,
# vai para o fim. Estar a poucas instruções do `mkdir` deixa de ser o que decide.

# Microssegundos em 20 dígitos: a ordem lexicográfica do glob passa a coincidir com a numérica.
# Sem `perl`, cai para resolução de 1s arredondando para CIMA — medido, truncar para baixo dá ao
# degradado até 1 segundo de vantagem sistemática, e ele furaria a fila de todo mundo do segundo.
_fhm_now_us20() {
  local us
  us="$(perl -MTime::HiRes -e 'printf "%.0f", Time::HiRes::time()*1000000' 2>/dev/null)"
  if [ -n "$us" ]; then _FHM_CLOCK="hires"; else _FHM_CLOCK="degradado"; us="$(date +%s)999999"; fi
  printf '%020d' "$us" 2>/dev/null || printf '%020d' 0
}

_fhm_queue_enabled() { [ -f "$_FHM_QSWITCH" ]; }

# Recolhe o PRÓPRIO ticket. Remoção SIMÉTRICA à criação: `mv` para `.reaping.` e só então
# `rm -rf`. Medido, a criação por staging+`mv` nunca é observada parcial, mas o `rm -rf` direto
# produz observações de ticket sem `pid`/`token`; a assimetria estava na ponta errada.
_fhm_leave_queue() {
  [ -n "${_FHM_TICKET:-}" ] || return 0
  [ -d "$_FHM_TICKET" ] || { _FHM_TICKET=""; return 0; }
  # Nunca destrua o que você não provou ser seu — mesmo princípio do `release`. Mas "li outro pid"
  # e "não consegui ler" NÃO são o mesmo desfecho: se o arquivo existe e a leitura veio vazia, o
  # que falhou foi o fork do `cat`, e falta de fork é justamente o que acontece sob a carga que
  # este mutex existe para conter. Abandonar aí largaria o NOSSO ticket vivo na cabeça da fila,
  # travando todo mundo atrás até o teto — perder o próprio lugar por escassez de recurso é o
  # oposto do que a fila promete.
  local _fhm_lq_pid; _fhm_lq_pid="$(cat "$_FHM_TICKET/pid" 2>/dev/null)"
  if [ "$_fhm_lq_pid" != "$$" ]; then
    if [ -n "$_fhm_lq_pid" ] || [ ! -f "$_FHM_TICKET/pid" ]; then _FHM_TICKET=""; return 0; fi
    # arquivo presente e leitura vazia ⇒ falha de leitura, não ticket alheio: seguimos e recolhemos.
  fi
  local reap="$_FHM_QDIR/.reaping.$(basename "$_FHM_TICKET").${_FHM_NONCE:-x}"
  mv "$_FHM_TICKET" "$reap" 2>/dev/null && rm -rf "$reap" 2>/dev/null
  _FHM_TICKET=""
  return 0
}

# Enfileira com o carimbo dado, com PÓS-VERIFICAÇÃO obrigatória. `mv src dst` com `dst` existente
# devolve rc 0 e ANINHA (medido nos dois SOs): sem conferir, o processo acredita ter enfileirado,
# o ticket no disco pertence a outro, ele nunca é cabeça, e volta ao timeout sobre recurso livre —
# o estado absorvente reproduzido pelo código que o corrige.
_fhm_enqueue() {  # _fhm_enqueue <us20>
  local stamp="$1" stag dest
  stag="$_FHM_QDIR/.staging.$$.$stamp"
  rm -rf "$stag" 2>/dev/null
  mkdir -p "$stag" 2>/dev/null || return 1
  printf '%s\n' "$$" > "$stag/pid" || return 1
  printf '%s\n' "$(_fhm_token "$$")" > "$stag/token" 2>/dev/null
  dest="$_FHM_QDIR/$stamp.$$"
  mv "$stag" "$dest" 2>/dev/null || { rm -rf "$stag"; return 1; }
  if [ ! -f "$dest/pid" ] || [ "$(cat "$dest/pid" 2>/dev/null)" != "$$" ]; then
    echo "heavy-mutex: destino de ticket ocupado por terceiro — reenfileirando com carimbo novo" >&2
    rm -rf "$dest/.staging.$$.$stamp" 2>/dev/null
    return 1
  fi
  _FHM_TICKET="$dest"
  return 0
}

# Menor ticket VIVO. Varre e recolhe mortos no caminho, idempotentemente, por qualquer participante.
_fhm_head_ticket() {
  local f base tpid ttok head=""
  for f in "$_FHM_QDIR"/*; do
    [ -d "$f" ] || continue
    base="$(basename "$f")"
    tpid="$(cat "$f/pid" 2>/dev/null || echo '')"
    ttok="$(cat "$f/token" 2>/dev/null || echo '')"
    if [ -z "$tpid" ] || ! _fhm_alive "$tpid" "$ttok"; then
      mv "$f" "$_FHM_QDIR/.reaping.$base.dead" 2>/dev/null && rm -rf "$_FHM_QDIR/.reaping.$base.dead" 2>/dev/null
      continue
    fi
    [ -z "$head" ] && head="$base"
  done
  printf '%s' "$head"
}


# Reivindica e remove um lock ÓRFÃO com exclusividade.
#
# Por que não basta `rm -rf`: a decisão de "isto é órfão" nasce de uma leitura e o `rm` acontece
# DEPOIS. Entre os dois, o dono pode ter liberado e um terceiro criado o lock — e o `rm` cai sobre
# o lock de quem acabou de vencer a corrida, JÁ CONFIRMADO. Medido: duas cargas pesadas
# entrelaçadas na testemunha, que é a falha de segurança que este primitivo existe para impedir.
# A confirmação de posse não cobre isso: ela é um INSTANTE, e a remoção vem depois dela — detectar
# na entrada não protege quem já entrou, então a proteção tem de estar do lado de quem remove.
#
# `mv` para nome exclusivo é `rename(2)`, atômico: dois reivindicantes competem e só um leva o
# diretório, porque o outro falha com a origem já ausente. Quem levou RECONFERE o que tem na mão e
# devolve se não for mais o órfão que motivou a decisão. É o mesmo princípio do `release`, que
# confere PID e nonce antes de remover: nunca destrua o que você não provou ser seu.

# Reentrância por LINHAGEM, reavaliada. A ordem normativa é identidade → linhagem → enfileirar, e
# ela é fixada porque a inversão dá DEADLOCK: medido, verificar linhagem DENTRO do ramo de
# cabeça-de-fila faz o filho esperar atrás da fila pelo processo que o gerou.
#
# O token do ancestral TEM de conferir: um PID reciclado que por acaso esteja na nossa árvore de
# ancestrais não pode nos fazer seguir sem lock nenhum.
_fhm_reentrant_now() {  # 0 quando o detentor atual é ancestral vivo e coerente
  local h t
  [ -d "$_FHM_LOCK" ] || return 1
  h="$(cat "$_FHM_LOCK/pid" 2>/dev/null || echo '')"
  [ -n "$h" ] || return 1
  t="$(cat "$_FHM_LOCK/token" 2>/dev/null || echo '')"
  _fhm_alive "$h" "$t" || return 1
  _fhm_is_ancestor "$h" || return 1
  _FHM_ANCESTOR="$h"
  return 0
}

_fhm_reclaim_orphan() {  # _fhm_reclaim_orphan <pid-esperado>
  local want="$1" reap p2 t2
  reap="${_FHM_LOCK}.reaping.$$.$(date +%s).${RANDOM:-0}"
  mv "$_FHM_LOCK" "$reap" 2>/dev/null || return 1
  p2="$(cat "$reap/pid" 2>/dev/null || echo '')"
  t2="$(cat "$reap/token" 2>/dev/null || echo '')"
  if [ "$p2" = "$want" ] && ! _fhm_alive "$p2" "$t2"; then
    echo "heavy-mutex: lock órfão de PID $want removido em $_FHM_LOCK (processo morto, zumbi ou PID reciclado)." >&2
    rm -rf "$reap" 2>/dev/null
    return 0
  fi
  if [ ! -d "$_FHM_LOCK" ] && mv "$reap" "$_FHM_LOCK" 2>/dev/null; then
    return 1
  fi
  # Não foi possível devolver: alguém já ocupou o nome. O diretório é EVIDÊNCIA de uma reivindicação
  # que atropelou um detentor, e apagá-lo em silêncio repetiria o defeito num nível acima — mas
  # deixá-lo para sempre planta lixo em /tmp. Fica com nome que o `sweep` reconhece e recolhe.
  echo "heavy-mutex: reivindicação de órfão atropelou um detentor novo (PID ${p2:-?}); evidência em $reap (recolhida por: heavy-run.sh sweep)" >&2
  return 1
}

_FHM_LAST_BENEFICIARY=""

# ── posse órfã por BENEFICIÁRIO morto (issue #144) e por IDADE (issue #137) ────────────────────
#
# A ausência de identidade NUNCA é licença para destruir — mesmo idioma que `_fhm_alive` já aplica
# ao token (`[ -n "$want" ] || return 0`). Campo ausente, vazio, não numérico ou <= 1 NUNCA
# reclama: PID 0 endereça o grupo do chamador (`kill -0 0` é sucesso) e PID 1 é o próprio init —
# um campo corrompido para um desses dois não pode virar "beneficiário vivo" ou "beneficiário
# válido" por acidente.
_fhm_beneficiary_orphaned() {  # 0 quando há beneficiário DECLARADO e ele está MORTO
  local b bt
  b="$(cat "$_FHM_LOCK/beneficiary" 2>/dev/null)"
  case "$b" in ''|*[!0-9]*) return 1 ;; esac
  [ "$b" -gt 1 ] || return 1
  bt="$(cat "$_FHM_LOCK/beneficiary_token" 2>/dev/null)"
  _FHM_LAST_BENEFICIARY="$b"
  _fhm_alive "$b" "$bt" && return 1
  return 0
}

# Idade da posse, pela leitura de `acquired_at` — NUNCA pelo `etime` do detentor, que mede a idade
# do PROCESSO e não da POSSE (um detentor recém-nascido pode segurar um lock antigo). Ausente,
# vazio, não numérico, <= 0 ou no FUTURO: idade NÃO É COMPUTÁVEL, e "não sei a idade" não é
# licença para tratar como "é velho".
_fhm_lock_age() {  # ecoa a idade em segundos; rc 1 quando não computável
  local at now
  at="$(cat "$_FHM_LOCK/acquired_at" 2>/dev/null)"
  case "$at" in ''|*[!0-9]*) return 1 ;; esac
  [ "$at" -gt 0 ] || return 1
  now="$(date +%s)"
  [ "$at" -le "$now" ] || return 1
  printf '%s' "$((now - at))"
  return 0
}

# Graça entre TERM e KILL. Botão de OPERAÇÃO de uma máquina, não contrato de repositório — por
# isso não tem chave em forge.yaml (só a variável de ambiente).
_fhm_stale_grace() {
  case "${FORGE_HEAVY_MUTEX_STALE_GRACE_S:-}" in
    ''|*[!0-9]*) printf 5 ;;
    *) printf '%s' "$FORGE_HEAVY_MUTEX_STALE_GRACE_S" ;;
  esac
}

_FHM_ESCALATE_CONSUMED=0

# Encerramento TERM -> graça -> KILL, com remoção só depois de morte CONFIRMADA (D6). Nunca faz
# `rm -rf` sobre detentor vivo — delega a remoção ao primitivo que já existe e já reconfere pid e
# token (`_fhm_reclaim_orphan`). Imprime o censo de descendentes ANTES do encerramento (D11),
# porque depois dele os filhos são reparentados e o vínculo de ppid some.
_fhm_escalate_and_reclaim() {  # _fhm_escalate_and_reclaim <holder> <holder-token> <motivo>
  local holder="$1" htok="$2" motivo="$3" grace poll consumed=0 nfilhos
  grace="$(_fhm_stale_grace)"
  poll="${FORGE_HEAVY_MUTEX_POLL_HEAD_S:-1}"
  nfilhos="$(LC_ALL=C ps -Ao ppid= 2>/dev/null | tr -d ' ' | grep -cx "$holder" 2>/dev/null)"
  echo "heavy-mutex: RECOLHENDO posse — ${motivo} (PID $holder, ${nfilhos:-0} descendente(s) direto(s) medido(s) antes do encerramento)" >&2
  kill -TERM "$holder" 2>/dev/null
  while [ "$consumed" -lt "$grace" ]; do
    if [ ! -d "$_FHM_LOCK" ]; then
      _FHM_ESCALATE_CONSUMED="$consumed"
      echo "heavy-mutex: detentor liberou a posse após o sinal (TERM) — ${motivo}" >&2
      return 0
    fi
    sleep "$poll"
    consumed=$((consumed + poll))
  done
  if [ -d "$_FHM_LOCK" ]; then
    kill -KILL "$holder" 2>/dev/null
    sleep 1
    consumed=$((consumed + 1))
  fi
  _FHM_ESCALATE_CONSUMED="$consumed"
  if [ ! -d "$_FHM_LOCK" ]; then
    return 0
  fi
  if ! _fhm_alive "$holder" "$htok"; then
    if _fhm_reclaim_orphan "$holder"; then
      echo "heavy-mutex: posse recolhida — ${motivo} (PID $holder)" >&2
      return 0
    fi
    return 1
  fi
  echo "heavy-mutex: recolhimento TENTADO e FALHOU — ${motivo} (PID $holder segue vivo após TERM/KILL; morte não confirmada, posse NÃO removida)" >&2
  return 1
}


# Escreve os metadados e CONFIRMA a posse; devolve 1 quando o lock foi revogado no meio, e o
# chamador RETENTA em vez de desistir. Desistir transformaria uma corrida benigna em falha de
# push: medido com cinco concorrentes, três saíam com rc 75 sobre um recurso que estava LIVRE.
_fhm_claim() {  # _fhm_claim <label> <beneficiario>
  local label="$1" beneficiary="${2:-}"
  # `pid` PRIMEIRO, porque é o campo que o legado lê: estreita ao máximo a janela em que o lock
  # existe sem dono legível. Todo `rc` de escrita é conferido — um `printf` que falhe é falha de
  # AQUISIÇÃO, não um aviso solto no stderr.
  printf '%s\n' "$$" > "$_FHM_LOCK/pid" || { echo "heavy-mutex: não consegui escrever $_FHM_LOCK/pid" >&2; return 1; }
  # Sonda de teste: reproduz determinística e exclusivamente a revogação por consumidor legado
  # dentro da janela, para que o cenário [19] meça a decisão e não dependa de vencer uma corrida.
  [ "${FORGE_HEAVY_MUTEX_REVOKE_PROBE:-}" = "1" ] && rm -rf "$_FHM_LOCK"
  # Segunda sonda: o lock CONTINUA existindo, mas com dono diferente — é o que acontece quando um
  # terceiro recria o nome entre o nosso mkdir e a confirmação. Sem ela, o cenário [19] exercitaria
  # só o ramo `[ ! -d ]` e as comparações de pid/nonce ficariam sem alvo (removê-las não reprovava).
  if [ "${FORGE_HEAVY_MUTEX_STEAL_PROBE:-}" = "1" ]; then
    rm -rf "$_FHM_LOCK" 2>/dev/null
    mkdir -p "$_FHM_LOCK" 2>/dev/null
    printf '%s\n' "999999" > "$_FHM_LOCK/pid" 2>/dev/null
    printf '%s\n' "nonce-de-terceiro" > "$_FHM_LOCK/nonce" 2>/dev/null
  fi
  printf '%s\n' "$(_fhm_token "$$")" > "$_FHM_LOCK/token" 2>/dev/null
  printf '%s\n' "$_FHM_NONCE" > "$_FHM_LOCK/nonce" 2>/dev/null
  printf '%s\n' "$(date +%s)" > "$_FHM_LOCK/acquired_at" 2>/dev/null
  printf '%s\n' "${label}" > "$_FHM_LOCK/label" 2>/dev/null
  printf '%s\n' "$(_fhm_state1 "$$")" > "$_FHM_LOCK/state" 2>/dev/null
  printf '%s\n' "$(id -un 2>/dev/null || echo '?')" > "$_FHM_LOCK/owner" 2>/dev/null
  printf '%s\n' "$(LC_ALL=C ps -o command= -p "$$" 2>/dev/null | cut -c1-200)" > "$_FHM_LOCK/cmd" 2>/dev/null
  # Beneficiário (issue #144): só gravado quando DECLARADO e VÁLIDO (inteiro > 1). Campo ausente
  # ou inválido não vira arquivo — leitura de arquivo inexistente já é "não reclamável" por
  # `_fhm_beneficiary_orphaned`, então não há necessidade de gravar lixo para distinguir isso.
  case "$beneficiary" in
    ''|*[!0-9]*) : ;;
    *)
      if [ "$beneficiary" -gt 1 ] 2>/dev/null; then
        printf '%s\n' "$beneficiary" > "$_FHM_LOCK/beneficiary" 2>/dev/null
        printf '%s\n' "$(_fhm_token "$beneficiary")" > "$_FHM_LOCK/beneficiary_token" 2>/dev/null
      fi ;;
  esac

  # CONFIRMAÇÃO DE POSSE. Escrever `pid` primeiro ESTREITA a janela (medido: mediana 87 µs, p95
  # 130 µs), não a fecha — e um consumidor legado que a atravesse remove o nosso lock e segue.
  # Sem esta releitura, o processo continua se comportando como detentor de um lock que não existe
  # mais, tendo produzido apenas uma linha `No such file or directory` que ninguém lê: duas suítes
  # pesadas rodando juntas, que é o defeito que o mutex existe para impedir.
  if [ ! -d "$_FHM_LOCK" ] || [ "$(cat "$_FHM_LOCK/pid" 2>/dev/null)" != "$$" ] \
     || [ "$(cat "$_FHM_LOCK/nonce" 2>/dev/null)" != "$_FHM_NONCE" ]; then
    echo "heavy-mutex: lock revogado durante a janela de escrita — refazendo a aquisição ($_FHM_LOCK)" >&2
    _FHM_OWNED="false"
    return 1
  fi
  return 0
}

# Terceira precedência do timeout: env > forge.yaml > 1800. Sem ela, a chave `timeout_s` que o
# template entrega seria config publicada no npm que ninguém lê — pior que não ter a chave, porque
# quem a ajusta acredita ter ajustado. É a frase que este arquivo aplica aos aliases do wrapper.
_fhm_yaml_timeout() {
  local yaml="${FORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}/.forge/forge.yaml"
  [ -f "$yaml" ] || return 0
  # O `sub` do comentário é obrigatório, não cosmético: `timeout_s: 600 # 10 minutos` é ortografia
  # YAML corriqueira — e o forge.yaml que o template entrega é quase todo comentário. Sem isso o
  # valor sai como "600 # 10 minutos", a validação numérica no chamador o descarta e o timeout
  # volta para 1800 SEM UMA LINHA DE AVISO. Que é exatamente o defeito que este campo foi criado
  # para eliminar: config publicada que ninguém lê é pior que config ausente, porque quem a ajusta
  # acredita ter ajustado.
  awk '/^heavy_mutex:/{f=1;next} f&&/^[a-z]/{f=0} f&&/^[[:space:]]*timeout_s:/{sub(/^[[:space:]]*timeout_s:[[:space:]]*/,"");sub(/[[:space:]]*#.*$/,"");gsub(/["'"'"']/,"");sub(/[[:space:]]+$/,"");print;exit}' "$yaml" 2>/dev/null
}

# Teto de POSSE (issue #137) — OPT-IN, ausente significa DESLIGADO. Precedência idêntica à do
# timeout: env > forge.yaml > ausente. NÃO existe terceiro degrau numérico aqui — decisão DH-5 do
# dono: um default derivado (mesmo pela metade do teto de espera) encerraria dono vivo em TODO
# consumidor que ligasse o mutex sem nunca ter declarado nada, o que é regressão de produto. Quando
# o consumidor declara um valor, ele é RESPEITADO como está (DA-06) — nunca rebaixado —, mesmo que
# ultrapasse o teto de espera menos a reserva; nesse caso o efeito é só um AVISO (ver _fhm_stale_*).
_fhm_yaml_stale_after() {
  local yaml="${FORGE_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}/.forge/forge.yaml"
  [ -f "$yaml" ] || return 0
  awk '/^heavy_mutex:/{f=1;next} f&&/^[a-z]/{f=0} f&&/^[[:space:]]*stale_after_s:/{sub(/^[[:space:]]*stale_after_s:[[:space:]]*/,"");sub(/[[:space:]]*#.*$/,"");gsub(/["'"'"']/,"");sub(/[[:space:]]+$/,"");print;exit}' "$yaml" 2>/dev/null
}

# Resolução de `stale_after_s`, compartilhada entre `forge_heavy_mutex_acquire` e
# `forge_heavy_mutex_status` — as duas precisam do MESMO efetivo, senão o `status` classificaria
# como "estagnada" uma posse que o `acquire` nunca reclamaria (ou o oposto).
_fhm_resolve_stale_after() {
  local _sa_env _sa_yaml=""
  _sa_env="${FORGE_HEAVY_MUTEX_STALE_AFTER_S:-}"
  case "$_sa_env" in
    '') : ;;
    *[!0-9]*)
      printf 'heavy-mutex: FORGE_HEAVY_MUTEX_STALE_AFTER_S inválido (%s) — exigido inteiro >= 0 em SEGUNDOS; ignorando\n' "$_sa_env" >&2
      _sa_env="" ;;
  esac
  if [ -z "$_sa_env" ]; then
    _sa_yaml="$(_fhm_yaml_stale_after)"
    case "$_sa_yaml" in
      '') : ;;
      *[!0-9]*)
        printf 'heavy-mutex: stale_after_s inválido no forge.yaml (%s) — exigido inteiro >= 0; recuperação por idade DESLIGADA\n' "$_sa_yaml" >&2
        _sa_yaml="" ;;
    esac
  fi
  printf '%s' "${_sa_env:-${_sa_yaml:-0}}"
}

forge_heavy_mutex_acquire() {
  # Precedência do teto: env > forge.yaml > 1800. Cada degrau é validado ANTES de o seguinte ser
  # consultado, e essa ordem não é estética: validar o env depois de já ter decidido não ler o YAML
  # faz um env inválido pular o YAML e cair direto no 1800 — medido, um `timeout_s: 4` declarado no
  # repositório virava 1800s de espera porque alguém exportou `30m` no ambiente. Um valor inválido
  # tem de ser tratado como AUSENTE, e ausente é exatamente o que devolve a vez ao degrau de baixo.
  local _t_env _t_yaml=""
  _t_env="${FORGE_HEAVY_MUTEX_TIMEOUT_S:-}"
  # `0` é VÁLIDO nos três caminhos e significa "recusa de imediato", não erro. Antes ele era
  # recusado no YAML e aceito pela variável de ambiente: a mesma grandeza com duas semânticas para
  # o mesmo valor, dependendo de onde foi escrita.
  case "$_t_env" in
    '') : ;;
    *[!0-9]*)
      # SEM esta validação o valor cru chega em `[ "$waited" -ge "$timeout" ]`, o teste falha com
      # "integer expression expected", o -ge NUNCA é verdade e o teto NUNCA dispara: o acquire fica
      # preso para sempre. Num pre-push isso é um `git push` que não termina — e a issue que
      # originou este arquivo nasceu de 1305 segundos de fila, então laço infinito é aquele mesmo
      # sintoma sem fim e sem um 75 para explicar. O caso realista não é digitar letras ao acaso: o
      # alias de compatibilidade AXIS_HEAVY_SUITE_WAIT é em MINUTOS, e quem tem "30" na memória
      # muscular escreve `30m` numa variável que é em SEGUNDOS.
      printf 'heavy-mutex: FORGE_HEAVY_MUTEX_TIMEOUT_S inválido (%s) — exigido inteiro >= 0 em SEGUNDOS; ignorando\n' "$_t_env" >&2
      _t_env="" ;;
  esac
  if [ -z "$_t_env" ]; then
    _t_yaml="$(_fhm_yaml_timeout)"
    # Valor ausente é legítimo e cala; valor PRESENTE e inválido avisa em stderr e segue para o
    # degrau seguinte, porque config errada não deve travar um push.
    case "$_t_yaml" in
      '') : ;;
      *[!0-9]*)
        printf 'heavy-mutex: timeout_s inválido no forge.yaml (%s) — exigido inteiro >= 0; usando 1800s\n' "$_t_yaml" >&2
        _t_yaml="" ;;
    esac
  fi
  # Teto de posse: mesma disciplina de validação do teto de espera, sem terceiro degrau (ver
  # comentário de `_fhm_yaml_stale_after`). Ausente (nos dois degraus) = 0 = DESLIGADO.
  local stale_after; stale_after="$(_fhm_resolve_stale_after)"
  local beneficiary="${FORGE_HEAVY_MUTEX_BENEFICIARY:-}"
  case "$beneficiary" in ''|*[!0-9]*) beneficiary="" ;; esac

  local label="carga pesada" timeout="${_t_env:-${_t_yaml:-1800}}" waited=0 holder
  # O contador de reimpressão é por AQUISIÇÃO, não por processo. Ele é global porque os dois laços
  # de espera precisam enxergá-lo, mas herdar o valor da aquisição anterior faz a subtração ficar
  # negativa na seguinte, e o primeiro diagnóstico some por até LAST_NOTIFY + NOTIFY_S segundos —
  # silêncio numa espera que já começou, que é o pior momento para não dizer nada.
  _FHM_LAST_NOTIFY=0
  local _sa_warned=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --label)
        case "${2:-}" in
          '') echo "heavy-mutex: --label vazio — recusado" >&2; return 64 ;;
        esac
        label="$2"; shift 2 ;;
      --timeout)
        case "${2:-}" in
          ''|*[!0-9]*)
            echo "heavy-mutex: --timeout inválido '${2:-}' — exigido inteiro >= 0 em segundos" >&2
            return 64 ;;
        esac
        timeout="$2"; shift 2 ;;
      *) echo "heavy-mutex: argumento desconhecido '$1'" >&2; return 64 ;;
    esac
  done

  local rr root prov res tab
  tab="$(printf '\t')"
  res="$(_fhm_resource)"
  rr="$(_fhm_resolve_root)" || return 69
  root="${rr%%$tab*}"; prov="${rr#*$tab}"
  _fhm_ensure_sidecar "$root/$res.q" || return 69
  _FHM_LOCK="$root/$res.lock"
  _FHM_QDIR="$root/$res.q"
  _FHM_QSWITCH="$root/$res.q.enabled"
  # WAIT_START é o instante em que ESTE processo começou a esperar, e é o carimbo do ticket mesmo
  # que ele só venha a ser criado mais tarde — é o que preserva a espera já investida quando o
  # interruptor liga no meio do voo, em vez de mandar para o fim quem esperava há vinte minutos.
  _FHM_WAIT_START="$(_fhm_now_us20)"
  _FHM_TICKET=""

  local incomplete=0 holder htok
  _FHM_NONCE="$$.$(date +%s).${RANDOM:-0}"
  # Passo 3 da ordem normativa: reentrância é verificada ANTES de enfileirar, e o caminho
  # reentrante NÃO cria ticket. Enfileirar primeiro e descobrir a linhagem depois deixaria o
  # ticket de um processo que não está esperando na cabeça da fila, bloqueando quem espera atrás
  # por uma posse inteira.
  if _fhm_reentrant_now; then
    echo "heavy-mutex: lock já detido por processo ancestral (PID $_FHM_ANCESTOR) — seguindo sem readquirir." >&2
    _FHM_OWNED="false"
    FORGE_HEAVY_MUTEX_REENTRANT=1
    export FORGE_HEAVY_MUTEX_REENTRANT
    return 0
  fi

  # A sexta saída da fila (morte por sinal DURANTE a espera) só funciona se houver trap instalado
  # enquanto se espera — e o uso canônico arma DEPOIS do acquire, quando a espera já terminou.
  #
  # Armamos aqui pela MESMA função do consumidor, e não por um `trap` cru: um trap cru SUBSTITUI o
  # handler dele (trap não acumula) e o desarme posterior o apagaria de vez — que é exatamente o
  # defeito do ci-local.sh que este primitivo existe para evitar. Medido: a matriz [47] reprovou
  # com `disp1:EXIT(1!=0)` na primeira tentativa desta correção.
  #
  # `arm_trap` é idempotente e preserva o que já existe, então a chamada do consumidor depois é
  # no-op. Durante a espera o `release` embutido é no-op (não detemos nada) e o `leave_queue` faz
  # o trabalho. O retorno é ignorado de propósito: dentro de subshell ele recusa com 64, e isso
  # não pode transformar uma aquisição legítima em falha.
  forge_heavy_mutex_arm_trap >/dev/null || true

  local qon="DESLIGADA" head
  if _fhm_queue_enabled; then
    qon="LIGADA"
    _fhm_enqueue "$_FHM_WAIT_START" || _fhm_enqueue "$(_fhm_now_us20)" || true
  fi

  while : ; do
    # PORTÃO DE JUSTIÇA: só a cabeça TENTA. Com a fila desligada, todos tentam — que é o
    # comportamento legado, e é o que mantém a migração monótona em corretude.
    # 6b — reentrância REAVALIADA: o ancestral pode ter adquirido depois de nós. Sem isto, um
    # filho que entrou na fila antes de o ancestral pegar o lock espera atrás da fila pelo
    # processo que o gerou. Custa um `cat` e um `ps` por poll.
    if _fhm_reentrant_now; then
      echo "heavy-mutex: lock passou a ser detido por processo ancestral (PID $_FHM_ANCESTOR) — seguindo sem readquirir." >&2
      _FHM_OWNED="false"
      FORGE_HEAVY_MUTEX_REENTRANT=1
      export FORGE_HEAVY_MUTEX_REENTRANT
      _fhm_leave_queue
      return 0
    fi
    # 6a — interruptor REAVALIADO: pode ter mudado no meio do voo. Desligado, recolhemos o ticket
    # em vez de deixá-lo na fila — um ticket órfão na cabeça bloqueia quem respeita a fila.
    if ! _fhm_queue_enabled; then
      qon="DESLIGADA"
      _fhm_leave_queue
    fi
    if _fhm_queue_enabled; then
      qon="LIGADA"
      # O próprio ticket pode ter sido varrido por terceiro. Não reenfileirar tornaria "não sou
      # cabeça" um estado ABSORVENTE: medido, o processo espera o teto inteiro com o lock LIVRE.
      # "existe?" NÃO basta: o nome do ticket é determinístico, então ele pode ter sido ocupado por
      # terceiro entre a nossa leitura e agora. Adotá-lo faz o processo contar-se como cabeça pelo
      # ticket alheio e, no leave_queue, DESTRUIR o ticket de um processo vivo — a proibição que
      # este arquivo aplica com rigor ao lock (release confere pid e nonce) e não aplicava aqui.
      if [ -z "${_FHM_TICKET:-}" ] || [ ! -d "$_FHM_TICKET" ] \
         || [ "$(cat "$_FHM_TICKET/pid" 2>/dev/null)" != "$$" ]; then
        _FHM_TICKET=""
        _fhm_enqueue "$_FHM_WAIT_START" || _fhm_enqueue "$(_fhm_now_us20)" || true
      fi
      head="$(_fhm_head_ticket)"
      if [ -n "$head" ] && [ -n "${_FHM_TICKET:-}" ] && [ "$head" != "$(basename "$_FHM_TICKET")" ]; then
        if [ "$waited" -ge "$timeout" ]; then
          _qr="$(_fhm_queue_report)"
          echo "heavy-mutex: TIMEOUT após $(_fhm_fmt_age "$waited") na fila — posição alcançada: ${_qr%% *} de $(printf '%s' "$_qr" | cut -d' ' -f2)." >&2
          echo "  lock ........ $_FHM_LOCK (âncora: $prov)" >&2
          _fhm_leave_queue
          return 75
        fi
        # Primeira espera e a cada NOTIFY_S — nunca a cada poll. Numa espera de trinta minutos,
        # uma linha no segundo zero é o mesmo que silêncio.
        # Diferença desde a última impressão, não módulo: com POLL_S que não divide NOTIFY_S, o
        # módulo pula reimpressões inteiras — medido, 2 em vez de 4 numa espera de 13s.
        if [ "$waited" = 0 ] || [ $(( waited - _FHM_LAST_NOTIFY )) -ge "${FORGE_HEAVY_MUTEX_NOTIFY_S:-60}" ]; then
          _fhm_diag "${label}" "${holder:-?}" "$prov" "$waited" "$timeout" "LIGADA"
          _FHM_LAST_NOTIFY="$waited"
        fi
        sleep "${FORGE_HEAVY_MUTEX_POLL_S:-5}"
        waited=$((waited + ${FORGE_HEAVY_MUTEX_POLL_S:-5}))
        continue
      fi
    fi
    if mkdir "$_FHM_LOCK" 2>/dev/null; then
      if _fhm_claim "${label}" "${beneficiary}"; then break; fi
      if [ "$waited" -ge "$timeout" ]; then _fhm_leave_queue; return 75; fi
      sleep "${FORGE_HEAVY_MUTEX_POLL_HEAD_S:-1}"
      waited=$((waited + ${FORGE_HEAVY_MUTEX_POLL_HEAD_S:-1}))
      continue
    fi
    holder="$(cat "$_FHM_LOCK/pid" 2>/dev/null || echo '')"
    htok="$(cat "$_FHM_LOCK/token" 2>/dev/null || echo '')"

    if [ -z "$holder" ]; then
      # Lock SEM dono legível é o estado da janela entre o `mkdir` e a escrita do `pid`. Reclamar
      # no primeiro poll é apagar o lock de quem acabou de vencer a corrida — é o que o legado faz,
      # e é uma corrida real. Contamos observações consecutivas em vez de comparar mtime, o que
      # evitaria a divergência `stat -f %m` (BSD) contra `stat -c %Y` (GNU).
      incomplete=$((incomplete + 1))
      if [ "$incomplete" -ge "${FORGE_HEAVY_MUTEX_INCOMPLETE_POLLS:-5}" ]; then
        echo "heavy-mutex: lock incompleto (sem pid) por $incomplete poll(s) — reclamando $_FHM_LOCK" >&2
        rm -rf "$_FHM_LOCK"
        incomplete=0
        continue
      fi
    else
      incomplete=0
      if ! _fhm_alive "$holder" "$htok"; then
        _fhm_reclaim_orphan "$holder" || true
        continue
      fi
      # Ordem D5: dono morto (acima) -> BENEFICIÁRIO morto -> IDADE acima do teto. Beneficiário é
      # CERTEZA ("ninguém vai ler o resultado"), idade é HEURÍSTICA ("está demorando demais") — a
      # certeza vem primeiro (issue #144 antes da #137).
      if _fhm_beneficiary_orphaned; then
        if _fhm_escalate_and_reclaim "$holder" "$htok" "beneficiário PID ${_FHM_LAST_BENEFICIARY} morto"; then
          waited=$((waited + _FHM_ESCALATE_CONSUMED))
          continue
        fi
        waited=$((waited + _FHM_ESCALATE_CONSUMED))
        if [ "$waited" -ge "$timeout" ]; then
          echo "heavy-mutex: TIMEOUT após ${waited}s esperando o mutex da máquina (recolhimento por beneficiário morto tentado e falhou)." >&2
          echo "  lock ........ $_FHM_LOCK (âncora: $prov)" >&2
          echo "  detentor .... PID ${holder}" >&2
          _fhm_leave_queue
          return 75
        fi
        continue
      fi
      if [ "$stale_after" -gt 0 ]; then
        local _fhm_age="" _fhm_reserve
        if _fhm_age="$(_fhm_lock_age)"; then
          _fhm_reserve=$(( $(_fhm_stale_grace) + ${FORGE_HEAVY_MUTEX_POLL_HEAD_S:-1} ))
          if [ "$_sa_warned" = 0 ] && [ $(( stale_after + _fhm_reserve )) -gt "$timeout" ]; then
            echo "heavy-mutex: AVISO — heavy_mutex.stale_after_s declarado ($stale_after) + reserva (${_fhm_reserve}s de graça e poll) excede o teto de espera ($timeout): um dono vivo pode não ser reclamado por idade antes do timeout de quem espera." >&2
            _sa_warned=1
          fi
          if [ "$_fhm_age" -gt "$stale_after" ]; then
            if _fhm_escalate_and_reclaim "$holder" "$htok" "posse com ${_fhm_age}s, acima do teto de posse declarado (${stale_after}s)"; then
              waited=$((waited + _FHM_ESCALATE_CONSUMED))
              continue
            fi
            waited=$((waited + _FHM_ESCALATE_CONSUMED))
            if [ "$waited" -ge "$timeout" ]; then
              echo "heavy-mutex: TIMEOUT após ${waited}s esperando o mutex da máquina (recolhimento por idade tentado e falhou)." >&2
              echo "  lock ........ $_FHM_LOCK (âncora: $prov)" >&2
              echo "  detentor .... PID ${holder}" >&2
              _fhm_leave_queue
              return 75
            fi
            continue
          fi
        fi
      fi
    fi

    if [ "$waited" -ge "$timeout" ]; then
      echo "heavy-mutex: TIMEOUT após ${waited}s esperando o mutex da máquina." >&2
      echo "  lock ........ $_FHM_LOCK (âncora: $prov)" >&2
      echo "  detentor .... PID ${holder:-desconhecido}" >&2
      _fhm_leave_queue
      return 75
    fi
    if [ "$waited" = 0 ] || [ $(( waited - _FHM_LAST_NOTIFY )) -ge "${FORGE_HEAVY_MUTEX_NOTIFY_S:-60}" ]; then
      _fhm_diag "${label}" "${holder:-?}" "$prov" "$waited" "$timeout" "$qon"
      _FHM_LAST_NOTIFY="$waited"
    fi
    # A CABEÇA dorme por POLL_HEAD_S (default 1s), não por POLL_S: é ela que decide a ociosidade do
    # lock entre uma posse e a seguinte. Usar POLL_S aqui fazia POLL_HEAD_S ser inerte e a §D4 valer
    # só por coincidência de dois literais diferentes para a mesma variável.
    sleep "${FORGE_HEAVY_MUTEX_POLL_HEAD_S:-1}"
    waited=$((waited + ${FORGE_HEAVY_MUTEX_POLL_HEAD_S:-1}))
  done

  _FHM_OWNED="true"
  _fhm_leave_queue
  # Recibo SEMPRE, mesmo sem contenção: é o análogo do contador de controle para um primitivo que
  # não itera universo. Sem ele, "rodei com o mutex e não houve disputa" e "rodei sem o mutex
  # porque a biblioteca sumiu" produzem o MESMO silêncio no log.
  echo "heavy-mutex: adquirido — $_FHM_LOCK (âncora: $prov), recurso $res, fila $qon, espera ${waited}s, relógio ${_FHM_CLOCK:-hires}" >&2
  FORGE_HEAVY_MUTEX_HELD_PATH="$_FHM_LOCK"
  export FORGE_HEAVY_MUTEX_HELD_PATH
  return 0
}

# Libera SÓ o que é nosso. Liberar lock alheio é pior que vazar o próprio: o vazamento é
# reclamado em minutos pela detecção de órfão, a liberação indevida põe duas suítes a rodar já.
forge_heavy_mutex_release() {
  [ "$_FHM_OWNED" = "true" ] || return 0
  [ -n "$_FHM_LOCK" ] || return 0
  local holder
  holder="$(cat "$_FHM_LOCK/pid" 2>/dev/null || echo '')"
  local nonce; nonce="$(cat "$_FHM_LOCK/nonce" 2>/dev/null || echo '')"
  # Confere PID e NONCE: o token identifica um processo, o nonce identifica ESTA aquisição.
  if [ "$holder" = "$$" ] && [ "$nonce" = "${_FHM_NONCE:-}" ]; then
    rm -rf "$_FHM_LOCK"
    # `rm -rf` pode falhar com "Directory not empty" sob criação concorrente. Conferir a remoção,
    # tentar de novo, e nunca ASSUMIR que removeu — um lock que sobra bloqueia a máquina inteira.
    if [ -d "$_FHM_LOCK" ]; then
      rm -rf "$_FHM_LOCK"
      [ -d "$_FHM_LOCK" ] && echo "heavy-mutex: NÃO consegui remover $_FHM_LOCK — o próximo adquirente vai tratá-lo como órfão; confira o caminho." >&2
    fi
  fi
  _FHM_OWNED="false"
  return 0
}
