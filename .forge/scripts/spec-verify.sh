#!/usr/bin/env bash
# forge verify (deterministic half, W2.2) — verifies an active change:
#   1. status must be implementing|implemented (chain states with code done)
#   2. tasks.md must have zero open entries ([ ] / [-] / [!])
#   3. runs the checks declared in .forge/FORGE.md frontmatter (runtime: test/
#      typecheck/lint) with a 300s timeout each; raw output goes to /tmp, only
#      the tail is meant to be read (§17.6)
#   4. writes verification.yaml (§10.10) with commit + per-check status
# With --story STORY-NN, verify only that story and its completed dependencies;
# write stories/STORY-NN.verification.yaml without changing global verification.yaml.
# It does NOT transition status — /forge:verify runs the HITL gate and then
# spec-transition.sh <id> verified.
# Output: "OK <id> (...)" or "FAIL (...)". Exit 1 on any failed check/open task.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
# LDG-0014: fonte ÚNICA de leitura do bloco runtime: e de execução de check com teto de tempo —
# antes deste fix, spec-verify.sh mantinha cópia própria (get_runtime/run_check) enquanto
# run-gates.sh já usava lib/forge-runtime.sh, e as duas cópias divergiam na norma mais importante
# (gate declarado com script ausente: aqui virava WARN+skip; lá já reprovava). Ver lib/
# forge-runtime.sh para forge_get_runtime/forge_run_gate/forge_runtime_gates.
. "$SCRIPT_DIR/lib/forge-runtime.sh"

ID="${1:-}"
[ -n "$ID" ] || { echo "FAIL (usage: spec-verify.sh <change-id> [--story STORY-NN])"; exit 2; }
shift
STORY=""
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = "--story" ] && [[ "$2" =~ ^STORY-[0-9]+$ ]] || { echo "FAIL (invalid story arguments)"; exit 2; }
  STORY="$2"
fi
DIR="$ROOT/.forge/specs/active/$ID"
MAN="$DIR/manifest.yaml"
[ -f "$MAN" ] || { echo "FAIL (no active change: $ID)"; exit 1; }
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
bash "$SCRIPT_DIR/budget-preflight.sh" --stage verify --change "$ID" --outputs "verification.yaml,evidence/runs/*/run-manifest.json" || true

STATUS="$(awk -F': ' '$1=="status"{print $2; exit}' "$MAN")"
case "$STATUS" in implementing|implemented) ;; *) echo "FAIL (status '$STATUS' — verify runs on implementing|implemented)"; exit 1 ;; esac
TYPE="$(awk -F': ' '$1=="type"{print $2; exit}' "$MAN")"
# issue #138 — predicado único (type:bugfix OU fixes_defects declarado), nunca mais awk direto
# sobre `type`: fixes_defects pode ser flow-style (`[D1, D2]`), que só yaml-lite.mjs parseia
# corretamente. Mesmo padrão de invocação node de spec-transition.sh para quick_plan.
IS_DEFECT_FIXING="$(node --input-type=module -e "
  import { parseYamlSubset } from '$SCRIPT_DIR/lib/yaml-lite.mjs';
  import { isDefectFixing } from '$SCRIPT_DIR/lib/defect-scope.mjs';
  import { readFileSync } from 'node:fs';
  const man = parseYamlSubset(readFileSync(process.argv[1], 'utf8'));
  process.stdout.write(isDefectFixing(man) ? '1' : '0');
" "$MAN" 2>/dev/null || echo 0)"

fail=0
notes=""

# ── tasks complete? ───────────────────────────────────────────────────────────
if [ -n "$STORY" ]; then
  # Never leave a previously passing story receipt after a failed recheck.
  command -v python3 >/dev/null 2>&1 || { echo "FAIL (story checkpoint requires python3 for safe atomic evidence)"; exit 1; }
  STORY_HELPER="$SCRIPT_DIR/lib/story-checkpoint.py"
  python3 "$STORY_HELPER" clear "$ROOT" "$DIR" "$STORY" || exit 1
  STORY_SNAPSHOT="$(python3 "$STORY_HELPER" snapshot "$ROOT" "$DIR" "$STORY")" || exit 1
  if ! story_out="$(node --input-type=module - "$SCRIPT_DIR/lib" "$DIR" "$STORY" 2>&1 <<'NODE'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [lib, dir, id] = process.argv.slice(2);
