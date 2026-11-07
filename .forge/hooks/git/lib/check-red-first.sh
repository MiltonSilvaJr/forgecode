#!/usr/bin/env bash
# check-red-first.sh (hook) — Forge pre-push: bloqueia o push de uma faixa que contenha commit
# `fix(...)` quando algum change ATIVO sujeito ao red-first (type:bugfix ou fixes_defects
# declarado, issue #138) não tiver evidência de Red resolvida
# (observed|waived). Chama SÓ o check ESTÁTICO já existente (.forge/scripts/check-red-first.sh
# check — Onda B, nunca roda teste algum, só lê evidence/red/*.json). O replay real (Onda C,
# lib/red-replay.mjs) é caro — worktree git + execução de teste — e NUNCA roda aqui: o pre-push
# tem que continuar rápido e viável. Replay é responsabilidade de `/forge:red replay` e do
# checkpoint de `/forge:verify` (spec-verify.sh). Sourced por pre-push (mesmo padrão de
# check-docs-reviewed.sh), também executável standalone para teste.
set -u

REPO="${REPO:-}"
[ -n "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
ZERO_SHA="0000000000000000000000000000000000000000"

_redfirst_resolve_base() {  # espelha _docs_resolve_base (check-docs-reviewed.sh)
  local local_sha="$1" remote_sha="$2" default_ref base
  if [ "$remote_sha" != "$ZERO_SHA" ]; then
    printf '%s\n' "$remote_sha"
    return 0
  fi
  default_ref="$(git -C "$REPO" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
  default_ref="${default_ref#refs/remotes/}"
  for candidate in "origin/develop" "$default_ref" "origin/main"; do
    [ -n "$candidate" ] || continue
    if base="$(git -C "$REPO" merge-base "$local_sha" "$candidate" 2>/dev/null)" && [ -n "$base" ]; then
      printf '%s\n' "$base"
      return 0
    fi
  done
  git -C "$REPO" rev-list --max-parents=0 "$local_sha" 2>/dev/null | tail -1
}

_redfirst_has_fix_commit() {  # _redfirst_has_fix_commit <base> <local_sha>
  local base="$1" local_sha="$2"
  git -C "$REPO" log --format=%s "$base..$local_sha" 2>/dev/null | grep -Eq '^fix(\([^)]*\))?!?:'
}

# Nota de escopo (auditoria Onda C, corrigida na Onda D item 5) — bloquear por QUALQUER change
# bugfix ativo pendente, independente de relação com o que está sendo empurrado, torna o
# bloqueio inegociável um convite ao --no-verify. O filtro por interseção de fix_files serve
# para ESCOLHER quais changes cobrar quando há vários — nunca para ISENTAR quem não declarou
# fix_files algum. A versão anterior invertia isso: `[ -f "$ev" ] || return 1` (sem evidência,
# pula) e `[ -n "$ff" ] || return 1` (sem fix_files declarados, pula) faziam exatamente o caso
# mais comum de brownfield — bugfix ativo criado, evidência ainda com fix_files:[] (o próprio
# scaffold de spec-new) — escapar do bloqueio inteiro, em vez de ser pego pelo item 1 do check
# estático ("ausência de evidência de Red num change type:bugfix" — a rule é explícita: quem NÃO
# declara nada não pode estar em posição melhor do que quem declara e não intersecta). Agora:
# ausência de evidência OU fix_files vazio/ausente ⇒ SEMPRE checa (não há como estabelecer
# não-relação); só um change com fix_files DECLARADOS e comprovadamente sem interseção é pulado.
_redfirst_touched_files() {  # _redfirst_touched_files <base> <local_sha> -> um path por linha
  git -C "$REPO" diff --name-only "$1" "$2" 2>/dev/null
}

_redfirst_should_check() {  # _redfirst_should_check <chdir> <touched-tmpfile> — 0 = checar, 1 = pular
  local chdir="$1" touched="$2" ev="$chdir/evidence/red/red-evidence.json" ff
  [ -f "$ev" ] || return 0
  ff="$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const arr = Array.isArray(d.fix_files) ? d.fix_files : [];
      for (const f of arr) process.stdout.write(f + '\n');
    } catch {}
  " "$ev" 2>/dev/null)"
  [ -n "$ff" ] || return 0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    grep -Fxq "$f" "$touched" 2>/dev/null && return 0
    grep -qF "$f/" "$touched" 2>/dev/null && return 0
  done <<< "$ff"
  return 1
}

