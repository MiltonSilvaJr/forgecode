#!/usr/bin/env bash
# node-baseline.sh — audita (e materializa) a camada de enforcement de lint da stack Node/TS.
#
# Espelha dotnet-baseline.sh (mesma dupla check/apply, mesma recusa de sobrescrever configuração
# existente sem --force). Onde o MSBuild importa Directory.Build.props automaticamente, o ESLint
# não tem equivalente: quem decide o que entra no lint é o `eslint.config.*` que o projeto já
# tem — por isso este script só MATERIALIZA um `eslint.config.mjs` quando nenhum config flat
# existe ainda; quando já existe (qualquer extensão), o script nunca escreve por cima e o
# `--check` cobra que o arquivo existente referencie as regras vendorizadas.
#
#   eslint.config.{mjs,js,cjs,ts}   registro do plugin forge-quality/* + severidade por regra
#   eslint-rules/ (dentro do pack)  as três regras vendorizadas, cópia própria — nunca dependência
#
# A armadilha do max-lines: decisão registrada (ledger LDG-0061/LDG-0130) diz que
# `forge-quality/max-lines` NUNCA é "error" — é sinal, não portão (conflita com
# rules/conventions/code-style.md se virar bloqueante). Quem liga isso sem saber da decisão
# comete o erro simétrico ao IDE1006 do lado .NET: um valor que PARECE reforço e na verdade
# contraria o desenho do harness. O --check reprova explicitamente essa severidade.
#
# Uso:
#   node-baseline.sh [--root <dir>] [--check]           # default; não escreve nada
#   node-baseline.sh [--root <dir>] --apply [--force]   # materializa o que falta
#
# Saída: uma linha por check, no padrão do gate-runner (OK / MISS / FAIL / WARN / INFO).
# Exit: 0 quando tudo que é load-bearing está no lugar; 1 quando falta ou diverge; 2 em erro de uso.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="$SELF/../capabilities/backend-node-postgres/assets"

ROOT="."
MODE="check"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --check) MODE="check"; shift ;;
    --apply) MODE="apply"; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '1,26p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "FAIL uso: argumento desconhecido '$1'" >&2; exit 2 ;;
  esac
done

[ -d "$ROOT" ] || { echo "FAIL root inexistente: $ROOT" >&2; exit 2; }
ROOT="$(cd "$ROOT" && pwd)"
[ -d "$ASSETS" ] || { echo "FAIL assets do pack ausentes: $ASSETS" >&2; exit 2; }
[ -f "$ASSETS/eslint.config.mjs" ] || { echo "FAIL asset ausente: $ASSETS/eslint.config.mjs" >&2; exit 2; }

RC=0
ABSENT=0     # arquivo do baseline que não existe → --apply resolve
INCOMPLETE=0 # arquivo que existe e está incompleto/errado → --apply NÃO resolve (não sobrescreve)
say()  { echo "$*"; }
bad()  { echo "$*"; RC=1; case "$1" in MISS*) ABSENT=1 ;; *) INCOMPLETE=1 ;; esac; }

# ── é um repositório Node? ───────────────────────────────────────────────────────────────────
# Sem package.json/tsconfig.json não há o que cobrar: o script é no-op silencioso.
pkg_count="$(find "$ROOT" \( -name node_modules -o -name dist -o -name build -o -name .next -o -name .git \) -prune -o \
  \( -name 'package.json' -o -name 'tsconfig.json' \) -print 2>/dev/null | wc -l | tr -d ' ')"
if [ "$pkg_count" = "0" ]; then
  say "INFO node:none (nenhum package.json/tsconfig.json em $ROOT — nada a auditar)"
  exit 0
fi

