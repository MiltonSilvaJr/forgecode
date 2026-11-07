#!/usr/bin/env bash
# Runner da suíte de guarda do CONSUMIDOR (issue #73).
#
# Existe porque o `pre-push` do harness trata "o diretório existe e o runner não" como ERRO que
# bloqueia — e isso é deliberado, é o fecho da issue #49: um gate entregue e nunca chamado conta
# como cobertura nos relatórios e não cobre nada, então a ausência do invocador não pode terminar
# no mesmo desfecho de uma execução bem-sucedida.
#
# O que estava errado é que o template NÃO entregava este arquivo. Todo consumidor que tivesse
# `.forge/scripts/tests/` — porque escreveu testes de gate próprios ali, que é exatamente o que o
# harness incentiva — recebia no upgrade um hook que bloqueia o push e não recebia o arquivo que o
# desbloquearia. Medido: dois de quatro repositórios de um ecossistema caíam nisso, e num deles o
# mesmo `update` migrava `core.hooksPath` de relativo para absoluto, de modo que o tronco e as
# quatro worktrees passavam a executar o hook do tronco no mesmo instante — cinco checkouts com
# push bloqueado simultaneamente, no primeiro `git push` depois do upgrade.
#
# E nenhum `--dry-run` revelava: a lista de mudanças enumera o que o overlay ESCREVE, e a ausência
# de um arquivo no template não é uma mudança.
#
# Diretório sem teste algum sai ZERO — mas dizendo em voz alta que examinou zero. "Não rodei" e
# "rodei e passou" não podem terminar no mesmo silêncio: é o defeito canônico que a suíte deste
# harness existe para eliminar, e ele seria reintroduzido aqui por um runner mudo.
set -uo pipefail
# Isolamento git (LDG-0201): GIT_DIR herdado do ambiente (de uma sessão paralela mal isolada) faria
# os testes que criam repositório git temporário obedecerem ao repositório de quem invocou a suíte,
# em vez do repositório sintético de cada teste — incidente P1 medido em 2026-09-26. O unset aqui,
# no processo do runner, cobre todo alvo despachado abaixo mesmo quando o próprio teste não tem
# preâmbulo equivalente, porque a variável não exportada não chega ao processo-filho.
# GIT_CONFIG_COUNT e GIT_CONFIG_PARAMETERS ficam FORA do unset de propósito: medido que não
# redirecionam escrita (o repositório sintético continua sendo o gravado), e carregam config
# legítima — o `git -c chave=valor` de quem invocou.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_CONFIG

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --path) DIR="$2"; shift 2 ;;
    -h|--help) echo "uso: run-all.sh [--path <dir>]"; exit 0 ;;
    *) echo "run-all.sh: argumento desconhecido '$1'" >&2; exit 64 ;;
  esac
done
[ -d "$DIR" ] || { echo "run-all.sh: '$DIR' não é um diretório" >&2; exit 66; }

# Sentinela da árvore RASTREADA (LDG-0179). Um teste que muta arquivo rastreado do repositório e
# restaura no trap não sobrevive a `SIGKILL`, e quando restaura com `git checkout --` apaga trabalho
# não commitado com o teste saindo verde. Aqui a guarda mede o EFEITO: retrato da árvore rastreada
# antes e depois de cada alvo, e a divergência vira veredito próprio, distinto de "reprovou".
#
# Repositório ausente ou `git` ausente NÃO viram verde silencioso, e a promessa é CUMPRIDA em código,
# não só em comentário: a primeira redação deste bloco guardava tudo por `if [ -n "$REPO" ]`, de modo
# que sem repositório não havia snapshot, o ramo do aviso ficava inalcançável e um teste que sujava a
# árvore saía com `✓` e o runner com rc 0 — medido. Agora a impossibilidade de medir é ela própria um
# estado: aviso explícito na cabeça, marcação por alvo e rc 3 no fecho, o MESMO contrato de rc 3 do
# runner da suíte. Duas implementações do mesmo contrato divergindo em silêncio é o LDG-0014.
LIB_ARVORE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" 2>/dev/null && pwd)/arvore-rastreada.sh"
SENTINELA=0
REPO=""
if [ -f "$LIB_ARVORE" ]; then
  # shellcheck source=/dev/null
  . "$LIB_ARVORE"
  SENTINELA=1
  REPO="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null)" || REPO=""
  if [ -z "$REPO" ]; then
    SENTINELA=0
    echo "run-all.sh: aviso — '$DIR' não está em repositório git (ou 'git' está ausente); a sentinela da árvore rastreada NÃO pôde medir nada, e um teste que sujar a árvore passará sem ser visto" >&2
  fi