_redfirst_hook_forge_dir() {  # .forge de onde ESTE arquivo foi carregado (sourced ou executado
  # direto — ${BASH_SOURCE[0]} sobrevive à sourcing, ao contrário de $0). Issue #141: quando
  # sourced a partir do tronco (hooksPath absoluto, worktree sem cópia própria da lib), este é o
  # .forge do TRONCO — a árvore-fallback dos alvos abaixo. Este arquivo mora em
  # .forge/hooks/git/lib/ — três níveis acima de dirname($BASH_SOURCE), não dois (diferença dos
  # hooks-raiz como pre-push, que moram direto em .forge/hooks/git/).
  local d
  d="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)"
  # Só é fallback legítimo quando também carrega esta própria lib — caso contrário (symlink
  # solto, HOME, checkout parcial) o tronco fica indisponível, como antes da #141.
  [ -n "$d" ] && [ -f "$d/hooks/git/lib/check-red-first.sh" ] && printf '%s\n' "$d"
}

_redfirst_resolve_delegated() {  # _redfirst_resolve_delegated <label> <rel-sob-.forge/> — mesmo
  # contrato de resolve_delegated (pre-push, pre-commit, commit-msg, post-merge): rc 0 = achado
  # (ecoa o caminho; aviso em stderr quando veio do tronco); rc 1 = ausente nas duas com o
  # diretório-lar presente em ao menos uma; rc 2 = diretório-lar ausente nas duas.
  local label="$1" rel="$2"
  local wt="$REPO/.forge/$rel" trunk="" hook_forge_dir wt_dir trunk_dir=""
  wt_dir="$(dirname "$wt")"
  if [ -f "$wt" ]; then printf '%s\n' "$wt"; return 0; fi
  # Árvore sem $REPO/.forge nenhum nunca adotou o harness — não é uma worktree defasada, é uma
  # árvore NÃO gerenciada. Devolve o mesmo no-op de antes da #141 (rc 2), sem consultar o tronco,
  # sem aviso e sem efeito colateral. A delegação ao tronco abaixo vale só para a árvore que TEM
  # .forge/ mas com este alvo ausente ou defasado. Mesmo contrato de resolve_delegated
  # (pre-push/pre-commit/commit-msg/post-merge); aqui a origem do tronco é obtida por
  # _redfirst_hook_forge_dir() em vez de uma variável global, porque esta lib pode ser sourced a
  # partir de árvores diferentes em chamadas diferentes.
  [ -d "$REPO/.forge" ] || return 2
  hook_forge_dir="$(_redfirst_hook_forge_dir)"
  if [ -n "$hook_forge_dir" ]; then
    trunk="$hook_forge_dir/$rel"
    trunk_dir="$(dirname "$trunk")"
  fi
  if [ -n "$trunk" ] && [ -f "$trunk" ]; then
    echo "hook: $label ausente em $REPO — usando o do tronco ($trunk); rode forge update na worktree" >&2
    printf '%s\n' "$trunk"
    return 0
  fi
  if [ -d "$wt_dir" ] || { [ -n "$trunk_dir" ] && [ -d "$trunk_dir" ]; }; then
    # Mesma correção do resolve_delegated de pre-push/pre-commit/commit-msg/post-merge: nomear
    # as duas árvores procuradas, nunca deixar a recusa do chamador implicar presença que só
    # existe numa delas.
    echo "  (procurado em $wt_dir e em ${trunk_dir:-<tronco indisponível>})" >&2
    return 1
  fi
  return 2
}