try {
  const {parseTasks, checkTasksGraph} = await import(pathToFileURL(join(lib, 'tasks-graph.mjs')).href);
  const {parseStories, checkStoryCoverage, checkStoryCycle} = await import(pathToFileURL(join(lib, 'story-shard.mjs')).href);
  const taskText = readFileSync(join(dir, 'tasks.md'), 'utf8');
  const invalidTasks = (text) => text.split('\n').filter(line => /^\s*[-*]\s*\[[^\]]*\]\s*TASK-\d+\b/i.test(line) && !/^\s*[-*]\s*\[[ xX!\-]\]\s*TASK-\d+\b/i.test(line));
  const parsed = parseTasks(taskText);
  const {stories, errors} = parseStories(join(dir, 'stories'));
  const ids = stories.map(s => s.id);
  const problems = [...errors, ...checkStoryCoverage(parsed.tasks.map(t => t.id), stories), ...checkStoryCycle(stories), ...checkTasksGraph(parsed).filter(f => f.enforceable).map(f => f.msg)];
  if (!parsed.tasks.length || new Set(ids).size !== ids.length) problems.push('tasks vazias ou stories duplicadas');
  if (invalidTasks(taskText).length) problems.push('checkbox inválido em tasks.md');
  for (const item of stories) {
    if (item.file !== `${item.id}.md`) problems.push(`arquivo de story não corresponde ao ID: ${item.file}`);
    const text = readFileSync(join(dir, 'stories', item.file), 'utf8');
    const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
    if (!front) { problems.push(`frontmatter inválido: ${item.id}`); continue; }
    for (const key of ['story_id', 'status', 'depends_on']) {
      const lines = front.split('\n').filter(line => new RegExp(`^${key}\\s*:`).test(line));
      if (lines.length !== 1) problems.push(`campo ${key} ausente ou duplicado: ${item.id}`);
    }
    const dep = /^depends_on:\s*\[([^\]]*)\]\s*$/m.exec(front);
    if (!dep || (dep[1].trim() !== '' && dep[1].split(',').map(v => v.trim()).some(v => !/^STORY-[0-9]+$/.test(v)))) problems.push(`depends_on ausente ou inválido: ${item.id}`);
    if (!['todo', 'in_progress', 'done', 'blocked'].includes(item.status)) problems.push(`status inválido: ${item.id}`);
    if (invalidTasks(text).length) problems.push(`checkbox inválido: ${item.id}`);
    for (const taskId of item.taskIds) for (const depId of parsed.tasks.find(t => t.id === taskId)?.dependsOn || []) {
      const owner = stories.find(s => s.taskIds.includes(depId));
      if (!owner || (owner.id !== item.id && !item.dependsOn.includes(owner.id))) problems.push(`dependência ${depId} omitida em ${item.id}`);
    }
  }
  const story = stories.find(s => s.id === id);
  if (!story || !story.taskIds.length || story.status !== 'in_progress') problems.push('story ausente, vazia ou não está in_progress');
  if (story) {
    const visited = new Set();
    const visit = dep => {
      if (visited.has(dep)) return;
      visited.add(dep);
      const dependency = stories.find(s => s.id === dep);
      if (!dependency || dependency.status !== 'done' || dependency.taskIds.some(t => parsed.tasks.find(x => x.id === t)?.status !== 'X')) problems.push(`dependência ${dep} não concluída`);
      if (dependency) for (const next of dependency.dependsOn) visit(next);
    };
    for (const dep of story.dependsOn) visit(dep);
    for (const taskId of story.taskIds) if (parsed.tasks.find(t => t.id === taskId)?.status !== 'X') problems.push(`${taskId} não concluída em tasks.md`);
  }
  if (problems.length) { console.error(problems.join('; ')); process.exit(1); }
} catch (e) { console.error(e.message); process.exit(1); }
NODE
)"; then
    echo "FAIL (story inválida: $story_out)"; exit 1
  fi
elif [ -f "$DIR/tasks.md" ]; then
  open="$(grep -cE '^\s*- \[( |-|!)\] ' "$DIR/tasks.md" || true)"
  if [ "$open" -gt 0 ]; then
    notes="$open open task(s) in tasks.md"
    fail=1
  fi
