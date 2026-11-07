#!/usr/bin/env bash
# lib/arvore-rastreada.sh — sentinela da árvore RASTREADA e cópia conferida (LDG-0179).
#
# POR QUE EXISTE. Um teste que usa arquivo RASTREADO da árvore de trabalho como fixture — muta o
# arquivo real, mede o efeito, restaura no trap — carrega duas falhas que a suíte pagou caro. A
# primeira: a restauração depende de o processo sobreviver até o fim, e NENHUMA restauração sobrevive
# a `SIGKILL`, que é o modo de morte real de uma máquina sob pressão de memória. A segunda, pior
# porque sai verde: restaurar com `git checkout -- <arquivo>` APAGA trabalho não commitado do
# operador, e o gate reporta sucesso. As duas foram medidas nesta suíte, e a segunda já custou uma
# implementação inteira que estava na árvore sem commit.
#
# A correção primária não é melhorar a restauração — é NÃO MUTAR o rastreado: o teste copia para a
# sua bancada, confere a cópia byte a byte, muta a CÓPIA e roda o sistema sob teste a partir dela.
# Sem mutação não há janela, não há sinal que corrompa e não há `checkout` que apague trabalho. É o
# que `copia_conferida` empacota.
#
# Esta biblioteca fecha a CLASSE por fora, com a sentinela: os runners tiram um retrato da árvore
# rastreada antes de cada teste e conferem depois. Ela mede EFEITO e é infalsificável quanto a ele —
# compara o estado real da árvore, seja qual for o primitivo que o teste use. Ela é, em contrapartida,
# cega quanto à FORMA: um teste que muta e restaura corretamente no fluxo feliz passa por ela, e é
# justamente esse teste que o `SIGKILL` corrompe. Por isso as duas peças, e não uma.
#
# ESCOLHA DO PRIMITIVO, e o seu limite. `git status --porcelain -uno` mede a divergência da árvore
# RASTREADA contra o índice/HEAD, que é exatamente a propriedade afirmada aqui, e vê tanto ` M`
# quanto ` D`. Ele NÃO vê arquivo novo não rastreado deixado para trás — isso é lixo de sandbox, não
# corrupção de árvore rastreada, e está fora do contrato desta sentinela. A escolha também é de
# custo, e o custo foi medido: neste repositório `--porcelain` (que anda a árvore de não rastreados,
# `node_modules` incluído) custou de 0,832 s a 1,338 s por chamada, contra 0,042 a 0,050 s do `-uno`.
# Com 136 gates e dois retratos por gate, a diferença é de minutos para segundos, na mesma máquina
# em que a suíte já foi perdida por pressão de memória. Quem precisa da propriedade mais forte,
# incluindo não rastreados, pede o modo `tudo` — e paga por chamada, não por suíte.
#
# TRÊS ESTADOS, NUNCA DOIS. "Não consegui verificar" jamais colapsa em "não encontrei violação": as
# funções devolvem rc 3 quando não puderam medir, e `arvore_snapshot` emite a marca
# `__ARVORE_NAO_MEDIDA__` em vez de string vazia, para que um retrato não obtido não se pareça com
# uma árvore limpa na comparação do chamador.
#
# USO NO GATE ADOTANTE — este par, e não o de baixo, porque ele preserva os três estados sob `set -e`:
#   . "<...>/lib/arvore-rastreada.sh"
#   ANTES="$(arvore_retrato "$WS")"                       # nunca falha; a marca vem no VALOR
#   ... roda o gate ...
#   arvore_sentinela_fim "$WS" "$ANTES" "meu-gate" || exit $?   # 0 limpo | 1 mudou | 3 não medido
#
# USO CRU (quem quer o rc na mão, e sabe que `X="$(arvore_snapshot ...)"` sob `set -e` mata o gate):
#   ANTES="$(arvore_snapshot "$REPO")" || ANTES="$ARVORE_NAO_MEDIDA"   # ou "$REPO" tudo
#   arvore_confere "$REPO" "$ANTES" "meu-gate" || ...  # 0 igual | 1 divergiu | 3 não medido
#   copia_conferida "$ORIGEM" "$T/copia" || ...        # 0 cópia fiel | 3 não deu para garantir

ARVORE_NAO_MEDIDA='__ARVORE_NAO_MEDIDA__'

# arvore_snapshot <repo> [rastreados|tudo]
#   Imprime o retrato da árvore e devolve rc 0; imprime a marca de não medido e devolve rc 3 quando
#   não foi possível medir. O retrato de uma árvore limpa é a string vazia — distinta da marca.
arvore_snapshot() {
  local repo="${1:-}" modo="${2:-rastreados}" saida rc
  if [ -z "$repo" ] || [ ! -d "$repo" ]; then
    printf '%s\n' "$ARVORE_NAO_MEDIDA"
    return 3
  fi
  if ! command -v git >/dev/null 2>&1; then
    printf '%s\n' "$ARVORE_NAO_MEDIDA"
    return 3
  fi
  if ! git -C "$repo" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '%s\n' "$ARVORE_NAO_MEDIDA"
    return 3
  fi
  case "$modo" in
    tudo)       saida="$(git -C "$repo" status --porcelain 2>/dev/null)"; rc=$? ;;
    rastreados) saida="$(git -C "$repo" status --porcelain -uno 2>/dev/null)"; rc=$? ;;
    *)
      printf '%s\n' "$ARVORE_NAO_MEDIDA"
      return 3
      ;;
  esac
  if [ "$rc" -ne 0 ]; then
    printf '%s\n' "$ARVORE_NAO_MEDIDA"
    return 3
  fi
  printf '%s\n' "$saida"
  return 0
}

