#!/usr/bin/env node
// forge overview generate (§16.5, W4.3). Zero-dependency. Builds the single
// navigable overview.html: the 3 C4 levels (Mermaid, rendered client-side),
// the baseline capability index, and the active change state (manifest + tasks
// progress). Deterministic (except the embedded timestamp). Mermaid is loaded
// from CDN — overview.html is a throwaway visualization artifact (.forge/graph/,
// out of commit, §20), not production code.
// Usage: overview-gen.mjs <forge-root>
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const c4Dir = join(root, '.forge/graph/c4');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// C4 diagrams are Markdown (.md) wrapping a ```mermaid block — extract the raw Mermaid
// for the HTML <pre class="mermaid"> embed (falls back to the whole file if no fence).
function readMermaid(name) {
  const p = join(c4Dir, name);
  if (!existsSync(p)) return null;
  const t = readFileSync(p, 'utf8');
  const m = t.match(/```mermaid\n([\s\S]*?)```/);
  return m ? m[1].replace(/\s+$/, '') : t;
}
const c1 = readMermaid('c1-context.md');
const c2 = readMermaid('c2-container.md');
const c3files = existsSync(c4Dir) ? readdirSync(c4Dir).filter((f) => f.startsWith('c3-component-') && f.endsWith('.md')).sort() : [];

// baseline capabilities
const capsDir = join(root, '.forge/product/current/capabilities');
const caps = existsSync(capsDir) ? readdirSync(capsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
  const sp = join(capsDir, e.name, 'spec.yaml');
  let version = '?', reqs = 0;
  if (existsSync(sp)) {
    const t = readFileSync(sp, 'utf8');
    const v = t.match(/^version:\s*(.+)$/m); if (v) version = v[1].trim();
    reqs = (t.match(/^\s*- id: REQ-/gm) || []).length;
  }
  return { name: e.name, version, reqs };
}) : [];

// active changes
const activeDir = join(root, '.forge/specs/active');
const changes = existsSync(activeDir) ? readdirSync(activeDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
  const man = join(activeDir, e.name, 'manifest.yaml');
  const tasks = join(activeDir, e.name, 'tasks.md');
  let status = '?', scale = '?';
  if (existsSync(man)) { const t = readFileSync(man, 'utf8'); status = (t.match(/^status:\s*(.+)$/m) || [])[1] || '?'; scale = (t.match(/^scale:\s*(.+)$/m) || [])[1] || '?'; }
  let done = 0, total = 0;
  if (existsSync(tasks)) { const t = readFileSync(tasks, 'utf8'); total = (t.match(/^\s*- \[.\] TASK-/gm) || []).length; done = (t.match(/^\s*- \[X\] TASK-/gm) || []).length; }
  return { name: e.name, status, scale, done, total };
}) : [];

const mermaidBlock = (title, code) => code ? `<h3>${esc(title)}</h3>\n<pre class="mermaid">\n${esc(code)}</pre>` : '';
// C3 sections wrapped for client-side filtering (search by boundary name).
const c3blocks = c3files.map((f) => {
  const name = f.replace('c3-component-', '').replace('.md', '');
  return `<section class="c3" data-name="${esc(name)}">${mermaidBlock('C3 · ' + name, readMermaid(f))}</section>`;
}).join('\n');

// module dependency analysis (graph deps --json) — deps/cycles/layer violations
let mdeps = null;
try { const p = join(root, '.forge/graph/module-deps.json'); if (existsSync(p)) mdeps = JSON.parse(readFileSync(p, 'utf8')); } catch { /* optional */ }

// domain view (light): map each capability to boundaries whose name matches it.
const boundaries = mdeps ? mdeps.modules : [];
const domainRows = caps.map((c) => {
  const key = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const matched = boundaries.filter((b) => b.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(key) || key.includes(b.split('/').pop().toLowerCase().replace(/[^a-z0-9]+/g, ''))).slice(0, 4);
  return { cap: c.name, modules: matched };
});

const LAYER_COLORS = { api: '#e3f2fd', application: '#fff3e0', domain: '#e8f5e9', infrastructure: '#f3e5f5', contracts: '#e0f7fa', test: '#eceff1', config: '#fffde7', unknown: '#fafafa' };
const legend = Object.entries(LAYER_COLORS).map(([l, c]) => `<span class="lg" style="background:${c}">${l}</span>`).join(' ');

