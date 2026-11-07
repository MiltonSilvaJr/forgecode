#!/usr/bin/env bash
set -euo pipefail

# Pre-tool-use hook: convenções de nomenclatura no <project_name>.
# 1) Tipos C# não devem começar com prefixo de tecnologia (Sql, Mongo, Kafka, ...).
# 2) Diretórios novos fora das pastas C# canônicas devem ser kebab-case.
# Falha com exit 1 ao detectar.

FILE="${1:-}"
if [[ -z "$FILE" ]]; then exit 0; fi

violations=()

# ─── 1) Prefixo de tecnologia em declarações de tipo (.cs) ───────────────────
if [[ "$FILE" =~ \.cs$ ]]; then
    TECH_PREFIXES=(
        "Sql[A-Z]"
        "Mongo[A-Z]"
        "Kafka[A-Z]"
        "Redis[A-Z]"
        "RabbitMq[A-Z]"
        "Postgres[A-Z]"
        "MySql[A-Z]"
        "Grpc[A-Z]"
        "Http[A-Z][a-z]"
        "Rest[A-Z]"
        "Dynamo[A-Z]"
        "Aws[A-Z]"
        "S3[A-Z]"
    )
    for prefix in "${TECH_PREFIXES[@]}"; do
        if grep -qE "(class|interface|record|struct)\s+${prefix}" "$FILE" 2>/dev/null; then
            match=$(grep -oE "(class|interface|record|struct)\s+${prefix}[A-Za-z0-9]+" "$FILE" | head -1 || true)
            violations+=("Prefixo de tecnologia em tipo: '${match:-?}'")
        fi
    done
fi

# ─── 2) Novos diretórios devem ser kebab-case fora das pastas .NET canônicas ─
DIR=$(dirname "$FILE")
BASENAME=$(basename "$DIR")

# Diretórios raiz e estruturais — ignorados
case "$BASENAME" in
    .|.git|.claude|.github|.githooks|.vs|.idea|.kiro|node_modules|bin|obj|TestResults)
        exit 0 ;;
esac

# Estrutura .NET canônica permite PascalCase em qualquer profundidade
# (<project_name> usa src/, tests/, deploy/; refactoring-plan introduzirá services/).
# Âncora nas duas pontas — (^|/) — porque o caminho pode chegar RELATIVO (git diff
# --cached --name-only, ou a ponte lib/argv-bridge.sh) e começar exatamente pelo segmento
# isento, sem barra antes dele; exigir só "/" nunca casava esse caso (issue #129). "(^|/)"
# preserva o caso absoluto e o aninhado (services/token-vault/src/...) sem alargar a isenção
# para um nome que apenas CONTÉM o segmento (mysrc/, srcx/ continuam reprovando).
if [[ "$DIR" =~ (^|/)(src|tests?|services|deploy)(/|$) ]]; then
    : # PascalCase permitido em código .NET (test/ e tests/: repositórios Payments.* usam as duas grafias)
elif [[ "$BASENAME" =~ [A-Z] ]] && [[ ! "$FILE" =~ \.(csproj|sln|props|targets)$ ]]; then
    violations+=("Diretório '$BASENAME' não está em kebab-case")
fi

if [[ ${#violations[@]} -gt 0 ]]; then
    echo "[HOOK] VIOLAÇÃO DE CONVENÇÕES DE NOMENCLATURA em: $FILE" >&2
    for v in "${violations[@]}"; do
        echo "[HOOK]   - $v" >&2
    done
    echo "[HOOK] Consulte: .forge/rules/conventions/naming.md (a definir)" >&2
    exit 1
fi

exit 0
