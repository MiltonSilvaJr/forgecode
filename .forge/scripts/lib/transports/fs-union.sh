#!/usr/bin/env bash
# Transporte `fs-union` — o hub de `fs` (mesmo layout `<path>/<channel>/{log,blobs}`), com o
# `_common.sh` resolvido no CHECKOUT PRINCIPAL e falha fechada quando ele falta (issue #123).
# Opt-in: nenhum consumidor é orientado a trocar `fs` por este kind; quem não troca não muda nada.
#
# O DANO QUE ELE FECHA. `liaison-ops.sh` resolve `ROOT` pelo checkout principal (`forge-root.sh`),
# mas `LIBDIR` por `$SCRIPT_DIR/lib`, a cópia do código da árvore que o invocou. Uma worktree
# criada de branch anterior ao conserto de `_dir_push` carrega o `cp` cru, que sobrescreve o log do
# hub com a réplica local. O `sync` empurra antes de puxar e `_dir_pull` não traz o próprio log de
# volta, por contrato; o hub não é repositório git. Perda irrecuperável, com rc 0 e sem aviso.
#
# POR QUE UM KIND, E NÃO UMA GUARDA NO `_common.sh`. Qualquer guarda escrita no `_dir_push` viaja
# no arquivo que a worktree traz da branch: a árvore armada não a tem, justamente por ser anterior
# a ela. O único elo que TODA árvore lê do tronco é a configuração (`liaison.yaml`, lido de
# `$ROOT/.forge/liaison`). Declarar ali um kind que só existe a partir deste conserto faz a árvore
# antiga falhar em dois pontos, ambos antes de tocar o hub: o `liaison-config.mjs` dela não tem o
# kind em `TRANSPORT_KINDS` (`kind inválido`), e o `_load_transport` dela não acha este arquivo
# (`backend de transporte ausente`).
#
# A SEGUNDA CAMADA, SEM FALLBACK. Uma árvore pode ter este arquivo e ainda assim um `_common.sh`
# destrutivo, por merge feito pela metade — a trava por kind não a pega. Por isso o `_common.sh`
# carregado aqui é o do TRONCO, nunca o de `$(dirname "${BASH_SOURCE[0]}")`, e a resolução falha
# fechado: se o do tronco não existir, este transporte recusa em vez de cair para a cópia da árvore,
# porque a cópia da árvore é exatamente o que pode estar destrutivo.
#
# A TERCEIRA CAMADA: O TRONCO TAMBÉM PODE NÃO UNIR. Carregar o `_common.sh` do tronco só protege se
# ele une. Um tronco que ainda não recebeu o update, ou que está numa branch antiga (o tronco pode
# estar noutra branch, `forge-root.sh`), traz o `cp` cru; com uma worktree atualizada, rodar o
# `_dir_push` dele apagaria do hub, com rc 0, a mensagem que o próprio `fs` preservaria com o
# `_common.sh` da worktree. Por isso, depois do source, este transporte confere que o `_dir_push`
# que acabou de carregar publica pela união (`_dir_push_union`) e, se não, recusa antes de
# qualquer `t_push`. A conferência lê o corpo do `_dir_push` recém-definido, e não só a existência
# de `_dir_push_union`, porque o source sempre redefine `_dir_push`, mas não apaga uma
# `_dir_push_union` que já estivesse definida no processo.
#
# O tronco é resolvido a partir do diretório DESTE arquivo, por `forge_main_root`, que não lê
# `FORGE_ROOT`: `FORGE_ROOT` declara onde mora o ESTADO (e um `sync` com `FORGE_ROOT=<worktree>`
# aponta para a worktree), enquanto a âncora aqui é sobre qual CÓDIGO roda. Honrar `FORGE_ROOT`
# nesta linha levaria o `sync` inline de volta ao `_common.sh` da worktree. Sem nenhum repositório
# git alcançável não há tronco a resolver, e o transporte recusa dizendo isso: fora de git, use
# `fs`.
#
# Custo aceito: numa worktree de branch MAIS NOVA que o tronco, o `_common.sh` que roda é o do
# tronco, mais velho. Enquanto ele une, o desfecho é o de `fs`; quando não une, o sync recusa até o
# tronco ser atualizado, em vez de publicar. Só vale para quem optou pelo kind.
#
# Mesma semântica do `fs-union.sh` local do axis-device-platform (`6e11ec6`/`422a87d`) nos desfechos
# ff, behind, diverged e equal do push, com o `_common.sh` do tronco que une, e na falha fechada
# quando ele falta — por isso o kind reaproveita o nome. O do axis-device-platform não tem a
# terceira camada nem a recusa fora de git: com um tronco que não une, ele publica pelo `cp` cru.

if ! declare -F forge_main_root >/dev/null 2>&1; then
  _fsu_lib="$(CDPATH='' cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  # shellcheck source=../forge-root.sh
  . "$_fsu_lib/forge-root.sh"
fi

# `forge_main_root` lê `$(pwd)`: o `cd` no subshell ancora a resolução na PRÓPRIA localização deste
# arquivo, e não no cwd de quem chamou `liaison-ops.sh`, sem alterar o cwd do processo pai.
_fsu_dir="$(CDPATH='' cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! _fsu_tronco="$(CDPATH='' cd "$_fsu_dir" && forge_main_root)"; then
  echo "FAIL fs-union: exige um checkout git para resolver o checkout principal, e nenhum repositório" >&2
  echo "                git é alcançável a partir de $_fsu_dir. Fora de git, use o kind fs." >&2
  return 1
