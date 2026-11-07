#!/usr/bin/env node
// forge infra-diagram — scaffold de diagram-as-code (mingrammer/diagrams) a partir da
// infra detectada (docker-compose). Emite um <out>/infra.py com clusters (Edge/Serviços/
// Dados/Observabilidade), ícones reais mapeados pela imagem, e arestas iniciais. É um
// SCAFFOLD: o humano refina (topologia de rede/PCI não está no compose). Zero-dep.
//
// Uso: infra-scan.mjs <repo-root> [--out <dir>]  (default out: docs/diagrams)
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(process.argv[2] || '.');
const outArg = process.argv.indexOf('--out');
const outDir = resolve(outArg >= 0 ? process.argv[outArg + 1] : join(root, 'docs/diagrams'));

// localizar compose files
function findCompose(dir, depth = 0, acc = []) {
  if (depth > 3) return acc;
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) findCompose(p, depth + 1, acc);
    else if (/^(docker-)?compose([.-][\w]+)?\.ya?ml$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const composeFiles = findCompose(root).filter((f) => !/override\.ya?ml\.example$/.test(f));
if (!composeFiles.length) { console.log('FAIL (nenhum docker-compose encontrado)'); process.exit(1); }

// parse services + image (targeted; compose: services: -> 2sp nome: -> image:)
const services = new Map(); // name -> image
for (const f of composeFiles) {
  let txt = ''; try { txt = readFileSync(f, 'utf8'); } catch { continue; }
  const lines = txt.split('\n'); let inSvcs = false, cur = null;
  for (const ln of lines) {
    if (/^services:\s*$/.test(ln)) { inSvcs = true; continue; }
    if (inSvcs && /^[A-Za-z]/.test(ln)) inSvcs = false;       // saiu do bloco services:
    if (!inSvcs) continue;
    const m = ln.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
    if (m) { cur = m[1]; if (!services.has(cur)) services.set(cur, ''); continue; }
    const im = ln.match(/^\s+image:\s*["']?([^"'\s]+)["']?/);
    if (im && cur) services.set(cur, im[1]);
  }
}

// mapeamento imagem/nome -> {module, cls, group, label}
const REG = [
  [/kong/i, 'diagrams.onprem.network', 'Kong', 'edge', 'Kong API Gateway'],
  [/istio/i, 'diagrams.onprem.network', 'Istio', 'edge', 'Istio'],
  [/traefik/i, 'diagrams.onprem.network', 'Traefik', 'edge', 'Traefik'],
  [/nginx/i, 'diagrams.onprem.network', 'Nginx', 'edge', 'Nginx'],
  [/postgres|pgvector/i, 'diagrams.onprem.database', 'PostgreSQL', 'data', 'PostgreSQL'],
  [/mysql|mariadb/i, 'diagrams.onprem.database', 'Mysql', 'data', 'MySQL'],
  [/mongo/i, 'diagrams.onprem.database', 'MongoDB', 'data', 'MongoDB'],
  [/redis/i, 'diagrams.onprem.inmemory', 'Redis', 'data', 'Redis'],
  [/rabbitmq/i, 'diagrams.onprem.queue', 'RabbitMQ', 'data', 'RabbitMQ'],
  [/kafka/i, 'diagrams.onprem.queue', 'Kafka', 'data', 'Kafka'],
  [/jaeger/i, 'diagrams.onprem.tracing', 'Jaeger', 'obs', 'Jaeger'],
  [/grafana/i, 'diagrams.onprem.monitoring', 'Grafana', 'obs', 'Grafana'],
  [/prometheus/i, 'diagrams.onprem.monitoring', 'Prometheus', 'obs', 'Prometheus'],
  [/localai|ollama|llama/i, 'diagrams.generic.compute', 'Rack', 'ai', 'AI/LLM'],
];
const classify = (name, image) => {
  const hay = `${name} ${image}`;
  for (const [re, mod, cls, group, label] of REG) if (re.test(hay)) return { mod, cls, group, label };
  return { mod: 'diagrams.k8s.compute', cls: 'Deployment', group: 'svc', label: name };
};

const py = (s) => 'py_' + s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
const nodes = [...services.entries()].map(([name, image]) => ({ name, image, ...classify(name, image) }));
const imports = new Map(); // module -> Set(class)
imports.set('diagrams.onprem.client', new Set(['Users']));
for (const n of nodes) { if (!imports.has(n.mod)) imports.set(n.mod, new Set()); imports.get(n.mod).add(n.cls); }

const GROUPS = [['edge', 'Edge (DMZ)'], ['svc', 'Serviços'], ['data', 'Dados'], ['ai', 'AI/LLM'], ['obs', 'Observabilidade']];
const projName = (() => { try { const fm = readFileSync(join(root, '.forge/FORGE.md'), 'utf8').match(/display:\s*(.+)/); return fm ? fm[1].trim() : 'Projeto'; } catch { return 'Projeto'; } })();

let out = `#!/usr/bin/env python3
"""${projName} — infraestrutura (SCAFFOLD gerado por /forge:infra-diagram).

Gerado a partir de ${composeFiles.length} arquivo(s) compose. Refine à mão: arestas de rede,
zonas de confiança e escopo de compliance NÃO vêm do compose. Render: python3 infra.py
(requer graphviz + pip install diagrams).
"""
from diagrams import Diagram, Cluster, Edge
${[...imports.entries()].map(([m, cs]) => `from ${m} import ${[...cs].sort().join(', ')}`).join('\n')}

graph_attr = {"fontsize": "18", "bgcolor": "white", "pad": "0.5"}

with Diagram("${projName} — Infraestrutura", filename="infra", outformat="png",
             show=False, direction="LR", graph_attr=graph_attr):
    users = Users("Usuário")
`;
for (const [g, title] of GROUPS) {
  const gn = nodes.filter((n) => n.group === g);
  if (!gn.length) continue;
  out += `\n    with Cluster("${title}"):\n`;
  for (const n of gn) out += `        ${py(n.name)} = ${n.cls}("${n.label}")\n`;
}
// arestas scaffold: users -> edge -> serviços -> dados
const byG = (g) => nodes.filter((n) => n.group === g).map((n) => py(n.name));
const edge = byG('edge'), svc = byG('svc'), data = byG('data');
out += `\n    # arestas (SCAFFOLD — ajuste para o fluxo real)\n`;
// diagrams suporta `node >> [lista]` e `[lista] >> node`, mas NÃO `[lista] >> [lista]`.
if (edge.length) out += `    users >> Edge(label="HTTPS") >> ${edge.length > 1 ? `[${edge.join(', ')}]` : edge[0]}\n`;
if (edge.length && svc.length) out += `    ${edge[0]} >> Edge(color="darkgreen") >> [${svc.join(', ')}]\n`;
if (svc.length && data.length) for (const d of data) out += `    [${svc.join(', ')}] >> Edge(color="firebrick", style="dotted") >> ${d}\n`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'infra.py'), out);

