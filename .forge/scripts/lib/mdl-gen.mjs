#!/usr/bin/env node
// forge mdl (PoC, EXPERIMENTAL) — gera diagramas na notação MDL 2.0 (mdlmodel.com) a
// partir do code graph. MDL é uma notação VISUAL (sem DSL textual oficial); aqui mapeamos
// seus 7 elementos (USER, DATA, BACK-END, FRONT-END, BLACK-BOX, PART, BOUNDARY) e 5
// conectores (LINK, ALWAYS LINK, ESPECIALIZAÇÃO, VIRTUAL LINK, COMPOSIÇÃO) para Mermaid.
// Limitação honesta: Mermaid não desenha as pontas exatas da MDL (triângulo/círculo) — o
// TIPO do conector vai no marcador «...» do rótulo; elementos levam «tipo» (estilo MDL «...»).
//
// Saída: .forge/graph/mdl/{mdl-context.md, mdl-component-<service>.md, README.md}
// Uso: mdl-gen.mjs <forge-root> [--service <nome>]
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const root = resolve(process.argv[2] || '.');
const svcArg = (() => { const i = process.argv.indexOf('--service'); return i >= 0 ? process.argv[i + 1] : null; })();
const gpath = join(root, '.forge/graph/graph.json');
if (!existsSync(gpath)) { console.log('FAIL (no graph — run: graph.sh build)'); process.exit(1); }
const g = JSON.parse(readFileSync(gpath, 'utf8'));
const mdlDir = join(root, '.forge/graph/mdl');
mkdirSync(mdlDir, { recursive: true });

const sym = existsSync(join(root, '.forge/graph/symbols.json')) ? JSON.parse(readFileSync(join(root, '.forge/graph/symbols.json'), 'utf8')) : { symbols: [], edges: [] };

// rótulo seguro p/ Mermaid (mantém «» e /; remove o que quebra parser)
const lab = (s) => String(s).replace(/["[\]{}|;<>]/g, ' ').replace(/\s+/g, ' ').trim();

// ── boundaries do grafo ───────────────────────────────────────────────────────
const BR = ['backend', 'frontend', 'services', 'apps', 'packages', 'src'];
const boundaryOf = (id) => { const p = id.split('/'); return BR.includes(p[0]) && p.length > 1 ? `${p[0]}/${p[1]}` : (p.length > 1 ? p[0] : '(root)'); };
const boundaries = [...new Set(g.nodes.map((n) => boundaryOf(n.id)))].sort();
const services = boundaries.filter((b) => /^backend\/.*-service$/.test(b));
const frontends = boundaries.filter((b) => b.startsWith('frontend/'));
const shared = boundaries.filter((b) => /backend\/shared/.test(b));

// ── DATA stores: varre infra (docker/helm/kubernetes) por imagens conhecidas ───
const STORES = [
  [/postgres|postgresql/i, 'PostgreSQL'], [/mongo/i, 'MongoDB'], [/redis/i, 'Redis'],
  [/rabbitmq/i, 'RabbitMQ'], [/kafka/i, 'Kafka'], [/mysql/i, 'MySQL'], [/elasticsearch/i, 'Elasticsearch'],
];
const detected = new Set();
function scan(dir, depth = 0) {
  if (depth > 4) return; let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) scan(p, depth + 1);
    else if (/\.(ya?ml)$/.test(e.name)) { let t = ''; try { t = readFileSync(p, 'utf8'); } catch { /* */ } for (const [re, name] of STORES) if (re.test(t)) detected.add(name); }
  }
}
for (const d of ['docker', 'helm', 'kubernetes', 'k8s', 'deploy']) { const p = join(root, d); if (existsSync(p)) scan(p); }
const dataStores = [...detected].sort();