# ── greenfield × brownfield decide a severidade default de no-direct-console ────────────────
# Mesma lógica do dotnet-baseline (AnalysisMode All vs Recommended): "error" direto numa base
# com centenas de console.log já escritos reprova o primeiro lint e mata a adoção ali. O eixo é
# presença de código-fonte, não contagem de violação — mesmo critério simples do lado .NET.
src_count="$(find "$ROOT" \( -name node_modules -o -name dist -o -name build -o -name .next -o -name coverage -o -name .git \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) -print 2>/dev/null \
  | grep -vE '\.(test|spec)\.[cm]?[jt]sx?$|/(__tests__|__mocks__|fixtures|mocks)/' \
  | wc -l | tr -d ' ')"
if [ "$src_count" = "0" ]; then
  CONSOLE_SEVERITY="error"; FLAVOR="greenfield"
else
  CONSOLE_SEVERITY="warn"; FLAVOR="brownfield (${src_count} arquivo(s) de código-fonte)"
fi

# ── qual arquivo de config flat existe (se algum) ────────────────────────────────────────────
CONFIG=""
for name in eslint.config.mjs eslint.config.js eslint.config.cjs eslint.config.ts; do
  if [ -f "$ROOT/$name" ]; then CONFIG="$ROOT/$name"; break; fi
done

# ── materialização ──────────────────────────────────────────────────────────────────────────
# Só escreve eslint.config.mjs quando NENHUM eslint.config.* existe. Um config de extensão
# diferente já presente nunca é sobrescrito, nem com --force: o ESLint reprova com "multiple
# configuration files found" se os dois coexistirem, e forçar a escrita produziria exatamente
# esse estado quebrado. Nesse caso a orientação é sempre wiring manual.
if [ "$MODE" = "apply" ]; then
  say "INFO mode:apply ($FLAVOR → no-direct-console ${CONSOLE_SEVERITY})"
  if [ -n "$CONFIG" ] && [ "$(basename "$CONFIG")" != "eslint.config.mjs" ]; then
    say "INFO keep:$(basename "$CONFIG") (config de outra extensão já existe; --force não se aplica — cablear forge-quality/* manualmente, ver $ASSETS/eslint.config.mjs)"
  elif [ -f "$ROOT/eslint.config.mjs" ] && [ "$FORCE" != "1" ]; then
    say "INFO keep:eslint.config.mjs (já existe; use --force para substituir)"
  else
    sed "s|\"forge-quality/no-direct-console\": \"warn\"|\"forge-quality/no-direct-console\": \"${CONSOLE_SEVERITY}\"|" \
      "$ASSETS/eslint.config.mjs" > "$ROOT/eslint.config.mjs" \
      || { bad "FAIL write:eslint.config.mjs"; }
    [ "$RC" = "0" ] && say "OK write:eslint.config.mjs"
    CONFIG="$ROOT/eslint.config.mjs"
  fi
fi

# ── check: eslint.config.* e as propriedades load-bearing ───────────────────────────────────
if [ -z "$CONFIG" ]; then
  for name in eslint.config.mjs eslint.config.js eslint.config.cjs eslint.config.ts; do
    if [ -f "$ROOT/$name" ]; then CONFIG="$ROOT/$name"; break; fi
  done
fi

if [ -z "$CONFIG" ]; then
  bad "MISS eslint.config.mjs (ausente na raiz — sem ele nenhuma regra forge-quality entra no lint)"
