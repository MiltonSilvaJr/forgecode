#!/usr/bin/env bash
# lib/arg-guards.sh — disciplina de parsing de flags para scripts de registro (issue #103).
#
# Duas recusas que todo parser de flags precisa e que quase nenhum tem por default:
#
#   forge_reject_unknown  — argumento que o subcomando não conhece REPROVA, nunca é descartado.
#   forge_require_value   — flag de campo com valor VAZIO REPROVA, nomeando a flag.
#
# Por que a primeira. Um `case` que termina em `*) shift ;;` engole a flag E, na iteração
# seguinte, o VALOR dela: `ledger-ops.sh add --type x --title y --details "texto longo"` (typo em
# `--detail`) descartava as duas palavras e criava a entrada com `detail: ''`, imprimindo `OK`. Os
# seis subcomandos de `ledger-ops.sh` terminavam assim; três entradas abertas do ledger deste
# repositório nasceram sem `detail` no mesmo instante, e não há como provar retroativamente qual
# das duas portas silenciosas as produziu.
#
# Por que a segunda. `update <id> --detail ""` passava por `if (de) e.detail = de;`, que trata
# string vazia como falsa: o campo não mudava, `updated_at` avançava, e o comando respondia `OK`.
# O commit anunciava um conteúdo que o ledger não carregava.
#
# O idioma vem de `liaison-ops.sh::_reject_unknown` (22 usos naquele arquivo, inclusive dentro do
# próprio `ack)`), e a mensagem preserva o formato de lá — nomear o subcomando importa porque o
# conjunto de flags varia por subcomando: sem isso, quem digitou `--body-file` num `ack` conclui
# que a flag não existe em lugar nenhum. Este arquivo NÃO substitui a cópia de `liaison-ops.sh`;
# consolidar os dois é trabalho próprio, fora do escopo desta correção.

# forge_reject_unknown <subcomando> <flags aceitas> <argumento> [dica]
# Sempre encerra o processo com rc 1 — é chamada no ramo `*)` do `case` de parsing.
forge_reject_unknown() {
  local sub="$1" accepted="$2" arg="$3" hint="${4:-}"
  case "$arg" in
    -*) echo "FAIL: flag desconhecida '$arg' para o subcomando '$sub'" >&2 ;;
    *)  echo "FAIL: argumento inesperado '$arg' para o subcomando '$sub'" >&2 ;;
  esac
  echo "  flags aceitas em '$sub': $accepted" >&2
  echo "  argumento desconhecido não é descartado: o descarte engole a flag E o valor dela, e a" >&2
  echo "  operação segue com rc 0 sobre um registro incompleto." >&2
  [ -z "$hint" ] || echo "  $hint" >&2
  exit 1
}

# forge_reject_flag_as_value <subcomando> <flag> <valor> <flags aceitas> [dica]
# issue #103 — a segunda metade da mesma classe de defeito de `forge_reject_unknown`: ali era a
# flag DESCONHECIDA que o parser engolia; aqui é a flag SEGUINTE que o parser aceita como VALOR da
# anterior. `ledger-ops.sh update <id> --detail --title` não tem `--details` (typo) para reprovar —
# tem `--title`, uma flag legítima, sentada onde um valor deveria estar. `--detail` vira
# `'--title'` literal, `title` fica intocado, e o comando responde `OK`.
#
# PERTENCIMENTO ao conjunto DECLARADO de flags do subcomando, nunca "começa com hífen": a
# alternativa por prefixo reprovaria `list --top -3` e `add --detail '---frontmatter'` — valores
# legítimos que só por acaso começam com hífen. Normaliza os dois idiomas do repositório: espaço
# (`ledger-ops.sh`: "--type --title --detail") e vírgula+espaço (`liaison-ops.sh`: "--subject,
# --body, --participants"). Pertencimento é por TOKEN EXATO depois de normalizar — um
# `case "$accepted" in *"$value"*)` casaria `--body` dentro de `--body-file` e reprovaria valor
# legítimo.
#
# RESTRIÇÃO (i), medida na revisão: esta função TEM de terminar em `return 0` EXPLÍCITO no
# caminho de aceite. Uma implementação cujo último comando é o próprio teste de pertencimento
# devolve 1 quando o valor é legítimo (nenhum token bateu, e a última comparação do laço é falsa);
# chamada como comando NU dentro de `liaison-ops.sh` (`set -euo pipefail`), isso ABORTA o
# chamador com rc 1 e ZERO saída — demonstrado com `naive_guard send --subject "assunto real"
# "--subject, --body, --requires-ack"` seguido de `echo SOBREVIVEU`, que nunca chegou a rodar. O
# `return 0` depois do laço é o que impede essa regressão de aborto mudo no próprio change que
# existe para tirar o silêncio do parser.
forge_reject_flag_as_value() {
  local sub="$1" flag="$2" value="$3" accepted="$4" hint="${5:-}"
  local normalized="${accepted//, / }"
  local tok
  for tok in $normalized; do
    if [ "$tok" = "$value" ]; then
      echo "FAIL: '$flag' recebeu '$value' como valor no subcomando '$sub' — '$value' é uma flag aceita em '$sub', não conteúdo." >&2
      echo "  A flag seguinte foi engolida como valor da anterior. Flags aceitas em '$sub': $accepted" >&2
      if [ -n "$hint" ]; then
        echo "  $hint" >&2
      else
        echo "  Não há sintaxe de escape hoje para passar, como valor literal, um texto que coincida" >&2
        echo "  com o nome de uma flag aceita (ver ledger do projeto — item aberto pela issue #103)." >&2
      fi
      exit 1
    fi
  done
  return 0
}

# forge_require_value <subcomando> <flag> <valor> [flags aceitas]
# Recusa valor vazio numa flag de conteúdo. Encerra o processo com rc 1 quando vazio. O QUARTO
# parâmetro é OPCIONAL: quando presente, delega PRIMEIRO ao teste de pertencimento acima — a flag
# seguinte engolida como valor da anterior nunca chega vazia (`--detail --title` grava
# `detail='--title'`, não `detail=''`), então sem a delegação essa classe inteira escaparia por
# aqui. A ordem importa: pertencimento entra ANTES da linha abaixo, que segue intacta byte a byte
# (tests/w194-ledger-write-discipline-gate.sh muta essa linha exata com regex literal — mexer nela
# faz o `perl -0pi` do w194 deixar de casar, e a mutação daquele gate passa a mutar nada). A arity
# de 3 (sem o quarto parâmetro) continua válida: `accepted` vazio pula a delegação — é o que
# permite lib e call sites viajarem em commits separados sem quebrar um consumidor com lib nova e
# script velho. RESTRIÇÃO (i) vale aqui também: `if [ -n "$accepted" ]; then ...; fi`, nunca um
# `&&` cujo rc possa vazar para o caminho feliz.
forge_require_value() {
  local sub="$1" flag="$2" value="${3-}" accepted="${4-}"
  if [ -n "$accepted" ]; then
    forge_reject_flag_as_value "$sub" "$flag" "$value" "$accepted"
  fi
  [ -n "$value" ] && return 0
  echo "FAIL: '$flag' veio com valor vazio no subcomando '$sub'." >&2
  echo "  Valor vazio não apaga campo nem grava conteúdo: antes desta guarda o comando respondia" >&2
  echo "  'OK' e só avançava 'updated_at', o que faz a entrada parecer recente sem carregar" >&2
  echo "  informação nova. Passe um valor, ou omita a flag." >&2
  exit 1
}
