#!/usr/bin/env bash
set -euo pipefail

# Pre-tool-use hook: identificadores em arquivos de código devem ser EN.
# Comentários, mensagens, docs e strings podem ser PT-BR (política do projeto).
# Verifica apenas .cs (<project_name> é .NET puro).
# Falha com exit 1 ao encontrar identificador PT-BR comum.

FILE="${1:-}"
if [[ -z "$FILE" ]]; then exit 0; fi
if [[ ! "$FILE" =~ \.cs$ ]]; then exit 0; fi
# Skip arquivos gerados / migration / fixture
case "$FILE" in
    *.Designer.cs|*.g.cs|*Migration*|*test*|*spec*|*mock*|*fixture*) exit 0 ;;
esac

# Lista representativa de identificadores PT-BR (não exaustiva). Heurística:
# casa em declarações de tipos/membros (após class/interface/record/struct/method modifiers).
PT_BR_PATTERNS=(
    "Pagamento"
    "Cliente"
    "Cobranca"
    "Cobrança"
    "Cancelar"
    "Cancelamento"
    "Estorno"
    "Conta"
    "Transacao"
    "Transação"
    "Lancamento"
    "Lançamento"
    "Empresa"
    "Usuario"
    "Usuário"
    "Senha"
    "ProcessarPagamento"
    "CriarVenda"
    "CalcularTaxa"
)

declarators='class|interface|record|struct|enum|delegate|void|Task|async|public|private|protected|internal|static|virtual|override|readonly|const|var'
violations=()

for word in "${PT_BR_PATTERNS[@]}"; do
    # Match: <declarator> <Word>... ou nome=<Word>...( ou propriedades { get; set; }
    if grep -qE "(${declarators})\s+([A-Z][A-Za-z0-9]*)*${word}([A-Z][A-Za-z0-9]*)*\\b|\\b${word}\\s*[({=]" "$FILE" 2>/dev/null; then
        match=$(grep -oE "(${declarators})\s+([A-Z][A-Za-z0-9]*)*${word}([A-Z][A-Za-z0-9]*)*" "$FILE" | head -1 || true)
        violations+=("'${word}' em ${match:-identificador}")
    fi
done

if [[ ${#violations[@]} -gt 0 ]]; then
    echo "[HOOK] VIOLAÇÃO DE POLÍTICA DE IDIOMA em: $FILE" >&2
    echo "[HOOK] Identificadores em PT-BR detectados (código deve ser EN):" >&2
    for v in "${violations[@]}"; do
        echo "[HOOK]   - $v" >&2
    done
    echo "[HOOK] Comentários/docs/strings em PT-BR são permitidos." >&2
    echo "[HOOK] Consulte: .forge/rules/conventions/language-policy.md (a definir)" >&2
    exit 1
fi

exit 0