check_red_first() {
  local line local_ref local_sha remote_ref remote_sha base failed=0
  local examined=0 skipped=0 engaged=0
  local check_script univ_lib _rc scripts_lib_dir
  local active_dir="$REPO/.forge/specs/active"

  # Delegação em alvo AUSENTE é erro, não no-op (issue #49, instância 4). `[ -f ] || return 0`
  # sozinho degrada em silêncio: apagar o script de red-first — ou atualizar o harness pela
  # metade — deixava o hook verde sem uma linha, com o mesmo desfecho de uma execução
  # bem-sucedida. Se o diretório de scripts do harness EXISTE, o alvo da delegação TEM de
  # existir. Só a ausência do diretório inteiro (repositório sem harness instalado) continua
  # sendo no-op legítimo — aí não há maquinaria a impor.
  #
  # Issue #141: antes de bloquear, tenta o mesmo alvo na árvore do hook (o tronco, quando
  # core.hooksPath é absoluto e esta lib foi sourced de lá) — worktree e tronco podem divergir
  # sem que isso seja corrupção.
  check_script="$(_redfirst_resolve_delegated check-red-first.sh scripts/check-red-first.sh)"; _rc=$?
  if [ "$_rc" -eq 2 ]; then return 0; fi
  if [ "$_rc" -eq 1 ]; then
    echo "pre-push BLOQUEADO: .forge/scripts/ existe mas check-red-first.sh não — o gate de red-first sumiu." >&2
    return 1
  fi
  univ_lib="$(_redfirst_resolve_delegated gate-universe.sh scripts/lib/gate-universe.sh)"; _rc=$?
  if [ "$_rc" -ne 0 ]; then
    echo "pre-push BLOQUEADO: .forge/scripts/lib/gate-universe.sh ausente — sem contador de controle o gate" >&2
    echo "  não consegue distinguir 'examinei e estava limpo' de 'não examinei nada' (issue #49)." >&2
    return 1
  fi
  # shellcheck disable=SC1090
  . "$univ_lib"
  # issue #138 — defect-scope.mjs vive junto do check_script já delegado acima (mesma árvore,
  # worktree ou tronco): nunca uma segunda chamada a _redfirst_resolve_delegated, que poderia
  # resolver para uma árvore diferente da do check_script e desalinhar as duas libs.
  scripts_lib_dir="$(dirname "$check_script")/lib"

  while IFS=' ' read -r local_ref local_sha remote_ref remote_sha; do
    [ -n "${local_ref:-}" ] || continue
    [ "${local_sha:-}" != "$ZERO_SHA" ] || continue

    base="$(_redfirst_resolve_base "$local_sha" "${remote_sha:-$ZERO_SHA}")"
    [ -n "$base" ] || continue
    _redfirst_has_fix_commit "$base" "$local_sha" || continue
    # A partir daqui o gate ESTÁ engajado: um commit fix(...) está sendo publicado, então a
    # pergunta "quantos changes de bugfix eu examinei?" passa a ter resposta obrigatória.
    engaged=1
    [ -d "$active_dir" ] || continue

    local touched_file
    touched_file="$(mktemp "${TMPDIR:-/tmp}/forge-redfirst-touched-XXXXXX")"
    _redfirst_touched_files "$base" "$local_sha" > "$touched_file"

    for chdir in "$active_dir"/*/; do
      [ -d "$chdir" ] || continue
      local chid manifest out rc
      chid="$(basename "$chdir")"
      manifest="$chdir/manifest.yaml"
      [ -f "$manifest" ] || continue
      # issue #138 — predicado único (type:bugfix OU fixes_defects declarado), nunca mais awk
      # direto sobre `type`: fixes_defects pode ser flow-style (`[D1, D2]`), que só
      # yaml-lite.mjs parseia corretamente.
      node --input-type=module -e "
        import { parseYamlSubset } from '$scripts_lib_dir/yaml-lite.mjs';
        import { isDefectFixing } from '$scripts_lib_dir/defect-scope.mjs';
        import { readFileSync } from 'node:fs';
        const man = parseYamlSubset(readFileSync(process.argv[1], 'utf8'));
        process.exit(isDefectFixing(man) ? 0 : 1);
      " "$manifest" 2>/dev/null || continue
      # Contam como EXAMINADOS os dois desfechos: o change que roda o check estático e o change
      # que o gate abriu, leu os fix_files declarados e concluiu, por critério explícito, que não
      # tem relação com o que está sendo empurrado. Esse segundo caso é cobertura — o gate olhou
      # e decidiu —, não ausência de cobertura. O que a vacuidade acusa é o caso em que NÃO HAVIA
      # nada para olhar (issue #49).
      examined=$((examined + 1))
      if ! _redfirst_should_check "$chdir" "$touched_file"; then
        skipped=$((skipped + 1))
        continue
      fi

      out="$(FORGE_ROOT="$REPO" bash "$check_script" check "$chid" 2>&1)"; rc=$?
      if [ "$rc" -ne 0 ]; then
        {
          echo "pre-push BLOQUEADO: red-first pendente em '$chid' (commit fix(...) detectado em '$local_ref')."
          echo "$out" | sed 's/^/  /'
          echo "  grave a observação com /forge:red record + /forge:red replay, ou dispense com /forge:red waive --reason <motivo>."
        } >&2
        failed=1
      fi
    done
    rm -f "$touched_file"
  done

  # Contador de controle (issue #49, instância 1). Sem esta linha, o push de um bugfix num
  # repositório SEM change ativo type:bugfix terminava no mesmo `return 0` silencioso de um push
  # em que todos os changes foram examinados e estavam conformes — o gate existe para exigir
  # vermelho antes do verde em bugfix e passava justamente num bugfix. Só roda quando o gate
  # engajou: push sem commit fix(...) não tem universo a contar e continua mudo.
  if [ "$engaged" -eq 1 ]; then
    local scope="changes ativos em .forge/specs/active, push com commit fix(...)"
    [ "$skipped" -gt 0 ] && scope="$scope; $skipped sem interseção com os fix_files declarados"
    if ! forge_universe_check "red-first" "$examined" "change(s) sujeito(s) ao red-first" "$scope" "$REPO"; then
      {
        echo "pre-push BLOQUEADO: red-first — há commit fix(...) sendo publicado e NENHUM change"
        echo "  ativo sujeito ao red-first (type:bugfix ou fixes_defects declarado) foi examinado."
        echo "  Abra o change (/forge:spec new --type bugfix) e registre o Red com /forge:red"
        echo "  record + replay, ou dispense com /forge:red waive."
      } >&2
      failed=1
    fi
  fi

  [ "$failed" -eq 0 ]
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_red_first
  exit $?
fi