else
  notes="tasks.md missing"
  fail=1
fi

# ── checks from FORGE.md runtime: block ──────────────────────────────────────
CHECKS_YAML=""
CHECK_NAMES=()
CHECK_COMMANDS=()
CHECK_STATUSES=()
run_check() { # run_check <name> <command>
  local name="$1" cmd="$2" log="/tmp/forge-verify-$ID-$1.log" status
  if forge_run_gate "$name" "$cmd" "$log" "$ROOT"; then
    status="passed"
  else
    status="failed"; fail=1
  fi
  echo "  $name: $status (log: $log)"
  CHECK_NAMES+=("$name"); CHECK_COMMANDS+=("$cmd"); CHECK_STATUSES+=("$status")
  CHECKS_YAML="$CHECKS_YAML    - name: $name\n      command: \"$cmd\"\n      status: $status\n"
}

STORY_COMPONENT=""
COMPONENT_RESULT=""
if [ -n "$STORY" ]; then
  STORY_COMPONENT="$(python3 "$STORY_HELPER" component "$ROOT" "$DIR" "$STORY")" || exit 1
fi
for check in test typecheck lint; do
  # A component story runs its pinned test in an isolated checkout; global verify remains unchanged.
  [ "$check" = test ] && [ -n "$STORY_COMPONENT" ] && continue
  cmd="$(forge_get_runtime "$check" "$ROOT" || true)"
  [ -n "$cmd" ] && run_check "$check" "$cmd"
done
if [ -n "$STORY_COMPONENT" ]; then
  if COMPONENT_RESULT="$(printf '%s' "$STORY_COMPONENT" | python3 "$SCRIPT_DIR/lib/component-story-runner.py")"; then
    CHECK_NAMES+=("component-test"); CHECK_COMMANDS+=("xunit-v3 fixed component revision"); CHECK_STATUSES+=("passed")
    echo "  component-test: passed"
  else
    fail=1
    CHECK_NAMES+=("component-test"); CHECK_COMMANDS+=("xunit-v3 fixed component revision"); CHECK_STATUSES+=("failed")
    echo "  component-test: failed"
  fi
fi

# ── gates declared in FORGE.md runtime: gates (REQ-15/TASK-17, design.md §2.6) ──
# forge_runtime_gates_phase (lib/forge-runtime.sh) é a MESMA extração usada por run-gates.sh,
# filtrada para a fase "source" — CSV escalar numa única linha (ex.: "gates: check-authz,
# check-observability") OU block-sequence YAML, ambas com fase "source" implícita quando não
# declaram outra (issue #82). /forge:verify roda ANTES do artefato implantável existir — a
# mesma razão pela qual os hooks e o fechamento de wave só executam gates de source hoje — então
# um gate declarado com `phase: pre-deploy`/`post-deploy` é ignorado aqui de propósito (não é
# lacuna: rodar um gate de artefato publicado contra a árvore de fontes, sem artefato nenhum,
# só produziria FAIL sistemático de algo que não é o defeito do change). Ausência de "gates:" ⇒
# nada roda (compat retroativa, no-op por padrão). Script declarado e AUSENTE em disco REPROVA
# (LDG-0014) — era WARN+skip só aqui, silêncio verde para um pré-requisito faltando, enquanto
# run-gates.sh já reprovava o mesmo cenário; as duas cópias divergiam justamente na norma que
# mais importa. "MISSING" é a mesma palavra e a mesma forma de mensagem que run-gates.sh usa, de
# propósito — um só vocabulário para os dois caminhos.
#
# Contrato de invocação (issue #192), o MESMO do pre-push e de run-gates.sh:
#   FORGE_CHANGE_ID=<id> bash <gate>.sh --path <raiz>
# Zero posicionais. Antes daqui o gate recebia o change-id como `$1`, enquanto o pre-push sempre o
# chamou com `--path <raiz>`: gate de consumidor que valida a própria linha de comando recusava o
# posicional e o verify reprovava por defeito de CHAMADA, sem achado — o mesmo gate passava no
# push. Quem precisa do change em foco lê FORGE_CHANGE_ID (ausente no pre-push, onde não há um).
while IFS= read -r gate; do
  [ -n "$gate" ] || continue
  gate_script="$SCRIPT_DIR/${gate}.sh"
  if [ -f "$gate_script" ]; then
    run_check "$gate" "FORGE_CHANGE_ID='$ID' bash '$gate_script' --path '$ROOT'"
  else
    echo "  $gate: MISSING ($gate_script não existe)"
    notes="${notes:+$notes; }gate '$gate' declarado em runtime.gates mas $gate_script não existe"
    fail=1
  fi
