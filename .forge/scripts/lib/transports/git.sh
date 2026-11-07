#!/usr/bin/env bash
# Transporte `git` — hub numa BRANCH DEDICADA de um repositório remoto.
#
# Por que branch dedicada e não um diretório no default branch: o canal do liaison muda em ritmo
# próprio (várias mensagens por dia) e não deve poluir o histórico do código, disparar CI, nem
# entrar em PR de feature. A branch é órfã — sem ancestral comum com o código — então nunca é
# candidata a merge por engano.
#
# REPOSITÓRIO TEMPORÁRIO POR EXECUÇÃO (design §2.4, opção C — "nenhum recurso compartilhado por
# execução"). O antigo clone compartilhado em `.forge/cache/liaison/<channel>` usava
# `checkout -B`/`reset --hard`, e o `reset` de um processo apagava a união recém-escrita por
# outro. Em vez de travar esse recurso compartilhado (trazendo de volta o problema de vivacidade
# que a opção C abandonou para os transportes de diretório), CADA EXECUÇÃO de `t_push`/`t_pull`
# trabalha num repositório `git init` próprio e descartável em
# `.forge/cache/liaison-git-run/<channel>@<pid>@<aleatório>/`; se o clone antigo existir, seus
# objetos entram como `alternates` (só leitura, para economizar download) — nenhum ref nem
# objeto é escrito no repositório compartilhado, que deixa de ser escrito e fica como fonte
# opcional de objetos. O próprio REMOTO é o compare-and-swap: só aceita fast-forward, então a
# recusa de um push por não-fast-forward É a conferência — não há conferência pós-mv separada
# como nos transportes de diretório.
#
# SEC-001 — A BRANCH DO CANAL É ESCRITA POR TERCEIROS. Quem tem push nela pode publicar symlink ou
# submódulo dentro do canal (`<canal>/blobs -> ../../.git/hooks`), e um checkout que materialize o
# link leva a escrita do sync para fora da árvore. Camadas independentes, aplicadas no
# repositório descartável de cada execução, no push E no pull:
#   1. varredura da árvore INTEIRA da branch (`ls-tree -r`, sem pathspec) antes do checkout, com
#      falha fechada (`_git_scan_tree`). Sem pathspec porque ele diferencia maiúsculas e o
#      filesystem pode não diferenciar: `CH/blobs` escapava de `-- ch` e virava `ch/blobs` no
#      APFS/NTFS. A saída é CAPTURADA antes de ser examinada, e o `awk` lê tudo: `ls-tree | awk |
#      grep -q` dentro de `if` sob `pipefail` era pulado por SIGPIPE em árvores grandes;
#   2. o repositório descartável nasce com symlinks DESLIGADOS no checkout (`_git_init_run`): se
#      algo escapar da varredura, o link vira arquivo de texto comum;
#   3. depois do checkout, nenhum link pode existir na árvore de trabalho (`_git_reject_links`) —
#      se existir, recusa e descarta a árvore;
#   4. a árvore de trabalho do clone antigo `.forge/cache/liaison/<channel>`, herdada de uma versão
#      anterior (que fazia checkout ali com links reais), é descartada no início de cada execução
#      (`_git_descarta_cache_antigo`) — só a árvore; `.git` fica, porque seus objetos são a fonte
#      `alternates`;
#   5. toda recusa propaga até o `sync`, que nunca grava marca d'água do que não foi publicado.
# O pull materializa por checkout no repositório PRIVADO da execução (nunca `git archive | tar`,
# que materializa link independentemente da configuração do checkout) e lê de lá por `_dir_pull`.
# Essa leitura, e toda publicação na árvore descartável (blobs, união, reparo), passam pelo módulo `liaison-hub-io.mjs` dentro do diretório ancorado por `_dir_anchor`, como nos transportes de diretório.
#
# PLAT-204 — A BRANCH CONFIGURADA PRECISA SER DEDICADA AO LIAISON, e não só "não ser a de código": a varredura de SEC-001 (camada 1, `_git_scan_tree`) olha a árvore INTEIRA da branch, sem pathspec, e recusa symlink (120000) ou gitlink/submódulo (160000) em QUALQUER lugar dela, não só abaixo de `<canal>/`. Apontar `branch` para uma branch que carregue symlink ou submódulo legítimo (uma branch de código, uma branch de docs com link) faz todo sync desse canal reprovar. A restrição é deliberada: o pathspec por canal diferencia maiúsculas e o filesystem pode não diferenciar, e foi por ali que `CH/blobs` escapava da varredura.
#
# Como todo transporte, este move ARQUIVOS OPACOS: não parseia mensagem, não sabe o que é thread,
# e não decide merge. Conflito de conteúdo é resolvido pela política de import (liaison-import.mjs),
# nunca pelo git.

