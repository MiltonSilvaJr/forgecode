#!/usr/bin/env bash
# forge check-attack-premise (REQ-01/REQ-02, change adopt-ub-mode-practices): verifica se um
# bloco de falha de TASK exige — e tem — os campos "Premissa:" / "Ator(es) com o desequilíbrio:"
# antes de permitir retomada. Cobre os dois artefatos reais do harness com UM script, que
# reconhece o formato pelo NOME do campo, nunca pelo caractere de prefixo (`>` em tasks.md,
# `**...**` em PROGRESS-TRACKING.md):
#
#   tasks.md            — bloco único por TASK em `[!]`; os campos são exigidos sempre que a
#                          causa do `[!]` for literalmente "gate falha após 2 tentativas de
#                          correção" (as outras duas causas do HALT — dependência externa
#                          indisponível, decisão de produto necessária — nunca exigem os campos).
#   PROGRESS-TRACKING.md — bloco "## ⚠️ Última falha — Wave N / TASK-NN" acumulado (nunca
#                          sobrescrito); os campos são exigidos a partir da 2ª ocorrência
#                          CONSECUTIVA do par (TASK, Gate) desde a última retomada INFORMADA
#                          (ocorrência anterior do mesmo par com Premissa/Ator já preenchidos
#                          abre série nova — a reocorrência seguinte volta a ser "1ª do par").
#
# Usage:
#   check-attack-premise.sh --file <tasks.md|PROGRESS-TRACKING.md> --task-id <TASK-NN>
#       → rc 0 se a(s) ocorrência(s) da TASK atendem à regra; rc 1 e mensagem nomeando o que
#         falta, caso contrário.
#   check-attack-premise.sh --list --file <tasks.md|PROGRESS-TRACKING.md>
#       → lista (rc sempre 0) toda TASK com Premissa/Ator preenchidos neste arquivo — insumo
#         de `verify.md` §"Premissas atacadas".
set -euo pipefail
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 2; }

FILE=""
TASK_ID=""
LIST_MODE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="${2:-}"; shift 2 ;;
    --task-id) TASK_ID="${2:-}"; shift 2 ;;
    --list) LIST_MODE=1; shift ;;
    *) echo "FAIL (flag desconhecida: $1 — use --file/--task-id/--list)"; exit 2 ;;
  esac
done

[ -n "$FILE" ] || { echo "FAIL (usage: --file <path> é obrigatório)"; exit 2; }
[ -f "$FILE" ] || { echo "FAIL (arquivo não encontrado: $FILE)"; exit 2; }
if [ "$LIST_MODE" -eq 0 ]; then
  [ -n "$TASK_ID" ] || { echo "FAIL (usage: --task-id <TASK-NN> é obrigatório fora do modo --list)"; exit 2; }
fi

node --input-type=module -e '
const fs = await import("node:fs");
const path = process.argv[1];
const taskId = process.argv[2] || null;
const listMode = process.argv[3] === "1";
const text = fs.readFileSync(path, "utf8");
const lines = text.split(/\r?\n/);
const base = path.split("/").pop();

