#!/usr/bin/env bash
# deferral-ops.sh — operações deterministas em deferrals.json (§17.4).
# Uso:
#   deferral-ops.sh raise   <change-id> --reason "<texto>" [--blocks "<item,...>"]
#   deferral-ops.sh resolve <change-id> <deferral-id> --note "<texto>"
#   deferral-ops.sh test    <change-id> <deferral-id>
#   deferral-ops.sh status  <change-id>   # one-line: OK (3 resolved/tested, 0 open)
set -euo pipefail

FORGE_ROOT="${FORGE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
ACTIVE="$FORGE_ROOT/.forge/specs/active"

# Disciplina de parsing (issue #103): flag desconhecida REPROVA e flag engolida como valor de
# outra REPROVA. Delegação em alvo ausente é erro, nunca silêncio — mesmo idioma de
# ledger-ops.sh e liaison-ops.sh. NÃO mexe na resolução de FORGE_ROOT acima (por diretório do
# script, não por git): esse invariante é de outro change.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/lib/arg-guards.sh" ]; then
  # shellcheck source=lib/arg-guards.sh
  . "$SCRIPT_DIR/lib/arg-guards.sh"
else
  echo "FAIL: deferral-ops: '$SCRIPT_DIR/lib/arg-guards.sh' ausente — as guardas de flag desconhecida e de flag engolida como valor são parte do contrato deste script; rodar sem elas reinstala a escrita silenciosa que a issue #103 fechou." >&2
  exit 1
fi

cmd="${1:-}"; shift || true
case "$cmd" in
  -h|--help|help) echo "Usage: deferral-ops.sh raise|resolve|test|status <change-id> [args...]"; exit 0 ;;
esac
change_id="${1:-}"; shift || true

[ -n "$cmd" ] && [ -n "$change_id" ] || {
  echo "Usage: deferral-ops.sh raise|resolve|test|status <change-id> [args...]" >&2; exit 1
}

spec_dir="$ACTIVE/$change_id"
df="$spec_dir/deferrals.json"
progress_file="$spec_dir/progress.json"

_now() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
_write_json() { local f="$1"; local tmp; tmp="$(mktemp "${f}.XXXXXX")"; printf '%s\n' "$2" > "$tmp"; mv "$tmp" "$f"; }

_init_deferrals() {
  [ -f "$df" ] || _write_json "$df" "{\"change_id\":\"$change_id\",\"deferrals\":[]}"
}

_update_open_count() {
  [ -f "$progress_file" ] || return 0
  node -e "
    const pf='$progress_file', df='$df';
    const p=JSON.parse(require('fs').readFileSync(pf,'utf8'));
    const d=JSON.parse(require('fs').readFileSync(df,'utf8'));
    p.open_deferrals=d.deferrals.filter(x=>x.status==='open').length;
    p.updated_at='$(_now)';
    require('fs').writeFileSync(pf,JSON.stringify(p,null,2));
  "
}

case "$cmd" in

raise)
  reason=""
  blocks=()
  RAISE_FLAGS="--reason --blocks"
  while [ $# -gt 0 ]; do
    case "$1" in
      --reason) forge_reject_flag_as_value raise --reason "${2-}" "$RAISE_FLAGS"; reason="$2"; shift 2 ;;
      --blocks) forge_reject_flag_as_value raise --blocks "${2-}" "$RAISE_FLAGS"; IFS=',' read -ra blocks <<< "$2"; shift 2 ;;
      *) forge_reject_unknown raise "$RAISE_FLAGS" "$1" ;;
    esac
  done
  [ -n "$reason" ] || { echo "FAIL: --reason obrigatório" >&2; exit 1; }
  _init_deferrals
  result="$(node - "$df" "$reason" "$(_now)" "${blocks[*]:-}" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , df, reason, now, blocksRaw] = process.argv;
const data = JSON.parse(readFileSync(df, 'utf8'));
const blocks = blocksRaw ? blocksRaw.split(' ').filter(Boolean) : [];
const n = data.deferrals.length + 1;
const id = 'DEFER-' + String(n).padStart(2, '0');
data.deferrals.push({ id, raised_in: now, description: reason, reason, blocks, depends_on: [], status: 'open', resolved_at: null, resolution_note: null });
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$df" "$result"
  _update_open_count
  new_id="$(node -e "const d=JSON.parse(require('fs').readFileSync('$df','utf8')); console.log(d.deferrals[d.deferrals.length-1].id)")"
  echo "OK raise — $new_id registrado"
  ;;

resolve)
  deferral_id="${1:-}"; shift || true
  [ -n "$deferral_id" ] || { echo "FAIL: deferral-id obrigatório" >&2; exit 1; }
  note=""
  RESOLVE_FLAGS="--note"
  while [ $# -gt 0 ]; do case "$1" in --note) forge_reject_flag_as_value resolve --note "${2-}" "$RESOLVE_FLAGS"; note="$2"; shift 2 ;; *) forge_reject_unknown resolve "$RESOLVE_FLAGS" "$1" ;; esac; done
  [ -n "$note" ] || { echo "FAIL: --note obrigatório" >&2; exit 1; }
  _init_deferrals
  result="$(node - "$df" "$deferral_id" "$note" "$(_now)" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , df, defId, note, now] = process.argv;
const data = JSON.parse(readFileSync(df, 'utf8'));
const d = data.deferrals.find(x => x.id === defId);
if (!d) { console.error('deferral ' + defId + ' não encontrado'); process.exit(1); }
if (d.status !== 'open') { console.error('deferral ' + defId + ' não está open (status: ' + d.status + ')'); process.exit(1); }
d.status = 'resolved';
d.resolved_at = now;
d.resolution_note = note;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$df" "$result"
  _update_open_count
  echo "OK resolve — $deferral_id marcado como resolved"
  ;;

test)
  deferral_id="${1:-}"; shift || true
  [ -n "$deferral_id" ] || { echo "FAIL: deferral-id obrigatório" >&2; exit 1; }
  [ $# -eq 0 ] || forge_reject_unknown test "(nenhuma)" "$1"
  _init_deferrals
  result="$(node - "$df" "$deferral_id" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , df, defId] = process.argv;
const data = JSON.parse(readFileSync(df, 'utf8'));
const d = data.deferrals.find(x => x.id === defId);
if (!d) { console.error('deferral ' + defId + ' não encontrado'); process.exit(1); }
if (d.status !== 'resolved') { console.error('deferral ' + defId + ' deve estar resolved antes de testar (status: ' + d.status + ')'); process.exit(1); }
d.status = 'tested';
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$df" "$result"
  _update_open_count
  echo "OK test — $deferral_id marcado como tested"
  ;;

status)
  [ $# -eq 0 ] || forge_reject_unknown status "(nenhuma)" "$1"
  _init_deferrals
  node - "$df" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , df] = process.argv;
const data = JSON.parse(readFileSync(df, 'utf8'));
const open = data.deferrals.filter(d => d.status === 'open').length;
const resolved = data.deferrals.filter(d => d.status === 'resolved').length;
const tested = data.deferrals.filter(d => d.status === 'tested').length;
const total = data.deferrals.length;
if (open > 0) {
  const ids = data.deferrals.filter(d => d.status === 'open').map(d => d.id).join(', ');
  console.log('OPEN (' + open + '/' + total + ' open: ' + ids + ')');
} else {
  console.log('OK (' + tested + ' tested, ' + resolved + ' resolved, 0 open)');
}
NODEEOF
  ;;

*)
  echo "FAIL: comando desconhecido '$cmd'" >&2; exit 1
  ;;
esac