# shellcheck source=./_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

_git_branch() { printf '%s' "${LIAISON_T_BRANCH:-liaison/$LIAISON_CHANNEL}"; }
# Clone antigo, só leitura (alternates): nunca mais escrito por este transporte.
_git_old_cache() { printf '%s/.forge/cache/liaison/%s' "$LIAISON_ROOT" "$LIAISON_CHANNEL"; }
_git_run_base() { printf '%s/.forge/cache/liaison-git-run' "$LIAISON_ROOT"; }
_git_run_dir() { printf '%s/%s@%s@%s' "$(_git_run_base)" "$LIAISON_CHANNEL" "$$" "$(_liaison_unique_suffix)"; }

# _git_cleanup_orphans — remove diretório de execução morta SÓ POR IDADE (> 1 h pelo mtime),
# nunca por pid (um pid pode ter sido reaproveitado). O glob `<channel>@*` não casa com outro
# canal porque `@` não pertence a `[a-z0-9._-]`.
_git_cleanup_orphans() {
  local base; base="$(_git_run_base)"
  [ -d "$base" ] || return 0
  local d mtime now cutoff
  now="$(date +%s)"; cutoff=$(( now - 3600 ))
  for d in "$base/$LIAISON_CHANNEL"@*; do
    [ -d "$d" ] || continue
    mtime="$(stat -c %Y "$d" 2>/dev/null || stat -f %m "$d" 2>/dev/null || echo "$now")"
    [ "$mtime" -lt "$cutoff" ] && rm -rf "$d" 2>/dev/null || true
  done
}

# _git_branch_check <remote> <branch> — rc 0 existe, 2 ausente (ls-remote --exit-code), 1 falha
# de rede/qualquer outra causa. NUNCA trata falha de rede como "ausente".
_git_branch_check() {
  local remote="$1" branch="$2"
  git ls-remote --exit-code "$remote" "refs/heads/$branch" >/dev/null 2>&1
  local rc=$?
  case "$rc" in
    0) return 0 ;;
    2) return 2 ;;
    *) return 1 ;;
  esac
}

# _git_descarta_arvore <dir> — apaga a árvore de trabalho de <dir> (tudo menos `.git`).
# `checkout`/`reset --hard` não tocam arquivo não rastreado, e desligar symlinks não reescreve uma
# entrada do índice que o git considera limpa — por isso a árvore é descartada, não "atualizada".
_git_descarta_arvore() {
  find "$1" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} + 2>/dev/null || true
}

# _git_descarta_cache_antigo — camada 4 de SEC-001 (ver o cabeçalho): a árvore de trabalho do
# clone antigo pode trazer link materializado por uma versão vulnerável. Este transporte não faz
# mais checkout ali, mas o link continuaria no disco da vítima; descarta a árvore, preserva `.git`.
_git_descarta_cache_antigo() {
  local old; old="$(_git_old_cache)"
  [ -d "$old/.git" ] || return 0
  _git_descarta_arvore "$old"
}