fi
_fsu_common="$_fsu_tronco/.forge/scripts/lib/transports/_common.sh"
if [ ! -f "$_fsu_common" ]; then
  echo "FAIL fs-union: _common.sh do checkout principal ausente em $_fsu_common." >&2
  echo "                Este transporte NÃO cai para a cópia da árvore local — a cópia local é" >&2
  echo "                exatamente o que pode estar destrutivo (issue #123)." >&2
  return 1
fi
# As guardas de SEC-001 conferidas abaixo são apagadas ANTES do source, pelo mesmo motivo da
# conferência do corpo de `_dir_push`: o source define o que o arquivo traz, mas não apaga uma
# função que já estivesse definida no processo, e a conferência leria a cópia errada.
unset -f _dir_reject_symlink _dir_publish_file 2>/dev/null || true
# shellcheck source=./_common.sh
. "$_fsu_common"
case "$(declare -f _dir_push)" in
  *_dir_push_union*) : ;;
  *)
    echo "FAIL fs-union: o _common.sh do checkout principal não une o log (anterior à #110): $_fsu_common." >&2
    echo "                Publicar com ele substituiria o log do hub pela réplica local. Atualize o" >&2
    echo "                checkout principal antes de sincronizar (issue #123)." >&2
    return 1
    ;;
esac
# Opção C (design §2.4, add-liaison-handoff-baton): um tronco anterior a este change tem
# `_dir_push_union`, mas publica sem `union-own` (ainda faz `cp "$hubf" "$own"`) e sem
# `LIAISON_OBSERVED_FILE` — a mesma classe de risco da checagem acima, um patamar depois. Lê o
# CORPO das duas funções recém-carregadas (não só se existem), pela mesma razão: o source sempre
# redefine `_dir_push`/`_dir_push_union`, mas não apaga uma definição anterior no processo.
case "$(declare -f _dir_push)$(declare -f _dir_push_union)" in
  *union-own*LIAISON_OBSERVED_FILE* | *LIAISON_OBSERVED_FILE*union-own*) : ;;
  *)
    echo "FAIL fs-union: o _common.sh do checkout principal não tem a publicação sem trava (opção C, anterior ao add-liaison-handoff-baton): $_fsu_common." >&2
    echo "                Publicar com ele sincronizaria o log próprio de volta sem a trava do log (cp cru)," >&2
    echo "                podendo perder uma gravação concorrente. Atualize o checkout principal antes de" >&2
    echo "                sincronizar." >&2
    return 1
    ;;
esac
# A QUARTA CAMADA (SEC-001, SEC-106): unir não basta, o tronco também precisa publicar sem seguir
# link. Um tronco anterior a esta correção une, mas escreve no hub por temporário previsível e
# segue symlink plantado por quem escreve no hub — execução de código na máquina de quem sincroniza.
# Recusa antes de qualquer `t_probe`/`t_push`, falha fechada.
if ! declare -F _dir_reject_symlink >/dev/null 2>&1 || ! declare -F _dir_publish_file >/dev/null 2>&1; then
  echo "FAIL fs-union: o _common.sh do checkout principal não tem as guardas de SEC-001" >&2
  echo "                (_dir_reject_symlink e _dir_publish_file): $_fsu_common." >&2
  echo "                Publicar com ele seguiria symlink plantado no hub e escreveria fora da árvore" >&2
  echo "                do canal. Atualize o checkout principal antes de sincronizar." >&2
  return 1
fi

# SEC-001: mesma regra de confiança do `fs` (ver o cabeçalho de `fs.sh`): a raiz configurada é
# confiável e resolvida por `cd -P`; tudo abaixo dela é escrito por terceiros e verificado.
_fsu_raiz() {
  mkdir -p -- "$LIAISON_T_PATH" 2>/dev/null || true
  (CDPATH='' cd -P -- "$LIAISON_T_PATH" 2>/dev/null && pwd -P) \
    || { echo "FAIL: não foi possível resolver o hub em $LIAISON_T_PATH (permissão? caminho inválido?)" >&2; return 1; }
}

_fsu_hub() { local raiz; raiz="$(_fsu_raiz)" || return 1; printf '%s/%s' "$raiz" "$LIAISON_CHANNEL"; }

t_probe() {
  [ -n "${LIAISON_T_PATH:-}" ] || { echo "FAIL: transporte fs-union exige 'path' no liaison.yaml" >&2; return 1; }
  local hub; hub="$(_fsu_hub)" || return 1
  # Guardas ANTES de criar qualquer coisa (SEC-108): `mkdir -p` sobre um canal que é symlink
  # criaria `log/` e `blobs/` onde o link aponta.
  _dir_reject_symlink "$hub" || return 1
  _dir_reject_symlink "$hub/log" || return 1
  _dir_reject_symlink "$hub/blobs" || return 1
  { _dir_ensure_subdir "$(dirname -- "$hub")" "$LIAISON_CHANNEL" \
      && _dir_ensure_subdir "$hub" log && _dir_ensure_subdir "$hub" blobs; } \
    || { echo "FAIL: não foi possível criar o hub em $hub (permissão? caminho inválido?)" >&2; return 1; }
  [ -w "$hub/log" ] || { echo "FAIL: hub sem permissão de escrita: $hub/log" >&2; return 1; }
  return 0
}

t_push() { local hub; hub="$(_fsu_hub)" || return 1; _dir_push "$hub"; }

t_pull() { local hub; hub="$(_fsu_hub)" || return 1; _dir_pull "$hub" "$1"; }
