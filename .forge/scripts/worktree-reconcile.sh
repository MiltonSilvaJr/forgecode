#!/usr/bin/env bash
# worktree-reconcile.sh — reconciliação determinista de worktrees (sem LLM).
# Para cada worktree de `git worktree list --porcelain`, imprime branch, ahead/behind do
# upstream, status curto (staged/dirty/untracked) e último commit — 1 bloco de 3-4 linhas por
# worktree. Usa `git -C` sempre (nunca `cd`) para não perder o cwd entre chamadas.
#
# Motivação: após um subagente ser interrompido/morto no meio de uma onda, o tracker
# (PROGRESS-TRACKING.md) pode não refletir o estado REAL do worktree — este script dá a foto
# real antes de redistribuir tasks (ver /forge:coding-loop).
#
# AHEAD/BEHIND (LDG-0056): resolvido por `git ls-remote`, nunca por `refs/remotes/<remote>/*`.
# `refs/remotes/*` é réplica LOCAL e pode estar desatualizada NAS DUAS DIREÇÕES: sem `fetch`
# recente ela ignora o que o servidor já tem (ahead superestimado), e depois de um `fetch` de
# OUTRO processo ela pode registrar mais do que este processo ainda sabia (ahead subestimado). É o
# MESMO defeito que o `check-push-ahead.sh` corrigiu para o `pre-push` (issue #67) — a técnica é a
# mesma; o desenho aqui é diferente porque `git worktree` COMPARTILHA `refs/remotes/*` e o banco de
# objetos entre TODOS os worktrees do mesmo repositório (só HEAD/index são por worktree), então uma
# leitura de rede POR REMOTO — nunca por worktree — já cobre todos eles. Ver `worktree_reconcile.
# timeout_s` no forge.yaml.
#
# TRIAGEM (--triage): classifica cada worktree linkada num dos seis desfechos de
# `lib/worktree-classify.sh` e imprime, para cada um, o comando exato — sem executar nenhum. Ela
# existe porque o `post-merge` só fala no instante de um merge no tronco, e ninguém que acumulou 29
# worktrees num repositório estava olhando naquele instante. Ela NUNCA remove e NUNCA commita:
# medido em 2026-09-08, 23 das 36 worktrees mergeadas do ecossistema satisfazem "limpa" por
# `git status --porcelain` e carregam estado ignorado irrecuperável — uma varredura que agisse sobre
# essa população destruiria 23 árvores e sairia com código zero.
#
# Uso:
#   worktree-reconcile.sh                # lista todos os worktrees do repo atual
#   worktree-reconcile.sh --root <path>  # repo alternativo (default: cwd)
#   worktree-reconcile.sh --triage       # classifica e PROPÕE (não executa nada)
#   worktree-reconcile.sh --triage --barato   # sem o predicado de arquivo ignorado (caro)
set -u

ROOT="."
TRIAGE=0
TRIAGE_MODO="completo"
TRIAGE_REF_LOCAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --triage) TRIAGE=1; shift ;;
    --barato) TRIAGE_MODO="barato"; shift ;;
    --ref)
      # O critério de recusa é ser MEMBRO do conjunto de flags declaradas, nunca "começa com hífen":
      # é a lição de #103, em que `[ -n "$value" ]` gravava a string `--title` no campo e respondia
      # OK com rc 0. Uma branch chamada `-x` é nome ruim, mas não é uma flag deste script.
      case "${2:-}" in
        ''|--root|--triage|--barato|--ref)
          echo "FAIL: --ref exige o nome de uma branch, e recebeu '${2:-<nada>}', que é uma flag deste próprio script." >&2
          exit 1 ;;
      esac
      TRIAGE_REF_LOCAL="$2"; shift 2 ;;
    *) echo "Uso: worktree-reconcile.sh [--root <path>] [--triage [--barato] [--ref <branch>]]" >&2; exit 1 ;;
  esac
done

ROOT="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "FAIL: não é um repositório git ($ROOT)" >&2
  exit 1
}

