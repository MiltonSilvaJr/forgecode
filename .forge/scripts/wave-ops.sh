#!/usr/bin/env bash
# wave-ops.sh — operações deterministas em waves.json e progress.json (§10.11, §17.2).
# Nunca relê o change inteiro; opera apenas nos arquivos JSON + schema.
# Uso:
#   wave-ops.sh plan   <change-id>   # inicializa waves.json a partir de stories/
#   wave-ops.sh open   <change-id> <wave-id>
#   wave-ops.sh close  <change-id> <wave-id> [--gate OK|FAIL]
#   wave-ops.sh status <change-id>  # one-line summary (OK: W2 open, 3/5 stories done)
set -euo pipefail

FORGE_ROOT="${FORGE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ACTIVE="$FORGE_ROOT/.forge/specs/active"

# Disciplina de parsing (issue #103, completada pela #133): flag desconhecida REPROVA e flag
# engolida como valor de outra REPROVA. Mesmo idioma de ledger-ops.sh, deferral-ops.sh e
# liaison-ops.sh — delegação em alvo ausente é erro, nunca silêncio.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/lib/arg-guards.sh" ]; then
  # shellcheck source=lib/arg-guards.sh
  . "$SCRIPT_DIR/lib/arg-guards.sh"
else
  echo "FAIL: wave-ops: '$SCRIPT_DIR/lib/arg-guards.sh' ausente — as guardas de flag desconhecida e de flag engolida como valor são parte do contrato deste script; rodar sem elas reabre a aceitação silenciosa de flag engolida como valor que a issue #133 fechou." >&2
  exit 1
fi

cmd="${1:-}"; shift || true
case "$cmd" in
  -h|--help|help) echo "Usage: wave-ops.sh plan|open|close|status <change-id> [args...]"; exit 0 ;;
esac
change_id="${1:-}"; shift || true

if [ -z "$cmd" ] || [ -z "$change_id" ]; then
  echo "Usage: wave-ops.sh plan|open|close|status <change-id> [args...]" >&2
  exit 1
fi

spec_dir="$ACTIVE/$change_id"
waves_file="$spec_dir/waves.json"
progress_file="$spec_dir/progress.json"
stories_dir="$spec_dir/stories"

_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

_read_json() { node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync('$1','utf8')),null,2))"; }

_write_json() {
  local f="$1"; local data="$2"
  local tmp; tmp="$(mktemp "${f}.XXXXXX")"
  printf '%s\n' "$data" > "$tmp"
  mv "$tmp" "$f"
}

case "$cmd" in

plan)
  # Deriva waves.json a partir de stories/ (grafo depends_on).
  # Wave 0 sempre: stories sem depends_on. Waves subsequentes respeitam topologia.
  [ $# -eq 0 ] || forge_reject_unknown plan "(nenhuma)" "$1"
  if [ ! -d "$stories_dir" ]; then
    echo "FAIL: stories/ não existe em $spec_dir — rode /forge:shard primeiro" >&2; exit 1
  fi
  result="$(node - "$stories_dir" "$change_id" <<'NODEEOF'
const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');

const [, , storiesDir, changeId] = process.argv;
const files = readdirSync(storiesDir).filter(f => f.endsWith('.md')).sort();
const stories = {};

for (const f of files) {
  const content = readFileSync(join(storiesDir, f), 'utf8');
  const fm = content.slice(content.indexOf('---') + 3, content.indexOf('---', 4));
  const idM = fm.match(/story_id:\s*(\S+)/);
  const depM = fm.match(/depends_on:\s*\[([^\]]*)\]/);
  if (!idM) throw new Error('missing story_id in ' + f);
  const id = idM[1];
  const deps = depM ? depM[1].split(',').map(s => s.trim()).filter(Boolean) : [];
  stories[id] = deps;
}

// Topological layer assignment
const layer = {};
function getLayer(id, visited = new Set()) {
  if (id in layer) return layer[id];
  if (visited.has(id)) throw new Error('cycle detected at ' + id);
  visited.add(id);
  const deps = stories[id] || [];
  layer[id] = deps.length === 0 ? 0 : Math.max(...deps.map(d => getLayer(d, new Set(visited)))) + 1;
  return layer[id];
}
for (const id of Object.keys(stories)) getLayer(id);

// Group by layer → wave
const byLayer = {};
for (const [id, l] of Object.entries(layer)) {
  if (!byLayer[l]) byLayer[l] = [];
  byLayer[l].push(id);
}

