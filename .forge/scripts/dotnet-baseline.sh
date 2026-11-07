#!/usr/bin/env bash
# dotnet-baseline.sh — audita (e materializa) a camada de enforcement de build da stack .NET.
#
# Por que este script existe: todo o conhecimento .NET do harness vivia em prosa — agents,
# reviewers, capability pack. Prosa em contexto longo degrada; regra convertida em erro de
# compilação não. Este script cobre os três arquivos que fazem essa conversão:
#
#   Directory.Build.props   TreatWarningsAsErrors + AnalysisMode + EnforceCodeStyleInBuild
#   .editorconfig           severidade POR ID de regra (a armadilha do IDE1006, abaixo)
#   Directory.Packages.props  Central Package Management (ponto único de versão)
#
# A armadilha do IDE1006: severidade declarada dentro de `dotnet_naming_rule.<x>.severity` é
# respeitada apenas por IDEs. Em build ela é ignorada — o squiggle aparece no editor, o CI passa
# verde, e o enforcement de nomenclatura simplesmente não existe. Quem o liga em build é
# `dotnet_diagnostic.IDE1006.severity` junto de `EnforceCodeStyleInBuild`.
#
# Uso:
#   dotnet-baseline.sh [--root <dir>] [--check]           # default; não escreve nada
#   dotnet-baseline.sh [--root <dir>] --apply [--force]   # materializa o que falta
#
# Saída: uma linha por check, no padrão do gate-runner (OK / MISS / FAIL / WARN / INFO).
# Exit: 0 quando tudo que é load-bearing está no lugar; 1 quando falta ou diverge; 2 em erro de uso.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="$SELF/../capabilities/backend-dotnet-relational/assets"

ROOT="."
MODE="check"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --check) MODE="check"; shift ;;
    --apply) MODE="apply"; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '1,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "FAIL uso: argumento desconhecido '$1'" >&2; exit 2 ;;
  esac
done

[ -d "$ROOT" ] || { echo "FAIL root inexistente: $ROOT" >&2; exit 2; }
ROOT="$(cd "$ROOT" && pwd)"
[ -d "$ASSETS" ] || { echo "FAIL assets do pack ausentes: $ASSETS" >&2; exit 2; }

RC=0
ABSENT=0     # arquivo do baseline que não existe → --apply resolve
INCOMPLETE=0 # arquivo que existe e está incompleto → --apply NÃO resolve (não sobrescreve)
say()  { echo "$*"; }
bad()  { echo "$*"; RC=1; case "$1" in MISS*) ABSENT=1 ;; *) INCOMPLETE=1 ;; esac; }

# ── é um repositório .NET? ──────────────────────────────────────────────────────────────────
# Sem projeto .NET não há o que cobrar: o script é no-op silencioso, e não um falso negativo.
proj_count="$(find "$ROOT" \( -name obj -o -name bin -o -name node_modules -o -name .git \) -prune -o \
  \( -name '*.csproj' -o -name '*.sln' -o -name '*.slnx' \) -print 2>/dev/null | wc -l | tr -d ' ')"
if [ "$proj_count" = "0" ]; then
  say "INFO dotnet:none (nenhum .csproj/.sln em $ROOT — nada a auditar)"
  exit 0
fi

# ── greenfield × brownfield decide o AnalysisMode ───────────────────────────────────────────
# `All` numa base existente produz centenas de erros no primeiro build e a adoção morre ali.
# `Recommended` é o degrau realista; subir depois é decisão do projeto, registrada em ADR.
cs_count="$(find "$ROOT" \( -name obj -o -name bin -o -name node_modules -o -name .git \) -prune -o \
  -name '*.cs' -print 2>/dev/null | wc -l | tr -d ' ')"
if [ "$cs_count" = "0" ]; then
  ANALYSIS_MODE="All"; FLAVOR="greenfield"
