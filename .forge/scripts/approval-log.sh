#!/usr/bin/env bash
# HITL decision log (§12.1) — appends one entry to the active change's
# approvals.yaml and, on approve, flips the corresponding manifest gate to true.
# Usage:
#   approval-log.sh <change-id> --gate <gate> --decision <decision>
#                   [--reason "<text>"] [--iteration N] [--scope "<text>"]
#                   [--notes "<text>"] [--superseded-by <id>] [--autonomous]
# gates:     requirements_reviewed | design_reviewed | tasks_reviewed |
#            implementation_verified | human_archive_approval | close
# decisions: approve | review | reject | supersede | abandon | block | deliver-external
# Rules (§12.1): every decision except approve REQUIRES --reason;
#                supersede also requires --superseded-by; iteration is 1..3.
# --autonomous (§12.2, modo yolo): decisão tomada por subagente Opus, não por humano.
#                Grava autonomous:true e decided_by fixo "forge-yolo (opus, high)"; exige
#                --reason SEMPRE (inclusive approve) para a análise ficar auditável.
# Output: "OK <id>: <gate> = <decision>" or "FAIL (...)".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

ID="${1:-}"; shift || true
GATE=""; DECISION=""; REASON=""; ITERATION=""; SCOPE=""; NOTES=""; SUPERSEDED_BY=""; AUTONOMOUS=0
while [ $# -gt 0 ]; do case "$1" in
  --gate) GATE="${2:-}"; shift 2 ;;
  --decision) DECISION="${2:-}"; shift 2 ;;
  --reason) REASON="${2:-}"; shift 2 ;;
  --iteration) ITERATION="${2:-}"; shift 2 ;;
  --scope) SCOPE="${2:-}"; shift 2 ;;
  --notes) NOTES="${2:-}"; shift 2 ;;
  --superseded-by) SUPERSEDED_BY="${2:-}"; shift 2 ;;
  --autonomous) AUTONOMOUS=1; shift ;;
  *) echo "FAIL (unknown argument: $1)"; exit 2 ;;
esac; done

[ -n "$ID" ] || { echo "FAIL (usage: approval-log.sh <change-id> --gate <g> --decision <d> ...)"; exit 2; }
DIR="$ROOT/.forge/specs/active/$ID"
MAN="$DIR/manifest.yaml"
[ -f "$MAN" ] || { echo "FAIL (no active change: $ID)"; exit 1; }

case "$GATE" in requirements_reviewed|design_reviewed|tasks_reviewed|implementation_verified|human_archive_approval|close) ;; *) echo "FAIL (--gate invalid: '$GATE')"; exit 2 ;; esac
case "$DECISION" in approve|review|reject|supersede|abandon|block|deliver-external) ;; *) echo "FAIL (--decision invalid: '$DECISION')"; exit 2 ;; esac
if [ "$DECISION" != "approve" ] && [ -z "$REASON" ]; then
  echo "FAIL (every decision except approve requires --reason — §12.1)"; exit 2
fi
# Modo autônomo (--yolo): a decisão é de um subagente, não de um humano. Toda decisão
# autônoma — inclusive approve — carrega a análise como reason (auditoria: a máquina sempre
# registra o porquê, para ser distinguível e revisável). O registro marca autonomous:true.
if [ "$AUTONOMOUS" -eq 1 ] && [ -z "$REASON" ]; then
  echo "FAIL (autonomous decision requires --reason — a máquina sempre registra a análise, §12.2)"; exit 2
fi
# Hard-stop DETERMINISTA (§12.2/§13.1): --autonomous não pode decidir um gate listado em
# autonomy.human_hard_stops do forge.yaml. A fronteira de segurança é mecânica aqui — não fica
# refém do juízo do agente. Mutação de baseline em domínio regulado exige humano de verdade.
if [ "$AUTONOMOUS" -eq 1 ] && [ -f "$ROOT/.forge/forge.yaml" ]; then
  HARD_STOPS="$(awk '/^autonomy:/{a=1;next} a&&/^[^[:space:]]/{a=0} a&&/human_hard_stops:/{l=1;next} l&&/^[[:space:]]*-[[:space:]]/{sub(/^[[:space:]]*-[[:space:]]*/,"");print;next} l&&/^[[:space:]]*[a-z_]+:/{l=0}' "$ROOT/.forge/forge.yaml")"
  for hs in $HARD_STOPS; do
    [ "$hs" = "$GATE" ] && { echo "FAIL (gate '$GATE' está em autonomy.human_hard_stops — decisão autônoma proibida; exige aprovação humana, §13.1)"; exit 2; }
  done
