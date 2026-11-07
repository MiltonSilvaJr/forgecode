#!/usr/bin/env bash
# Transporte `fs` — hub em diretório local compartilhado. Default do piloto.
#
# É o `manual` acrescido de duas coisas: o hub é criado sob demanda (auto-suficiente, sem passo
# humano) e é multi-canal — o layout é `<path>/<channel>/{log,blobs}`, então um mesmo diretório
# compartilhado hospeda vários canais sem colisão.
#
# TOPOLOGIA: hub único por canal, nunca par-a-par. Cada participante publica o próprio log no
# ponto de encontro e puxa os N-1 restantes; a configuração cresce como N (cada repo aponta para
# um lugar), não como N². Par-a-par deixaria dois participantes divergentes por tempo
# indeterminado sem ninguém perceber.
#
# CONFIDENCIALIDADE: quem alcança o hub lê o canal inteiro, todas as threads. A lista de
# participantes de uma thread roteia e cobra ack — não confina leitura. Separação real é canal
# separado, com hub separado.
#
# SEC-001 — CONFIANÇA. A RAIZ (`path` no liaison.yaml) é configuração do operador e é confiável:
# pode ser um symlink legítimo (`~/shared -> /Volumes/...`), e é resolvida uma vez por `cd -P`.
# Tudo ABAIXO dela — o diretório do canal, `log/`, `blobs/` e os arquivos — é escrito pelos
# demais participantes e não é confiável: link ali é recusado, e toda escrita entra no diretório
# por `cd -P`, confere `pwd -P` e usa nome relativo (ver `_common.sh`). Risco residual: um
# participante que renomeia o diretório já fixado no meio do sync só consegue movê-lo para onde ele
# mesmo tem escrita. Num hub compartilhado entre USUÁRIOS diferentes do sistema, aplique sticky bit
# na raiz e nos diretórios do canal (`chmod +t <path> <path>/<canal> <path>/<canal>/log
# <path>/<canal>/blobs`): sem ele, qualquer usuário com escrita no diretório pode apagar ou
# renomear o arquivo de outro.

# shellcheck source=./_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

# _fs_raiz — a raiz configurada, criada se faltar e resolvida no caminho físico. Falha fechada.
_fs_raiz() {
  mkdir -p -- "$LIAISON_T_PATH" 2>/dev/null || true
  (CDPATH='' cd -P -- "$LIAISON_T_PATH" 2>/dev/null && pwd -P) \
    || { echo "FAIL: não foi possível resolver o hub em $LIAISON_T_PATH (permissão? caminho inválido?)" >&2; return 1; }
}

_fs_hub() { local raiz; raiz="$(_fs_raiz)" || return 1; printf '%s/%s' "$raiz" "$LIAISON_CHANNEL"; }

t_probe() {
  [ -n "${LIAISON_T_PATH:-}" ] || { echo "FAIL: transporte fs exige 'path' no liaison.yaml" >&2; return 1; }
  local hub; hub="$(_fs_hub)" || return 1
  # As guardas vêm ANTES de criar qualquer coisa: `mkdir -p` sobre um canal que é symlink criaria
  # `log/` e `blobs/` onde o link aponta (SEC-108).
  _dir_reject_symlink "$hub" || return 1
  _dir_reject_symlink "$hub/log" || return 1
  _dir_reject_symlink "$hub/blobs" || return 1
  { _dir_ensure_subdir "$(dirname -- "$hub")" "$LIAISON_CHANNEL" \
      && _dir_ensure_subdir "$hub" log && _dir_ensure_subdir "$hub" blobs; } \
    || { echo "FAIL: não foi possível criar o hub em $hub (permissão? caminho inválido?)" >&2; return 1; }
  [ -w "$hub/log" ] || { echo "FAIL: hub sem permissão de escrita: $hub/log" >&2; return 1; }
  return 0
}

t_push() { local hub; hub="$(_fs_hub)" || return 1; _dir_push "$hub"; }

t_pull() { local hub; hub="$(_fs_hub)" || return 1; _dir_pull "$hub" "$1"; }
