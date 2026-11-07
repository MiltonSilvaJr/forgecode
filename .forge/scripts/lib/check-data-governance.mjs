#!/usr/bin/env node
// forge check data-governance (G4 enforcement, GW.3). Zero-dependency. Scans
// markdown artifacts (a change dir, or given files) for declarations that
// CONTRADICT the global data-governance matrix (rules/data/data-governance.md) —
// the per-module divergence that caused the pilot incident. Deterministic grep
// of known anti-patterns; reports CONFLICT findings (file:line + why).
//
// This is a guardrail for the literal incident pattern (a module declaring
// "RLS opcional"/"sem RLS" against the mandatory-RLS decision). It complements,
// not replaces, the human/LLM cross-artifact analysis (/forge:analyze).
//
// REQ-12 extension (TASK-16, design.md §2.2 "Extensão check-data-governance"):
//   (a) PAN (13-19 dígitos)/CPF/e-mail dentro de uma chamada de log (log.*(...)/
//       logger.*(...)) — violação PCI direta.
//   (b) campo marcado `// forge:sensitive-field="x"` (ou `#` em Python/Rego) sem
//       entrada correspondente no artefato `data-classification` (JSON, schema
//       data-classification.schema.json) encontrado dentro dos mesmos `inputs`.
// A varredura de código usa o coletor genérico `source-scan.collect` com `exts`
// ampliado (`.go/.kt/.ts/.rego/.py/.sql` — `.sql` adicionado pelo change
// add-migration-review-rule, REQ-06) — o coletor .md original fica com `exts`
// default (`.md`), preservando 100% o comportamento de `gw3-data-governance-gate.sh`
// [1]-[8] (NFR-04).
//
// REQ-16 AC3 exclui REQ-12 da lista dos "cinco gates de adoção" (REQ-06/07/08/09/10)
// que leem `mode: warn|enforce` de um bloco declarativo do FORGE.md — REQ-12 nunca é
// rebaixável, sempre enforce. Por isso TODO finding deste gate (os legados de .md e os
// dois novos de REQ-12) é marcado `enforceable:true` e passa por `lib/gate-mode.mjs`
// apenas para manter o mesmo contrato uniforme dos três gates da Wave 4 (design.md
// §2.2 "Contrato comum dos gates") — nenhum bloco `data-governance:` novo é lido do
// FORGE.md/graph.json (não existe essa família em REQ-11); o `mode` nunca rebaixa nada
// aqui, então o resultado observável é idêntico ao anterior (sempre CONFLICT/exit 1).
//
// Usage: check-data-governance.mjs <change-dir|file> [...more files]
// Output: "OK data-governance (no divergence)" or "CONFLICT (<findings>)" (exit 1).
import { readFileSync } from 'node:fs';
import { collect, scan } from './source-scan.mjs';
import { applyMode } from './gate-mode.mjs';
import { universeCheck, emitUniverse } from './gate-universe.mjs';

const inputs = process.argv.slice(2);
// `nothing to check` saía com exit 0: invocação sem path algum — que é o que acontece quando o
// chamador monta a lista de arquivos e a lista sai vazia — reportava-se verde sem ter aberto
// arquivo nenhum (issue #49). Agora é o contador de controle que decide, com o mesmo critério
// dos demais gates e a mesma saída declarada em .forge/empty-universe-allowlist.txt.
const gateRoot = process.env.FORGE_ROOT || '.';
if (!inputs.length) {
  process.exit(emitUniverse(universeCheck({
    root: gateRoot, gate: 'data-governance', count: 0, item: 'arquivo(s)', scope: '(nenhum path recebido)',
  })));
}

// anti-patterns vs the global matrix. Each: { re, why, allow } — allow skips a
// match when the same line carries an allowed qualifier (e.g. formal exception).
const ANTI = [
  { re: /\bsem\s+RLS\b/i, why: 'declara "sem RLS" — matriz exige RLS p/ tabelas multi-tenant de domínio (SQL)', allow: /exceção\s+formal|exception/i },
  { re: /RLS\s+(é\s+)?opcional/i, why: 'declara RLS opcional — matriz: RLS obrigatório, dispensa só por exceção formal', allow: /exceção\s+formal/i },
  { re: /RLS\s+optional/i, why: 'declares RLS optional — matrix: RLS mandatory, waivable only by formal exception', allow: /formal\s+exception/i },
  { re: /RLS\s+não\s+(é\s+)?obrigat/i, why: 'declara RLS não obrigatório — contradiz a matriz', allow: /exceção\s+formal/i },
  { re: /cache\b[^\n]*\bsem\s+(namespace|prefixo)\s+(de\s+)?tenant/i, why: 'cache sem namespace de tenant — vetor de vazamento cross-tenant', allow: /(?!)/ },
];