else
  echo "run-all.sh: aviso — sentinela da árvore rastreada ausente ($LIB_ARVORE); os testes rodam SEM ela" >&2
fi
# Contador por ALVO, não por condição global: com a sentinela desligada cada alvo já entra em
# `rc_sentinela=3` e se conta sozinho, e semear o contador aqui somaria um ponto que não existe.
nao_medidos=0

pass=0; fail=0; failed=""; sem_veredito=0; sem_veredito_nomes=""

# Três estados por alvo, nunca dois (LDG-0181 — o mesmo defeito que o LDG-0180 fechou no runner
# interno deste harness). Até aqui todo rc diferente de zero virava a mesma parcela FAIL, o mesmo ✗ e
# o mesmo rc 1: um teste morto pelo OOM killer (SIGKILL), por teto de tempo, ou sem o interpretador
# (`node` ausente do PATH) ficava indistinguível de um teste que reprovou por asserção. É
# falso-VERMELHO: manda o consumidor procurar defeito no código onde não há.
#
# O discriminador primário é a FORMA DO RC, e o log só agrava, nunca abranda:
#   rc 0                 passagem
#   rc em [129, 192]     morto por sinal (128+N; cobre os 31 sinais do macOS e os 64 do Linux) —
#                        SALVO se o log já contém uma LINHA de reprovação: aí a violação chegou a
#                        ser observada, e escondê-la atrás de "sem veredito" seria falso-verde
#   rc 126 ou 127        interpretador/dependência ausente ou alvo não executável
#   rc 128               REPROVAÇÃO: é o fatal do git, não forma de sinal
#   qualquer outro       reprovação
# "Linha de reprovação" é o token FAIL ABRINDO a linha (tolerando indentação de sub-alvo), nunca o
# token em qualquer posição: caminhos verdes reais narram "FAIL recusa" no meio da linha, e ler o
# token solto devolveria o falso-vermelho. A AUSÊNCIA de FAIL nunca abranda — asserção nua sob
# `set -e` reprova em silêncio e continua reprovação.
classificar() { # classificar <rc> <arquivo-de-log> -> PASS | FAIL | SV:<motivo>
  local rc="$1" lf="$2" n
  [ "$rc" -eq 0 ] && { echo "PASS"; return 0; }
  if [ "$rc" -ge 129 ] && [ "$rc" -le 192 ]; then
    # atribuição direta, sem `|| echo 0`: `grep -c` já imprime 0 quando não casa, e o `|| echo`
    # anexaria uma segunda linha que quebra o teste numérico (família do LDG-0177).
    n="$(grep -cE '^[[:space:]]*FAIL([^A-Za-z0-9_]|$)' "$lf" 2>/dev/null)"
    [ "${n:-0}" -ge 1 ] && { echo "FAIL"; return 0; }
    echo "SV:sinal-$((rc - 128))"; return 0
  fi
  if [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ]; then echo "SV:dependencia-ausente"; return 0; fi
  echo "FAIL"
}