fi
if [ "$DECISION" = "supersede" ] && [ -z "$SUPERSEDED_BY" ]; then
  echo "FAIL (supersede requires --superseded-by <change-id>)"; exit 2
fi
if [ -n "$ITERATION" ]; then
  case "$ITERATION" in 1|2|3) ;; *) echo "FAIL (--iteration must be 1..3 — loop §14.6 escalates after 3)"; exit 2 ;; esac
fi

if [ "$AUTONOMOUS" -eq 1 ]; then
  BY="forge-yolo (opus, high)"   # identidade honesta do decisor autônomo — nunca um humano
else
  BY="$(git config user.name 2>/dev/null || true)"; [ -n "$BY" ] || BY="$(id -un)"
fi
AT="$(date +%Y-%m-%dT%H:%M:%S%z | sed 's/\([0-9][0-9]\)$/:\1/')"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"

FILE="$DIR/approvals.yaml"
# Escrita atômica e validada (issue #188): monta o resultado num temporário ao lado do arquivo,
# valida o YAML resultante e só então move por cima. Antes, a entrada era anexada direto ao
# arquivo e o OK saía sem conferência — com `approvals: []` literal (o que o template de spec
# traz) o resultado era um documento que nenhum parser YAML aceita.
TMP="$(mktemp "$DIR/.approvals.yaml.XXXXXX")"
trap 'rm -f "$TMP" "$TMP.base"' EXIT
if [ -f "$FILE" ]; then
  # Lista vazia inline (`approvals: []`, com ou sem comentário) vira a chave em bloco, para a
  # entrada anexada cair DENTRO da lista. Um arquivo que já traga a entrada órfã sob `[]` (gravada
  # por versões anteriores) é reparado pela mesma troca.
  # Um comentário na mesma linha sobe para a linha de cima (o yaml-lite não o reconheceria depois
  # de `approvals:` e leria a lista como uma string).
  perl -pe 's/^approvals:[ \t]*\[\][ \t]*(#.*)?$/(defined $1 ? "$1\n" : "") . "approvals:"/e' "$FILE" > "$TMP"
  # Sem quebra de linha final, a primeira linha da entrada colaria na última linha existente.
  [ ! -s "$TMP" ] || [ -z "$(tail -c1 "$TMP")" ] || printf '\n' >> "$TMP"
  grep -q '^approvals:' "$TMP" || printf 'approvals:\n' >> "$TMP"
else
  printf 'approvals:\n' > "$TMP"
fi
cp "$TMP" "$TMP.base"

{
  printf '  - gate: %s\n' "$GATE"
  printf '    decision: %s\n' "$DECISION"
  [ "$AUTONOMOUS" -eq 1 ] && printf '    autonomous: true\n'
  [ -n "$REASON" ] && printf '    reason: "%s"\n' "$(printf '%s' "$REASON" | sed 's/"/\\"/g')"
  printf '    decided_by: "%s"\n' "$BY"
  printf '    decided_at: "%s"\n' "$AT"
  [ -n "$ITERATION" ] && printf '    iteration: %s\n' "$ITERATION"
  [ -n "$COMMIT" ] && printf '    commit: "%s"\n' "$COMMIT"
  [ -n "$SCOPE" ] && printf '    scope: "%s"\n' "$(printf '%s' "$SCOPE" | sed 's/"/\\"/g')"
  [ -n "$NOTES" ] && printf '    notes: "%s"\n' "$(printf '%s' "$NOTES" | sed 's/"/\\"/g')"
  [ -n "$SUPERSEDED_BY" ] && printf '    superseded_by: %s\n' "$SUPERSEDED_BY"
} >> "$TMP"

