#!/usr/bin/env bash
# worktree-classify.sh — os predicados de worktree, num lugar só, para que o harness não passe a ter
# duas definições de "limpa".
#
# Este arquivo é uma BIBLIOTECA: ele é feito para `source`, não para execução direta, e não imprime
# nada por conta própria.
#
# O predicado que carrega o incidente: `git status --porcelain` NÃO enxerga arquivo ignorado, e a
# remoção de uma worktree apaga o que está no disco, não o que está no índice. Uma worktree cheia de
# estado local irrecuperável satisfaz "limpa" por `status` — foi assim que sumiram `local.properties`
# e `build/` na issue #72. Por isso "limpa segundo o índice" e "limpa segundo o disco" são dois
# predicados com dois nomes, e nunca um só.
#
# O outro predicado que engana é "mergeada". Ele depende da REF escolhida, e as duas escolhas
# ingênuas erram hoje, em repositórios diferentes, em direções opostas: medido em 2026-09-08, cinco
# worktrees do `azim-crm` são ancestrais de `origin/develop` e não do `develop` local (que está 60
# commits atrás), e uma do `axis-go-cloud` é ancestral do `develop` local e não de `origin/develop`.
# Por isso `forge_wt_merged_state` responde com TRÊS estados e nunca com dois — a mesma lição que o
# `worktree-reconcile.sh` já pagou em LDG-0056.
#
# VOCABULÁRIO DE CLASSES (contrato publicado — mudar um destes nomes quebra quem os afirma):
#   viva                     não é ancestral de nenhuma das refs de integração
#   destacada                HEAD destacado, sem branch para empurrar
#   mergeada-limpa           ancestral, índice limpo E disco sem arquivo ignorado presente
#   mergeada-com-ignorados   ancestral, índice limpo, disco com arquivo ignorado presente
#   mergeada-suja            ancestral, índice sujo
#   nao-verificado           as refs de integração discordam, não resolvem, ou o predicado caro não
#                            foi executado — em nenhum desses casos existe veredito

# ── predicados elementares ──────────────────────────────────────────────────────────────────────

forge_wt_head_branch() {  # forge_wt_head_branch <worktree> -> ecoa a branch, ou nada se destacado
  local s
  s="$(git -C "$1" symbolic-ref -q HEAD 2>/dev/null || true)"
  [ -n "$s" ] || return 1
  printf '%s\n' "${s#refs/heads/}"
}

forge_wt_is_detached() {  # rc 0 se a worktree está com HEAD destacado
  [ -z "$(git -C "$1" symbolic-ref -q HEAD 2>/dev/null || true)" ]
}

forge_wt_tracked_dirty() {  # rc 0 se há mudança rastreada ou arquivo não rastreado; ecoa as 3 primeiras linhas
  local out
  out="$(git -C "$1" --no-optional-locks status --porcelain 2>/dev/null || true)"
  [ -n "$out" ] || return 1
  printf '%s\n' "$out" | head -3
}

forge_wt_ignored_present() {  # rc 0 se há arquivo IGNORADO presente no disco; ecoa as 3 primeiras linhas
  # CARO por natureza: medido, esta varredura sobre 145 worktrees não terminou em 590 segundos. Ela
  # não pode entrar em caminho quente, e quem a omite precisa dizer que omitiu.
  local out
  out="$(git -C "$1" clean -ndX 2>/dev/null || true)"
  [ -n "$out" ] || return 1
  printf '%s\n' "$out" | head -3
}

forge_wt_ref_exists() {  # forge_wt_ref_exists <repo> <ref>
  git -C "$1" rev-parse --verify -q "$2^{commit}" >/dev/null 2>&1
}

forge_wt_is_ancestor() {  # forge_wt_is_ancestor <repo> <rev> <ref> -> 0 ancestral, 1 não, 2 ref não resolve
  forge_wt_ref_exists "$1" "$3" || return 2
  forge_wt_ref_exists "$1" "$2" || return 2
  git -C "$1" merge-base --is-ancestor "$2" "$3" 2>/dev/null && return 0
  return 1
}

# forge_wt_merged_state <repo> <rev> <ref-local> <ref-remota> -> ecoa 'sim' | 'nao' | 'indeterminado'
# e devolve rc 0, 1 ou 2 respectivamente. 'indeterminado' é o terceiro estado, e ele cobre os dois
# casos medidos: nenhuma das refs resolve, e as duas resolvem e DISCORDAM sobre esta worktree.
forge_wt_merged_state() {
  local repo="$1" rev="$2" rl="$3" rr="$4" a b
  forge_wt_is_ancestor "$repo" "$rev" "$rl"; a=$?
  forge_wt_is_ancestor "$repo" "$rev" "$rr"; b=$?
  if [ "$a" -eq 2 ] && [ "$b" -eq 2 ]; then echo indeterminado; return 2; fi
  if [ "$a" -eq 2 ]; then [ "$b" -eq 0 ] && { echo sim; return 0; }; echo nao; return 1; fi
  if [ "$b" -eq 2 ]; then [ "$a" -eq 0 ] && { echo sim; return 0; }; echo nao; return 1; fi
  if [ "$a" -eq "$b" ]; then
    [ "$a" -eq 0 ] && { echo sim; return 0; }
    echo nao; return 1
  fi
  echo indeterminado; return 2
}