else
  ANALYSIS_MODE="Recommended"; FLAVOR="brownfield (${cs_count} arquivos .cs)"
fi

# ── materialização ──────────────────────────────────────────────────────────────────────────
# Nunca sobrescreve um arquivo do projeto sem --force: a configuração existente é decisão de
# quem mantém o repositório, e o check já a cobra item a item.
materialize() {
  local src="$1" dst="$2"
  if [ -f "$dst" ] && [ "$FORCE" != "1" ]; then
    say "INFO keep:$(basename "$dst") (já existe; use --force para substituir)"
    return 0
  fi
  sed "s|<AnalysisMode>Recommended</AnalysisMode>|<AnalysisMode>${ANALYSIS_MODE}</AnalysisMode>|" "$src" > "$dst" \
    || { bad "FAIL write:$(basename "$dst")"; return 1; }
  say "OK write:$(basename "$dst")"
}

if [ "$MODE" = "apply" ]; then
  say "INFO mode:apply ($FLAVOR → AnalysisMode ${ANALYSIS_MODE})"
  materialize "$ASSETS/Directory.Build.props"    "$ROOT/Directory.Build.props"
  materialize "$ASSETS/Directory.Packages.props" "$ROOT/Directory.Packages.props"
  materialize "$ASSETS/editorconfig"             "$ROOT/.editorconfig"
fi

# ── check 1: Directory.Build.props e as propriedades load-bearing ───────────────────────────
BP="$ROOT/Directory.Build.props"
if [ ! -f "$BP" ]; then
  bad "MISS Directory.Build.props (ausente na raiz — sem ele nenhuma regra vira erro de build)"
else
  say "OK Directory.Build.props:present"
  for prop in Nullable AnalysisLevel AnalysisMode TreatWarningsAsErrors EnforceCodeStyleInBuild; do
    if grep -q "<$prop>" "$BP"; then
      say "OK Directory.Build.props:$prop"
    else
      bad "FAIL Directory.Build.props:$prop (propriedade ausente)"
    fi
  done
  if grep -qE '<TreatWarningsAsErrors>\s*false' "$BP"; then
    bad "FAIL Directory.Build.props:TreatWarningsAsErrors (declarado como false — o warning volta a ser ignorável)"
  fi
  # Um <NoWarn> largo na raiz desliga em silêncio o que o resto do arquivo acabou de ligar.
  nowarn="$(grep -oE '<NoWarn>[^<]*</NoWarn>' "$BP" | head -1)"
  if [ -n "$nowarn" ]; then
    say "WARN Directory.Build.props:NoWarn ($nowarn — confira o que está sendo silenciado na raiz)"
  fi
fi

# ── check 2: .editorconfig e a armadilha de severidade ──────────────────────────────────────
EC="$ROOT/.editorconfig"
if [ ! -f "$EC" ]; then
  bad "MISS .editorconfig (ausente na raiz — estilo e nomenclatura sem contrato verificável)"
else
  say "OK .editorconfig:present"
  has_naming_rule=0
  grep -qE '^\s*dotnet_naming_rule\.[A-Za-z0-9_]+\.severity' "$EC" && has_naming_rule=1
  if grep -qE '^\s*dotnet_diagnostic\.IDE1006\.severity\s*=\s*(warning|error)' "$EC"; then
    say "OK .editorconfig:IDE1006 (nomenclatura vale em build)"
  elif [ "$has_naming_rule" = "1" ]; then
    bad "FAIL .editorconfig:IDE1006 (há dotnet_naming_rule com severity, mas sem dotnet_diagnostic.IDE1006.severity: a severidade dentro da regra vale só na IDE, e o build ignora toda a nomenclatura)"
  else
    bad "FAIL .editorconfig:IDE1006 (dotnet_diagnostic.IDE1006.severity ausente — nomenclatura não é verificada em build)"
  fi
  if grep -qE '^\s*dotnet_diagnostic\.CS86[0-9]{2}\.severity\s*=\s*error' "$EC"; then
    say "OK .editorconfig:nullability (diagnósticos CS86xx em error)"
  else
    say "WARN .editorconfig:nullability (nenhum CS86xx elevado a error — nulidade fica em warning)"
  fi
