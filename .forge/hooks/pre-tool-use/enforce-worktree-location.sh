#!/usr/bin/env bash
# PreToolUse (Bash) — bloqueia `git worktree add` cujo destino não esteja sob
# `.forge/worktrees/` (convenção conventions/git-worktree.md).
#
# Recebe o tool input como JSON no stdin. FALHA-ABERTO: qualquer erro de parsing
# → permite (exit 0). Só bloqueia (exit 2) em violação clara.

input="$(cat 2>/dev/null || true)"

cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
fi
if [ -z "$cmd" ] && command -v python3 >/dev/null 2>&1; then
  cmd="$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("tool_input",{}).get("command",""))
except Exception: pass' 2>/dev/null || true)"
fi

# Remove trechos entre aspas para não disparar em echo/printf/docs que apenas
# CITAM o comando. A detecção da invocação real roda sobre esse resíduo; a
# verificação do destino roda sobre o comando original (preserva paths citados).
stripped="$(printf '%s' "$cmd" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")"

# Detecta "git [flags] worktree add" como invocação real (não `list/remove/prune/move`).
if printf '%s' "$stripped" | grep -Eq 'git([[:space:]]+-[^[:space:]]+)*[[:space:]]+worktree[[:space:]]+add'; then
  if ! printf '%s' "$cmd" | grep -q '\.forge/worktrees/'; then
    echo "BLOQUEADO: crie a worktree sob '.forge/worktrees/' (regra conventions/git-worktree.md)." >&2
    echo "Ex.: git worktree add .forge/worktrees/<escopo>-<desc> -b <tipo>/<escopo>/<desc>" >&2
    exit 2
  fi
fi

exit 0