const depsTop = mdeps ? mdeps.edges.slice().sort((a, b) => b.count - a.count).slice(0, 20) : [];
const archSection = mdeps ? `
<h2>Dependências entre módulos <span class="muted">(${mdeps.granularity})</span></h2>
<p>${mdeps.modules.length} módulos · ${mdeps.edges.length} dependências · <b>${mdeps.cycles.length}</b> ciclo(s) · <b>${mdeps.layer_violations.length}</b> violação(ões) de camada</p>
${mdeps.cycles.length ? `<h3>⚠ Ciclos (smell)</h3><ul>${mdeps.cycles.slice(0, 12).map((c) => `<li>${esc(c.join(' → '))}</li>`).join('')}</ul>` : '<p class="muted">Sem ciclos entre módulos ✓</p>'}
${Object.keys(mdeps.layer_violations_by_pair || {}).length ? `<h3>⚠ Violações de camada (clean architecture)</h3><ul>${Object.entries(mdeps.layer_violations_by_pair).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li>${esc(k)}: ${n}</li>`).join('')}</ul>` : '<p class="muted">Sem violações de camada ✓</p>'}
<h3>Top dependências (fan-out)</h3>
<table><tr><th>de</th><th>para</th><th>arestas</th></tr>${depsTop.map((e) => `<tr><td>${esc(e.from)}</td><td>${esc(e.to)}</td><td>${e.count}</td></tr>`).join('')}</table>
` : '<h2>Dependências entre módulos</h2><p class="muted">Rode <code>/forge:graph deps --json</code> para popular esta seção.</p>';

const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Forge overview</title>
<style>
 body{font:14px/1.5 system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1a1a2e}
 h1{border-bottom:2px solid #444}h2{margin-top:2.5rem;color:#16213e}
 table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:.4rem .6rem;text-align:left}
 th{background:#f4f4f8}.pre{background:#f7f7fb;padding:1rem;border-radius:6px;overflow:auto}
 pre.mermaid{background:#f7f7fb;padding:1rem;border-radius:6px}
 .muted{color:#888}
 .lg{display:inline-block;padding:.1rem .5rem;border-radius:4px;border:1px solid #ccc;margin:.1rem;font-size:12px}
 #q{padding:.4rem .6rem;width:280px;border:1px solid #ccc;border-radius:6px;margin:.5rem 0}
 section.c3.hidden{display:none}
</style></head><body>
<h1>Forge — overview</h1>
<p class="muted">Mapa navegável gerado por <code>/forge:c4</code> (determinista, engine nativo). Artefato de visualização — não editar à mão.</p>
<p><b>Camadas:</b> ${legend}</p>

<h2>C4 — Arquitetura <span class="muted">(cor = camada)</span></h2>
${mermaidBlock('C1 · System Context', c1) || '<p class="muted">C1 indisponível (rode /forge:codegraph + /forge:c4).</p>'}
${mermaidBlock('C2 · Container', c2)}
<p><input id="q" type="search" placeholder="filtrar visões C3 por módulo…"></p>
${c3blocks || '<p class="muted">Sem visões de componente (nenhum boundary com 2+ arquivos).</p>'}

${archSection}

<h2>Domínio ↔ Código <span class="muted">(capability → módulos)</span></h2>
${domainRows.length ? `<table><tr><th>Capability</th><th>Módulos relacionados</th></tr>${domainRows.map((d) => `<tr><td>${esc(d.cap)}</td><td>${d.modules.length ? esc(d.modules.join(', ')) : '<span class="muted">sem correspondência por nome</span>'}</td></tr>`).join('')}</table>` : '<p class="muted">Baseline sem capabilities para mapear.</p>'}

<h2>Baseline — Capabilities (${caps.length})</h2>
${caps.length ? `<table><tr><th>Capability</th><th>Versão</th><th>Requisitos</th></tr>${caps.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.version)}</td><td>${c.reqs}</td></tr>`).join('')}</table>` : '<p class="muted">Baseline vazio (nenhuma capability — /forge:baseline extract ou archive de changes).</p>'}

<h2>Changes ativos (${changes.length})</h2>
${changes.length ? `<table><tr><th>Change</th><th>Status</th><th>Scale</th><th>Progresso</th></tr>${changes.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.status)}</td><td>${esc(c.scale)}</td><td>${c.done}/${c.total} tasks</td></tr>`).join('')}</table>` : '<p class="muted">Nenhum change ativo.</p>'}

<script type="module">
 import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
 // limites elevados: diagramas C3 podem ter muitos nós/arestas (default maxEdges=500).
 mermaid.initialize({ startOnLoad: true, theme: 'neutral', maxEdges: 5000, maxTextSize: 2000000, securityLevel: 'loose' });
</script>
<script>
 // busca/filtro client-side das visões C3 por nome de módulo
 const q = document.getElementById('q');
 if (q) q.addEventListener('input', () => {
   const t = q.value.trim().toLowerCase();
   document.querySelectorAll('section.c3').forEach((s) => {
     s.classList.toggle('hidden', t && !s.dataset.name.toLowerCase().includes(t));
   });
 });
</script>
</body></html>
`;

writeFileSync(join(root, '.forge/graph/overview.html'), html);
console.log(`OK overview.html (C4 + ${caps.length} capabilities + ${changes.length} active change(s))`);
