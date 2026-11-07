#!/usr/bin/env bash
# Transporte `manual` — a PRIMITIVA de que todos os outros são casos particulares.
#
# O ponto de encontro é um diretório qualquer, com o mesmo layout de `liaison-ops.sh export`
# (`log/` + `blobs/`) — o que torna `export`/`import` e `sync --kind manual` literalmente
# intercambiáveis. É o transporte para quando o canal atravessa uma fronteira que nenhum script
# cruza sozinho: pendrive, anexo de e-mail, diretório de VPN montado à mão.
#
# A única diferença para o `fs` é deliberada: `manual` NUNCA cria o ponto de encontro. Se o
# diretório não existe, o probe REPROVA — porque quem opera manualmente precisa saber que está
# publicando num lugar que ninguém combinou, em vez de ver o sync passar contra um diretório
# recém-criado e vazio que o outro lado jamais vai olhar.
#
# Contrato (ver liaison-ops.sh): t_probe, t_push <src>, t_pull <staging>.

# shellcheck source=./_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

t_probe() {
  [ -n "${LIAISON_T_PATH:-}" ] || { echo "FAIL: transporte manual exige 'path' no liaison.yaml" >&2; return 1; }
  [ -d "$LIAISON_T_PATH" ] || { echo "FAIL: ponto de encontro não existe: $LIAISON_T_PATH (transporte manual não cria o diretório — combine-o com o outro lado)" >&2; return 1; }
  return 0
}

# SEC-001: aqui o hub É o `path` configurado — configuração confiável do operador, que pode ser um
# symlink legítimo (`~/pendrive -> /Volumes/...`). Ele é resolvido uma vez para o caminho físico;
# o que fica ABAIXO dele (`log/`, `blobs/`, os arquivos) é escrito por terceiros e verificado em
# `_common.sh`. Recusar o próprio `path` por ser symlink (ARCH-004) quebrava configuração legítima
# sem proteger nada: quem escreveu o link foi o próprio operador.
_manual_hub() {
  (CDPATH='' cd -P -- "$LIAISON_T_PATH" 2>/dev/null && pwd -P) \
    || { echo "FAIL: ponto de encontro inacessível: $LIAISON_T_PATH" >&2; return 1; }
}

t_push() { local hub; hub="$(_manual_hub)" || return 1; _dir_push "$hub"; }

t_pull() { local hub; hub="$(_manual_hub)" || return 1; _dir_pull "$hub" "$1"; }