porcelain="$(git -C "$ROOT" worktree list --porcelain 2>/dev/null)"
[ -n "$porcelain" ] || { echo "Nenhum worktree encontrado."; exit 0; }

# ── triagem ─────────────────────────────────────────────────────────────────────────────────────
if [ "$TRIAGE" -eq 1 ]; then
  WTC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/worktree-classify.sh"
  if [ ! -f "$WTC" ]; then
    echo "FAIL: lib/worktree-classify.sh não encontrado ao lado deste script ($WTC) — a triagem delega os predicados a ele, e delegar para um alvo ausente é erro, nunca no-op." >&2
    exit 2
  fi
  # shellcheck source=/dev/null
  . "$WTC"

  if [ -n "$TRIAGE_REF_LOCAL" ]; then
    REF_LOCAL="$TRIAGE_REF_LOCAL"; REF_REMOTA="origin/$TRIAGE_REF_LOCAL"
  else
    _refs="$(forge_wt_default_refs "$ROOT")"
    REF_LOCAL="${_refs%% *}"; REF_REMOTA="${_refs##* }"
  fi

  echo "triagem de worktrees — $ROOT"
  echo "refs de integração: '$REF_LOCAL' (réplica local) e '$REF_REMOTA' (o que o servidor tinha no último fetch)"
  [ "$TRIAGE_MODO" = "barato" ] && echo "modo BARATO: o predicado de arquivo ignorado não foi executado, e por isso nenhuma worktree recebe veredito de remoção segura"
  echo

  n_viva=0; n_destacada=0; n_limpa=0; n_ign=0; n_suja=0; n_naoverif=0; n_total=0
  while IFS= read -r wtline; do
    case "$wtline" in "worktree "*) : ;; *) continue ;; esac
    wtpath="${wtline#worktree }"
    [ -n "$wtpath" ] || continue
    # O checkout principal não é população desta triagem: ele não se remove nem se renomeia aqui.
    [ "$wtpath" = "$ROOT" ] && continue
    n_total=$((n_total + 1))
    classe="$(forge_wt_classify "$ROOT" "$wtpath" "$REF_LOCAL" "$REF_REMOTA" "$TRIAGE_MODO")"
    branch="$(forge_wt_head_branch "$wtpath" 2>/dev/null || true)"
    echo "$classe  $wtpath"
    [ -n "$branch" ] && echo "    branch: $branch"
    case "$classe" in
      viva)
        n_viva=$((n_viva + 1))
        echo "    nada a fazer — não é ancestral de '$REF_LOCAL' nem de '$REF_REMOTA'"
        ;;
      destacada)
        n_destacada=$((n_destacada + 1))
        echo "    sem branch: o trabalho daqui não vira PR e o rastro morre com a worktree"
        # A classe `destacada` é decidida ANTES de qualquer predicado de sujeira, e sem esta leitura
        # ela absorveria em silêncio a face 2 do problema — trabalho não commitado. É a população
        # onde a perda de dado de fato acontece: as worktrees sujas medidas em campo eram todas
        # destacadas, e o conserto desta onda não as alcança retroativamente. Dizer "sem branch" e
        # calar sobre o arquivo que a remoção apaga seria informar a metade barata do problema.
        if sujo_d="$(forge_wt_tracked_dirty "$wtpath")"; then
          echo "    e há trabalho NÃO COMMITADO aqui, que a branch sozinha não salva:"
          printf '%s\n' "$sujo_d" | sed 's/^/        · /'
          echo "    resgatar ANTES de remover: git -C '$wtpath' switch -c <tipo>/<escopo>/<descricao> && git -C '$wtpath' add -A && git -C '$wtpath' commit -m 'wip($(basename "$wtpath")): resgate antes de remover a worktree'"
        else
          echo "    dar nome: git -C '$wtpath' switch -c <tipo>/<escopo>/<descricao>"
        fi
        ;;
      mergeada-limpa)
        n_limpa=$((n_limpa + 1))
        echo "    índice limpo e disco sem arquivo ignorado presente — removível sem perda"
        echo "    git worktree remove '$wtpath'${branch:+ && git branch -d '$branch'}"
        ;;
      mergeada-com-ignorados)
        n_ign=$((n_ign + 1))
        echo "    NÃO removível em silêncio: há arquivo IGNORADO presente, que 'git status' não enxerga e a remoção apaga sem recuperação possível"
        forge_wt_ignored_present "$wtpath" | sed 's/^/        · /'
        echo "    remover mesmo assim, ciente do que se perde: git worktree remove --force '$wtpath'${branch:+ && git branch -d '$branch'}"
        ;;
      mergeada-suja)
        n_suja=$((n_suja + 1))
        echo "    há trabalho NÃO COMMITADO aqui, e branch nenhuma o salva:"
        forge_wt_tracked_dirty "$wtpath" | sed 's/^/        · /'
        echo "    resgatar primeiro: git -C '$wtpath' add -A && git -C '$wtpath' commit -m 'wip($(basename "$wtpath")): resgate antes de remover a worktree'"
        echo "    só então: git worktree remove '$wtpath'"
        ;;
      nao-verificado)
        n_naoverif=$((n_naoverif + 1))
        # A explicação sai da CAUSA, nunca do MODO. No modo barato as duas causas ocorrem, e
        # explicar uma pela outra faria a triagem afirmar "mergeada e de índice limpo" sobre uma
        # worktree cujo estado de merge é indeterminado e cujo índice nunca foi medido — as duas
        # metades falsas, dentro do terceiro estado que esta triagem existe para proteger.
        case "$(forge_wt_naoverificado_causa "$ROOT" "$wtpath" "$REF_LOCAL" "$REF_REMOTA" "$TRIAGE_MODO")" in
          caminho-inexistente)
            echo "    o caminho não existe mais no disco — nada a classificar"
            echo "    limpar a referência morta: git -C '$ROOT' worktree prune"
            ;;
          predicado-omitido)
            echo "    mergeada e de índice limpo, mas o predicado de arquivo ignorado não foi executado neste modo — sem ele não há veredito de remoção segura"
            echo "    veredito completo: bash .forge/scripts/worktree-reconcile.sh --triage"
            ;;
          refs-nao-decidem)
            d_local="?"; d_remota="?"
            forge_wt_ref_exists "$ROOT" "$REF_LOCAL" && d_local="existe" || d_local="NÃO resolve"
            forge_wt_ref_exists "$ROOT" "$REF_REMOTA" && d_remota="existe" || d_remota="NÃO resolve"
            div="$(git -C "$ROOT" rev-list --count --left-right "$REF_LOCAL...$REF_REMOTA" 2>/dev/null || true)"
            echo "    NÃO CONSEGUI VERIFICAR: '$REF_LOCAL' ($d_local) e '$REF_REMOTA' ($d_remota) não concordam sobre esta worktree${div:+, e divergem em $div commit(s) (local/remota)}"
            echo "    resolver a divergência antes de decidir: git -C '$ROOT' fetch origin"
            ;;
          *)
            echo "    NÃO CONSEGUI VERIFICAR: e não consegui nomear a causa — nada aqui é veredito de mergeada nem de limpa"
            echo "    veredito completo: bash .forge/scripts/worktree-reconcile.sh --triage"
            ;;
        esac
        ;;
    esac
    echo
  done <<EOF_TRIAGE
