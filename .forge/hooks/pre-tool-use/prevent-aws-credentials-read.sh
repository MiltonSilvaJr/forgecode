#!/usr/bin/env bash
set -uo pipefail

# PreToolUse (Bash e Read) — bloqueia qualquer leitura de ~/.aws/credentials, ~/.aws/config,
# ~/.aws/sso/cache/* e ~/.aws/cli/cache/* (ORQ-20261027-105). Medido três vezes em dois dias em
# sessões peer diferentes (PIPELINE em 26/10, FULL-STACK e SUPORTE em 27/10), sempre depurando
# Terraform sem credencial - a regra em memória não é mecânica, então vira gancho.
#
# CONTRATO stdin-json: lê o payload do PreToolUse pelo STDIN (session_id, tool_name, tool_input -
# mesmo contrato dos demais ganchos deste diretório). FAIL-CLOSED (exit 2) quando o parser não
# consegue extrair nem comando nem caminho - diferente de enforce-worktree-location.sh (que falha
# aberto): aqui o risco de um falso negativo é expor segredo, e o de um falso positivo é só pedir
# `aws configure list`/`aws sts get-caller-identity` em vez de ler o arquivo direto - a assimetria
# justifica fail-closed.
#
# DETECÇÃO, Bash: exige um COMANDO LEITOR (cat, less, more, head, tail, grep, sed, awk, cp,
# base64, python(3), node, xxd, od, strings, vim, nano, open, jq, yq) e o CAMINHO SENSÍVEL na
# MESMA LINHA do comando - nunca "comando em qualquer lugar do payload inteiro" (ORQUESTRADOR,
# correção de 27/10): `cat "$HOME/.aws/credentials"` e `cat '/Users/milton/.aws/credentials'`
# precisam bloquear mesmo com aspas - aspas nunca isentam aqui, ao contrário de
# enforce-worktree-location.sh. A exceção real é a MENÇÃO do caminho como texto, nunca como
# argumento de um leitor: `git commit -m "corrigi leitura de ~/.aws/credentials"` não tem nenhum
# comando leitor na mensagem inteira, e `gh pr create --body "$(cat <<'EOF' ... EOF)"` usa "cat"
# só para montar um heredoc de documentação - o "cat" fica na primeira linha e a menção ao
# caminho, se houver, fica em alguma linha POSTERIOR do corpo, nunca na mesma linha do "cat". A
# checagem por linha resolve os dois sem precisar reconhecer "é um commit/PR" explicitamente.
#
# DETECÇÃO, Read: o caminho vem direto em tool_input.file_path, sem comando algum - qualquer
# correspondência bloqueia.

input="$(cat 2>/dev/null || true)"
if [ -z "$input" ]; then
  echo "BLOQUEADO (fail-closed): PreToolUse sem payload no stdin - não dá para confirmar que o alvo não é uma credencial AWS." >&2
  exit 2
fi

ler_campo() {
  # $1 = caminho jq (ex.: ".tool_name"). Tenta jq, cai para python3. Nenhum erro de parser deixa
  # o payload passar em silêncio: FALHOU vira string vazia, e quem chama trata vazio como
  # "não consegui ler" (fail-closed), nunca como "não encontrei o campo" (que seria aprovar).
  local jqpath="$1"
  local valor=""
  local jq_ok=1
  if command -v jq >/dev/null 2>&1; then
    valor="$(printf '%s' "$input" | jq -r "${jqpath} // empty" 2>/dev/null)" || jq_ok=0
    if [ "$jq_ok" -eq 1 ]; then
      printf '%s' "$valor"
      return 0
    fi
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$jqpath" <<'PYEOF' 2>/dev/null
import sys, json
caminho = sys.argv[1].lstrip(".").split(".")
try:
    dado = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for chave in caminho:
    if not isinstance(dado, dict):
        sys.exit(1)
    dado = dado.get(chave)
if dado is None:
    print("")
else:
    print(dado)
PYEOF
    return $?
  fi
  return 1
}