const waves = Object.keys(byLayer).sort((a, b) => +a - +b).map((l, i) => ({
  id: 'W' + i,
  name: i === 0 ? 'Foundation' : 'Wave ' + i,
  depends_on: i === 0 ? [] : ['W' + (i - 1)],
  stories: byLayer[l].sort(),
  status: 'pending',
  opened_at: null,
  closed_at: null,
  gate_result: null,
}));

console.log(JSON.stringify({ change_id: changeId, created_at: new Date().toISOString(), waves }, null, 2));
NODEEOF
)"
  _write_json "$waves_file" "$result"
  # Inicializar progress.json
  total_s="$(node -e "const d=JSON.parse(require('fs').readFileSync('$waves_file','utf8')); console.log(d.waves.reduce((a,w)=>a+w.stories.length,0))")"
  prog="{\"change_id\":\"$change_id\",\"updated_at\":\"$(_now)\",\"current_wave\":null,\"current_story\":null,\"total_stories\":$total_s,\"done_stories\":0,\"total_tasks\":0,\"done_tasks\":0,\"open_deferrals\":0,\"last_commit\":null,\"notes\":null}"
  _write_json "$progress_file" "$prog"
  echo "OK plan — $(node -e "const d=JSON.parse(require('fs').readFileSync('$waves_file','utf8')); console.log(d.waves.length+' waves, '+d.waves.reduce((a,w)=>a+w.stories.length,0)+' stories')")"
  ;;

open)
  wave_id="${1:-}"; shift || true
  [ -n "$wave_id" ] || { echo "FAIL: wave-id obrigatório" >&2; exit 1; }
  [ $# -eq 0 ] || forge_reject_unknown open "(nenhuma)" "$1"
  [ -f "$waves_file" ] || { echo "FAIL: waves.json não encontrado — rode wave plan primeiro" >&2; exit 1; }
  result="$(node - "$waves_file" "$wave_id" "$(_now)" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , wf, waveId, now] = process.argv;
const data = JSON.parse(readFileSync(wf, 'utf8'));
const wave = data.waves.find(w => w.id === waveId);
if (!wave) { console.error('wave ' + waveId + ' não encontrada'); process.exit(1); }
if (wave.status === 'open') { console.error('wave já está open'); process.exit(1); }
// Verificar que todas as dependências estão closed
for (const dep of (wave.depends_on || [])) {
  const dw = data.waves.find(w => w.id === dep);
  if (!dw || dw.status !== 'closed') {
    console.error('FAIL: dependência ' + dep + ' não está closed (status: ' + (dw ? dw.status : 'not found') + ')');
    process.exit(1);
  }
}
wave.status = 'open';
wave.opened_at = now;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$waves_file" "$result"
  node -e "const d=JSON.parse(require('fs').readFileSync('$progress_file','utf8')); d.current_wave='$wave_id'; d.updated_at='$(_now)'; process.stdout.write(JSON.stringify(d,null,2))" | { read -r -d '' out || true; _write_json "$progress_file" "$out"; } 2>/dev/null || \
    node -e "const f='$progress_file'; const d=JSON.parse(require('fs').readFileSync(f,'utf8')); d.current_wave='$wave_id'; d.updated_at='$(_now)'; require('fs').writeFileSync(f,JSON.stringify(d,null,2))"
  echo "OK open — $wave_id aberta"
  ;;

close)
  wave_id="${1:-}"; shift || true
  [ -n "$wave_id" ] || { echo "FAIL: wave-id obrigatório" >&2; exit 1; }
  [ -f "$waves_file" ] || { echo "FAIL: waves.json não encontrado" >&2; exit 1; }

  # O veredito do gate é OBSERVADO aqui, não recebido do chamador.
  #
  # Antes: `gate_result="OK"` por default, e `--gate OK` substituía execução. Quem fechava a wave
  # assinava o próprio laudo — e não por má-fé: `commands/waves/wave.md` mandava obter o resultado de
  # `run-gates.sh`, um script que NÃO EXISTIA no repositório, e a skill `wave-advance` passava
  # `--gate OK` literal. Não havia caminho honesto disponível.
  #
  # Agora: `--gate FAIL` continua reprovando sem gastar execução (afirmação negativa do chamador é
  # sempre aceita — ninguém precisa provar que falhou). `--gate OK`, ou a ausência de `--gate`,
  # dispara os gates de verdade e o resultado real decide. O veredito gravado carrega a PROCEDÊNCIA,
  # para que "passou nos gates", "não havia gate" e "alguém disse que passou" nunca mais se
  # confundam no waves.json.
  claimed=""
  CLOSE_FLAGS="--gate"
  while [ $# -gt 0 ]; do
    case "$1" in
      --gate) forge_require_value close --gate "${2-}" "$CLOSE_FLAGS"; claimed="$2"; shift 2 ;;
      *) forge_reject_unknown close "$CLOSE_FLAGS" "$1" ;;
    esac
  done

  if [ "$claimed" = "FAIL" ]; then
    echo "FAIL: gate declarado FAIL pelo chamador — wave não pode fechar" >&2; exit 1
  fi

  gate_out=""
  if [ -x "$FORGE_ROOT/.forge/scripts/run-gates.sh" ] || [ -f "$FORGE_ROOT/.forge/scripts/run-gates.sh" ]; then
    set +e
    gate_out="$(FORGE_ROOT="$FORGE_ROOT" bash "$FORGE_ROOT/.forge/scripts/run-gates.sh" "$change_id" "$wave_id" 2>&1)"
    gate_rc=$?
    set -e
  else
    echo "FAIL: run-gates.sh ausente — não há como observar o gate desta wave (pré-requisito faltando reprova; não se assume OK)" >&2
    exit 1
  fi
  verdict="$(printf '%s\n' "$gate_out" | tail -1)"
  printf '%s\n' "$gate_out"
  if [ "$gate_rc" -ne 0 ]; then
    echo "FAIL: gate da wave $wave_id reprovou na execução — wave não pode fechar" >&2; exit 1
  fi
  # `grep -c` sem match retorna != 0, e numa substituição dentro de atribuição isso mata o script
  # sob `set -e` — o close chegava a reprovar por ACIDENTE em vez de por veredito, o que é tão ruim
  # quanto aprovar por acidente: o resultado certo pelo motivo errado esconde a próxima regressão.
  passed_count="$(printf '%s\n' "$gate_out" | grep -c ': passed' || true)"
  case "$verdict" in
    NO-GATES) gate_result="executed:NO-GATES" ;;
    OK)       gate_result="executed:OK ($passed_count gate(s))" ;;
    *)        echo "FAIL: veredito inesperado do run-gates.sh: '$verdict'" >&2; exit 1 ;;
  esac
  result="$(node - "$waves_file" "$wave_id" "$gate_result" "$(_now)" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , wf, waveId, gateResult, now] = process.argv;
