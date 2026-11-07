#!/usr/bin/env bash
# Forge SessionEnd (opt-in via forge.yaml handoff.auto / liaison.auto) — regenerates the
# deterministic handoff scaffold (handoff.auto, rule-based, no LLM) AND/OR runs the liaison
# native-check coverage diagnostic (liaison.auto, REQ-08, design §2.6). Each part runs
# independently of the other's script being present, and the hook always exits 0 — this is a
# diagnostic hook, never a gate.
set -u
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0

# stdin é lido UMA VEZ (SessionEnd entrega transcript_path/session_id no payload) — handoff.auto
# e liaison.auto não podem cada um tentar a própria leitura do mesmo pipe.
# Leitura limitada no tempo: um chamador que não fecha o stdin (ou um terminal) nunca pode
# bloquear o fim de sessão; o Claude Code entrega o payload e fecha o pipe na hora.
PAYLOAD=""
if [ ! -t 0 ]; then
  IFS= read -r -d '' -t 5 PAYLOAD || true
fi

# Read a top-level "<key>:\n ... auto: true|false" flag from forge.yaml (same idiom as
# on-session-start.sh / handoff-gen.sh; avoids grep -P/-z which BSD grep lacks).
_yaml_auto() {
  [ -f "$ROOT/.forge/forge.yaml" ] || { echo ""; return; }
  awk -v key="$1" '
    $0 ~ "^"key":" { inblk=1; next }
    inblk && /^[a-z_]+:/ { exit }
    inblk && /^[ ]+auto:[ ]*(true|false)/ { sub(/^[ ]+auto:[ ]*/, ""); print; exit }
  ' "$ROOT/.forge/forge.yaml"
}

# Handoff (handoff.auto): regenera o scaffold determinístico. Ausência do script (consumidor sem
# handoff-gen.sh) nunca impede a parte do liaison abaixo.
if [ "$(_yaml_auto handoff)" = "true" ] && [ -x "$ROOT/.forge/scripts/handoff-gen.sh" ]; then
  FORGE_ROOT="$ROOT" bash "$ROOT/.forge/scripts/handoff-gen.sh" >/dev/null 2>&1 || true
fi

# Liaison (liaison.auto): `native check --report` (REQ-08) — a saída do SessionEnd não chega ao
# modelo nem ao operador, por isso o relatório é PERSISTIDO em estado local e exibido no próximo
# SessionStart. Ausência de liaison-ops.sh nunca impede a parte do handoff acima.
#
# O canal (e o estado nativo) moram no TRONCO (rule conventions/machinery-propagation.md), nunca
# na branch — mesma resolução de LIAISON_ROOT que on-session-start.sh usa.
if [ "$(_yaml_auto liaison)" = "true" ] && [ -f "$ROOT/.forge/scripts/liaison-ops.sh" ]; then
  LIAISON_ROOT="$ROOT"
  _common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  case "$_common" in /*) LIAISON_ROOT="$(dirname "$_common")" ;; esac

  # transcript_path/session_id do payload do SessionEnd — extraídos com node (já dependência do
  # harness); payload vazio ou malformado dá strings vazias, nunca erro.
  parsed="$(printf '%s' "$PAYLOAD" | node -e '
    let raw = "";
    process.stdin.on("data", (d) => { raw += d; });
    process.stdin.on("end", () => {
      let obj = {};
      try { obj = JSON.parse(raw); } catch { /* payload vazio ou malformado */ }
      process.stdout.write([obj.transcript_path || "", obj.session_id || ""].join("\u001f"));
    });
  ' 2>/dev/null || true)"
  transcript_path="${parsed%%$'\x1f'*}"
  session_id="${parsed#*$'\x1f'}"

  if [ -n "$transcript_path" ] || [ -n "$session_id" ]; then
    FORGE_ROOT="$LIAISON_ROOT" bash "$ROOT/.forge/scripts/liaison-ops.sh" native check \
      ${transcript_path:+--transcript "$transcript_path"} ${session_id:+--session "$session_id"} \
      --report >/dev/null 2>&1 || true
  fi
fi

exit 0
