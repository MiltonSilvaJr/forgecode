#!/usr/bin/env bash
# lib/gate-universe.sh — contador de controle de universo, em bash (issue #49).
#
# Todo gate que ITERA sobre um universo — arquivos, commits, changes, refs — tem de dizer quantos
# itens examinou, e o universo VAZIO tem de ser um estado próprio. Sem isso o caminho de "não
# examinei" e o caminho de "examinei e estava limpo" terminam no mesmo `exit 0` e imprimem a mesma
# linha: quem lê o log não distingue cobertura de ausência de cobertura, e o placar fica verde nos
# dois casos. Foi assim que o gate de red-first aprovou o push de um bugfix imprimindo
# `OK — 0 change(s) examinado(s)`.
#
# Três estados observáveis, nunca dois:
#
#   OK   <gate>/universo — N <item>(ns) examinado(s) (<escopo>)
#   FAIL <gate>/universo-vazio — 0 <item>(ns) examinado(s) (<escopo>)          ← default
#   OK   <gate>/universo-vazio — 0 ... ; justificativa declarada: <motivo>
#
# O terceiro estado NÃO é operado por memória de agente nem por flag de quem invoca: a
# justificativa mora em `.forge/empty-universe-allowlist.txt`, versionada e revisável, no mesmo
# formato da allowlist de segredos — `<gate-key>  # motivo: <justificativa auditável>`. Entrada
# sem `# motivo:` é isenção anônima e REPROVA por integridade: é exatamente por aí que um gate é
# esvaziado na prática.
#
# Uso (sourced):
#   . "$SCRIPT_DIR/lib/gate-universe.sh"
#   forge_universe_check <gate-key> <count> <item-label> <escopo> [root]
# Ecoa a linha do estado (stdout no OK, stderr no FAIL) e devolve 0/1.

# Localiza a justificativa declarada para <gate-key>.
# stdout: "OK<TAB><motivo>" quando declarada com motivo; "ERR<TAB><linha>" quando declarada sem
# motivo; vazio quando não declarada. rc sempre 0 — quem decide é o chamador.
forge_universe_waiver() { # forge_universe_waiver <root> <gate-key>
  local root="$1" key="$2" file
  file="${FORGE_EMPTY_UNIVERSE_ALLOWLIST:-$root/.forge/empty-universe-allowlist.txt}"
  [ -f "$file" ] || return 0
  awk -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      k = $0
      sub(/[[:space:]]*#.*$/, "", k)
      gsub(/^[[:space:]]+/, "", k); gsub(/[[:space:]]+$/, "", k)
      if (k != key) next
      if ($0 ~ /#[[:space:]]*motivo:[[:space:]]*[^[:space:]]/) {
        m = $0; sub(/^.*#[[:space:]]*motivo:[[:space:]]*/, "", m)
        printf "OK\t%s\n", m
      } else {
        printf "ERR\t%d\n", NR
      }
      exit
    }
  ' "$file"
}

forge_universe_check() { # forge_universe_check <gate-key> <count> <item-label> <escopo> [root]
  local key="$1" count="${2:-0}" item="$3" scope="$4" root="${5:-${FORGE_ROOT:-.}}"
  local waiver tab file
  tab="$(printf '\t')"
  file="${FORGE_EMPTY_UNIVERSE_ALLOWLIST:-$root/.forge/empty-universe-allowlist.txt}"

  case "$count" in ''|*[!0-9]*) count=0 ;; esac

  if [ "$count" -gt 0 ]; then
    echo "OK $key/universo — $count $item examinado(s) ($scope)"
    return 0
  fi

  waiver="$(forge_universe_waiver "$root" "$key")"
  case "$waiver" in
    OK"$tab"*)
      echo "OK $key/universo-vazio — 0 $item examinado(s) ($scope); justificativa declarada: ${waiver#OK$tab}"
      return 0
      ;;
    ERR"$tab"*)
      echo "FAIL $key/universo-vazio — isenção de '$key' em $file (linha ${waiver#ERR$tab}) sem '# motivo:'." >&2
      echo "      Isenção anônima é como um gate é esvaziado — declare '<gate>  # motivo: <justificativa>'." >&2
      return 1
      ;;
  esac

  echo "FAIL $key/universo-vazio — 0 $item examinado(s) ($scope): o gate não examinou nada." >&2
  echo "      Universo vazio não é ausência de violação, é ausência de verificação — os dois não" >&2
  echo "      podem colapsar no mesmo verde. Confira o alvo, o glob e o range." >&2
  echo "      Se o vazio for legítimo, declare em $file: '$key  # motivo: <justificativa>'." >&2
  return 1
}