TOOL_NAME="$(printf '%s' "$input" | ler_campo '.tool_name')"
PARSE_RC_NOME=$?
if [ "$PARSE_RC_NOME" -ne 0 ]; then
  echo "BLOQUEADO (fail-closed): não consegui extrair tool_name do payload (jq/python3 ausentes ou JSON malformado)." >&2
  exit 2
fi

# Caminho sensível: ".aws/credentials", ".aws/config", ou algo dentro de ".aws/sso/cache/" ou
# ".aws/cli/cache/" - casa com ~/.aws/..., $HOME/.aws/..., ${HOME}/.aws/... e qualquer caminho
# absoluto terminando nisso (/Users/<x>/.aws/..., /home/<x>/.aws/...), com ou sem aspas em volta,
# porque o sufixo ".aws/..." é o mesmo independente do que vem antes.
CAMINHO_SENSIVEL='\.aws/(credentials$|credentials[^a-zA-Z0-9_-]|config$|config[^a-zA-Z0-9_-]|sso/cache(/|$)|cli/cache(/|$))'

if [ "$TOOL_NAME" = "Read" ]; then
  FILE_PATH="$(printf '%s' "$input" | ler_campo '.tool_input.file_path')"
  PARSE_RC_PATH=$?
  if [ "$PARSE_RC_PATH" -ne 0 ]; then
    echo "BLOQUEADO (fail-closed): não consegui extrair tool_input.file_path do payload do Read." >&2
    exit 2
  fi
  if printf '%s' "$FILE_PATH" | grep -Eq "$CAMINHO_SENSIVEL"; then
    echo "BLOQUEADO: Read de credencial/config AWS (~/.aws/credentials, ~/.aws/config, ~/.aws/sso/cache/* ou ~/.aws/cli/cache/*) nunca é permitido - o valor não pode entrar no contexto da sessão." >&2
    echo "Use 'aws configure list', 'aws configure list-profiles' ou 'aws sts get-caller-identity' para o que for diagnóstico de qual credencial/perfil está ativo." >&2
    exit 2
  fi
  exit 0
fi

if [ "$TOOL_NAME" = "Bash" ]; then
  CMD="$(printf '%s' "$input" | ler_campo '.tool_input.command')"
  PARSE_RC_CMD=$?
  if [ "$PARSE_RC_CMD" -ne 0 ]; then
    echo "BLOQUEADO (fail-closed): não consegui extrair tool_input.command do payload do Bash." >&2
    exit 2
  fi

  # Comando leitor: qualquer ferramenta que exiba/copie/processe o CONTEÚDO de um arquivo dado
  # como caminho. "python"/"python3" e "node"/"nodejs" cobrem os dois nomes comuns de binário.
  COMANDO_LEITOR='\b(cat|less|more|head|tail|grep|sed|awk|cp|base64|python3?|node(js)?|xxd|od|strings|vim|nano|open|jq|yq)\b'

  BLOQUEOU=0
  while IFS= read -r linha; do
    if printf '%s' "$linha" | grep -Eq "$COMANDO_LEITOR" && printf '%s' "$linha" | grep -Eq "$CAMINHO_SENSIVEL"; then
      BLOQUEOU=1
      break
    fi
  done <<< "$CMD"

  if [ "$BLOQUEOU" -eq 1 ]; then
    echo "BLOQUEADO: comando lê credencial/config AWS (~/.aws/credentials, ~/.aws/config, ~/.aws/sso/cache/* ou ~/.aws/cli/cache/*) - o valor nunca pode entrar no contexto da sessão, com ou sem aspas em volta do caminho." >&2
    echo "Use 'aws configure list', 'aws configure list-profiles' ou 'aws sts get-caller-identity' para o que for diagnóstico de qual credencial/perfil está ativo." >&2
    exit 2
  fi
  exit 0
fi

# Nem Bash nem Read: este gancho não se aplica (o matcher do hooks.manifest já deveria ter
# restringido a invocação a estes dois, mas nunca presume - um tool_name inesperado aqui é
# aprovado, porque não há o que bloquear sem saber nem comando nem caminho).
exit 0
