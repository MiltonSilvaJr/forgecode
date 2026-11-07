#!/usr/bin/env bash
# data-agent-bash-guard.sh — hook PreToolUse (matcher "Bash") declarado no frontmatter dos seis especialistas de dados.
#
# Por que existe: os especialistas são consultivos (sem Write, Edit nem Agent), mas precisam de Bash para os dois
# comandos de leitura do protocolo — o scan.sh da skill e o check-data-governance.sh. Com Bash livre a premissa "uma
# árvore, um escritor" seria falsa: `>`, `sed -i` e `git commit` escrevem na árvore. Este guarda deixa passar só os
# dois comandos, com argumentos num alfabeto restrito, e nega todo o resto (REQ-10 e D-13 do change
# data-engineer-agent).
#
# Aceita exatamente:
#   bash .forge/skills/data-<domínio>-practices/scripts/scan.sh [--root <caminho>]... [--max <n>]   (sem --json)
#   bash .forge/scripts/check-data-governance.sh --path <caminho>...
# com todo o comando no alfabeto [A-Za-z0-9._/=-] mais espaço, caminhos que não começam com "-" e --max numérico.
# Nega com exit 2 qualquer outro comando, inclusive redirecionamento, `;`, `&&`, `||`, `|`, `$(`, crase, aspas,
# `sed -i`, `git`, `rm` e `tee`. Fail-closed como o allowlist: JSON malformado, campo ausente e falta de node saem 2,
# e o comando no frontmatter termina em `|| exit 2`. Leitura de arquivo é pelas ferramentas Read, Grep e Glob.
# Sinal positivo: grava "data-agent-bash-guard: <comando>" na saída de erro em toda decisão.
set -u

ALFABETO='A-Za-z0-9._/=-'
SCANS="data-relational data-nosql data-cache data-object-storage data-analytical data-streaming"

nega() { echo "data-agent-bash-guard: negado — $1 (o especialista só roda o scan.sh da skill e o check-data-governance.sh)" >&2; exit 2; }

command -v node >/dev/null 2>&1 || nega "node ausente; sem ler o JSON do hook não há como decidir (fail-closed)"

entrada="$(cat)"
cmd="$(printf '%s' "$entrada" | node -e '
  let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
    let j; try { j = JSON.parse(d); } catch { process.exit(3); }
    const c = j && j.tool_input && j.tool_input.command;
    if (typeof c !== "string" || c === "") process.exit(4);
    process.stdout.write(c + "#");
  });' 2>/dev/null)"
case $? in
  0) ;;
  3) nega "JSON do hook malformado" ;;
  *) nega "tool_input.command ausente ou vazio" ;;
esac

# O node grava um "#" depois do valor e ele sai aqui: a substituição de comando do shell apaga quebras de linha finais,
# e sem o sentinela um valor com "\n" no fim seria comparado já normalizado (achado do PBT do w250 [20]).
cmd="${cmd%#}"

echo "data-agent-bash-guard: $cmd" >&2

re="^[ ${ALFABETO}]+\$"
[[ "$cmd" =~ $re ]] || nega "comando com caractere fora do alfabeto [${ALFABETO}] e espaço: '$cmd'"

read -r -a tok <<< "$cmd"
[ "${#tok[@]}" -ge 2 ] || nega "comando incompleto: '$cmd'"
[ "${tok[0]}" = "bash" ] || nega "só 'bash <script do protocolo>' é aceito: '$cmd'"

alvo="${tok[1]}"
eh_scan=0
for e in $SCANS; do
  [ "$alvo" = ".forge/skills/$e-practices/scripts/scan.sh" ] && eh_scan=1
done

if [ "$eh_scan" -eq 1 ]; then
  i=2
  while [ "$i" -lt "${#tok[@]}" ]; do
    flag="${tok[$i]}"
    [ $((i + 1)) -lt "${#tok[@]}" ] || nega "opção '$flag' sem valor: '$cmd'"
    val="${tok[$((i + 1))]}"
    case "$flag" in
      --root) case "$val" in -*) nega "--root com valor que parece opção: '$cmd'" ;; esac ;;
      --max) case "$val" in ''|*[!0-9]*) nega "--max não numérico: '$cmd'" ;; esac ;;
      *) nega "opção '$flag' não aceita (só --root e --max; --json escreve arquivo): '$cmd'" ;;
    esac
    i=$((i + 2))
  done
  exit 0
fi

if [ "$alvo" = ".forge/scripts/check-data-governance.sh" ]; then
  [ "${#tok[@]}" -ge 4 ] && [ "${tok[2]}" = "--path" ] || nega "check-data-governance.sh só com '--path <caminho>...': '$cmd'"
  i=3
  while [ "$i" -lt "${#tok[@]}" ]; do
    case "${tok[$i]}" in -*) nega "argumento que parece opção depois de --path: '$cmd'" ;; esac
    i=$((i + 1))
  done
  exit 0
fi

nega "script fora dos dois comandos do protocolo: '$cmd'"