# _git_scan_tree <run_dir> <rev> <branch> — camada 1 de SEC-001: recusa se a árvore INTEIRA de
# <rev> tiver symlink (120000) ou submódulo (160000). Falha fechada: sem conseguir listar, não há
# checkout.
_git_scan_tree() {
  local dir="$1" rev="$2" branch="$3" tree
  tree="$(git -C "$dir" ls-tree -r "$rev")" \
    || { echo "FAIL: não foi possível listar a árvore da branch '$branch' — recusado (SEC-001: sem varredura não há checkout)." >&2; return 1; }
  if printf '%s\n' "$tree" | awk '$1=="120000"||$1=="160000"{f=1} END{exit !f}'; then
    echo "FAIL: a branch do canal '$branch' contém symlink ou submódulo — recusado (SEC-001, possível" >&2
    echo "      traversal). Não sincronize até remover o commit malicioso da branch remota e" >&2
    echo "      identificar quem o publicou." >&2
    return 1
  fi
  return 0
}

# _git_reject_links <run_dir> <branch> — camada 3 de SEC-001: nenhum link na árvore de trabalho
# depois do checkout. Se houver, recusa e descarta a árvore.
_git_reject_links() {
  local dir="$1" branch="$2" links
  links="$(find "$dir" -path "$dir/.git" -prune -o -type l -print)" \
    || { echo "FAIL: não foi possível varrer o cache de execução '$dir' — recusado (SEC-001)." >&2; return 1; }
  if [ -n "$links" ]; then
    echo "FAIL: o checkout da branch '$branch' materializou link simbólico no cache de execução — recusado (SEC-001):" >&2
    printf '      %s\n' "$links" >&2
    _git_descarta_arvore "$dir"
    return 1
  fi
  return 0
}

# _git_checkout_safe <run_dir> <branch> — checkout de FETCH_HEAD no repositório descartável, entre
# as camadas 1 e 3 de SEC-001.
_git_checkout_safe() {
  local dir="$1" branch="$2"
  _git_descarta_arvore "$dir"
  _git_scan_tree "$dir" FETCH_HEAD "$branch" || return 1
  git -C "$dir" checkout -q -f -B "$branch" FETCH_HEAD || return 1
  _git_reject_links "$dir" "$branch" || return 1
  return 0
}

# _git_init_run <dir> — git init do repositório descartável desta execução, com o clone antigo
# (se existir) como fonte opcional de objetos. O diretório é criado de forma EXCLUSIVA (`mkdir`
# sem `-p` no último nível): um nome já existente nunca é reaproveitado com o conteúdo que tiver.
# Symlinks ficam desligados no checkout (camada 2 de SEC-001).
_git_init_run() {
  local dir="$1"
  mkdir -p "$(dirname -- "$dir")" || return 1
  mkdir -- "$dir" 2>/dev/null || return 1
  git init -q "$dir" || return 1
  git -C "$dir" config user.email "liaison@forge.local"
  git -C "$dir" config user.name "forge-liaison"
  git -C "$dir" config commit.gpgsign false
  git -C "$dir" config core.symlinks false
  local old; old="$(_git_old_cache)"
  if [ -d "$old/.git/objects" ]; then
    mkdir -p "$dir/.git/objects/info"
    printf '%s\n' "$old/.git/objects" > "$dir/.git/objects/info/alternates"
  fi
  return 0
}

t_probe() {
  [ -n "${LIAISON_T_REMOTE:-}" ] || { echo "FAIL: transporte git exige 'remote' no liaison.yaml" >&2; return 1; }
  command -v git >/dev/null 2>&1 || { echo "FAIL: git não encontrado no PATH" >&2; return 1; }
  git ls-remote "$LIAISON_T_REMOTE" >/dev/null 2>&1 \
    || { echo "FAIL: remote inacessível: $LIAISON_T_REMOTE (credencial? URL?)" >&2; return 1; }
  return 0
}

