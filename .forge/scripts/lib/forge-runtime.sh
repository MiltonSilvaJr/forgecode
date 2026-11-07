#!/usr/bin/env bash
# lib/forge-runtime.sh — leitura e execução dos checks declarados no bloco `runtime:` do FORGE.md.
# Sourceável (não executável por si). Fonte ÚNICA de duas coisas que existiam em cópia única e
# inacessível dentro do spec-verify.sh:
#
#   forge_get_runtime <key>          → valor escalar de "  <key>:" dentro do bloco runtime:
#   forge_run_gate <name> <cmd> <log>→ executa um check com teto de tempo; rc do check
#   forge_runtime_gates              → lista (uma por linha) os nomes declarados em runtime.gates
#
# POR QUE EXTRAIR: `commands/waves/wave.md` manda rodar `bash .forge/scripts/run-gates.sh` e
# passar o resultado ao `wave-ops.sh close --gate`. Esse script NUNCA EXISTIU — a doc invocava um
# arquivo ausente, então na prática o veredito da wave vinha do chamador, e a skill wave-advance
# chegava a passar `--gate OK` literal. Um executor que só existe dentro de um script que a wave
# não chama é um executor que a wave não tem; daí a extração, em vez de uma segunda cópia.
#
# `runtime.gates` é CSV escalar de NOMES DE SCRIPT (`check-authz,check-observability`), nunca
# comando shell livre nem block-sequence — forge_get_runtime só lê "key: value" de uma linha.
# Cada nome resolve para `.forge/scripts/<nome>.sh`, invocado com o change-id.

FORGE_GATE_TIMEOUT_S="${FORGE_GATE_TIMEOUT_S:-300}"

forge_get_runtime() { # forge_get_runtime <key> [root]
  local key="$1" root="${2:-${FORGE_ROOT:-.}}"
  [ -f "$root/.forge/FORGE.md" ] || return 0
  awk -v key="$key" '
    /^runtime:/ { inb=1; next }
    inb && /^[^ ]/ { inb=0 }
    inb { sub(/^  /, ""); if (index($0, key ":") == 1) { sub(key ":", ""); gsub(/^ +| +$/, ""); print; exit } }
  ' "$root/.forge/FORGE.md"
}

# Nomes declarados em runtime.gates, um por linha. Ausência ⇒ saída vazia (no-op retrocompatível).
forge_runtime_gates() { # forge_runtime_gates [root]
  local csv; csv="$(forge_get_runtime gates "${1:-${FORGE_ROOT:-.}}" || true)"
  [ -n "$csv" ] || return 0
  local g
  IFS=',' read -ra _fg <<< "$csv"
  for g in "${_fg[@]}"; do
    g="$(printf '%s' "$g" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -n "$g" ] && printf '%s\n' "$g"
  done
  return 0
}

# Teto de tempo explícito por check — um gate que pendura é um gate que ninguém espera, e o
# watchdog do executor mata a sessão inteira em vez de reprovar o check.
forge_run_gate() { # forge_run_gate <name> <command> <logfile> [root]
  local name="$1" cmd="$2" log="$3" root="${4:-${FORGE_ROOT:-.}}"
  perl -e "alarm $FORGE_GATE_TIMEOUT_S; exec @ARGV" -- bash -c "cd '$root' && $cmd" >"$log" 2>&1
}

# ── issue #82 — runtime.gates com FASE ────────────────────────────────────────────────────
# O contrato de gate do harness é inteiramente em forma de árvore de fontes: todo gate lê
# arquivos do repositório, runtime.gates é lista plana executada no fechamento da wave, hooks
# rodam no commit/push — os três momentos em que o artefato implantável ainda não existe. Isso
# não deixa onde declarar um gate que só faz sentido depois do build/deploy (digest publicado,
# manifesto renderizado, cluster no ar). Cada entrada de runtime.gates passa a ter uma FASE.
#
# forge_runtime_gates() ACIMA fica INTOCADA — retrocompat literal, não só de intenção: quem já
# chamava essa função continua recebendo exatamente a mesma lista, pela mesma leitura CSV.
#
# forge_runtime_gate_entries [root] → "name<TAB>phase" por linha, para QUALQUER forma declarada:
#   - CSV escalar numa linha (`gates: check-a,check-b`) — lida aqui mesmo, em bash puro, ZERO
#     dependência nova; cada nome tem phase "source" implícita (idêntico ao comportamento
#     sempre existente, só agora também rotulado).
#   - block-sequence YAML (`gates:` vazio seguido de `- check-x` / `- name: ... [phase: ...]`)
#     — exige um parser YAML de verdade; delegada a gate-phase.mjs, que reaproveita o parser
#     único do subset YAML do harness (lib/yaml-lite.mjs) em vez de uma cópia bespoke em awk.
#     Node já é dependência dura do harness (é pacote npm consumido via /forge:init) — isto não
#     introduz dependência nova para quem já roda o harness, só exercita um caminho que outros
#     scripts (validate-spec.sh, archive-spec.sh) já exercitam. Ausência de node ⇒ a forma
#     mapeada simplesmente não é lida (mesmo efeito de "gates:" ausente) — nunca trava o script.
forge_runtime_gate_entries() { # forge_runtime_gate_entries [root]
  local root="${1:-${FORGE_ROOT:-.}}"
  local csv; csv="$(forge_get_runtime gates "$root" || true)"
  if [ -n "$csv" ]; then
    local g
    IFS=',' read -ra _fge <<< "$csv"
    for g in "${_fge[@]}"; do
      g="$(printf '%s' "$g" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
      [ -n "$g" ] && printf '%s\tsource\n' "$g"
    done
    return 0
  fi
  local script_dir; script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if command -v node >/dev/null 2>&1 && [ -f "$script_dir/gate-phase.mjs" ]; then
    node "$script_dir/gate-phase.mjs" entries "$root" 2>/dev/null || true
  fi
}

# Nomes declarados para UMA fase (default: source) — filtro de forge_runtime_gate_entries.
# run-gates.sh (--phase) é o consumidor real; qualquer outro script pode adotar o mesmo seletor.
forge_runtime_gates_phase() { # forge_runtime_gates_phase [phase] [root]
  local phase="${1:-source}" root="${2:-${FORGE_ROOT:-.}}"
  forge_runtime_gate_entries "$root" | awk -F'\t' -v p="$phase" '$2==p{print $1}'
}