// ── REQ-12a — PAN/CPF/e-mail em chamada de log (sempre enforce) ──────────────────────
// Regex/taint por linha: exige o call de log (log.*(.../logger.*() e o valor bruto na
// MESMA linha. `allow` cobre mascaramento explícito (mask(/redact(/last4/asteriscos/x).
const LOG_CALL = String.raw`(?:\blog|\blogger)\.\w+\s*\(.*`;
const PAN_DIGITS = String.raw`\b\d{13,19}\b`;
const CPF = String.raw`\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b`;
const EMAIL = String.raw`\b[\w.+-]+@[\w-]+\.[A-Za-z]{2,}\b`;
const MASKED_ALLOW = /mask\(|redact\(|last4|\*{2,}|x{4,}/i;
const LOG_TAINT = [
  { re: new RegExp(LOG_CALL + PAN_DIGITS, 'i'), why: 'PAN (13-19 dígitos) em chamada de log — mascare antes de logar (REQ-12a, PCI DSS Req 3/10)', allow: MASKED_ALLOW },
  { re: new RegExp(LOG_CALL + CPF, 'i'), why: 'CPF em chamada de log — PII exposta sem mascaramento (REQ-12a)', allow: MASKED_ALLOW },
  { re: new RegExp(LOG_CALL + EMAIL, 'i'), why: 'e-mail em chamada de log — PII exposta sem mascaramento (REQ-12a)', allow: MASKED_ALLOW },
];

// ── REQ-12b — campo marcado sensível sem classificação (sempre enforce) ──────────────
// Convenção de marcação inline (comentário — funciona em Go/Kotlin/TS com `//` e em
// Python/Rego com `#`): `// forge:sensitive-field="cpf"` ou `# forge:sensitive-field="cpf"`.
// O gate procura um artefato `data-classification.json` (schema data-classification.
// schema.json) dentro dos mesmos `inputs`; campo marcado sem entrada correspondente no
// mapa (ou artefato ausente) é finding. Em `.sql` o comentário de linha é `--`, aceito SÓ
// nessa extensão: nas demais, `--` não é comentário e um texto como `--forge:sensitive-field=x`
// numa docstring ou help de CLI viraria finding não rebaixável.
const SENSITIVE_MARKER_RE = /(?:\/\/|#)\s*forge:sensitive-field\s*[:=]\s*"?([A-Za-z0-9_.]+)"?/i;
const SENSITIVE_MARKER_SQL_RE = /(?:\/\/|#|--)\s*forge:sensitive-field\s*[:=]\s*"?([A-Za-z0-9_.]+)"?/i;

function loadClassification(paths) {
  const jsonFiles = collect(paths, { exts: new Set(['.json']) });
  const hit = jsonFiles.find((f) => f.endsWith('data-classification.json'));
  if (!hit) return null;
  try { return JSON.parse(readFileSync(hit, 'utf8')); } catch { return null; } // malformado ⇒ tratado como ausente, nunca lança
}

function relLike(f) {
  return f.includes('/specs/active/') ? f.slice(f.indexOf('/specs/active/') + 1) : f;
}

function scanSensitiveFields(files, classification) {
  const findings = [];
  for (const f of files) {
    const r = relLike(f);
    const lines = readFileSync(f, 'utf8').split('\n');
    const markerRe = f.toLowerCase().endsWith('.sql') ? SENSITIVE_MARKER_SQL_RE : SENSITIVE_MARKER_RE;
    lines.forEach((line, i) => {
      const m = line.match(markerRe);
      if (!m) return;
      const field = m[1];
      if (!classification || !Object.prototype.hasOwnProperty.call(classification, field)) {
        findings.push(`${r}:${i + 1}: campo sensível "${field}" sem entrada em data-classification (REQ-12b)`);
      }
    });
  }
  return findings;
}

const CODE_EXTS = new Set(['.go', '.kt', '.ts', '.rego', '.py', '.sql']);

const mdFindings = scan(collect(inputs), ANTI); // default exts {'.md'} — retrocompat NFR-04
const codeFiles = collect(inputs, { exts: CODE_EXTS });
const logFindings = scan(codeFiles, LOG_TAINT);
const classification = loadClassification(inputs);
const fieldFindings = scanSensitiveFields(codeFiles, classification);

// Todo finding deste gate é inegociável (REQ-16 AC3) — ver nota no topo do arquivo.
const findings = [...mdFindings, ...logFindings, ...fieldFindings].map((msg) => ({ enforceable: true, msg }));
const result = applyMode(findings, {});

if (result.blocking.length) {
  console.log(`CONFLICT (${result.blocking.map((f) => f.msg).join('; ')})`);
  process.exit(result.exitCode);
}

// ── contador de controle (issue #49) — antes do OK, e capaz de reprová-lo ─────────────
const mdFiles = collect(inputs);
const universe = universeCheck({
  root: gateRoot,
  gate: 'data-governance',
  count: mdFiles.length + codeFiles.length,
  item: 'arquivo(s)',
  scope: inputs.join(' '),
});
if (emitUniverse(universe) !== 0) process.exit(1);
console.log(`OK data-governance (${mdFiles.length} .md, ${codeFiles.length} código, no divergence)`);