# t_push — publica log/<self>.jsonl e blobs novos na branch do canal, sem trava de rede (design
# §2.4). Cada tentativa: repositório temporário novo, `ls-remote` decide se a branch existe,
# fetch+checkout (ou commit inicial vazio), sequência igual à dos transportes de diretório
# (instantâneo, blobs, união), `git add` explícito só de `<channel>/log/<self>.jsonl` e blobs
# novos (nunca `git add -A`), commit, `push ... HEAD:refs/heads/<branch>` sem force. Recusa por
# não-fast-forward volta ao início da tentativa (novo fetch) — é o próprio laço de recusa que
# confere, sem conferência pós-mv separada. SEC-001: o checkout passa pelas camadas de
# `_git_checkout_safe`, e toda escrita na árvore descartável (blobs, união, reparo) usa os mesmos
# helpers dos transportes de diretório — temporário aleatório com O_EXCL + `rename(2)`.
t_push() {
  _git_cleanup_orphans
  _git_descarta_cache_antigo
  local remote branch
  remote="$LIAISON_T_REMOTE"; branch="$(_git_branch)"
  local deadline; deadline=$(( $(date +%s) + $(_liaison_push_deadline_s) ))
  local attempts=0 repairs=0 rc=1
  LIAISON_OBSERVED_FILE=""

  local src="$LIAISON_CHANNEL_DIR"
  local own="$src/log/$LIAISON_SELF.jsonl"

  while :; do
    attempts=$((attempts + 1))
    local run_dir; run_dir="$(_git_run_dir)"
    if ! _git_init_run "$run_dir"; then
      echo "FAIL: não foi possível preparar repositório temporário git em $run_dir" >&2
      rm -rf "$run_dir" 2>/dev/null
      return 1
    fi

    local branch_rc=0
    _git_branch_check "$remote" "$branch" || branch_rc=$?
    local base_commit=""
    case "$branch_rc" in
      0)
        if ! git -C "$run_dir" fetch -q --depth 1 "$remote" "$branch" 2>/dev/null; then
          echo "FAIL: push RECUSADO — fetch da branch $branch falhou (rede?)" >&2
          rm -rf "$run_dir"; return 1
        fi
        _git_checkout_safe "$run_dir" "$branch" || { rm -rf "$run_dir"; return 1; }
        base_commit="$(git -C "$run_dir" rev-parse HEAD)"
        ;;
      2)
        local empty_tree initial_commit
        empty_tree="$(git -C "$run_dir" hash-object -t tree /dev/null)"
        initial_commit="$(git -C "$run_dir" commit-tree "$empty_tree" -m "liaison: canal $LIAISON_CHANNEL (inicial)")"
        git -C "$run_dir" checkout -q -B "$branch" "$initial_commit" || { rm -rf "$run_dir"; return 1; }
        base_commit="$initial_commit"
        ;;
      *)
        echo "FAIL: push RECUSADO — não foi possível saber se a branch $branch existe no remoto (falha de rede, não ausência)" >&2
        rm -rf "$run_dir"; return 1
        ;;
    esac

    # Caminho físico da árvore descartável (o `LIAISON_ROOT` pode passar por symlink, ex. `/tmp`
    # no macOS) e diretórios do canal criados por nome relativo, como no `_dir_push`: um `<canal>`
    # publicado como arquivo comum na branch faz a criação falhar, nunca escrever em outro lugar.
    local run_phys hub
    run_phys="$(CDPATH='' cd -P -- "$run_dir" 2>/dev/null && pwd -P)" || { rm -rf "$run_dir"; return 1; }
    hub="$run_phys/$LIAISON_CHANNEL"
    if ! { _dir_ensure_subdir "$run_phys" "$LIAISON_CHANNEL" \
           && _dir_ensure_subdir "$hub" log && _dir_ensure_subdir "$hub" blobs; }; then
      echo "FAIL: push RECUSADO — não foi possível preparar '$LIAISON_CHANNEL/{log,blobs}' na árvore da branch $branch." >&2
      rm -rf "$run_dir"; return 1
    fi

    if [ ! -f "$own" ]; then
      # nada próprio a publicar nesta execução.
      rm -rf "$run_dir"
      export LIAISON_PUSH_ATTEMPTS="$attempts" LIAISON_PUSH_REPAIRS="$repairs"
      return 0
    fi

    # Diretório PRIVADO da tentativa (fora do hub e da árvore descartável): instantâneo do log próprio, cópia do log próprio da branch e resultado da união. Todo caminho de saída o apaga.
    local gpriv snap hubf
    gpriv="$(mktemp -d "${TMPDIR:-/tmp}/forge-liaison-git-push.XXXXXX")" \
      || { echo "FAIL: push RECUSADO — não foi possível criar o diretório privado do push." >&2; rm -rf "$run_dir"; return 1; }
    snap="$gpriv/instantaneo.jsonl"; hubf="$gpriv/hub-$LIAISON_SELF.jsonl"
    if ! cp -- "$own" "$snap"; then
      echo "FAIL: push RECUSADO — não foi possível tirar o instantâneo do log próprio." >&2
      rm -rf "$gpriv" "$run_dir"; return 1
    fi
    if ! _dir_push_blobs "$hub" "$src"; then
      rm -rf "$gpriv" "$run_dir"
      return 1
    fi
    _liaison_test_barrier after-blobs

    # NODE-201, SEC-204: o log próprio que veio da branch é lido UMA vez pelo leitor seguro do módulo (`_dir_read_hub_own_log`), como nos transportes de diretório — a classificação e a união olham essa cópia privada, nunca o arquivo da árvore descartável por caminho.
    if ! _dir_reject_symlink "$hub/log/$LIAISON_SELF.jsonl" || ! _dir_read_hub_own_log "$hub" "$hubf"; then
      rm -rf "$gpriv" "$run_dir"; return 1
    fi
    local verdict cls_rc=0 did_union=1
    verdict="$(_dir_push_classify "$hub" "$snap" "$hubf")" || cls_rc=$?
    case "$cls_rc" in
      0) : ;;
      1) repairs=$((repairs + 1)) ;;
      2)
        if [ "${LIAISON_PUSH_REPAIR:-0}" = "1" ]; then
          # Reparo DECLARADO (LGC-003): mesmo desfecho do caso 2 de `_dir_push` — o log desta
          # árvore substitui o da branch, em vez de cair na união (que recusa a bifurcação e
          # instruiria o operador a trazer a versão do hub, o oposto do que ele declarou). O
          # commit segue sem force: se a branch andar no meio, o laço de recusa não-ff refaz a
          # tentativa inteira, com nova classificação.
          echo "WARN: reparo do log próprio (--repair-own-log) — a branch diverge desta árvore em posição(ões) que ela também tem:" >&2
          echo "     ${verdict#diverged}" >&2
          echo "      A versão da BRANCH nessas posições será DESCARTADA e substituída pela desta árvore." >&2
          echo "      Você está afirmando que este log é a autoridade sobre '$LIAISON_SELF'. Se a" >&2
          echo "      divergência vier de outra réplica sua que publicou mensagem distinta no mesmo" >&2
          echo "      seq, ela se perde aqui." >&2
          # Mesmo helper de publicação dos transportes de diretório (SEC-001): temporário
          # aleatório com O_EXCL e rename, nunca `cp` por caminho sobre o arquivo da branch.
          if ! _dir_publish_file "$snap" "$hub/log" "$LIAISON_SELF.jsonl"; then
            rm -rf "$gpriv" "$run_dir"
            return 1
          fi
          repairs=$((repairs + 1))
          did_union=0
        else
          echo "FAIL: push RECUSADO — DIVERGÊNCIA entre a branch $branch e esta árvore em posição(ões) que ela também tem: ${verdict#diverged}" >&2
          rm -rf "$gpriv" "$run_dir"
          return 1
        fi
        ;;
      *)
        echo "FAIL: push RECUSADO — não foi possível classificar o conteúdo da branch (rc $cls_rc)." >&2
        rm -rf "$gpriv" "$run_dir"
        return 1
        ;;
    esac

    local libdir; libdir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
    local unionmod="$libdir/liaison-push-union.mjs"
    if [ "$did_union" -eq 1 ]; then
      # União no diretório PRIVADO da tentativa e instalação por `_dir_publish_file` (módulo `liaison-hub-io.mjs`, SEC-001): nada de `<log>.tmp` de nome previsível ao lado do arquivo publicado.
      if ! node "$unionmod" "$snap" "$hubf" "$gpriv/uniao.jsonl" "$LIAISON_SELF" \
         || ! _dir_publish_file "$gpriv/uniao.jsonl" "$hub/log" "$LIAISON_SELF.jsonl"; then
        rm -rf "$gpriv" "$run_dir"
        return 1
      fi
    fi
    _liaison_test_barrier after-union
    rm -rf "$gpriv"

    # `git add` explícito (nunca `-A`): só o log do self e blobs novos.
    git -C "$run_dir" add -- "$LIAISON_CHANNEL/log/$LIAISON_SELF.jsonl" >/dev/null 2>&1
    if [ -d "$hub/blobs" ]; then
      local b
      while IFS= read -r b; do
        [ -n "$b" ] || continue
        git -C "$run_dir" add -- "$LIAISON_CHANNEL/blobs/$(basename "$b")" >/dev/null 2>&1
      done < <(find "$hub/blobs" -type f 2>/dev/null)
    fi

    local append_mod="$libdir/liaison-append.mjs"
    if git -C "$run_dir" diff --cached --quiet; then
      # nada novo sobre o que já está na branch — a observação é o que acabou de ser buscado.
      LIAISON_OBSERVED_FILE="$(mktemp "${TMPDIR:-/tmp}/liaison-git-observed.XXXXXX")"
      git -C "$run_dir" show "$base_commit:$LIAISON_CHANNEL/log/$LIAISON_SELF.jsonl" > "$LIAISON_OBSERVED_FILE" 2>/dev/null || : > "$LIAISON_OBSERVED_FILE"
      export LIAISON_OBSERVED_FILE
      _liaison_test_barrier after-mv
      rm -rf "$run_dir"
      # LGC-201: "nada novo a commitar" não quer dizer "réplica local em dia". Quando o log local é
      # prefixo do da branch (réplica atrasada do mesmo self, classificação `behind`), a união sai
      # igual ao arquivo da branch e não há commit — mas o log próprio local continua atrás, e o
      # próximo `send` reusaria um seq que a branch já tem (DIVERGÊNCIA permanente, issue #101).
      # Mesma disciplina de `_dir_push_union`: o observado (cópia privada, fora da árvore
      # descartável) volta para o log próprio por `union-own`, sob a trava, e a falha propaga.
      if ! node "$append_mod" union-own "$src" "$LIAISON_SELF" "$LIAISON_OBSERVED_FILE" >/dev/null; then
        echo "FAIL: union-own falhou ao sincronizar o log próprio de volta — o hub foi atualizado, mas a réplica local pode ficar atrás até o próximo sync" >&2
        rc=1
        break
      fi
      rc=0
      break
    fi

    git -C "$run_dir" commit -q -m "liaison($LIAISON_CHANNEL): $LIAISON_SELF" || { rm -rf "$run_dir"; return 1; }
    _liaison_test_barrier after-mv

    if git -C "$run_dir" push -q "$remote" "HEAD:refs/heads/$branch" 2>/dev/null; then
      # Push aceito pelo remoto = a própria conferência (fast-forward-only). Observação: o
      # log próprio tal como FOI ENVIADO (o commit HEAD, que por ser fast-forward é exatamente
      # o que o remoto passou a ter) — nenhum ref compartilhado (origin/<branch>) é consultado.
      LIAISON_OBSERVED_FILE="$(mktemp "${TMPDIR:-/tmp}/liaison-git-observed.XXXXXX")"
      git -C "$run_dir" show "HEAD:$LIAISON_CHANNEL/log/$LIAISON_SELF.jsonl" > "$LIAISON_OBSERVED_FILE" 2>/dev/null || : > "$LIAISON_OBSERVED_FILE"
      export LIAISON_OBSERVED_FILE
      # sincroniza o log próprio local de volta, sob a trava, com o que foi de fato enviado —
      # mesma disciplina de escritor único que os transportes de diretório (design §2.4). LGC-201:
      # a falha (trava ocupada ou perdida) RECUSA, como em `_dir_push_union` — antes um `|| true`
      # devolvia rc 0 com a réplica local atrás do que acabou de ser publicado.
      rm -rf "$run_dir"
      if ! node "$append_mod" union-own "$src" "$LIAISON_SELF" "$LIAISON_OBSERVED_FILE" >/dev/null; then
        echo "FAIL: union-own falhou ao sincronizar o log próprio de volta — o hub foi atualizado, mas a réplica local pode ficar atrás até o próximo sync" >&2
        rc=1
        break
      fi
      rc=0
      break
    fi

    # Recusado por não-fast-forward (ou qualquer outra causa) — o laço de recusa É a
    # conferência: volta ao início com um fetch novo. O prazo é o mesmo dos transportes de
    # diretório.
    rm -rf "$run_dir"
    if [ "$(date +%s)" -ge "$deadline" ]; then
      rc=1
      echo "FAIL: push esgotou o prazo ($(_liaison_push_deadline_s)s) sem conseguir publicar na branch $branch" >&2
      break
    fi
  done

  export LIAISON_PUSH_ATTEMPTS="$attempts" LIAISON_PUSH_REPAIRS="$repairs"
  echo "publicação: $attempts tentativa(s), $repairs reparo(s)" >&2
  return "$rc"
}