else
  say "OK $(basename "$CONFIG"):present"

  if grep -q 'eslint-rules/index\.cjs' "$CONFIG" && grep -q 'forge-quality' "$CONFIG"; then
    say "OK $(basename "$CONFIG"):forge-quality (plugin vendorizado referenciado)"
  else
    bad "FAIL $(basename "$CONFIG"):forge-quality (config presente mas não referencia .../eslint-rules/index.cjs sob a chave forge-quality — as regras vendorizadas não entram no lint)"
  fi

  console_line="$(grep -oE '"forge-quality/no-direct-console"[[:space:]]*:[[:space:]]*"[a-z]+"' "$CONFIG" | head -1)"
  if [ -z "$console_line" ]; then
    bad "FAIL $(basename "$CONFIG"):no-direct-console (regra ausente — console.* direto em produção não é pego em lugar nenhum)"
  elif grep -qE '"off"' <<<"$console_line"; then
    bad "FAIL $(basename "$CONFIG"):no-direct-console (severidade off — regra presente mas desligada)"
  else
    say "OK $(basename "$CONFIG"):no-direct-console ($console_line)"
  fi

  # A armadilha: max-lines em "error" contraria a decisão registrada do harness. Ausente é só
  # informativo (o sinal de tamanho é opcional); presente e "error" é reprovação de verdade.
  maxlines_line="$(grep -oE '"forge-quality/max-lines"[[:space:]]*:[[:space:]]*(\[[[:space:]]*)?"[a-z]+"' "$CONFIG" | head -1)"
  if [ -z "$maxlines_line" ]; then
    say "INFO $(basename "$CONFIG"):max-lines (não configurado — sinal de tamanho de arquivo é opcional)"
  elif grep -qE '"error"' <<<"$maxlines_line"; then
    bad "FAIL $(basename "$CONFIG"):max-lines (severidade error — decisão do harness (ledger LDG-0061/LDG-0130, rules/conventions/code-style.md) é NÃO bloquear por tamanho de arquivo; use \"warn\")"
  else
    say "OK $(basename "$CONFIG"):max-lines ($maxlines_line — sinal não bloqueante, como decidido)"
  fi

  if grep -q '"forge-quality/no-direct-data-access"' "$CONFIG"; then
    say "OK $(basename "$CONFIG"):no-direct-data-access (configurado)"
  else
    say "INFO $(basename "$CONFIG"):no-direct-data-access (não configurado — preencha modules/layers se este projeto acessa banco diretamente da camada de apresentação)"
  fi
fi

# ── parser TypeScript: pré-requisito do projeto, não deste baseline (informativo) ───────────
ts_count="$(find "$ROOT" \( -name node_modules -o -name dist -o -name build -o -name .next -o -name .git \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print 2>/dev/null | wc -l | tr -d ' ')"
if [ "$ts_count" != "0" ]; then
  # Só olha package.json: o próprio eslint.config.mjs que materializamos CITA
  # "typescript-eslint" em comentário explicativo, e checar o config daria falso positivo
  # permanente (o comentário nosso "detectando" a si mesmo).
  has_ts_parser=0
  [ -f "$ROOT/package.json" ] && grep -q 'typescript-eslint\|@typescript-eslint/parser' "$ROOT/package.json" 2>/dev/null && has_ts_parser=1
  if [ "$has_ts_parser" = "1" ]; then
    say "OK typescript:parser (typescript-eslint detectado)"
  else
    say "WARN typescript:parser (${ts_count} arquivo(s) .ts/.tsx sem sinal de typescript-eslint/@typescript-eslint/parser — o espree padrão não parseia sintaxe TS, e as regras forge-quality/* dependem do arquivo já ter sido parseado)"
  fi
fi

if [ "$RC" = "0" ]; then
  say "PASS node-baseline ($FLAVOR)"
elif [ "$INCOMPLETE" = "1" ] && [ "$ABSENT" = "1" ]; then
  say "FAIL node-baseline: falta arquivo E há configuração incompleta — 'bash .forge/scripts/node-baseline.sh --apply' cria o que está ausente; os FAIL acima são de arquivo que já existe e precisa ser corrigido à mão (o script não sobrescreve decisão do projeto)"
elif [ "$INCOMPLETE" = "1" ]; then
  say "FAIL node-baseline: a configuração existe e está incompleta — corrija os itens acima em $ROOT (modelo de referência em $ASSETS/eslint.config.mjs)"
else
  say "FAIL node-baseline: baseline de lint ausente — rode 'bash .forge/scripts/node-baseline.sh --apply'"
fi
exit "$RC"