// ── helpers de elemento/conector MDL → Mermaid ────────────────────────────────
const elClass = `
  classDef user fill:#fff8e1,stroke:#f9a825,color:#7a5900;
  classDef data fill:#e0f7fa,stroke:#00838f,color:#00484f;
  classDef backend fill:#e3f2fd,stroke:#1565c0,color:#0d3c78;
  classDef frontend fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c;
  classDef blackbox fill:#eceff1,stroke:#37474f,color:#1c2429;
  classDef part fill:#e8f5e9,stroke:#2e7d32,color:#194d22;`.trim().split('\n').map((l) => '  ' + l.trim());

const legend = [
  '## Legenda MDL', '',
  '**Elementos:** `«user»` USER · `«data»` DATA (cilindro) · `«back-end»` BACK-END · `«front-end»` FRONT-END · `«black-box»` BLACK-BOX · `«part»` PART · BOUNDARY = caixa/subgraph.', '',
  '**Conectores:** `LINK` (seta sólida) · `«always»` ALWAYS LINK (seta grossa, interação constante) · `«especialização»` herança · `«virtual»` VIRTUAL (pontilhada) · `«composição»` COMPOSIÇÃO.', '',
  '> PoC: Mermaid não desenha as pontas exatas da MDL; o tipo do conector está no marcador `«...»` do rótulo.', '',
].join('\n');

function writeDoc(base, title, mermaid) {
  const md = `# ${title}\n\n> Notação **MDL 2.0** (mdlmodel.com) — PoC gerada por \`/forge:graph mdl\` a partir do code graph.\n> Renderiza em qualquer previewer Markdown com Mermaid (VS Code, GitHub).\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n${legend}`;
  writeFileSync(join(mdlDir, `${base}.md`), md);
}

// ── C(ontexto): USER → FRONT-END → BACK-END (boundary) ==> DATA ───────────────
const ctx = ['flowchart TD', '  u(["Operador «user»"]):::user'];
ctx.push('  subgraph FE["Apresentação «boundary»"]');
for (const fe of frontends) ctx.push(`    fe_${slug(fe)}["${lab(fe.split('/').pop())} «front-end»"]:::frontend`);
if (!frontends.length) ctx.push('    fe_none["(sem frontend) «front-end»"]:::frontend');
ctx.push('  end');
ctx.push('  subgraph BK["Backend «boundary»"]');
for (const s of services) ctx.push(`    ${id(s)}["${lab(s.split('/').pop())} «back-end»"]:::backend`);
for (const sh of shared) ctx.push(`    ${id(sh)}[["${lab(sh.split('/').pop())} «black-box»"]]:::blackbox`);
ctx.push('  end');
if (dataStores.length) {
  ctx.push('  subgraph DB["Dados «boundary»"]');
  for (const d of dataStores) ctx.push(`    db_${slug(d)}[("${d} «data»")]:::data`);
  ctx.push('  end');
}
// conectores de contexto no nível de TIER/BOUNDARY (honesto e legível — sem overclaim
// "cada serviço usa cada store"; a MDL usa BOUNDARY como container de tier).
for (const fe of frontends) ctx.push(`  u -->|"acessa (1)"| fe_${slug(fe)}`);
for (const fe of frontends) ctx.push(`  fe_${slug(fe)} -->|"REST (2)"| BK`);
for (const d of dataStores) ctx.push(`  BK ==>|"«always» persiste/usa"| db_${slug(d)}`);
ctx.push(...elClass);
writeDoc('mdl-context', 'MDL · Contexto — sistema, tiers e dados', ctx.join('\n'));

