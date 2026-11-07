#!/usr/bin/env bash
# lib/scan-exclude.sh — diretórios que NENHUM gate deve varrer (issue #76).
#
# O `update` passou a criar o backup em `.git/forge-backups/`, fora da árvore, o que resolve a
# classe na origem. Esta lista cobre o resíduo: todo consumidor que já rodou uma versão anterior
# tem um `.forge.bak-N` dentro do repositório, e enquanto ele existir os gates que varrem por
# caminho varrem também a CÓPIA — e reprovam por conteúdo que é duplicata deles mesmos.
#
# Medido em consumidor real: `check-data-governance.sh --path .` acusava conflito de RLS; movendo
# só o backup para fora, no mesmo commit, passava. O pior caso é o `check-secrets.sh`, onde um
# segredo já corrigido no original continua presente na cópia e reprova para sempre.
#
# Uso:
#   . "$SCRIPT_DIR/lib/scan-exclude.sh"
#   prune=(); forge_find_prune_args prune
#   find "$root" "${prune[@]}" -type f ...            # bash 3.2: array, nunca eval do find
#   forge_scan_skip "$caminho" && continue            # para laços que já têm a lista
FORGE_SCAN_EXCLUDE="${FORGE_SCAN_EXCLUDE:-.git node_modules .forge.bak-* dist build out obj coverage vendor}"

# forge_find_prune_args <nome-do-array> — preenche <nome-do-array> com a cláusula de poda para
# `find` (\( -name PAT -o -name PAT ... \) -prune -o), SEM -false.
#
# Substitui o antigo forge_find_prune (removido, nunca teve chamador), que ecoava a cláusula como
# STRING para uso com `eval` e tinha três defeitos: (1) as aspas simples em torno de cada padrão
# são echoadas como caracteres literais — `eval` nunca as interpreta como delimitador de shell,
# então "$pat" com espaço ou glob quebra o casamento; (2) `(` e `)` sem escape são metacaracteres
# de shell — `eval` tenta abrir um subshell e falha com erro de sintaxe antes mesmo do `find`
# rodar (reproduzido: "syntax error near unexpected token `('"); (3) o `-false` colado ao ÚLTIMO
# padrão da lista o transforma em `-name 'vendor' -false`, que NUNCA casa — `vendor` sai da
# exclusão silenciosamente e continua sendo varrido.
#
# Array em vez de string elimina (1) e (2): cada elemento é um argv literal, nunca reinterpretado
# por um shell. bash 3.2 (macOS) não tem nameref (`local -n`), então a atribuição ao array do
# CHAMADOR é feita por cópia via `eval` de um array temporário local — não do `find` em si, e sem
# interpolar o CONTEÚDO dos padrões na string do eval (só o nome do array de saída).
forge_find_prune_args() {
  local __out="$1" pat _tmp=()
  for pat in $FORGE_SCAN_EXCLUDE; do
    if [ ${#_tmp[@]} -eq 0 ]; then
      _tmp+=('(')
    else
      _tmp+=('-o')
    fi
    _tmp+=('-name' "$pat")
  done
  if [ ${#_tmp[@]} -gt 0 ]; then
    _tmp+=(')' '-prune' '-o')
  fi
  eval "$__out=(\"\${_tmp[@]}\")"
}

forge_scan_skip() {  # forge_scan_skip <caminho> — 0 quando o caminho deve ser PULADO
  # `case` sobre o caminho INTEIRO, sem mexer em IFS. A versão anterior fatiava o caminho com
  # IFS='/' e, no laço de dentro, a MESMA variável fatiava a lista de padrões — que é separada por
  # espaço. Resultado medido: nada casava, e a função devolvia "varre" para tudo, inclusive para o
  # `.forge.bak-1` que ela existe para excluir. Uma exclusão que nunca exclui é pior que nenhuma,
  # porque parece proteção.
  local p="$1" pat
  for pat in $FORGE_SCAN_EXCLUDE; do
    case "/$p" in
      */"$pat"/*) return 0 ;;
      */"$pat") return 0 ;;
    esac
    # padrões com glob (`.forge.bak-*`) precisam de casamento sem aspas
    case "/$p" in
      */$pat/*) return 0 ;;
      */$pat) return 0 ;;
    esac
  done
  return 1
}
