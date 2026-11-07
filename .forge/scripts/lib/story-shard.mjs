// lib/story-shard.mjs — cobertura de story sharding (scale >= 3, §17.1), como CÓDIGO.
//
// POR QUE ESTE ARQUIVO EXISTE (issue #35)
//
// O contrato scale-adaptive já DECLARAVA que scale >= 3 soma story sharding ao fluxo
// (`commands/specs/spec.md` tabela de scale, `commands/specs/tasks.md`, e o próprio
// `spec-manifest.schema.json` já trazia `dev_loop.sharded`/`epic_context_compiled` e
// "story-sharding" no enum de `quick_plan.skipped_phases`) — mas nada verificava que o shard de
// fato aconteceu antes de `/forge:implement` entrar no loop TASK a TASK. `dev_loop.sharded`
// podia ficar `false` para sempre e a implementação seguia em silêncio, sem `epic_context.md`
// nem stories auto-contidas: o mesmo anti-padrão que motivou `tasks-graph.mjs` (checkTasksGraph)
// para o grafo de TASKs — aqui é o grafo de STORIES.
//
// DECISÃO: frontmatter de STORY.md tem parser PRÓPRIO, não reaproveita yaml-lite.mjs.
//
// `depends_on` em STORY.md é sempre flow-style (`[]`, `[STORY-01]` — é o que o template
// `.forge/templates/story/STORY.md` e o comando `/forge:shard` emitem). yaml-lite.mjs já
// parseia array flow-style não-vazio (LDG-0033 resolvido — ver lib/yaml-lite.mjs e
// tests/w162-yaml-lite-flow-array-gate.sh), então a razão original para o parser próprio não
// se aplica mais. Mesmo assim ele fica: um regex dedicado para os três campos que este arquivo
// lê (story_id, depends_on, status) de um frontmatter isolado é mais barato do que carregar o
// parser de DOCUMENTO inteiro (`parseYamlSubset`) só para três linhas — trocar exigiria reescrever
// o frontmatter como um mini-documento YAML e perderia a leitura tolerante a Markdown ao redor
// que este parser próprio já tem.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// `- [ ] TASK-07 — título`. Mesmos quatro estados de tracker do TASK_RE de tasks-graph.mjs —
// reconhece a task independente do checkbox estar marcado.
const TASK_ASSIGN_RE = /^\s*[-*]\s*\[([ xX\-!])\]\s*TASK-0*([0-9]+)\b/;

function normId(n) { return `TASK-${String(n).padStart(2, '0')}`; }

// parseStoryFrontmatter(text) → { storyId, dependsOn, status } | null (sem bloco --- --- válido
// ou sem story_id). dependsOn é sempre array (vazio quando `depends_on: []` ou ausente).
export function parseStoryFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const body = m[1];
  const idM = /^story_id:\s*(.+)$/m.exec(body);
  if (!idM) return null;
  const depM = /^depends_on:\s*\[([^\]]*)\]/m.exec(body);
  const statusM = /^status:\s*(.+)$/m.exec(body);
  const dependsOn = depM ? depM[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  return { storyId: idM[1].trim(), dependsOn, status: statusM ? statusM[1].trim() : null };
}

// parseStories(storiesDir) → { stories, errors }.
//   stories: [{ id, file, dependsOn, status, taskIds }]
//   errors: problemas ESTRUTURAIS do diretório em si (ausente, vazio, frontmatter malformado) —
//   nunca lançam, viram achado, como todo o resto deste módulo. Vacuidade (diretório ausente ou
//   sem nenhum STORY-NN.md) é SEMPRE erro explícito aqui — nunca stories: [] silencioso, que o
//   chamador poderia confundir com "nada para cobrir".
export function parseStories(storiesDir) {
  if (!existsSync(storiesDir)) return { stories: [], errors: [`stories/ não existe (${storiesDir})`] };
  const files = readdirSync(storiesDir).filter((f) => /^STORY-[0-9]+.*\.md$/.test(f)).sort();
  if (!files.length) return { stories: [], errors: [`stories/ existe mas não contém nenhum STORY-NN.md (${storiesDir})`] };
  const stories = [];
  const errors = [];
  for (const f of files) {
    const text = readFileSync(join(storiesDir, f), 'utf8');
    const fm = parseStoryFrontmatter(text);
    if (!fm) { errors.push(`stories/${f}: frontmatter ausente ou sem story_id`); continue; }
    const taskIds = [];
    for (const line of text.split('\n')) {
      const m = TASK_ASSIGN_RE.exec(line);
      if (m) taskIds.push(normId(Number(m[2])));
    }
    stories.push({ id: fm.storyId, file: f, dependsOn: fm.dependsOn, status: fm.status, taskIds });
  }
  return { stories, errors };
}

// checkStoryCoverage(taskIds, stories) → string[]. Cada TASK de tasks.md precisa aparecer em
// EXATAMENTE UMA story (nem zero — furo; nem duas ou mais — disputa da mesma unidade de
// trabalho). Também acusa story referenciando TASK que não existe em tasks.md.
export function checkStoryCoverage(taskIds, stories) {
  const findings = [];
  const count = new Map();
  for (const t of taskIds) count.set(t, 0);
  for (const s of stories) for (const t of s.taskIds) count.set(t, (count.get(t) || 0) + 1);
  for (const id of taskIds) {
    const n = count.get(id) || 0;
    if (n === 0) findings.push(`${id} não aparece em nenhuma story (stories/*.md)`);
    else if (n > 1) findings.push(`${id} aparece em ${n} stories — deve pertencer a exatamente uma`);
  }
  const known = new Set(taskIds);
  for (const s of stories) for (const t of s.taskIds) if (!known.has(t))
    findings.push(`stories/${s.file}: referencia ${t}, que não existe em tasks.md`);
  return findings;
}

// checkStoryCycle(stories) → string[]. DFS com pilha explícita de caminho (mesmo desenho do
// TSK-02 de tasks-graph.mjs), no grafo depends_on das STORIES.
export function checkStoryCycle(stories) {
  const findings = [];
  const byId = new Map(stories.map((s) => [s.id, s]));
  const state = new Map();
  const reported = new Set();
  const path = [];
  const walk = (id) => {
    const s = byId.get(id);
    if (!s) return;
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cut = path.indexOf(id);
      const cycle = [...path.slice(cut), id];
      const key = [...cycle].slice(0, -1).sort().join('>');
      if (!reported.has(key)) {
        reported.add(key);
        findings.push(`ciclo de dependência entre stories — ${cycle.join(' → ')}`);
      }
      return;
    }
    state.set(id, 'visiting');
    path.push(id);
    for (const d of s.dependsOn) {
      if (!byId.has(d)) { findings.push(`stories/${s.file}: depends_on referencia ${d}, que não existe`); continue; }
      walk(d);
    }
    path.pop();
    state.set(id, 'done');
  };
  for (const s of byId.values()) walk(s.id);
  return findings;
}