# forge_wt_classify <repo> <worktree> <ref-local> <ref-remota> <modo>
# <modo> = 'completo' (executa o predicado de arquivo ignorado) ou 'barato' (não executa, e por isso
# não pode distinguir mergeada-limpa de mergeada-com-ignorados: responde nao-verificado, porque
# fingir "limpa" ali é exatamente o colapso que destruiu 23 árvores no cenário contrafactual medido).
forge_wt_classify() {
  local repo="$1" wt="$2" rl="$3" rr="$4" modo="${5:-completo}" estado
  if [ ! -d "$wt" ]; then echo "nao-verificado"; return 0; fi
  if forge_wt_is_detached "$wt"; then echo "destacada"; return 0; fi
  estado="$(forge_wt_merged_state "$repo" "$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo HEAD)" "$rl" "$rr")"
  case "$estado" in
    indeterminado) echo "nao-verificado"; return 0 ;;
    nao) echo "viva"; return 0 ;;
  esac
  if forge_wt_tracked_dirty "$wt" >/dev/null; then echo "mergeada-suja"; return 0; fi
  if [ "$modo" = "barato" ]; then echo "nao-verificado"; return 0; fi
  if forge_wt_ignored_present "$wt" >/dev/null; then echo "mergeada-com-ignorados"; return 0; fi
  echo "mergeada-limpa"
}

# forge_wt_naoverificado_causa <repo> <worktree> <ref-local> <ref-remota> <modo>
#   -> ecoa 'caminho-inexistente' | 'refs-nao-decidem' | 'predicado-omitido' | 'desconhecida'
#
# `nao-verificado` é uma classe com CAUSAS diferentes, e quem imprime precisa saber qual delas
# ocorreu. Derivar a causa do MODO é errado: no modo barato as duas causas ocorrem, e explicar a
# divergência de refs pela omissão do predicado caro faz a saída afirmar "mergeada e de índice
# limpo" sobre uma worktree cujo estado de merge é indeterminado e cujo `status --porcelain` nunca
# chegou a rodar. É a invariante 2 — afirmar sobre predicado não executado — dentro do próprio
# remédio que existe para combatê-la.
forge_wt_naoverificado_causa() {
  local repo="$1" wt="$2" rl="$3" rr="$4" modo="${5:-completo}"
  if [ ! -d "$wt" ]; then echo "caminho-inexistente"; return 0; fi
  case "$(forge_wt_merged_state "$repo" "$(git -C "$wt" rev-parse HEAD 2>/dev/null || echo HEAD)" "$rl" "$rr")" in
    indeterminado) echo "refs-nao-decidem"; return 0 ;;
  esac
  if [ "$modo" = "barato" ]; then echo "predicado-omitido"; return 0; fi
  # No modo completo a classificação só devolve `nao-verificado` pelas duas causas acima; chegar
  # aqui significa que algo mudou entre a classificação e esta leitura. Dizer "desconhecida" é a
  # única resposta honesta, e ela é preferível a repetir a explicação de uma causa que não vale.
  echo "desconhecida"
}

# forge_wt_default_refs <repo> -> ecoa "<ref-local> <ref-remota>"
# A ref de integração não é adivinhada em silêncio: a primeira que existir entre develop, main e
# master vence, e o nome escolhido é publicado por quem chama.
#
# Quando NENHUMA delas existe, a resposta é um par de sentinelas que não resolvem, e não `HEAD HEAD`.
# A diferença não é cosmética: com `HEAD` dos dois lados toda worktree é ancestral de si mesma, toda
# worktree vira "mergeada", e a triagem passaria a PROPOR remoção de árvore viva — o falso-verde
# exato que esta camada existe para impedir. Com as sentinelas, as duas leituras devolvem "não
# resolve", o estado é `indeterminado` e a classe é `nao-verificado`.
forge_wt_default_refs() {
  local repo="$1" b
  for b in dev develop main master; do
    if forge_wt_ref_exists "$repo" "$b" || forge_wt_ref_exists "$repo" "origin/$b"; then
      printf '%s origin/%s\n' "$b" "$b"
      return 0
    fi
  done
  printf 'FORGE-SEM-REF-DE-INTEGRACAO origin/FORGE-SEM-REF-DE-INTEGRACAO\n'
}
