#!/usr/bin/env node
// forge check-observability (Wave 4 — TASK-15, REQ-09/10, design.md §2.2). Zero-dep
// (NFR-01) — nenhuma dependência de runtime além do Node puro. Gate de ADOÇÃO (REQ-16):
// todo finding daqui nasce `enforceable:false` (rebaixável), governado pelo `mode` do
// bloco `observability:` do FORGE.md — materializado em `graph.json:governance.observability`
// por `graph-build.mjs` (TASK-07) e aplicado por `lib/gate-mode.mjs` (TASK-13).
//
// Três sub-checks:
//   REQ-09a — boundary (node `layer:api`, fora da allowlist) sem caminho (import direto
//     ou transitivo) a um módulo `roles:["otel-wrapper"]` declarado. Delegado a
//     `lib/graph-govern.mjs` (reachability sobre `graph.json`) — prova só IMPORTAÇÃO,
//     nunca aplicação (design §2.3).
//   REQ-09b — logger cru (`fmt.Println`, `console.log`, `print(` em contexto de serviço)
//     fora do diretório do wrapper (`observability.wrapper_paths`) — matriz `ANTI` via
//     `scan()` de `lib/source-scan.mjs`. Varredura TEXTUAL: roda sempre, mesmo sem
//     `graph.json`/bloco `observability:` (não depende do grafo) — só não exclui nenhum
//     arquivo do wrapper quando `wrapper_paths` está ausente (nada para excluir).
//   REQ-10 — cada boundary declarado (node `layer:api` fora da allowlist) precisa de
//     >=1 artefato `alerts-as-code` válido (schema `alerts-as-code.schema.json`) cujo
//     campo `service` bata com o identificador do boundary. O identificador de boundary
//     reusa a MESMA heurística "primeiros dois segmentos de path sob uma raiz conhecida"
//     que `lib/graph-deps.mjs` (`boundaryOf`) já usa para módulo→módulo — reimplementada
//     aqui (não importada) porque `graph-deps.mjs` é um script CLI top-level, não uma lib
//     (mesma razão documentada em `graph-govern.mjs`).
//
// Sem `graph.json` (`.forge/graph/graph.json` ausente): REQ-09a e REQ-10 não têm
// boundaries para checar → sem findings (nunca falso-positivo, REQ-11 AC). REQ-09b roda
// do mesmo jeito, sem exclusão de wrapper.
//
// A validação do artefato `alerts-as-code` é reimplementada aqui em vez de invocar um
// validador JSON Schema genérico (ajv) — o `template/.forge/**` shipado ao consumidor
// precisa ficar zero-dependência em runtime (NFR-01); mesmo padrão de
// `lib/validate-spec.mjs` ("schema rules, re-implemented deterministically here").
//
// Usage (CLI): check-observability.mjs --root <forge-root> <path|dir> [...]
// Output: "OK check-observability (…)" (exit 0) | "WARN (…)" (exit 0, achados
// rebaixados) | "CONFLICT (…)" (exit 1, achados bloqueantes em mode:enforce).
import { readFileSync, existsSync } from 'node:fs';
import { relative, resolve, join } from 'node:path';
import { collect, scan } from './source-scan.mjs';
import { govern, pathMatches } from './graph-govern.mjs';
import { applyMode, governanceFor } from './gate-mode.mjs';
import { universeCheck, emitUniverse } from './gate-universe.mjs';

