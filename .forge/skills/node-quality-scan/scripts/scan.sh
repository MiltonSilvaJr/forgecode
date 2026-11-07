#!/usr/bin/env bash
# scan.sh — detecção determinística do que o ESLint (nem com as regras forge-quality/*) reprova.
#
# Espelha .forge/skills/dotnet-quality-scan/scripts/scan.sh. As regras forge-quality/* (a
# camada de build/lint, vendorizada de soumatheusgomes/vibe-coding-toolkit) cobrem import
# direto de banco na apresentação, console.* fora de adaptador de log e tamanho de arquivo —
# tudo AST, tudo verificável em lint. O que sobra é intenção: nenhuma regra AST dirá que
# `PedidoHelper` não nomeia nada, que `process.env.X` espalhado é config sem validação central,
# ou que uma interface criada "para poder mockar" tem uma implementação só.
#
# Duas propriedades tornam isto auditável, e as duas são exigidas pelo gate w180:
#   1. TODA regra emite uma linha, inclusive quando não acha nada. Omissão fica visível.
#   2. Todo achado sai com arquivo:linha. Quem revisa confere, não acredita.
#
# Usa ripgrep quando disponível e grep quando não — o mesmo padrão nos dois motores. Um scanner
# que emudece porque falta ferramenta é pior do que nenhum: reporta verde por ausência de motor.
#
# Uso: scan.sh [--root <dir>] [--json <arquivo>] [--max <n>]
# Exit: 0 sem achados; 1 com achados; 2 em erro de uso.
set -uo pipefail

ROOT="."
JSON=""
MAX=10

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --json) JSON="$2"; shift 2 ;;
    --max)  MAX="$2"; shift 2 ;;
    -h|--help) sed -n '1,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "FAIL uso: argumento desconhecido '$1'" >&2; exit 2 ;;
  esac
done

[ -d "$ROOT" ] || { echo "FAIL root inexistente: $ROOT" >&2; exit 2; }
ROOT="$(cd "$ROOT" && pwd)"

ENGINE="grep"
command -v rg >/dev/null 2>&1 && ENGINE="rg"

# Extensões cobertas: mesmo conjunto que o eslint.config.mjs materializado lista para
# forge-quality/*. Diretórios ignorados espelham IGNORED_PATH_SEGMENTS de eslint-rules/utils.cjs
# mais coverage/.git, que não são AST mas também não são código de aplicação.
EXCLUDE_DIRS='/(node_modules|dist|build|\.next|generated|__generated__|coverage|\.git)/'

# Um motor, um padrão. `rg` e `grep -E` concordam sobre classes POSIX e sobre `$` dentro de
# alternativa; `\b` NÃO é portátil (BSD grep do macOS não o reconhece) e por isso não aparece em
# nenhum padrão abaixo.
search() {
  local pattern="$1" exclude="${2:-}"
  local raw
  if [ "$ENGINE" = "rg" ]; then
    raw="$(rg --no-heading --line-number --no-messages \
      --glob '*.ts' --glob '*.tsx' --glob '*.js' --glob '*.jsx' --glob '*.mjs' --glob '*.cjs' \
      -e "$pattern" "$ROOT" 2>/dev/null)"
  else
    raw="$(grep -arnE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
      --include='*.mjs' --include='*.cjs' -e "$pattern" "$ROOT" 2>/dev/null)"
  fi
  # Lookahead não existe em ERE nem no regex do rg: o que a regra precisa NEGAR sai por filtro.
  if [ -n "$exclude" ]; then
    raw="$(printf '%s\n' "$raw" | grep -vE "$exclude")"
  fi
  # O `-a` acima faz a varredura entregar a linha casada mesmo em arquivo com byte de controle — sem ele o achado vira `Binary file … matches`, sem caminho nem número de linha. O preço é que os bytes crus passariam para o relatório e para o JSON, onde byte de controle é inválido; por isso a última etapa os remove e preserva a localização, que é o que o relatório precisa.
  printf '%s\n' "$raw" | grep -vE "$EXCLUDE_DIRS" | grep -v '^$' | sed "s|^$ROOT/||" | LC_ALL=C tr -d "\000-\010\013\014\016-\037"
}

FINDINGS=0
JSON_ITEMS=""

