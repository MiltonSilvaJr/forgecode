#!/usr/bin/env bash
# Transporte `gh` — DECLARADO, NÃO IMPLEMENTADO. Este arquivo reprova por construção.
#
# A convenção do harness é que script `.sh` nunca invoca o binário do GitHub CLI: ele exige rede,
# autenticação interativa e um estado de repositório remoto que nenhum gate consegue reproduzir de
# forma determinista. Um transporte que só funciona na máquina de quem o escreveu não é
# transporte, é armadilha — passaria no `probe` de um e falharia no do próximo.
#
# A mecânica pretendida (uma linha JSONL por comentário numa issue dedicada, a issue fazendo as
# vezes de hub) vive na documentação do comando, `commands/harness/liaison.md`, onde o agente lê e
# executa com as ferramentas dele — que têm autenticação, permissão e supervisão humana. Enquanto
# essa via não existir, este stub falha alto, citando as alternativas que funcionam hoje.
#
# ATENÇÃO ao editar: manter este arquivo livre de qualquer invocação do CLI do GitHub. O gate
# w111 varre o próprio arquivo procurando por ela.

t_probe() {
  echo "FAIL: transporte 'gh' ainda não é implementável por script — o harness proíbe invocar o CLI do GitHub em .sh (rede, auth interativa, estado irreprodutível em gate)." >&2
  echo "      Use 'fs' (hub em diretório compartilhado), 'git' (branch dedicada em remote) ou 'manual' (export/import). A via por issue está descrita em commands/harness/liaison.md." >&2
  return 1
}

t_push() { t_probe; }

t_pull() { t_probe; }