const data = JSON.parse(readFileSync(wf, 'utf8'));
const wave = data.waves.find(w => w.id === waveId);
if (!wave) { console.error('wave ' + waveId + ' não encontrada'); process.exit(1); }
if (wave.status !== 'open') { console.error('wave não está open (status: ' + wave.status + ')'); process.exit(1); }
if (gateResult === 'FAIL') { console.error('FAIL: gate retornou FAIL — wave não pode fechar'); process.exit(1); }
wave.status = 'closed';
wave.closed_at = now;
wave.gate_result = gateResult;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$waves_file" "$result"
  echo "OK close — $wave_id fechada (gate: $gate_result)"
  ;;

status)
  [ $# -eq 0 ] || forge_reject_unknown status "(nenhuma)" "$1"
  [ -f "$waves_file" ] || { echo "no waves.json"; exit 0; }
  node - "$waves_file" "$progress_file" <<'NODEEOF'
const { readFileSync, existsSync } = require('fs');
const [, , wf, pf] = process.argv;
const data = JSON.parse(readFileSync(wf, 'utf8'));
const prog = existsSync(pf) ? JSON.parse(readFileSync(pf, 'utf8')) : null;
const open = data.waves.filter(w => w.status === 'open').map(w => w.id);
const closed = data.waves.filter(w => w.status === 'closed').length;
const total = data.waves.length;
const doneS = prog ? prog.done_stories : '?';
const totalS = prog ? prog.total_stories : '?';
const deferrals = prog ? prog.open_deferrals : 0;
const parts = [
  'waves: ' + closed + '/' + total + ' closed',
  open.length ? 'open: ' + open.join(',') : 'no open wave',
  'stories: ' + doneS + '/' + totalS,
];
if (deferrals > 0) parts.push('deferrals: ' + deferrals + ' open');
console.log('OK: ' + parts.join('; '));
NODEEOF
  ;;

*)
  echo "FAIL: comando desconhecido '$cmd'" >&2; exit 1
  ;;
esac
