#!/usr/bin/env bash
# forge red-evidence (Onda C, rule testing/regression-red-first.md): CLI de
# /forge:red — record|replay|status|waive sobre evidence/red/red-evidence.json de um change
# sujeito ao red-first — type:bugfix ou, desde a issue #138, type:feature (ou qualquer outro)
# que declare `fixes_defects` não vazio no manifest (predicado isDefectFixing, lib/defect-scope.mjs).
#
#   record — declara test_path/test_id/command/fix_files/... (lib/red-evidence-ops.mjs). NUNCA
#            marca observed sozinho.
#   replay — roda o motor real (lib/red-replay.mjs): worktrees git efêmeros, UM teste, timeout
#            explícito. SEMPRE executa (uso explícito — ver `ensure` para o caminho cache-checked
#            usado por /forge:verify e /forge:archive). É o único caminho para status:'observed' —
#            converte "presumido" em "observado". CARO (roda teste de verdade) — nunca chamado do
#            pre-push (ver hooks/git/lib/check-red-first.sh, que só faz o check ESTÁTICO da Onda B).
#   ensure  — Onda E: mesmo motor de `replay`, SEM cache (o cache local foi removido — decisão
#            do orquestrador: era versionável em projetos que instalaram o harness antes do patch
#            do .gitignore, e fonte de livelock). Executa SEMPRE, incondicionalmente — o único
#            atalho é status:'waived' (política própria). Chamado por spec-verify.sh, pelo
#            pré-flight de archive-spec.sh e por validate-spec.mjs (na transição para verified)
#            para todo change type:bugfix — nunca atalhado pelo campo `status` do artefato. rc
#            sempre 0 (a decisão de bloquear é do check estático, que roda em seguida e lê o que
#            `ensure` acabou de gravar).
#   status — one-liner não-bloqueante.
#   waive  — política de waiver da Onda B (check-red-first.sh waive): non-behavioral recusado
#            se o diff tocar código no grafo; no-test-infra/external-unreproducible/
#            hotfix-under-incident abrem deferral (+ ledger quando aplicável) atomicamente.
#            Delegado, não reimplementado — uma fonte só de política de waiver.
#   task   — issue #156: vermelho/verde de uma TASK delegada (task-coder §3.5, /forge:implement),
#            sem change-id nem artefato. Mesmo motor de `replay` (worktree efêmero, um comando,
#            timeout explícito, classificador). Os arquivos de teste do --green são enxertados na
#            árvore do --red: o teste do verde tem de FALHAR sobre o vermelho por asserção (rc ≠ 0,
#            classificação 'behavioral', saída casando --failure-pattern) e PASSAR no verde.
#            Vermelho e verde idênticos fora dos arquivos de teste reprovam antes de o teste rodar
#            (`vermelho-vazio`: o verde não implementa nada). O vermelho não pode tocar infraestrutura (manifesto, lockfile, config de teste,
#            scripts/, dotfiles, arquivo citado pelo comando) e tem de ser o pai direto do verde;
#            --task-base exige que o pai do vermelho seja o início da TASK e --task-id confere o
#            assunto dos dois commits. Sem --green é só pré-checagem (sem enxerto, não prova o
#            TDD). rc 0 aceita, rc 1 reprova com `FAIL task [<código>] <motivo>`.
#   init   — item 3e (auditoria, brownfield sem saída): escaffolda evidence/red/red-evidence.json
#            (status:pending) num change type:bugfix EXISTENTE que nunca teve o scaffold (harness
#            atualizado por cima de um change já em andamento, ou o arquivo apagado à mão). As
#            mensagens de erro de `record`/`waive` apontavam `/forge:spec new --type bugfix` como
#            saída — que cria um change NOVO, não adiciona evidência ao change já existente. `init`
#            é a saída correta para esse caso; idempotente (no-op se o arquivo já existir).
#
# Usage: red-evidence.sh record <change-id> --test-path <p> --test-id <id> --command <c>
#                                --failure-pattern <p> [--fix-files a,b,c] [--setup-command <c>]
#                                [--reproduces <txt>] [--excerpt <txt>]
#        red-evidence.sh replay <change-id> [--timeout <segundos>]
#        red-evidence.sh ensure <change-id> [--timeout <segundos>]
#        red-evidence.sh status <change-id>
#        red-evidence.sh waive  <change-id> --reason <r> [--note <n>]
#        red-evidence.sh init   <change-id>
#        red-evidence.sh task --red <sha> [--green <sha>] [--task-base <sha>] [--task-id <TASK-NN>]
#                             --command <c> --failure-pattern <p> [--setup-command <c>] [--timeout <segundos>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
export FORGE_ROOT="$ROOT"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }

# _manifest_is_defect_fixing <manifest.yaml> -> "1"/"0" via lib/defect-scope.mjs (issue #138) —
# predicado único (type:bugfix OU fixes_defects não vazio), mesmo padrão de invocação node de
# spec-transition.sh para quick_plan. Nunca reimplementa o predicado em awk: `fixes_defects` pode
# ser flow-style (`[D1, D2]`) ou block-style, e só yaml-lite.mjs parseia os dois de forma correta.
_manifest_is_defect_fixing() {
  node --input-type=module -e "
    import { parseYamlSubset } from '$SCRIPT_DIR/lib/yaml-lite.mjs';
    import { isDefectFixing } from '$SCRIPT_DIR/lib/defect-scope.mjs';
    import { readFileSync } from 'node:fs';
    const man = parseYamlSubset(readFileSync(process.argv[1], 'utf8'));
    process.stdout.write(isDefectFixing(man) ? '1' : '0');
  " "$1" 2>/dev/null || echo 0
}

CMD="${1:-}"; shift || true
case "$CMD" in
  -h|--help|help) echo "Usage: red-evidence.sh record|replay|status|waive|init <change-id> [...] | ci | task --red <sha> [--green <sha>] [--task-base <sha>] [--task-id <TASK-NN>] --command <c> --failure-pattern <p> [--setup-command <c>] [--timeout <s>]"; exit 0 ;;
esac

# `task` também não tem change-id: o escopo são os dois commits que o chamador aponta (issue #156),
# resolvidos no repositório do diretório corrente (o worktree da onda), não em FORGE_ROOT.
if [ "$CMD" = "task" ]; then
  TASK_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "FAIL task [entrada] o diretório corrente não é um repositório git"; exit 1; }
  exec node "$SCRIPT_DIR/lib/red-evidence-ops.mjs" task "$TASK_ROOT" "$@"
fi