# SEM REEXECUÇÃO NO RAMO DE FALHA — decisão registrada (LDG-0181, plano 2026-09-15 DA-01).
# A versão anterior descartava a saída da execução (`>/dev/null`) e, no ramo ✗, RODAVA O ALVO DE NOVO
# só para imprimir o tail. Quatro defeitos, todos medidos no w247:
#   1. um alvo morto por falta de memória era morto DUAS vezes, sob a mesma pressão que o matou;
#   2. a segunda execução podia morrer de OUTRO jeito, ou não morrer — e a saída exibida era a dela,
#      não a da execução que produziu o veredito (o w247 [17] planta um alvo que morre na 1ª e
#      imprimiria `FAIL` na 2ª: era a linha da 2ª que o consumidor lia);
#   3. a segunda execução acontecia DEPOIS de `arvore_confere`, fora da janela da sentinela — um
#      teste que sujasse a árvore rastreada só na segunda rodada passava sem ser medido;
#   4. dobrava o custo de todo teste que falha.
# Alternativas descartadas: (a) reexecutar só quando o 1º rc NÃO indica sinal/recurso — mantém 2, 3 e
# 4 para toda reprovação; (b) reexecutar mas classificar pelo 1º rc — paga a segunda morte e continua
# exibindo saída de outra execução. A escolhida grava a saída da ÚNICA execução num log e imprime o
# `tail -20` desse log: o veredito, a saída e a medição da sentinela vêm todos da mesma execução.
# Custo aceito: o log exige `mktemp`, e um `mktemp` que falha (disco cheio, TMPDIR sem escrita — os
# vizinhos de porta da pressão de memória) vira "sem veredito" com motivo `sem-log`, SEM executar o
# alvo, como no runner interno (D5 do LDG-0180): classificar um rc que não é do alvo seria mentir.
run_one() {  # run_one <arquivo> <comando...>
  local nome="$1"; shift
  local antes="" rc_sentinela=0 rc=0 log veredito
  # Anúncio ANTES de rodar (issue #135): silêncio durante os minutos que um teste pesado leva é
  # indistinguível de travamento. A linha de veredito abaixo já diz o resultado; esta diz que o
  # teste COMEÇOU, o que falta quando o único sinal é o resultado final.
  printf '  -> %s\n' "$nome"
  log="$(mktemp "${TMPDIR:-/tmp}/forge-harness-tests.XXXXXX" 2>/dev/null)" || log=""
  if [ -z "$log" ] || [ ! -f "$log" ]; then
    sem_veredito=$((sem_veredito + 1)); sem_veredito_nomes="$sem_veredito_nomes$nome (sem-log)
"
    printf '  ⊘ %s\n' "$nome"
    printf '      sem veredito (sem-log) — o arquivo de log não pôde ser criado; o teste NÃO foi executado\n'
    return 0
  fi
  # `antes="$(arvore_snapshot ...)"` herdaria o rc 3 da biblioteca; `arvore_retrato` devolve sempre
  # rc 0 e carrega o estado no VALOR, que é o que impede a morte muda sob `set -e` no adotante.
  if [ "$SENTINELA" -eq 1 ]; then antes="$(arvore_retrato "$REPO")"; else rc_sentinela=3; fi
  "$@" >"$log" 2>&1; rc=$?
  veredito="$(classificar "$rc" "$log")"
  if [ "$SENTINELA" -eq 1 ]; then
    arvore_confere "$REPO" "$antes" "$nome" >/dev/null 2>&1
    rc_sentinela=$?
  fi
  # A sentinela agrava, nunca abranda: árvore suja é reprovação qualquer que seja o rc do teste.
  if [ "$rc_sentinela" -eq 1 ]; then
    fail=$((fail + 1)); failed="$failed $nome"
    printf '  ✗ %s — o teste sujou a árvore rastreada do repositório\n' "$nome"
    arvore_confere "$REPO" "$antes" "$nome" 2>&1 | sed 's/^/      /' | tail -20
    rm -f "$log"
    return 0
  fi
  if [ "$rc_sentinela" -eq 3 ]; then
    nao_medidos=$((nao_medidos + 1))
    printf '  ⚠ %s — árvore rastreada NÃO MEDIDA (sem git ou fora de repositório); o veredito abaixo vale só pelas asserções do teste, não pelo efeito dele na árvore\n' "$nome"
  fi
  case "$veredito" in
    PASS)
      pass=$((pass + 1)); printf '  ✓ %s\n' "$nome" ;;
    FAIL)
      fail=$((fail + 1)); failed="$failed $nome"; printf '  ✗ %s\n' "$nome"
      sed 's/^/      /' "$log" | tail -20 ;;
    *)
      sem_veredito=$((sem_veredito + 1)); sem_veredito_nomes="$sem_veredito_nomes$nome (${veredito#SV:})