fi

# ── check 3: Central Package Management ─────────────────────────────────────────────────────
PP="$ROOT/Directory.Packages.props"
if [ ! -f "$PP" ]; then
  bad "MISS Directory.Packages.props (ausente na raiz — versão de pacote sem ponto único, divergência silenciosa entre projetos)"
else
  say "OK Directory.Packages.props:present"
  if grep -qE '<ManagePackageVersionsCentrally>\s*true' "$PP"; then
    say "OK Directory.Packages.props:CPM"
    # Com CPM ligado, Version= no projeto é erro de restore (NU1008). Antecipar aqui evita
    # que a adoção do baseline quebre o build de quem só rodou o apply.
    offenders="$(find "$ROOT" \( -name obj -o -name bin -o -name node_modules -o -name .git \) -prune -o \
      -name '*.csproj' -print 2>/dev/null | while read -r f; do
        grep -HnE '<PackageReference[^>]*\sVersion\s*=' "$f" 2>/dev/null
      done | head -10)"
    if [ -n "$offenders" ]; then
      bad "FAIL Directory.Packages.props:CPM (PackageReference com Version= sob CPM — NU1008 no restore):"
      echo "$offenders" | sed 's|^|     |'
    else
      say "OK Directory.Packages.props:no-inline-version"
    fi
    if grep -qE 'Version\s*=\s*"[^"]*(\*|latest)' "$PP"; then
      bad "FAIL Directory.Packages.props:floating (versão flutuante quebra build reprodutível)"
    fi
  else
    bad "FAIL Directory.Packages.props:CPM (ManagePackageVersionsCentrally não está true)"
  fi
fi

# ── check 4: analisadores de terceiros (informativo) ────────────────────────────────────────
# O conjunto embutido do .NET não cobre o que Meziantou/Sonar/Roslynator cobrem, mas exigi-los é
# decisão do projeto — aqui é sinal, não portão.
found_analyzers=""
for a in Meziantou.Analyzer SonarAnalyzer.CSharp Roslynator.Analyzers; do
  if [ -f "$BP" ] && grep -q "$a" "$BP"; then found_analyzers="$found_analyzers $a"; fi
done
if [ -n "$found_analyzers" ]; then
  say "OK analyzers:third-party ($(echo "$found_analyzers" | sed 's/^ //'))"
else
  say "INFO analyzers:third-party (nenhum declarado — considere Meziantou/Sonar/Roslynator com IncludeAssets)"
fi

if [ "$RC" = "0" ]; then
  say "PASS dotnet-baseline ($FLAVOR)"
elif [ "$INCOMPLETE" = "1" ] && [ "$ABSENT" = "1" ]; then
  say "FAIL dotnet-baseline: falta arquivo E há configuração incompleta — 'bash .forge/scripts/dotnet-baseline.sh --apply' cria o que está ausente; os FAIL acima são de arquivos que já existem e precisam ser corrigidos à mão (o script não sobrescreve decisão do projeto)"
elif [ "$INCOMPLETE" = "1" ]; then
  # --apply não ajudaria: ele pula todo arquivo existente, e mandar rodá-lo aqui produziria a
  # experiência de rodar o comando sugerido e ver o mesmo erro de novo.
  say "FAIL dotnet-baseline: a configuração existe e está incompleta — corrija os itens acima em $ROOT (modelos de referência em .forge/capabilities/backend-dotnet-relational/assets/)"
else
  say "FAIL dotnet-baseline: baseline de build ausente — rode 'bash .forge/scripts/dotnet-baseline.sh --apply'"
fi
exit "$RC"