// ── REQ-09b — matriz ANTI de logger cru ("contexto de serviço" = código-fonte real,
// não markdown) + extensões de linguagem varridas. `allow` só é dispensado por um
// marcador explícito de exceção na mesma linha — não há wildcard "sempre permite".
const RAW_LOGGER_ALLOW = /forge:allow-raw-log/;
const ANTI = [
  { re: /\bconsole\.log\s*\(/, why: 'console.log cru — use o logger estruturado do wrapper de instrumentação declarado', allow: RAW_LOGGER_ALLOW },
  { re: /\bfmt\.Println\s*\(/, why: 'fmt.Println cru — use o logger estruturado do wrapper de instrumentação declarado', allow: RAW_LOGGER_ALLOW },
  { re: /\bprint\s*\(/, why: 'print( cru — use o logger estruturado do wrapper de instrumentação declarado', allow: RAW_LOGGER_ALLOW },
];
const SOURCE_EXTS = new Set(['.go', '.ts', '.js', '.py', '.kt']);

// ── REQ-09b: varre paths por logger cru, excluindo arquivos sob wrapper_paths (o
// próprio wrapper implementa o logger estruturado por cima do primitivo cru — chamar
// console.log/fmt.Println ALI é a implementação, não a violação).
export function checkRawLoggers(paths, { root, wrapperPaths = [] } = {}) {
  const files = collect(paths, { exts: SOURCE_EXTS });
  const kept = files.filter((f) => !pathMatches(relative(root, f), wrapperPaths));
  const raw = scan(kept, ANTI, { rel: (f) => relative(root, f) });
  return raw.map((why) => ({ subcheck: 'REQ-09b', target: null, why, enforceable: false }));
}

// ── REQ-10: identificador de boundary/serviço a partir do id do node (mesma heurística
// de `graph-deps.mjs:boundaryOf` — raiz conhecida + 2 segmentos, senão só o 1º segmento).
const BOUNDARY_ROOTS = new Set(['src', 'services', 'apps', 'packages', 'modules', 'libs', 'backend', 'frontend']);
export function boundaryOf(id) {
  const p = String(id).split('/');
  if (BOUNDARY_ROOTS.has(p[0]) && p.length > 1) return `${p[0]}/${p[1]}`;
  return p[0];
}

// ── REQ-10: validação determinística do artefato alerts-as-code (mirror de
// alerts-as-code.schema.json — service:string não-vazio, alerts:[{name,expr,severity
// em {critical,warning,info},for:/^[0-9]+[smhd]$/}], minItems 1). Retorna lista de
// erros; [] = válido.
export function validateAlertsAsCode(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['artefato não é um objeto'];
  if (typeof data.service !== 'string' || data.service.length < 1) errors.push('campo "service" ausente/vazio');
  if (!Array.isArray(data.alerts) || data.alerts.length < 1) {
    errors.push('campo "alerts" ausente/vazio (minItems 1)');
  } else {
    data.alerts.forEach((a, i) => {
      if (!a || typeof a !== 'object') { errors.push(`alerts[${i}] não é objeto`); return; }
      if (typeof a.name !== 'string' || !a.name.length) errors.push(`alerts[${i}].name ausente/vazio`);
      if (typeof a.expr !== 'string' || !a.expr.length) errors.push(`alerts[${i}].expr ausente/vazio`);
      if (!['critical', 'warning', 'info'].includes(a.severity)) errors.push(`alerts[${i}].severity inválida (esperado critical|warning|info)`);
      if (typeof a.for !== 'string' || !/^[0-9]+[smhd]$/.test(a.for)) errors.push(`alerts[${i}].for inválido (esperado ex.: "5m")`);
    });
  }
  return errors;
}

// ── REQ-10: coleta os `service` de todo artefato .json válido sob paths. Arquivo
// .json que não parseia ou não bate o formato alerts-as-code é ignorado silenciosamente
// (não é um alerts-as-code — não é o papel deste gate reprovar JSON solto no repo).
function collectAlertsServices(paths) {
  const files = collect(paths, { exts: new Set(['.json']) });
  const covered = new Set();
  for (const f of files) {
    let data;
    try { data = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    if (validateAlertsAsCode(data).length === 0) covered.add(data.service);
  }
  return covered;
}

// ── orquestração: roda os três sub-checks e aplica gate-mode uma única vez (a mesma
// família de governance — `observability:` — governa REQ-09a, REQ-09b e REQ-10).
export function checkObservability(inputs, { root } = {}) {
  root = root ? resolve(root) : process.cwd();
  const graphPath = join(root, '.forge/graph/graph.json');
  const graph = existsSync(graphPath) ? JSON.parse(readFileSync(graphPath, 'utf8')) : null;
  const govBlock = graph ? governanceFor(graph, 'observability') : undefined;
  const wrapperPaths = Array.isArray(govBlock && govBlock.wrapper_paths) ? govBlock.wrapper_paths : [];
  const allowlist = Array.isArray(govBlock && govBlock.allowlist) ? govBlock.allowlist : [];

  const findings = [];

  // REQ-09b — sempre roda (varredura textual, independente do grafo).
  findings.push(...checkRawLoggers(inputs, { root, wrapperPaths }));

  if (graph) {
    // REQ-09a — delega a graph-govern.govern(); no-op (sem findings) se governance.observability
    // ausente (checked:false) — nunca falso-positivo (REQ-11 AC).
    const gov = govern(graph).observability;
    for (const id of gov.findings) {
      findings.push({
        subcheck: 'REQ-09a',
        target: id,
        why: `boundary "${id}" sem caminho (import direto ou transitivo) ao wrapper de instrumentação (roles:otel-wrapper) declarado`,
        enforceable: false,
      });
    }

    // REQ-10 — só enumera boundaries quando o bloco observability: está presente (mesmo
    // guard de no-op de REQ-09a: sem bloco declarado, não há allowlist/threshold para
    // avaliar "serviço novo" com segurança).
    if (govBlock) {
      const boundaries = new Set();
      for (const n of graph.nodes || []) {
        if (n.layer !== 'api') continue;
        if (pathMatches(n.id, allowlist)) continue;
        boundaries.add(boundaryOf(n.id));
      }
      const covered = collectAlertsServices(inputs);
      for (const b of boundaries) {
        if (!covered.has(b)) {
          findings.push({
            subcheck: 'REQ-10',
            target: b,
            why: `serviço "${b}" tem boundary declarado sem artefato alerts-as-code válido associado`,
            enforceable: false,
          });
        }
      }
    }
  }

  return applyMode(findings, govBlock);
}

function describe(f) {
  return f.target ? `${f.target}: ${f.why}` : f.why;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`;
if (isMain) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf('--root');
  let root;
  if (rootIdx >= 0) { root = args[rootIdx + 1]; args.splice(rootIdx, 2); }
  const inputs = args;

  // Contador de controle (issue #49): `nothing to check` e "varri tudo e estava limpo" saíam os
  // dois em `OK ... exit 0`. Universo vazio é um estado próprio, contado, e por padrão reprova.
  const gateRoot = root || process.env.FORGE_ROOT || '.';
  const universeOf = (n) => universeCheck({
    root: gateRoot,
    gate: 'observability',
    count: n,
    item: 'arquivo(s)',
    scope: inputs.length ? inputs.join(' ') : '(nenhum path recebido)',
  });

  if (!inputs.length) process.exit(emitUniverse(universeOf(0)));

  const result = checkObservability(inputs, { root });

  if (result.blocking.length) {
    console.log(`CONFLICT (${result.blocking.map(describe).join('; ')})`);
    process.exit(1);
  }
  if (result.warnings.length) {
    console.log(`WARN (${result.warnings.map(describe).join('; ')})`);
    process.exit(0);
  }
  // Universo deste gate: código-fonte varrido (REQ-09b) mais os artefatos de alerts-as-code
  // (REQ-10) — os dois conjuntos que a varredura de fato abre.
  const scanned = collect(inputs, { exts: SOURCE_EXTS }).length
    + collect(inputs, { exts: new Set(['.json']) }).length;
  if (emitUniverse(universeOf(scanned)) !== 0) process.exit(1);
  console.log(`OK check-observability (${scanned} arquivo(s), no findings)`);
  process.exit(0);
}