$porcelain
EOF_TRIAGE

  if [ "$n_total" -eq 0 ]; then
    echo "universo-vazio: nenhuma worktree linkada — a triagem não examinou nada, e nada aqui é veredito."
    exit 0
  fi
  echo "resumo: viva=$n_viva destacada=$n_destacada mergeada-limpa=$n_limpa mergeada-com-ignorados=$n_ign mergeada-suja=$n_suja nao-verificado=$n_naoverif (total=$n_total)"
  echo "nada foi executado: a triagem classifica e propõe, e a decisão de remover é de quem tem o contexto da branch."
  exit 0
fi

# ── leitura de rede, uma vez por REMOTO, nunca por worktree ─────────────────────────────────────
CACHE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/forge-wtreconcile.XXXXXX")" || {
  echo "FAIL: não foi possível criar diretório temporário" >&2
  exit 1
}
trap 'rm -rf "$CACHE_DIR"' EXIT INT TERM HUP

FORGE_YAML="$ROOT/.forge/forge.yaml"
_wtr_yaml_field() {  # _wtr_yaml_field <bloco> <chave>
  [ -f "$FORGE_YAML" ] || { echo ""; return; }
  awk -v blk="$1" -v key="$2" '
    $0 ~ "^"blk":" { inblk=1; next }
    inblk && /^[a-z_]+:/ { exit }
    inblk && $0 ~ "^[ ]+"key":" { sub("^[ ]+"key":[ ]*",""); sub(/[ ]*#.*$/,""); sub(/[ ]+$/,""); print; exit }
  ' "$FORGE_YAML"
}
WTR_TIMEOUT_S="$(_wtr_yaml_field worktree_reconcile timeout_s)"
case "${WTR_TIMEOUT_S:-}" in
  '') WTR_TIMEOUT_S=5 ;;
  *[!0-9]*) WTR_TIMEOUT_S=5 ;;
  *) WTR_TIMEOUT_S=$((10#$WTR_TIMEOUT_S)); [ "$WTR_TIMEOUT_S" -ge 1 ] || WTR_TIMEOUT_S=5 ;;
esac

# `git ls-remote --heads <remote>` sem filtro de ref: UMA leitura de rede devolve TODAS as branches
# do remoto de uma vez, então N worktrees com upstreams diferentes no MESMO remote pagam uma leitura
# só. Nunca por PIPE: a captura por `$( )` esperaria o descritor fechar, e um neto de transporte
# (`git-remote-https`) pode sobreviver ao sinal e segurá-lo aberto bem depois do teto — a mesma
# armadilha medida no check-push-ahead.sh. Escreve em ARQUIVO e mata pelo grupo isolado do filho.
_wtr_ls_remote_once() {  # _wtr_ls_remote_once <remote> <arquivo-de-saída> -> rc 0 se mediu
  local remote="$1" out="$2" netpid child_pgid self_pgid isolated=0 i=0 maxi done_net=0
  set -m
  ( GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=/bin/echo SSH_ASKPASS_REQUIRE=never \
      git -C "$ROOT" ls-remote --heads "$remote" > "$out" 2>/dev/null
  ) </dev/null >/dev/null 2>&1 &
  netpid=$!
  set +m
  child_pgid="$(ps -o pgid= -p "$netpid" 2>/dev/null | tr -d ' ')"
  self_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
  [ -n "$child_pgid" ] && [ -n "$self_pgid" ] && [ "$child_pgid" != "$self_pgid" ] && isolated=1
  maxi=$(( WTR_TIMEOUT_S * 10 + 5 ))
  while [ "$i" -lt "$maxi" ]; do
    kill -0 "$netpid" 2>/dev/null || { done_net=1; break; }
    sleep 0.1; i=$((i + 1))
  done
  if [ "$done_net" -eq 0 ]; then
    if [ "$isolated" -eq 1 ]; then
      disown "$netpid" 2>/dev/null || true
      kill -TERM -- "-$child_pgid" 2>/dev/null
      sleep 0.3
      kill -KILL -- "-$child_pgid" 2>/dev/null
    fi
    return 1
  fi
  wait "$netpid" 2>/dev/null
  [ -s "$out" ]
}

# Cache POR REMOTO (nunca por worktree): a primeira chamada mede; as seguintes leem o arquivo. Sem
# array associativo (bash 3.2/macOS) — o nome do arquivo de cache é derivado do nome do remoto.
_wtr_remote_cache_file() {  # _wtr_remote_cache_file <remote> -> ecoa <arquivo>; rc 1 se não mediu
  local remote="$1" safe f status
  safe="$(printf '%s' "$remote" | tr -c 'A-Za-z0-9_.-' '_')"
  f="$CACHE_DIR/$safe.lsremote"
  status="$CACHE_DIR/$safe.status"
  if [ -f "$status" ]; then
    printf '%s' "$f"
    [ "$(cat "$status" 2>/dev/null)" = "ok" ]
    return $?
  fi
  if _wtr_ls_remote_once "$remote" "$f"; then
    echo ok > "$status"
    printf '%s' "$f"
    return 0
  fi
  : > "$f"
  echo fail > "$status"
  printf '%s' "$f"
  return 1
}

# sha remoto REAL de <remote>/<branch>, ou vazio se a leitura de rede não mediu.
_wtr_remote_sha() {  # _wtr_remote_sha <remote> <branch>
  local remote="$1" branch="$2" f
  f="$(_wtr_remote_cache_file "$remote")" || return 1
  [ -s "$f" ] || return 1
  awk -v b="refs/heads/$branch" '$2==b{print $1; exit}' "$f"
}

wt=""
count=0
print_block() {
  local path="$1"
  [ -n "$path" ] || return 0
  [ -d "$path" ] || { echo "$path :: MISSING (path não existe mais no disco)"; echo; return 0; }

  local branch upstream ahead behind status staged dirty untracked last
  local remote_name remote_branch rsha measured
  branch="$(git -C "$path" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")"
  upstream="$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo "")"

  ahead=0; behind=0; measured="sem upstream"
  if [ -n "$upstream" ]; then
    remote_name="${upstream%%/*}"
    remote_branch="${upstream#*/}"
    rsha="$(_wtr_remote_sha "$remote_name" "$remote_branch" 2>/dev/null)"
    case "$rsha" in
      [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*)
        if git -C "$path" cat-file -e "${rsha}^{commit}" 2>/dev/null; then
          # Medido pelo REMOTO REAL, não pela réplica: fecha o LDG-0056.
          ahead="$(git -C "$path" rev-list --count "${rsha}..HEAD" 2>/dev/null || echo 0)"
          behind="$(git -C "$path" rev-list --count "HEAD..${rsha}" 2>/dev/null || echo 0)"
          measured="medido via ls-remote"
        else
          # sha remoto existe mas o objeto não está localmente (clone raso, sem fetch). A réplica
          # local é o único dado disponível — mas dizemos isso, nunca fingimos que é o remoto real.
          ahead="$(git -C "$path" rev-list --count "${upstream}..HEAD" 2>/dev/null || echo 0)"
          behind="$(git -C "$path" rev-list --count "HEAD..${upstream}" 2>/dev/null || echo 0)"
          measured="NÃO MEDIDO — commit remoto $(printf '%s' "$rsha" | cut -c1-7) desconhecido localmente; réplica local pode estar desatualizada (git fetch $remote_name)"
        fi
        ;;
      *)
        ahead="$(git -C "$path" rev-list --count "${upstream}..HEAD" 2>/dev/null || echo 0)"
        behind="$(git -C "$path" rev-list --count "HEAD..${upstream}" 2>/dev/null || echo 0)"
        measured="NÃO MEDIDO — ls-remote de '$remote_name' falhou ou expirou; réplica local pode estar desatualizada"
        ;;
    esac
  fi

  status="$(git -C "$path" status --porcelain 2>/dev/null || echo "")"
  staged="$(printf '%s\n' "$status" | grep -c '^[MADRC]' || true)"
  dirty="$(printf '%s\n' "$status" | grep -c '^.[MD]' || true)"
  untracked="$(printf '%s\n' "$status" | grep -c '^??' || true)"

  last="$(git -C "$path" log -1 --format='%h %ci %s' 2>/dev/null || echo "sem commits")"

  echo "$path"
  echo "  branch=$branch upstream=${upstream:-<none>} ahead=$ahead behind=$behind ($measured)"
  echo "  staged=$staged dirty=$dirty untracked=$untracked"
  echo "  last: $last"
  echo
}

while IFS= read -r line; do
  case "$line" in
    "worktree "*)
      print_block "$wt"
      wt="${line#worktree }"
      count=$((count + 1))
      ;;
  esac
done <<EOF_PORCELAIN
$porcelain
EOF_PORCELAIN
print_block "$wt"

echo "Total: $count worktree(s)."
