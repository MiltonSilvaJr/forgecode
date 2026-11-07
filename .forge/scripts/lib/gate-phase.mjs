#!/usr/bin/env node
// lib/gate-phase.mjs — leitura de `runtime.gates` COM FASE (issue #82).
//
// O contrato de gate do harness é inteiramente em forma de árvore de fontes: todo gate recebe
// caminho de repositório e lê arquivos; runtime.gates é lista plana; hooks rodam no commit e no
// push — os três momentos em que o artefato implantável ainda não existe. Isso deixa o harness
// sem onde declarar um gate que só faz sentido depois do build/deploy (digest publicado,
// manifesto renderizado, cluster no ar). A fase é o que falta: cada gate declarado passa a ter
// uma FASE, e "source" (implícita) é a única que os hooks/wave-close continuam executando.
//
// Duas formas aceitas em runtime.gates (retrocompat total — nunca as duas ao mesmo tempo):
//
//   escalar CSV, numa linha (COMO SEMPRE FOI):
//     gates: check-authz,check-observability
//   → cada nome vira {name, phase:"source"}. Lida em bash puro por
//     lib/forge-runtime.sh::forge_runtime_gate_entries (a forma CSV NUNCA passa por este
//     módulo — zero dependência nova para quem já usa runtime.gates hoje).
//
//   block-sequence YAML (NOVO), quando o valor inline de "gates:" está vazio:
//     gates:
//       - check-red-first                       # escalar → phase: source
//       - name: check-migrate-image-provenance   # mapeada, sem phase → phase: source
//       - name: check-helm-digests               # mapeada, com phase
//         phase: pre-deploy
//
// Reaproveita o parser único do subset YAML do harness (lib/yaml-lite.mjs) — a mesma razão por
// trás de impact-freshness.mjs/tasks-graph.mjs: uma fórmula, não N cópias bespoke a divergir.
// FORGE.md não é YAML puro (é frontmatter `---`…`---` seguido de prosa markdown); a extração do
// bloco de frontmatter aqui é a mesma regra usada por sync-adapters.mjs (fmExtract).
//
// gateEntries(forgeRoot) → [{name, phase}], TODAS as fases declaradas (forma CSV inclusive, se
// chamado isoladamente por um consumidor que só tenha node — mas o caminho real do harness lê a
// CSV em bash e só cai aqui para a forma mapeada; ver forge_runtime_gate_entries).
//
// CLI: gate-phase.mjs entries <root> [phase] → "name<TAB>phase" por linha, uma por gate;
// filtra por phase quando informada. Nunca lança para YAML fora do subconjunto suportado —
// falha só é ERRO DE USO (root/arquivo ausente já responde lista vazia, igual ao bash).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseYamlSubset } from './yaml-lite.mjs';

export function frontmatterOf(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  return m ? m[1] : '';
}

export function gateEntries(forgeRoot) {
  const p = join(forgeRoot, '.forge/FORGE.md');
  if (!existsSync(p)) return [];
  const fm = frontmatterOf(readFileSync(p, 'utf8'));
  if (!fm) return [];
  let doc;
  try {
    doc = parseYamlSubset(fm);
  } catch {
    return []; // best-effort — bash já cobre a forma CSV; um frontmatter fora do subset aqui
    // não é regressão nova (a forma mapeada simplesmente não é lida, como se ausente).
  }
  const raw = doc && doc.runtime && doc.runtime.gates;
  if (raw == null) return [];
  if (typeof raw === 'string') return []; // forma CSV — não é papel deste módulo
  if (!Array.isArray(raw)) return []; // "gates:" presente e vazio, sem itens de sequence
  const out = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item) out.push({ name: item, phase: 'source' });
      continue;
    }
    if (item && typeof item === 'object' && item.name) {
      out.push({ name: String(item.name), phase: item.phase ? String(item.phase) : 'source' });
    }
  }
  return out;
}

// CLI
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const [cmd, root, phase] = process.argv.slice(2);
  if (cmd !== 'entries' || !root) {
    console.error('uso: gate-phase.mjs entries <root> [phase]');
    process.exit(2);
  }
  const list = gateEntries(root).filter((e) => !phase || e.phase === phase);
  for (const e of list) process.stdout.write(`${e.name}\t${e.phase}\n`);
}