# t_pull <staging> — materializa os logs alheios e blobs da branch do canal num repositório
# temporário descartável desta execução (nunca num checkout compartilhado). SEC-001: o checkout
# passa pelas camadas de `_git_checkout_safe` (varredura da árvore inteira, symlinks desligados,
# recusa de link pós-checkout) e a leitura vai por `_dir_pull`, ancorada e sem hardlink. Nada de
# `git archive | tar -x`: o tar materializa link independentemente da configuração do checkout.
# Toda recusa PROPAGA com rc≠0 até o `sync`.
t_pull() {
  local staging="$1"
  _git_cleanup_orphans
  _git_descarta_cache_antigo
  local remote branch
  remote="$LIAISON_T_REMOTE"; branch="$(_git_branch)"
  local run_dir; run_dir="$(_git_run_dir)"
  _git_init_run "$run_dir" || { echo "FAIL: não foi possível preparar repositório temporário git" >&2; rm -rf "$run_dir"; return 1; }

  local branch_rc=0
  _git_branch_check "$remote" "$branch" || branch_rc=$?
  case "$branch_rc" in
    0)
      if ! git -C "$run_dir" fetch -q --depth 1 "$remote" "$branch" 2>/dev/null; then
        echo "FAIL: pull — fetch da branch $branch falhou (rede?)" >&2
        rm -rf "$run_dir"; return 1
      fi
      _git_checkout_safe "$run_dir" "$branch" || { rm -rf "$run_dir"; return 1; }
      mkdir -p "$staging/log" "$staging/blobs" || { rm -rf "$run_dir"; return 1; }
      local run_phys
      run_phys="$(CDPATH='' cd -P -- "$run_dir" 2>/dev/null && pwd -P)" || { rm -rf "$run_dir"; return 1; }
      if [ -d "$run_phys/$LIAISON_CHANNEL" ]; then
        _dir_pull "$run_phys/$LIAISON_CHANNEL" "$staging" || { rm -rf "$run_dir"; return 1; }
      fi
      ;;
    2)
      mkdir -p "$staging/log" "$staging/blobs" # branch ainda não existe no remoto — nada a puxar, não é erro
      ;;
    *)
      echo "FAIL: pull — não foi possível saber se a branch $branch existe no remoto (falha de rede, não ausência)" >&2
      rm -rf "$run_dir"; return 1
      ;;
  esac
  rm -rf "$run_dir"
  return 0
}
