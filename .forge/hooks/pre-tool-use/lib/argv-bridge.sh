#!/usr/bin/env bash
# argv-bridge.sh <gancho-alvo> [args-extras...] — ponte de contrato (issue #125).
#
# O Claude Code entrega TODO PreToolUse pelo STDIN, mas alguns ganchos deste diretório (contrato
# `argv` no hooks.manifest.default) ainda esperam receber o caminho do arquivo por `$1` — foi
# assim que já foram escritos, e reescrevê-los para ler stdin diretamente não é o escopo desta
# issue. Esta ponte lê o payload JSON do stdin, extrai `tool_input.file_path` (ou
# `tool_input.notebook_path`, para NotebookEdit) e o conteúdo que ENTRA, e invoca o gancho alvo com
# `$1=<caminho>` e `$2=<conteúdo>` — o MESMO contrato legado `<file> [<new-content>]` que
# `prevent-secrets-leak.sh` já documenta e que o `hooks.manifest` real do axis-fare-validator já
# descreve para seus próprios ganchos `argv` ("lê o conteúdo que ENTRA quando há $2"). Repassar o
# conteúdo (achado de correção MEDIUM, revisão adversarial da 2ª iteração — cenário de versão
# mista) fecha a lacuna medida: um `prevent-secrets-leak.sh` fiado através desta ponte por um
# consumidor antigo lia só `$1` e caía direto no fallback de disco, aprovando qualquer segredo que
# ainda não tivesse sido escrito (arquivo novo, por exemplo) — sem alterar o gancho em si, que
# continua utilizável também por chamada direta (testes, ou o `dispatch-file-hook.sh` que um
# consumidor já tenha).
#
# FAIL-OPEN por design, e a razão é o alcance PADRÃO destes ganchos: os dois que
# `hooks.manifest.default` fia por esta ponte hoje (check-language-policy.sh,
# validate-naming-conventions.sh) são convenção de nomenclatura/idioma, não segurança, e já saem 0
# quando `$1` está vazio — um payload ilegível aqui produz o mesmo efeito neutro de uma chamada sem
# arquivo. Repassar `$2` não muda essa postura: os dois ignoram o segundo argumento (leem o disco
# via `$1`), e um gancho de segurança fiado através desta ponte por exceção passa a receber o
# conteúdo que entra, em vez de ser silenciosamente reduzido a um leitor de disco.
set -uo pipefail

TARGET="${1:-}"
if [[ -n "$TARGET" ]]; then shift; fi

if [[ -z "$TARGET" ]]; then
  echo "[HOOK] argv-bridge: nenhum gancho-alvo informado (uso: argv-bridge.sh <gancho.sh>)" >&2
  exit 0
fi

input="$(cat 2>/dev/null || true)"
FILE=""
CONTENT_B64=""
if [[ -n "$input" ]]; then
  if command -v jq >/dev/null 2>&1; then
    FILE="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null || true)"
    CONTENT_B64="$(printf '%s' "$input" | jq -r '
      ((.tool_input.content // .tool_input.new_string // .tool_input.new_source
        // ((.tool_input.edits // []) | map(.new_string // "") | join("\n"))
        // "")) | @base64' 2>/dev/null || true)"
  fi
  if [[ -z "$FILE" ]] && command -v python3 >/dev/null 2>&1; then
    FILE="$(printf '%s' "$input" | python3 -c 'import sys, json
try:
    d = json.load(sys.stdin).get("tool_input", {}) or {}
except Exception:
    d = {}
print(d.get("file_path") or d.get("notebook_path") or "")' 2>/dev/null || true)"
  fi
  if [[ -z "$CONTENT_B64" ]] && command -v python3 >/dev/null 2>&1; then
    CONTENT_B64="$(printf '%s' "$input" | python3 -c 'import sys, json, base64
try:
    d = json.load(sys.stdin).get("tool_input", {}) or {}
except Exception:
    d = {}
c = d.get("content")
if c is None:
    c = d.get("new_string")
if c is None:
    c = d.get("new_source")
if c is None:
    edits = d.get("edits") or []
    c = "\n".join((e.get("new_string") or "") for e in edits if isinstance(e, dict))
print(base64.b64encode((c or "").encode("utf-8")).decode("ascii"))' 2>/dev/null || true)"
  fi
fi

CONTENT=""
if [[ -n "$CONTENT_B64" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    CONTENT="$(printf '%s' "$CONTENT_B64" | python3 -c 'import sys, base64; sys.stdout.write(base64.b64decode(sys.stdin.read()).decode("utf-8", "replace"))' 2>/dev/null || true)"
  else
    CONTENT="$(printf '%s' "$CONTENT_B64" | { base64 -d 2>/dev/null || base64 -D 2>/dev/null || true; })"
  fi
fi

exec "$TARGET" "$FILE" "$CONTENT" "$@"