"
      printf '  ⊘ %s\n' "$nome"
      printf '      sem veredito (%s, rc=%s) — o teste não chegou a produzir veredito próprio\n' "${veredito#SV:}" "$rc"
      sed 's/^/      /' "$log" | tail -20 ;;
  esac
  rm -f "$log"
}

# `find` em vez de glob: glob que não casa nada devolve o próprio padrão como literal em bash, e
# isso vira "arquivo inexistente" contado como teste. O `-print0`/`read -d ''` cobre caminho com
# espaço; `mapfile -d` não existe no bash 3.2 do macOS.
total=0
while IFS= read -r -d '' f; do
  total=$((total + 1))
  case "$f" in
    *.test.mjs|*.mjs) run_one "$(basename "$f")" node "$f" ;;
    *.test.sh|*-test.sh|*.bats) run_one "$(basename "$f")" bash "$f" ;;
    *) total=$((total - 1)) ;;
  esac
done < <(find "$DIR" -type f \( -name '*.test.mjs' -o -name '*.test.sh' -o -name '*-test.sh' -o -name '*.bats' \) -print0 2>/dev/null | sort -z)

# O contador é a asserção, não o enfeite: sem ele, um diretório vazio e uma suíte inteira que não
# foi encontrada por erro de padrão produzem a mesma linha verde. Reconciliação com o terceiro estado
# (LDG-0181): esta guarda responde "examinei zero arquivos", e só ela sai pela linha `nada a rodar`;
# um diretório em que TODOS os testes morreram tem `total` > 0 e nunca chega aqui — sai pelo rc 3
# abaixo. Zero testes continua rc 0 de propósito: o template é DISTRIBUÍDO sem teste algum e o
# pre-push executa este runner em todo consumidor, então piso 1 bloquearia o push de todo adotante
# que nunca escreveu teste próprio. O que impede o silêncio é a linha nominal, não o rc.
if [ "$total" -eq 0 ]; then
  echo "OK harness-tests — 0 arquivo(s) de teste examinado(s) em $DIR (nada a rodar)"
  exit 0
fi
echo "harness-tests: $total arquivo(s) examinado(s) — PASS=$pass FAIL=$fail SEM-VEREDITO=$sem_veredito NÃO-MEDIDOS=$nao_medidos"
if [ "$fail" -ne 0 ]; then
  printf 'FALHARAM:\n'; printf '  - %s\n' $failed
fi
# A lista sai ANTES do exit 1: com reprovação e morte na mesma execução, o rc é o da reprovação, mas
# as mortes não podem sumir da saída — seria o colapso de dois estados de volta, só que no texto.
if [ "$sem_veredito" -ne 0 ]; then
  printf 'SEM VEREDITO:\n'; printf '%s' "$sem_veredito_nomes" | sed 's/^/  - /'
fi
# MAPA DE CÓDIGOS: 0 verde; 1 reprovação, com precedência (é o achado acionável); 3 não verificado —
# teste sem veredito próprio (sinal, interpretador ausente, sem log) OU árvore rastreada não medida,
# o MESMO contrato de rc 3 do runner interno; 64 argumento desconhecido e 66 `--path` que não é
# diretório (acima, intocados). Não sai 0 porque "rodei e o teste morreu" não é "rodei e passou", e
# não sai 1 porque não houve reprovação de asserção alguma. O pre-push bloqueia em qualquer rc ≠ 0,
# então o 3 continua bloqueando o push como o 1.
if [ "$fail" -ne 0 ]; then exit 1; fi
if [ "$sem_veredito" -ne 0 ] || [ "$nao_medidos" -ne 0 ]; then
  echo "NÃO VERIFICADO harness-tests — $sem_veredito teste(s) sem veredito próprio, árvore rastreada não medida em $nao_medidos ponto(s)"
  exit 3
fi
echo "OK harness-tests"