# rule <id> <severidade> <padrão> <explicação> [exclude]
rule() {
  local id="$1" sev="$2" pattern="$3" why="$4" exclude="${5:-}"
  local hits count
  hits="$(search "$pattern" "$exclude")"
  count="$(printf '%s' "$hits" | grep -c . )"
  if [ "$count" = "0" ]; then
    echo "OK $id [$sev] nenhuma ocorrência"
    return 0
  fi
  echo "FOUND $id [$sev] $count ocorrência(s) — $why"
  printf '%s\n' "$hits" | head -n "$MAX" | sed 's|^|     |'
  [ "$count" -gt "$MAX" ] && echo "     … e mais $((count - MAX)) (use --max)"
  FINDINGS=$((FINDINGS + count))
  JSON_ITEMS="$JSON_ITEMS
{\"rule\":\"$id\",\"severity\":\"$sev\",\"count\":$count,\"why\":\"$why\"},"
  return 0
}

echo "INFO node-quality-scan root=$ROOT engine=$ENGINE"

rule empty-catch HIGH \
  'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}' \
  'erro engolido some do log e reaparece como corrupção de dado ou bug fantasma em produção'

rule floating-promise HIGH \
  '[.]then\(' \
  'promise sem .catch() correspondente perde a rejeição em silêncio (fire-and-forget não intencional)' \
  '[.]catch\('

rule sync-fs-blocking BLOCKER \
  '(readFileSync|writeFileSync|existsSync|readdirSync|mkdirSync|statSync|unlinkSync|appendFileSync|copyFileSync|renameSync)\(' \
  'chamada síncrona de fs bloqueia o event loop inteiro — todo request concorrente espera'

rule sql-interpolation BLOCKER \
  '[.](query|execute)\([[:space:]]*`[^`]*\$\{[^`]*`' \
  'template literal interpolado em query é injeção de SQL; use placeholder parametrizado ($1, ?) do driver'

rule new-pg-client HIGH \
  'new[[:space:]]+(Pool|Client)[[:space:]]*\(' \
  'Pool/Client instanciado fora de um módulo de bootstrap de banco esgota conexões por instância descartada'

rule process-env-direct MEDIUM \
  'process[.]env[.][A-Za-z_][A-Za-z0-9_]*' \
  'leitura direta de process.env espalhada pelo código foge da validação central de config no boot' \
  '/(config|env)\.[jt]sx?:'

rule date-now MEDIUM \
  'new[[:space:]]+Date\([[:space:]]*\)' \
  'new Date() sem argumento amarra o domínio ao relógio real da máquina; injete um clock/Date.now abstraído em teste'

rule explicit-any MEDIUM \
  '(:[[:space:]]*any([^A-Za-z0-9_]|$)|([[:space:]]|^)as[[:space:]]+any([^A-Za-z0-9_]|$))' \
  '"any" desliga a checagem de tipo exatamente onde ela existiria para pegar o erro'

rule generic-name MEDIUM \
  '(class|interface|type)[[:space:]]+[A-Za-z0-9_]*(Manager|Helper|Utils|Utility)([^A-Za-z0-9_]|$)' \
  'Manager/Helper/Utils/Utility não nomeiam responsabilidade — viram ímã para o que ninguém decidiu onde pôr'

rule mutable-module-state HIGH \
  '^export[[:space:]]+let[[:space:]]+' \
  'let exportado no topo do módulo é estado mutável compartilhado por todo importador — corrida entre requests concorrentes'

# ── interface com implementação única ───────────────────────────────────────────────────────
# Heurística conservadora: conta declarações `interface X` e quantos tipos declaram `implements
# X`. Uma implementação só costuma ser abstração especulativa — mas às vezes é fronteira de
# porta legítima, por isso a saída é MEDIUM e o julgamento fica com quem revisa.
single_impl=""
for iface in $(search 'interface[[:space:]]+[A-Z][A-Za-z0-9_]*' \
                | sed -E 's/.*interface[[:space:]]+([A-Za-z0-9_]+).*/\1/' | sort -u); do
  impls="$(search "implements[[:space:]]+${iface}([^A-Za-z0-9_]|$)" | grep -c . )"
  [ "$impls" = "1" ] && single_impl="$single_impl $iface"
done
if [ -z "$single_impl" ]; then
  echo "OK single-impl-interface [MEDIUM] nenhuma ocorrência"
else
  echo "FOUND single-impl-interface [MEDIUM] $(echo "$single_impl" | wc -w | tr -d ' ') ocorrência(s) — interface com uma única implementação costuma ser abstração especulativa"
  echo "    $(echo "$single_impl" | sed 's/^ //')"
  FINDINGS=$((FINDINGS + 1))
  JSON_ITEMS="$JSON_ITEMS
{\"rule\":\"single-impl-interface\",\"severity\":\"MEDIUM\",\"count\":1,\"why\":\"interface com implementação única\"},"
fi

if [ -n "$JSON" ]; then
  {
    echo '{"skill":"node-quality-scan","root":"'"$ROOT"'","engine":"'"$ENGINE"'","findings":['
    printf '%s' "$JSON_ITEMS" | sed '$ s/,$//' | grep -v '^$'
    echo '],"total":'"$FINDINGS"'}'
  } > "$JSON"
  echo "INFO json=$JSON"
fi

if [ "$FINDINGS" = "0" ]; then
  echo "PASS node-quality-scan (0 achados)"
  exit 0
fi
echo "FAIL node-quality-scan ($FINDINGS achado(s) — julgue caso a caso; nem todo achado é defeito)"
exit 1