// ── Componente de um serviço: PARTs (.NET) + COMPOSIÇÃO + LINK + ESPECIALIZAÇÃO ─
const sizeOf = (b) => g.nodes.filter((n) => boundaryOf(n.id) === b).length;
const targetSvc = svcArg ? services.find((s) => s.includes(svcArg)) || services[0] : services.sort((a, b) => sizeOf(b) - sizeOf(a))[0];
let compCount = 0;
if (targetSvc) {
  // PARTs = projetos .NET dentro do serviço (segmento DotPascalCase)
  const partOf = (id2) => { const p = id2.split('/'); const i = p.findIndex((s) => /^[A-Z][A-Za-z0-9]*(\.[A-Z][A-Za-z0-9]*)+$/.test(s)); return i >= 0 ? p[i] : null; };
  const files = g.nodes.filter((n) => boundaryOf(n.id) === targetSvc);
  const parts = [...new Set(files.map((n) => partOf(n.id)).filter(Boolean))].sort();
  const layerOfPart = {};
  for (const n of files) { const pt = partOf(n.id); if (pt && !layerOfPart[pt]) layerOfPart[pt] = n.layer; }
  // LINKs entre parts (arestas resolvidas cross-part)
  const pe = new Map();
  for (const e of g.edges) { if (!e.resolved) continue; const a = partOf(e.from), b = partOf(e.to); if (a && b && a !== b && boundaryOf(e.from) === targetSvc && boundaryOf(e.to) === targetSvc) pe.set(`${a}>${b}`, (pe.get(`${a}>${b}`) || 0) + 1); }
  const comp = ['flowchart TD', `  svc["${lab(targetSvc.split('/').pop())} «back-end»"]:::backend`];
  comp.push(`  subgraph B["${lab(targetSvc.split('/').pop())} «boundary»"]`);
  for (const pt of parts) comp.push(`    ${id(pt)}["${lab(pt)} «part»"]:::part`);
  comp.push('  end');
  for (const pt of parts) comp.push(`  svc -->|"«composição»"| ${id(pt)}`);
  for (const k of [...pe.keys()].sort()) { const [a, b] = k.split('>'); comp.push(`  ${id(a)} -->|"depende (${pe.get(k)})"| ${id(b)}`); }
  // ESPECIALIZAÇÃO: até 5 heranças resolvidas dentro do serviço
  const inSvc = (p) => p && p.startsWith(targetSvc.replace(/^backend\//, '').split('/')[0]) || false;
  const inh = sym.edges.filter((e) => e.kind === 'inherits' && e.resolved && e.from.includes(targetSvc.split('/').pop().replace('-service', '')) ).slice(0, 5);
  for (const e of inh) {
    const a = `s_${slug(e.from)}`, b = `s_${slug(e.to)}`;
    comp.push(`  ${a}["${lab(e.from.split('#').pop())}"]:::part`);
    comp.push(`  ${b}["${lab(e.to.split('#').pop())}"]:::part`);
    comp.push(`  ${a} -->|"«especialização»"| ${b}`);
  }
  comp.push(...elClass);
  writeDoc(`mdl-component-${slug(targetSvc.split('/').pop())}`, `MDL · Componente — ${targetSvc} (PARTs, composição, especialização)`, comp.join('\n'));
  compCount = 1;
}

// README
writeFileSync(join(mdlDir, 'README.md'), [
  '# Diagramas MDL (PoC)', '',
  'Notação **MDL 2.0** (https://mdlmodel.com) derivada do code graph (determinista, zero tokens).',
  'MDL é visual — aqui aproximamos com Mermaid; o tipo de cada conector vai no marcador `«...»`.', '',
  '- `mdl-context.md` — USER → FRONT-END → BACK-END (BOUNDARY) ==«always»==> DATA.',
  '- `mdl-component-*.md` — PARTs (.NET) de um serviço + COMPOSIÇÃO + LINK + ESPECIALIZAÇÃO (herança real).', '',
  `Detectado: ${services.length} back-ends, ${frontends.length} front-end(s), ${dataStores.length} data store(s) [${dataStores.join(', ') || '—'}].`, '',
  '> Limitação: pontas exatas da MDL (triângulo/círculo/filled) não existem no Mermaid flowchart; um renderer MDL nativo seria trabalho futuro.', '',
].join('\n'));

console.log(`OK mdl/ (contexto + ${compCount} componente${targetSvc ? ` [${targetSvc}]` : ''}; back-ends ${services.length}, data ${dataStores.length} [${dataStores.join(', ')}])`);

// utils
function slug(s) { return String(s).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase(); }
function id(s) { return 'n_' + slug(s); }