done < <(forge_runtime_gates_phase source "$ROOT")
[ -n "$CHECKS_YAML" ] || [ -n "$STORY_COMPONENT" ] || echo "  (no checks declared in FORGE.md runtime: — skipping check phase)"

# Story checkpoint never writes or changes global verification evidence.
if [ -n "$STORY" ]; then
  STORY_RESULT=failed
  [ "$fail" -eq 0 ] && STORY_RESULT=passed
  if ! {
    for ((i=0; i<${#CHECK_NAMES[@]}; i++)); do printf '%s\0%s\0%s\0' "${CHECK_NAMES[$i]}" "${CHECK_COMMANDS[$i]}" "${CHECK_STATUSES[$i]}"; done
  } | python3 "$STORY_HELPER" write "$ROOT" "$DIR" "$STORY" "$STORY_SNAPSHOT" "$STORY_RESULT" "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unversioned)" "$COMPONENT_RESULT"; then
    echo "FAIL (could not write story verification safely)"; exit 1
  fi
  if [ "$fail" -ne 0 ]; then echo "FAIL (${notes:-check(s) failed})"; exit 1; fi
  echo "OK $ID $STORY (story verification written)"
  exit 0
fi

# ── spec-delta.yaml (§10.4): esqueleto nasce AQUI, não no improviso do archive ──
# Determinista e best-effort: gera/atualiza o scaffold a partir dos REQ-NN + manifest
# (nunca sobrescreve um delta já autorado). A autoria semântica é do /forge:verify
# (verify.md §2.5) — marcadores <scaffold: ...> bloqueiam o pré-flight do archive.
if command -v node >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/lib/spec-delta-scaffold.mjs" ]; then
  scaffold_out="$(node "$SCRIPT_DIR/lib/spec-delta-scaffold.mjs" "$DIR" "$ROOT" 2>&1 || true)"
  echo "  spec-delta: $scaffold_out"
  # cópia bash de SCAFFOLD_MARKERS_RE (canônico: lib/scaffold-markers.mjs) — manter em sincronia
  if [ -f "$DIR/spec-delta.yaml" ] && grep -qE '<scaffold:|<capability-kebab>|REQ-XXX-' "$DIR/spec-delta.yaml"; then
    echo "  WARN: spec-delta.yaml ainda tem placeholders de scaffold — preencha os payloads na fase verify (verify.md §2.5) antes do archive"
  fi
fi

# ── red-first (rule testing/regression-red-first.md) — replay real, não presumido ──────────
# Só para change sujeito ao red-first (type:bugfix ou fixes_defects declarado — isDefectFixing,
# issue #138). A prova mora na EXECUÇÃO, não no artefato: `red-evidence.sh ensure` roda
# SEMPRE, sem atalho por campo algum do JSON. Duas heurísticas anteriores foram removidas por
# serem circulares — ler replayed_at/replay_head do próprio artefato, e consultar um cache local
# cuja chave o autor também computa (ver ADR-0003, adendas 1 e 2). Evidência waived não dispara
# execução: é política própria, não observação de Red pendente.
# Teto de tempo próprio (perl alarm, defesa em profundidade — Furo 3): o motor JS já limita cada
# execução de teste a --timeout segundos, mas isso não impede /forge:verify de pendurar se o
# próprio processo node travar por outro motivo (lock de worktree, etc.).
RED_FIRST_YAML=""
if [ "$IS_DEFECT_FIXING" = "1" ]; then
  RED_JSON="$DIR/evidence/red/red-evidence.json"
  if [ -f "$RED_JSON" ] && [ -f "$SCRIPT_DIR/red-evidence.sh" ]; then
    _redfirst_status() { node -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(d.status||'')}catch{process.stdout.write('')}" "$RED_JSON"; }
    if perl -e 'alarm 600; exec @ARGV' -- bash -c "FORGE_ROOT='$ROOT' bash '$SCRIPT_DIR/red-evidence.sh' ensure '$ID'" >"/tmp/forge-verify-$ID-red-replay.log" 2>&1; then :; fi
    echo "  red-first ensure: log em /tmp/forge-verify-$ID-red-replay.log"
    red_status="$(_redfirst_status)"
    if [ "$red_status" != "observed" ] && [ "$red_status" != "waived" ]; then
      fail=1
      notes="${notes:+$notes; }red-first: evidência não resolvida (status: ${red_status:-desconhecido}) — rode /forge:red replay ou /forge:red waive"
    fi
    # item 4 (Onda D) — o rc do check ESTÁTICO (que corrobora 'observed' contra o cache local e
    # reaplica a política do waiver) precisa PROPAGAR: um achado bloqueante do red-first reprova
    # o verify (rule: "não rebaixáveis por modo de operação, nem em yolo"). O `|| true` antigo
    # descartava o rc e deixava o CONFLICT gravado só como texto informativo em verification.yaml
    # — o verify saía OK mesmo com a forja sentada no red_first.findings.
    red_check_rc=0
    red_check_out="$(FORGE_ROOT="$ROOT" bash "$SCRIPT_DIR/check-red-first.sh" check "$ID" 2>&1)" || red_check_rc=$?
    if [ "$red_check_rc" -ne 0 ]; then
      fail=1
      notes="${notes:+$notes; }red-first: check-red-first reprovou — $red_check_out"
    fi
    RED_FIRST_YAML="$(node -e "
      const status = process.argv[1] || 'pending';
      const raw = process.argv[2] || '';
      const findings = raw.split('\n').map((s) => s.trim()).filter(Boolean);
      const lines = ['  red_first:', '    status: ' + status, '    evidence_path: \"evidence/red/red-evidence.json\"', '    findings:'];
      for (const f of findings) lines.push('      - ' + JSON.stringify(f));
      process.stdout.write(lines.join('\n') + '\n');
    " "${red_status:-pending}" "$red_check_out")"
  fi
fi

# ── verification.yaml (§10.10) ───────────────────────────────────────────────
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "unversioned")"
AT="$(date +%Y-%m-%dT%H:%M:%S%z | sed 's/\([0-9][0-9]\)$/:\1/')"
{
  printf 'verification:\n'
  printf '  commit: "%s"\n' "$COMMIT"
  printf '  verified_at: "%s"\n' "$AT"
  printf '  checks:\n'
  if [ -n "$CHECKS_YAML" ]; then
    printf '%b' "$CHECKS_YAML"
  else
    printf '%s\n' '    - name: none' '      command: "(no checks declared in FORGE.md runtime)"' '      status: skipped'
  fi
  printf '  evidence:\n'
  printf '    - verification.md\n'
  [ -z "$RED_FIRST_YAML" ] || printf '%s' "$RED_FIRST_YAML"
} > "$DIR/verification.yaml"

RM_STATUS="passed"
[ "$fail" -eq 0 ] || RM_STATUS="failed"
# Evidence write is advisory, never blocking: REQ-05 blocks on an INCOMPLETE CONTRACT, not on I/O
# failure writing the manifest itself (disk-full/permission writing run-manifest.json must not
# abort a verify whose verification.yaml was already written successfully above).
bash "$SCRIPT_DIR/run-manifest.sh" write \
  --stage verify \
  --change "$ID" \
  --status "$RM_STATUS" \
  --started-at "$STARTED_AT" \
  --inputs "manifest.yaml,tasks.md,traceability.yaml" \
  --outputs "verification.yaml" \
  --command "spec-verify::spec-verify.sh $ID::$RM_STATUS" \
  --runner local \
  --profile standard \
  --budget-class medium \
  --expected-runs 1 \
  --estimated-timeout-s 300 \
  --uses-llm false \
  --uses-subagent false >/dev/null || true
if ! contract_out="$(bash "$SCRIPT_DIR/validate-stage-contract.sh" check --stage verify --change "$ID" 2>&1)"; then
  echo "FAIL (stage contract invalid: $contract_out)"
  exit 1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK $ID (verification.yaml written)"
else
  echo "FAIL (${notes:-check(s) failed — see /tmp/forge-verify-$ID-*.log})"
  exit 1
fi
