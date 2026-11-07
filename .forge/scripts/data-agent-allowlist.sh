#!/usr/bin/env bash
# data-agent-allowlist.sh — hook PreToolUse (matcher "Agent|Task") declarado no frontmatter do agente data-engineer.
#
# Por que existe: a lista entre parênteses de `tools: Agent(a, b)` só restringe quando o agente roda como thread
# principal (`claude --agent data-engineer`); como subagente — o caminho principal, pela descrição ou por
# `@data-engineer` — a lista é ignorada e ele poderia criar qualquer tipo, inclusive um agente com Write. Hook de
# frontmatter vale nos dois modos e só enquanto o orquestrador está ativo, então é aqui que a restrição é efetiva
# (REQ-10 do change data-engineer-agent).
#
# Contrato: lê o JSON do hook na entrada padrão; aceita (exit 0) só tool_input.subagent_type entre os seis
# especialistas de dados; nega (exit 2, motivo na saída de erro nomeando o tipo) qualquer outro. Fail-closed: JSON
# malformado, campo ausente ou vazio e falta de node também saem 2. No Claude Code só o exit 2 bloqueia a ferramenta;
# por isso o comando no frontmatter termina em `|| exit 2`, que fecha o canal também quando este script falta (o
# `bash` sairia 127, que o Claude Code trataria como erro não bloqueante e deixaria o Agent passar).
# Sinal positivo: grava "data-agent-allowlist: <tipo>" na saída de erro em toda decisão, para a prova pelo canal.
set -u

ACEITOS="data-relational data-nosql data-cache data-object-storage data-analytical data-streaming"

if ! command -v node >/dev/null 2>&1; then
  echo "data-agent-allowlist: negado — node ausente; sem ler o JSON do hook não há como decidir (fail-closed)" >&2
  exit 2
fi

entrada="$(cat)"
tipo="$(printf '%s' "$entrada" | node -e '
  let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
    let j; try { j = JSON.parse(d); } catch { process.exit(3); }
    const t = j && j.tool_input && j.tool_input.subagent_type;
    if (typeof t !== "string" || t === "") process.exit(4);
    process.stdout.write(t + "#");
  });' 2>/dev/null)"
case $? in
  0) ;;
  3) echo "data-agent-allowlist: negado — JSON do hook malformado (fail-closed)" >&2; exit 2 ;;
  *) echo "data-agent-allowlist: negado — tool_input.subagent_type ausente ou vazio (fail-closed)" >&2; exit 2 ;;
esac

# O node grava um "#" depois do valor e ele sai aqui: a substituição de comando do shell apaga quebras de linha finais,
# e sem o sentinela um valor com "\n" no fim seria comparado já normalizado (achado do PBT do w250 [20]).
tipo="${tipo%#}"

echo "data-agent-allowlist: $tipo" >&2
for aceito in $ACEITOS; do
  [ "$tipo" = "$aceito" ] && exit 0
done
echo "data-agent-allowlist: negado — '$tipo' não é especialista de dados; o data-engineer só aciona: $ACEITOS" >&2
exit 2