function detectFormat() {
  if (base === "tasks.md") return "tasks";
  if (base === "PROGRESS-TRACKING.md") return "progress";
  if (/^- \[[ Xx!-]\] TASK-\d+/m.test(text)) return "tasks";
  if (/^##\s*⚠️\s*Última falha/m.test(text)) return "progress";
  console.log("FAIL (formato desconhecido — nome do arquivo não é tasks.md/PROGRESS-TRACKING.md e o conteúdo não bate com nenhum dos dois padrões)");
  process.exit(2);
}
const format = detectFormat();

// ---- extração de campo genérica: aceita "> Campo: valor" (tasks.md) e "**Campo:** valor"
// (PROGRESS-TRACKING.md), pelo NOME do campo (nunca pelo prefixo).
function fieldFrom(line) {
  let m = line.match(/^\s*>\s*([^:]+):\s*(.*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  m = line.match(/^\s*\*\*([^*:]+):\*\*\s*(.*)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  return null;
}

const CAMPO_PREMISSA = "Premissa";
const CAMPO_ATOR = "Ator(es) com o desequilíbrio";
const CAMPO_GATE = "Gate";
const CAMPO_FALHA = "FALHA";
const CAUSA_GATE_2X = "gate falha após 2 tentativas de correção";

// Um valor inteiramente entre "<...>" é placeholder de template (ex.: copiado literal do exemplo
// de task-coder.md/design.md — "<idem>", "<preenchido só na 2ª ocorrência...>"), nunca conteúdo
// real preenchido — contá-lo como premissa nomeada aceitaria uma retomada que só copiou o
// formato, exatamente o que o REQ-01 proíbe (achado da revisão adversarial, implementation_verified).
function isPlaceholder(value) { return /^<.*>$/.test(value.trim()); }

function blockHasField(fieldLines, name) {
  for (const l of fieldLines) {
    const f = fieldFrom(l);
    if (f && f[0] === name) {
      if (isPlaceholder(f[1])) return null;
      return f[1];
    }
  }
  return null;
}

if (format === "tasks") {
  // Um bloco por TASK: linha "- [!] TASK-NN — ..." seguida de linhas "> Campo: valor"
  // consecutivas (para enquanto casarem o padrão).
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^- \[!\] (TASK-\d+)\s*—/);
    if (!m) continue;
    const id = m[1];
    const fieldLines = [];
    let j = i + 1;
    while (j < lines.length && /^\s*>\s*\S/.test(lines[j])) { fieldLines.push(lines[j]); j++; }
    blocks.push({ id, fieldLines });
  }

  if (listMode) {
    const out = [];
    for (const b of blocks) {
      const premissa = blockHasField(b.fieldLines, CAMPO_PREMISSA);
      const ator = blockHasField(b.fieldLines, CAMPO_ATOR);
      if (premissa && ator) {
        const gate = blockHasField(b.fieldLines, CAMPO_GATE) || "<sem gate registrado>";
        out.push(`${b.id} (tasks.md) — Gate: ${gate}; Premissa: ${premissa}; Ator(es) com o desequilíbrio: ${ator}`);
      }
    }
    if (out.length === 0) console.log("0 premissa(s) atacada(s) em tasks.md");
    else { console.log(`${out.length} premissa(s) atacada(s) em tasks.md:`); for (const l of out) console.log(l); }
    process.exit(0);
  }

  const b = blocks.find((x) => x.id === taskId);
  if (!b) { console.log(`FAIL (TASK ${taskId} não encontrada em [!] neste arquivo)`); process.exit(2); }
  const falha = blockHasField(b.fieldLines, CAMPO_FALHA) || "";
  if (!falha.includes(CAUSA_GATE_2X)) {
    console.log(`OK (${taskId}: causa do [!] não é "${CAUSA_GATE_2X}" — campos Premissa/Ator não exigidos)`);
    process.exit(0);
  }
  const gate = blockHasField(b.fieldLines, CAMPO_GATE);
  const premissa = blockHasField(b.fieldLines, CAMPO_PREMISSA);
  const ator = blockHasField(b.fieldLines, CAMPO_ATOR);
  const faltando = [];
  if (!gate) faltando.push(CAMPO_GATE);
  if (!premissa) faltando.push(CAMPO_PREMISSA);
  if (!ator) faltando.push(CAMPO_ATOR);
  if (faltando.length > 0) {
    console.log(`FAIL (${taskId}: causa "${CAUSA_GATE_2X}" exige os campos [${faltando.join(", ")}], ausente(s)/vazio(s))`);
    process.exit(1);
  }
  console.log(`OK (${taskId}: campos Gate/Premissa/Ator(es) presentes)`);
  process.exit(0);
}

// format === "progress"
// Blocos "## ⚠️ Última falha — Wave X / TASK-NN ..." em ordem de arquivo (histórico nunca
// sobrescrito — cada ocorrência é um bloco próprio).
const entries = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^##\s*⚠️\s*Última falha\s*—\s*Wave\s+\S+\s*\/\s*(TASK-\d+)/);
  if (!m) continue;
  const id = m[1];
  const fieldLines = [];
  let j = i + 1;
  while (j < lines.length && !/^##\s/.test(lines[j])) { fieldLines.push(lines[j]); j++; }
  entries.push({ id, fieldLines, line: i });
}

function entryField(e, name) { return blockHasField(e.fieldLines, name); }

// Caminha em ORDEM DE ARQUIVO computando, por par (TASK, Gate), se a ocorrência atual é a
// 1ª da série (não exige campos) ou 2ª+ (exige, salvo se a ocorrência ANTERIOR do mesmo par
// já era uma retomada informada — nesse caso a série reabre).
const seriesState = new Map(); // key "TASK|Gate" -> { informedPrev: bool }
const evaluated = [];
for (const e of entries) {
  const gate = entryField(e, CAMPO_GATE) || "<sem gate>";
  const key = `${e.id}|${gate}`;
  const prev = seriesState.get(key);
  const requiresFields = !!prev && !prev.informedPrev;
  const premissa = entryField(e, CAMPO_PREMISSA);
  const ator = entryField(e, CAMPO_ATOR);
  const informedNow = !!(premissa && ator);
  evaluated.push({ id: e.id, gate, requiresFields, premissa, ator, informedNow });
  seriesState.set(key, { informedPrev: informedNow });
}

if (listMode) {
  const out = evaluated.filter((x) => x.informedNow)
    .map((x) => `${x.id} (PROGRESS-TRACKING.md, Gate: ${x.gate}) — Premissa: ${x.premissa}; Ator(es) com o desequilíbrio: ${x.ator}`);
  if (out.length === 0) console.log("0 premissa(s) atacada(s) em PROGRESS-TRACKING.md");
  else { console.log(`${out.length} premissa(s) atacada(s) em PROGRESS-TRACKING.md:`); for (const l of out) console.log(l); }
  process.exit(0);
}

// Pré-condição de retomada: o que importa é a ocorrência MAIS RECENTE de cada par (TASK,
// Gate) desta TASK — entradas anteriores já resolvidas (por uma retomada informada
// subsequente, ou já corrigidas) não voltam a bloquear uma TASK hoje `[X]`/em andamento.
const forTask = evaluated.filter((x) => x.id === taskId);
if (forTask.length === 0) { console.log(`FAIL (TASK ${taskId} sem bloco de "Última falha" em PROGRESS-TRACKING.md)`); process.exit(2); }
const latestByGate = new Map();
for (const e of forTask) latestByGate.set(e.gate, e); // última ocorrência de cada Gate, em ordem de arquivo
const violacoes = [...latestByGate.values()].filter((x) => x.requiresFields && !(x.premissa && x.ator));
if (violacoes.length > 0) {
  const detalhe = violacoes.map((v) => `Gate "${v.gate}"`).join(", ");
  console.log(`FAIL (${taskId}: ocorrência mais recente é a 2ª+ consecutiva sem retomada informada — exige Premissa/Ator(es) com o desequilíbrio — ${detalhe})`);
  process.exit(1);
}
console.log(`OK (${taskId}: ocorrência mais recente de cada gate não exige os campos, ou já os tem)`);
process.exit(0);
' "$FILE" "$TASK_ID" "$LIST_MODE"