# Validação antes do OK. Duas camadas:
#  1. node (sempre; zero-dep): estrutura estrita — nenhuma linha mais indentada sob um valor
#     escalar/inline, sem tabulação na indentação — mais a semântica: `approvals` é lista, cresceu
#     exatamente uma entrada e a última é a decisão que acabou de ser gravada. O yaml-lite sozinho
#     não basta: ele é leniente e aceita a entrada órfã sob `approvals: []`.
#  2. PyYAML (quando disponível): parser YAML completo como segunda opinião.
validate_approvals() {
  command -v node >/dev/null 2>&1 || { echo "node ausente — não há como validar o YAML resultante"; return 1; }
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    const [lib, basePath, finalPath, gate, decision] = process.argv.slice(1);
    const { parseYamlSubset } = await import(pathToFileURL(lib).href);
    const fail = (m) => { console.log(m); process.exit(1); };
    const text = readFileSync(finalPath, "utf8");
    let prev = null;
    text.split("\n").forEach((l, i) => {
      if (/^\s*(#.*)?$/.test(l)) return;
      if (/^ *\t/.test(l)) fail(`linha ${i + 1}: tabulação na indentação`);
      let ind = l.match(/^ */)[0].length;
      if (prev && prev.scalar && ind > prev.ind) fail(`linha ${i + 1}: conteúdo indentado sob o valor escalar/inline da linha ${prev.n}`);
      let body = l.slice(ind);
      if (body === "-") { prev = { ind, scalar: false, n: i + 1 }; return; }
      if (body.startsWith("- ")) { const r = body.slice(2); ind += 2 + (r.length - r.trimStart().length); body = r.trimStart(); }
      const kv = body.match(/^("[^"]*"|\x27[^\x27]*\x27|[^\s#"\x27][^:]*?):(?:\s+(.*))?$/);
      let scalar = true;
      if (kv) { const v = (kv[2] || "").replace(/(^|\s+)#.*$/, "").trim(); scalar = v !== "" && !/^[|>]/.test(v); }
      prev = { ind, scalar, n: i + 1 };
    });
    const parse = (p) => { try { return parseYamlSubset(readFileSync(p, "utf8")); } catch (e) { fail(`${p === basePath ? "arquivo existente" : "resultado"} não parseia: ${e.message}`); } };
    const base = parse(basePath), fin = parse(finalPath);
    // `approvals:` sem itens chega do yaml-lite como {} — lista vazia, não mapa.
    const count = (d) => {
      const a = d ? d.approvals : undefined;
      if (Array.isArray(a)) return a.length;
      if (a == null || (typeof a === "object" && Object.keys(a).length === 0)) return 0;
      return -1;
    };
    const nb = count(base), nf = count(fin);
    if (nb < 0) fail("`approvals` existente não é uma lista");
    if (nf !== nb + 1) fail(`approvals deveria ter ${nb + 1} entrada(s), tem ${nf}`);
    const last = fin.approvals[nf - 1];
    if (!last || last.gate !== gate || last.decision !== decision) fail("a última entrada da lista não é a decisão recém-gravada");
  ' "$SCRIPT_DIR/lib/yaml-lite.mjs" "$TMP.base" "$TMP" "$GATE" "$DECISION" || return 1
  if command -v python3 >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
    python3 -c 'import sys,yaml; yaml.safe_load(open(sys.argv[1]))' "$TMP" >/dev/null 2>&1 \
      || { echo "PyYAML recusa o resultado"; return 1; }
  fi
  return 0
}
if ! WHY="$(validate_approvals)"; then
  echo "FAIL (approvals.yaml resultaria em YAML inválido — nada foi gravado: ${WHY:-motivo não informado}; corrija $FILE à mão)"
  exit 1
fi
# mktemp cria 0600; o arquivo final volta à permissão padrão do umask, como um arquivo criado normalmente.
chmod "$(printf '%o' $(( 0666 & ~$(umask) )))" "$TMP"
mv "$TMP" "$FILE"

if [ "$DECISION" = "approve" ] && [ "$GATE" != "close" ]; then
  GATE_RE="$GATE" perl -pi -e 's/^(  \Q$ENV{GATE_RE}\E): false$/$1: true/' "$MAN"
fi

echo "OK $ID: $GATE = $DECISION"