# arvore_confere <repo> <retrato-antes> [rótulo] [rastreados|tudo]
#   rc 0  o retrato não mudou
#   rc 1  o retrato mudou — o diff dos dois retratos vai para stderr, com os caminhos nomeados
#   rc 3  não foi possível medir agora, ou o retrato "antes" já era a marca de não medido
arvore_confere() {
  local repo="${1:-}" antes="${2-}" rotulo="${3:-arvore-rastreada}" modo="${4:-rastreados}"
  local depois rc
  depois="$(arvore_snapshot "$repo" "$modo")"
  rc=$?
  if [ "$rc" -ne 0 ] || [ "$depois" = "$ARVORE_NAO_MEDIDA" ] || [ "$antes" = "$ARVORE_NAO_MEDIDA" ]; then
    printf '%s: árvore rastreada NÃO MEDIDA em %s — sem git, fora de repositório ou modo inválido\n' \
      "$rotulo" "${repo:-(vazio)}" >&2
    return 3
  fi
  if [ "$antes" = "$depois" ]; then
    return 0
  fi
  printf '%s: a árvore RASTREADA de %s mudou durante a execução\n' "$rotulo" "$repo" >&2
  diff <(printf '%s\n' "$antes") <(printf '%s\n' "$depois") >&2
  return 1
}

# copia_conferida <origem> <destino>
#   Copia e confere byte a byte. rc 0 quando a cópia é fiel; rc 3 em qualquer outro desfecho — nunca
#   rc 1, porque "não consegui garantir a cópia" não é "a cópia diverge do original".
copia_conferida() {
  local origem="${1:-}" destino="${2:-}"
  if [ -z "$origem" ] || [ -z "$destino" ] || [ ! -f "$origem" ]; then
    printf 'copia_conferida: origem ausente ou destino vazio (origem=%s destino=%s)\n' \
      "${origem:-(vazio)}" "${destino:-(vazio)}" >&2
    return 3
  fi
  if ! cp "$origem" "$destino" 2>/dev/null; then
    printf 'copia_conferida: a cópia de %s para %s falhou\n' "$origem" "$destino" >&2
    return 3
  fi
  if ! cmp -s "$origem" "$destino"; then
    printf 'copia_conferida: a cópia de %s não bateu byte a byte com o original\n' "$origem" >&2
    return 3
  fi
  return 0
}

# arvore_retrato <repo> [rastreados|tudo]
#   Igual a `arvore_snapshot`, mas SEMPRE devolve rc 0: só o VALOR carrega o estado — o retrato, ou a
#   marca `__ARVORE_NAO_MEDIDA__`, que `arvore_confere` reconhece depois. Existe porque
#   `X="$(arvore_snapshot "$WS")"` sob `set -e` herda o rc 3 da biblioteca e mata o gate ali mesmo,
#   ANTES de qualquer echo: rc 3 com log de ZERO byte, sem nome do gate e sem motivo. Foi medido em
#   árvore sem `.git` — cinco gates adotantes morrendo mudos, dois deles saindo rc 0 antes da adoção
#   — e é a família da falha fantasma que este repositório já registrou. Quem quer o rc chama
#   `arvore_snapshot`; quem quer ATRIBUIR chama este.
#   As DUAS linhas do corpo carregam peso, e foi medido qual cobre o quê: o `return 0` é o que faz a
#   atribuição `X="$(arvore_retrato ...)"` sair rc 0 (sem ele o gate volta a morrer mudo — a mutação
#   está no [8]/[6] do w213), e o `|| true` é o que segura a CHAMADA DIRETA sob `set -e`, que aborta
#   no corpo da função antes de chegar ao `return` (medido: `f() { false; return 0; }; f` mata o
#   script, enquanto `X="$(f; echo x)"` não).
arvore_retrato() {
  arvore_snapshot "${1:-}" "${2:-rastreados}" || true
  return 0
}

# arvore_sentinela_fim <repo> <retrato-antes> <rótulo> [rastreados|tudo]
#   Fecho padrão de um gate adotante, com os TRÊS estados atravessando o sítio de adoção inteiros:
#     rc 0  nada mudou — silêncio
#     rc 1  a árvore mudou — acusação nomeada, em stdout (o diff detalhado sai por stderr no confere)
#     rc 3  NÃO VERIFICADO — não se pôde medir; jamais a acusação "a árvore mudou", que seria FALSA e
#           manda o leitor procurar corrupção que não houve
#   Existe porque o idioma `arvore_confere ... || { echo "a árvore mudou"; exit 1; }` colapsa rc 1 e
#   rc 3 no mesmo `||` — desfaz, no consumidor, a distinção que esta biblioteca existe para manter.
#   Uso no gate: `arvore_sentinela_fim "$WS" "$ANTES" "w203-..." || exit $?`
arvore_sentinela_fim() {
  local repo="${1:-}" antes="${2-}" rotulo="${3:-arvore-rastreada}" modo="${4:-rastreados}" rc=0 alvo
  case "$modo" in
    tudo) alvo="a árvore de trabalho (rastreados e não rastreados)" ;;
    *)    alvo="a árvore RASTREADA" ;;
  esac
  arvore_confere "$repo" "$antes" "$rotulo" "$modo" || rc=$?
  case "$rc" in
    0) return 0 ;;
    1)
      printf 'FAIL sentinela [%s]: %s do repositório MUDOU durante o gate\n' "$rotulo" "$alvo"
      return 1
      ;;
    *)
      printf 'NÃO VERIFICADO [%s]: %s não pôde ser medida (sem git, fora de repositório ou modo inválido) — ausência de medição não é ausência de violação\n' "$rotulo" "$alvo"
      return 3
      ;;
  esac
}