# `ci` não tem change-id (como `task`, acima), e a exceção é deliberada (LDG-0004): quem escolhe o
# escopo tem de ser o estado do repositório, não quem invoca. Um `ci --change X` devolveria ao
# autor a capacidade de apontar a verificação para o change que lhe convém — que é exatamente o
# grau de controle que mover a execução para o CI existe para tirar.
if [ "$CMD" = "ci" ]; then
  [ $# -eq 0 ] || { echo "FAIL (red-evidence.sh ci não aceita argumentos — o escopo é todo change ativo sujeito ao red-first, por construção)"; exit 1; }
  ACTIVE_DIR="$ROOT/.forge/specs/active"
  # shellcheck disable=SC1090
  . "$SCRIPT_DIR/lib/gate-universe.sh"
  fail=0
  checked=0
  active=0
  for man in "$ACTIVE_DIR"/*/manifest.yaml; do
    [ -f "$man" ] || continue
    active=$((active + 1))
    id="$(basename "$(dirname "$man")")"
    [ "$(_manifest_is_defect_fixing "$man")" = "1" ] || continue
    checked=$((checked + 1))
    # `ensure` executa e nunca falha o script; `check-red-first` é quem decide — a mesma divisão
    # que spec-verify.sh já usa, para não abrir uma terceira opinião sobre o mesmo artefato.
    node "$SCRIPT_DIR/lib/red-evidence-ops.mjs" ensure "$ACTIVE_DIR/$id" >"/tmp/forge-red-ci-$id.log" 2>&1 || true
    if out="$(bash "$SCRIPT_DIR/check-red-first.sh" check "$id" 2>&1)"; then
      strategy="$(node -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write((d.status||'?')+(d.base_strategy?' via '+d.base_strategy:''))}catch{process.stdout.write('?')}" "$ACTIVE_DIR/$id/evidence/red/red-evidence.json" 2>/dev/null || echo '?')"
      echo "  OK   $id — $strategy"
    else
      fail=1
      echo "  FAIL $id — $out"
    fi
  done
  # Contador de controle (issue #49), com a distinção que este modo exige: os dois vazios têm
  # causas opostas. `specs/active` PRESENTE e vazio é o repouso de qualquer repositório entre
  # ciclos de change — e o CI roda em todo PR, então reprovar ali produziria vermelho em PR de
  # manutenção, cuja única resposta operacional seria declarar `red-first-ci` na allowlist para
  # sempre; o gate ficaria esvaziado justamente para o caso anômalo, que é o oposto do que a issue
  # quer. `specs/active` AUSENTE é o caso anômalo: o alvo que este gate varre não está onde ele
  # procura — é o "confira o alvo, o glob e o range" da mensagem de reprovação, e aí o contador
  # reprova. Em ambos os casos o número examinado é DITO, que é o que a issue exige de fato.
  if [ ! -d "$ACTIVE_DIR" ]; then
    if ! forge_universe_check "red-first-ci" 0 "change(s) ativo(s)" "$ACTIVE_DIR (ausente)" "$ROOT"; then
      exit 1
    fi
    echo "OK ci — 0 change(s) ativo(s) examinado(s), alvo ausente com justificativa declarada"
    exit 0
  fi
  if [ "$active" -eq 0 ]; then
    echo "OK ci — 0 change(s) ativo(s) examinado(s) (specs/active presente e vazio: repouso entre ciclos)"
    exit 0
  fi
  forge_universe_check "red-first-ci" "$active" "change(s) ativo(s)" "$ACTIVE_DIR" "$ROOT" || exit 1
  if [ "$checked" -eq 0 ]; then echo "OK ci — $active change(s) ativo(s) examinado(s), 0 sujeito(s) ao red-first"; exit 0; fi
  [ "$fail" -eq 0 ] || { echo "FAIL ci — $active change(s) ativo(s) examinado(s), $checked sujeito(s) ao red-first verificado(s), ao menos um sem Red observado (logs em /tmp/forge-red-ci-*.log)"; exit 1; }
  echo "OK ci — $active change(s) ativo(s) examinado(s), $checked sujeito(s) ao red-first com Red observado ou dispensado"
  exit 0
fi

CHID="${1:-}"
[ -n "$CMD" ] && [ -n "$CHID" ] || { echo "FAIL (usage: red-evidence.sh record|replay|status|waive|init <change-id> [...] | ci)"; exit 1; }
shift || true

DIR="$ROOT/.forge/specs/active/$CHID"

case "$CMD" in
  record) node "$SCRIPT_DIR/lib/red-evidence-ops.mjs" record "$DIR" "$@" ;;
  replay) node "$SCRIPT_DIR/lib/red-evidence-ops.mjs" replay "$DIR" "$@" ;;
  ensure) node "$SCRIPT_DIR/lib/red-evidence-ops.mjs" ensure "$DIR" "$@" ;;
  status) bash "$SCRIPT_DIR/check-red-first.sh" status "$CHID" ;;
  waive)  bash "$SCRIPT_DIR/check-red-first.sh" waive "$CHID" "$@" ;;
  init)
    [ -d "$DIR" ] || { echo "FAIL (no active change: $CHID)"; exit 1; }
    MAN="$DIR/manifest.yaml"
    [ -f "$MAN" ] || { echo "FAIL (manifest.yaml ausente em $DIR)"; exit 1; }
    MTYPE="$(awk -F': ' '$1=="type"{print $2; exit}' "$MAN")"
    [ "$(_manifest_is_defect_fixing "$MAN")" = "1" ] || { echo "FAIL (init só se aplica a change sujeito ao red-first — type:bugfix ou fixes_defects declarado, got type: $MTYPE)"; exit 1; }
    EV="$DIR/evidence/red/red-evidence.json"
    if [ -f "$EV" ]; then echo "OK init (evidence/red/red-evidence.json já existe em $CHID — nada a fazer)"; exit 0; fi
    mkdir -p "$DIR/evidence/red"
    TPL="$SCRIPT_DIR/../templates/bugfix/red-evidence.json"
    if [ -f "$TPL" ]; then
      CH_ID="$CHID" perl -pe 's/<CHANGE_ID>/$ENV{CH_ID}/g' "$TPL" > "$EV"
    else
      cat > "$EV" <<JSON
{
  "schema": "red-evidence/v1", "change_id": "$CHID", "status": "pending",
  "test_path": null, "test_id": null, "command": null, "base_commit": null,
  "failure_pattern": null, "excerpt": null, "excerpt_sha256": null, "classification": null,
  "base_result": null, "base_strategy": null, "revert_patch": null, "replay_head": null,
  "setup_command": null, "reproduces": "bugfix.md §1", "fix_files": [], "waiver": null,
  "recorded_at": null, "replayed_at": null, "waived_at": null
}
JSON
    fi
    echo "OK init — evidence/red/red-evidence.json escaffoldado em $CHID (status: pending) — rode /forge:red record + replay, ou dispense com /forge:red waive"
    ;;
  *) echo "FAIL (unknown subcommand: $CMD — use record|replay|ensure|status|waive|init|ci|task)"; exit 1 ;;
esac
