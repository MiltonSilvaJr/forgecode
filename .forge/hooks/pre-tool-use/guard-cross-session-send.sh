#!/usr/bin/env bash
# Gancho PreToolUse — guarda de saída para SendMessage (design §2.5, REQ-04 a REQ-07): segredo,
# destino declarado e contenção por workspace antes de a mensagem sair para outra sessão.
#
# Contrato stdin-json: o Claude Code entrega o payload do PreToolUse pelo STDIN, nunca por argv.
# Este .sh só localiza `scripts/lib/` a partir do PRÓPRIO caminho (`../../scripts/lib/` a partir
# de `.forge/hooks/pre-tool-use/`, nunca por FORGE_ROOT nem pelo cwd) e repassa o stdin para
# `native-send-guard.mjs`, o leitor único que faz toda a classificação, varredura de segredo,
# contenção e checagem de destino declarado.
#
# Toda recusa é exit 2 com mensagem em stderr; NENHUM caminho de erro sai com 1 — é o único
# código que o Claude Code trata como bloqueio real de PreToolUse (um gancho que sai 1 é tratado
# como falha não bloqueante, e a ferramenta segue mesmo assim).
set -u

SELF="${BASH_SOURCE[0]}"
HOOK_DIR="$(cd "$(dirname "$SELF")" && pwd)"
LIB_DIR="$(cd "$HOOK_DIR/../../scripts/lib" 2>/dev/null && pwd)"

if [ -z "$LIB_DIR" ] || [ ! -f "$LIB_DIR/native-send-guard.mjs" ]; then
  echo "[HOOK] guard-cross-session-send: native-send-guard.mjs não encontrado a partir de '$HOOK_DIR' (esperado em '../../scripts/lib') — fail-closed" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[HOOK] guard-cross-session-send: 'node' ausente no PATH — fail-closed" >&2
  exit 2
fi

# Sem `exec`: o rc do node é normalizado aqui. Falha de CARGA de módulo (lib dependente ausente
# num upgrade parcial, erro de sintaxe, marcador de conflito) acontece antes de `main()` registrar
# o fail-closed e sai com 1; morte por sinal sai com 128+N. Qualquer rc diferente de 0 vira 2.
node "$LIB_DIR/native-send-guard.mjs"
rc=$?
[ "$rc" -eq 0 ] && exit 0
[ "$rc" -eq 2 ] || echo "[HOOK] guard-cross-session-send: avaliador saiu com rc $rc (falha de carga ou interrupção) — fail-closed" >&2
exit 2