// ── versão EDITÁVEL em Mermaid (texto; edita em VS Code / Mermaid Live; o draw.io
// importa Mermaid p/ edição visual). Cilindro p/ dados, retângulo p/ o resto; cor por grupo.
const GSTYLE = {
  edge: 'fill:#f3e5f5,stroke:#7b1fa2', svc: 'fill:#e3f2fd,stroke:#1565c0',
  data: 'fill:#e0f7fa,stroke:#00838f', ai: 'fill:#fff3e0,stroke:#ef6c00',
  obs: 'fill:#eceff1,stroke:#546e7a',
};
const mid = (s) => 'm_' + py(s).slice(3);
const mer = ['flowchart LR', '  users(["Usuário"])'];
for (const [g, title] of GROUPS) {
  const gn = nodes.filter((n) => n.group === g);
  if (!gn.length) continue;
  mer.push(`  subgraph ${g.toUpperCase()}["${title}"]`);
  for (const n of gn) mer.push(`    ${mid(n.name)}${g === 'data' ? `[("${n.label}")]` : `["${n.label}"]`}`);
  mer.push('  end');
}
if (edge.length) mer.push(`  users -->|HTTPS| ${mid(nodes.find((n) => n.group === 'edge').name)}`);
const e0 = nodes.find((n) => n.group === 'edge');
for (const n of nodes.filter((x) => x.group === 'svc')) if (e0) mer.push(`  ${mid(e0.name)} --> ${mid(n.name)}`);
for (const d of nodes.filter((x) => x.group === 'data')) for (const s of nodes.filter((x) => x.group === 'svc')) mer.push(`  ${mid(s.name)} -.-> ${mid(d.name)}`);
for (const [g, st] of Object.entries(GSTYLE)) mer.push(`  classDef ${g} ${st};`);
for (const n of nodes) mer.push(`  class ${mid(n.name)} ${n.group};`);
const md = `# ${projName} — Infraestrutura (editável)\n\n` +
  '> Scaffold Mermaid gerado por `/forge:infra-diagram`. **Editável**: VS Code (preview), Mermaid\n' +
  '> Live Editor, ou importe no **draw.io** (Inserir → Mermaid) para editar visualmente com ícones.\n' +
  '> Refine à mão: rede, zonas de confiança e escopo de compliance não vêm do compose.\n\n' +
  '```mermaid\n' + mer.join('\n') + '\n```\n';
writeFileSync(join(outDir, 'infra.md'), md);

// .drawio EDITÁVEL VISUAL (converte o Mermaid via mermaid-to-drawio.mjs) — opcional.
let drawio = '';
try {
  const conv = join(dirname(fileURLToPath(import.meta.url)), 'mermaid-to-drawio.mjs');
  execFileSync(process.execPath, [conv, join(outDir, 'infra.md'), '--out', join(outDir, 'infra.drawio')], { stdio: 'ignore' });
  if (existsSync(join(outDir, 'infra.drawio'))) drawio = ' + infra.drawio (draw.io)';
} catch { /* draw.io é opcional */ }

console.log(`OK ${join(outDir, 'infra.py')} + infra.md (editável)${drawio} (${nodes.length} serviços: ${GROUPS.map(([g, t]) => `${byG(g).length} ${g}`).filter((s) => !s.startsWith('0')).join(', ')})`);
