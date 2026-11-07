#!/usr/bin/env node
// forge mermaid→drawio — converte um diagrama Mermaid (flowchart) em .drawio (mxGraph XML)
// EDITÁVEL visualmente no draw.io/diagrams.net. Fecha o handoff: o Mermaid é a fonte de
// verdade (texto, versionável) e o .drawio é a edição visual com shapes manipuláveis.
//
// Suporta o subconjunto usado pelos diagramas do Forge:
//   nós:   id["..."]  id(["..."])  id[("...")]  id{{"..."}}  id{"..."}  (e id solto)
//   grupos: subgraph ID["título"] ... end  (aninhados)
//   edges:  -->  -->|lbl|  -.->  -. lbl .->  ==>  ==>|lbl|  com `&` em ambos os lados e cadeias
//   estilo: classDef nome fill:#..,stroke:#..  ·  class a,b nome  ·  linkStyle i,j stroke:#..
// Zero-dep. Uso: mermaid-to-drawio.mjs <arquivo.md|.mmd> [--out <arquivo.drawio>]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const inFile = process.argv[2];
if (!inFile || !existsSync(inFile)) { console.error('Uso: mermaid-to-drawio.mjs <arquivo.md|.mmd> [--out <drawio>]'); process.exit(1); }
const outArg = process.argv.indexOf('--out');
const outFile = outArg >= 0 ? process.argv[outArg + 1] : inFile.replace(/\.(md|mmd)$/, '.drawio');

// 1. extrair o bloco mermaid (ou usar o arquivo inteiro se .mmd)
let raw = readFileSync(inFile, 'utf8');
const fence = raw.match(/```mermaid\n([\s\S]*?)```/);
const src = fence ? fence[1] : raw;

// 2. parse ------------------------------------------------------------------
const lines = src.split('\n').map((l) => l.replace(/%%.*$/, '').trimEnd()).filter((l) => l.trim());
let direction = 'LR';
const nodes = new Map();        // id -> {id, label, shape, container}
const order = [];               // ordem de declaração de nós/containers no nível
const containers = new Map();   // id -> {id, title, parent, children:[], fill, stroke}
const edges = [];               // {from, to, kind, label}
const classDef = new Map();     // name -> {fill, stroke, dash}
const nodeClass = new Map();    // nodeId -> className
const linkStyles = [];          // {idx, color, width}
const stack = [];               // pilha de containers abertos

const NODE_RE = /^([A-Za-z0-9_]+)\s*(\[\(("?)([\s\S]*?)\3\)\]|\(\[("?)([\s\S]*?)\5\]\)|\{\{("?)([\s\S]*?)\7\}\}|\[("?)([\s\S]*?)\9\]|\{("?)([\s\S]*?)\11\})?\s*$/;
function shapeOf(decl) {
  if (!decl) return ['rect', null];
  if (decl.startsWith('[(')) return ['cylinder', decl.slice(2, -2).replace(/^"|"$/g, '')];
  if (decl.startsWith('([')) return ['stadium', decl.slice(2, -2).replace(/^"|"$/g, '')];
  if (decl.startsWith('{{')) return ['hexagon', decl.slice(2, -2).replace(/^"|"$/g, '')];
  if (decl.startsWith('{')) return ['rhombus', decl.slice(1, -1).replace(/^"|"$/g, '')];
  if (decl.startsWith('[')) return ['rect', decl.slice(1, -1).replace(/^"|"$/g, '')];
  return ['rect', null];
}
function ensureNode(id, decl, container) {
  if (!nodes.has(id)) { nodes.set(id, { id, label: id, shape: 'rect', container: container ?? null }); order.push({ kind: 'node', id }); }
  const n = nodes.get(id);
  if (decl) { const [shape, label] = shapeOf(decl); n.shape = shape; if (label != null) n.label = label; }
  if (container !== undefined && n.container == null && container != null) n.container = container;
  return n;
}

// operadores de edge (ordem: mais específico primeiro)
const OP = /(==>\|[^|]*\||==>|-->\|[^|]*\||-->|-\.\s*[^.|]*?\s*\.->|-\.->|--[xo]|---)/;
function opInfo(op) {
  let kind = 'arrow', label = '';
  if (op.startsWith('==>')) kind = 'thick';
  else if (op.startsWith('-.')) kind = 'dotted';
  const lbar = op.match(/\|([^|]*)\|/); if (lbar) label = lbar[1].trim();
  const ldot = op.match(/-\.\s*([^.|]+?)\s*\.->/); if (ldot) label = ldot[1].trim();
  return { kind, label };
}
const splitAmp = (s) => s.split('&').map((x) => x.trim()).filter(Boolean);
// extrai id de um operando que pode trazer decl de shape (ex.: fw{{"..."}})
function operandIds(token, container) {
  return splitAmp(token).map((t) => {
    const m = t.match(NODE_RE);
    if (m) { ensureNode(m[1], m[2], container); return m[1]; }
    const id = t.replace(/[^A-Za-z0-9_].*$/, '');
    if (id) ensureNode(id, null, container);
    return id;
  }).filter(Boolean);
}

for (const ln of lines) {
  const t = ln.trim();
  let m;
  if ((m = t.match(/^flowchart\s+(TB|TD|LR|RL|BT)/i))) { direction = m[1].toUpperCase().replace('TD', 'TB'); continue; }
  if (/^graph\s+/i.test(t)) { const d = t.match(/^graph\s+(TB|TD|LR|RL|BT)/i); if (d) direction = d[1].toUpperCase().replace('TD', 'TB'); continue; }
  if ((m = t.match(/^subgraph\s+([A-Za-z0-9_]+)\s*\[("?)([\s\S]*?)\2\]\s*$/)) || (m = t.match(/^subgraph\s+([A-Za-z0-9_]+)\s*$/))) {
    const id = m[1], title = m[3] || m[1];
    const parent = stack.length ? stack[stack.length - 1] : null;
    containers.set(id, { id, title, parent, children: [], fill: '#f5f5f5', stroke: '#9e9e9e' });
    if (parent) containers.get(parent).children.push({ kind: 'container', id });
    else order.push({ kind: 'container', id });
    stack.push(id);
    continue;
  }
  if (/^end$/.test(t)) { stack.pop(); continue; }
  if ((m = t.match(/^classDef\s+(\w+)\s+(.+);?$/))) {
    const style = m[2]; const fill = (style.match(/fill:\s*(#[0-9a-fA-F]+)/) || [])[1];
    const stroke = (style.match(/stroke:\s*(#[0-9a-fA-F]+)/) || [])[1];
    const dash = /stroke-dasharray/.test(style);
    classDef.set(m[1], { fill, stroke, dash }); continue;
  }
  if ((m = t.match(/^class\s+([A-Za-z0-9_,\s]+)\s+(\w+)\s*;?$/))) {
    for (const id of m[1].split(',').map((x) => x.trim()).filter(Boolean)) nodeClass.set(id, m[2]); continue;
  }
  if ((m = t.match(/^linkStyle\s+([\d,\s]+)\s+(.+);?$/))) {
    const idxs = m[1].split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => !isNaN(x));
    const color = (m[2].match(/stroke:\s*(#[0-9a-fA-F]+)/) || [])[1];
    const width = (m[2].match(/stroke-width:\s*(\d+)/) || [])[1];
    for (const i of idxs) linkStyles[i] = { color, width }; continue;
  }
  // linha de edge? (contém um operador)
  if (OP.test(t)) {
    const cont = stack.length ? stack[stack.length - 1] : null;
    const parts = t.split(OP);                       // [op0, sep, op1, sep, op2, ...]
    const operands = []; const ops = [];
    for (let i = 0; i < parts.length; i++) { if (i % 2 === 0) operands.push(parts[i].trim()); else ops.push(parts[i]); }
    for (let i = 0; i < ops.length; i++) {
      const froms = operandIds(operands[i], cont);
      const tos = operandIds(operands[i + 1], cont);
      const { kind, label } = opInfo(ops[i]);
      for (const f of froms) for (const to of tos) edges.push({ from: f, to, kind, label });
    }
    continue;
  }
  // senão, declaração de nó dentro (ou fora) de um subgraph
  if ((m = t.match(NODE_RE)) && m[1]) {
    ensureNode(m[1], m[2], stack.length ? stack[stack.length - 1] : null);
    continue;
  }
}

// aplica classes -> fill/stroke por nó
for (const n of nodes.values()) {
  const c = nodeClass.get(n.id); if (c && classDef.has(c)) { const s = classDef.get(c); n.fill = s.fill; n.stroke = s.stroke; n.dash = s.dash; }
}

// 3. layout — Graphviz (dot) para posicionamento limpo, com fallback zero-dep (colunas).
const esc = (s) => { let r = String(s).split(/<br\s*\/?>/i).join('@@BR@@'); r = r.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\x22/g, '&quot;'); return r.split('@@BR@@').join('&lt;br&gt;'); };
const nodeStyle = (n) => {
  const fill = n.fill || '#ffffff', stroke = n.stroke || '#333333';
  const base = `whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};`;
  if (n.shape === 'cylinder') return `shape=cylinder3;backgroundOutline=1;${base}verticalAlign=middle;`;
  if (n.shape === 'stadium') return `rounded=1;arcSize=50;${base}`;
  if (n.shape === 'hexagon') return `shape=hexagon;perimeter=hexagonPerimeter2;${base}`;
  if (n.shape === 'rhombus') return `rhombus;${base}`;
  return `rounded=1;arcSize=8;${base}`;
};
const r2 = (v) => Math.round(v * 10) / 10;
const NW = 200, NH = 56, GAP = 18, HEADER = 34, PAD = 18;

function graphvizLayout() {
  const rankdir = (direction === 'LR' || direction === 'RL') ? 'LR' : 'TB';
  const q = (s) => '"' + String(s).replace(/"/g, '\\"') + '"';
  const one = (s) => String(s).replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
  let dot = `digraph G {\n  rankdir=${rankdir};\n  graph [nodesep=0.6,ranksep=1.0,fontsize=12];\n  node [shape=box,fixedsize=true,width=2.0,height=0.7,fontsize=11];\n  edge [fontsize=10];\n`;
  const done = new Set();
  const emitC = (cid, ind) => {
    const c = containers.get(cid);
    dot += `${ind}subgraph "cluster_${cid}" {\n${ind}  label=${q(c.title)};\n`;
    for (const n of nodes.values()) if (n.container === cid) { dot += `${ind}  ${q(n.id)} [label=${q(one(n.label || n.id))}];\n`; done.add(n.id); }
    for (const ch of c.children) if (ch.kind === 'container') emitC(ch.id, ind + '  ');
    dot += `${ind}}\n`;
  };
  for (const o of order) if (o.kind === 'container') emitC(o.id, '  ');
  for (const n of nodes.values()) if (!done.has(n.id)) dot += `  ${q(n.id)} [label=${q(one(n.label || n.id))}];\n`;
  edges.forEach((e) => { if (nodes.has(e.from) && nodes.has(e.to)) dot += `  ${q(e.from)} -> ${q(e.to)}${e.label ? ` [label=${q(one(e.label))}]` : ''};\n`; });
  dot += '}\n';
  let out;
  try { out = execFileSync('dot', ['-Tjson'], { input: dot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return null; }
  let j; try { j = JSON.parse(out); } catch { return null; }
  const bb = (j.bb || '0,0,1000,1000').split(',').map(Number); const Hpt = bb[3];
  const abs = new Map();
  for (const o of (j.objects || [])) {
    if (typeof o.name === 'string' && o.name.startsWith('cluster_')) {
      const b = (o.bb || '0,0,0,0').split(',').map(Number);
      abs.set('c_' + o.name.slice(8), { x: b[0], y: Hpt - b[3], w: b[2] - b[0], h: b[3] - b[1] });
    } else if (o.pos) {
      const [x, y] = o.pos.split(',').map(Number);
      const w = (parseFloat(o.width) || 2) * 72, h = (parseFloat(o.height) || 0.7) * 72;
      abs.set('n_' + o.name, { x: x - w / 2, y: (Hpt - y) - h / 2, w, h });
    }
  }
  for (const n of nodes.values()) if (!abs.has('n_' + n.id)) return null;
  return abs;
}

function columnLayout() {
  const abs = new Map();
  function size(cid) {
    const c = containers.get(cid);
    const cn = [...nodes.values()].filter((n) => n.container === cid);
    const cc = c.children.filter((ch) => ch.kind === 'container').map((ch) => ch.id);
    let y = HEADER, maxw = NW; const rel = [];
    for (const n of cn) { rel.push({ t: 'n', id: n.id, x: PAD, y, w: NW, h: NH }); y += NH + GAP; }
    for (const k of cc) { const s = size(k); rel.push({ t: 'c', id: k, x: PAD, y, w: s.w, h: s.h }); y += s.h + GAP; maxw = Math.max(maxw, s.w); }
    c._rel = rel; c._w = Math.max(maxw, NW) + 2 * PAD; c._h = y + PAD - GAP; return { w: c._w, h: c._h };
  }
  const top = order.filter((o) => o.kind === 'container' || (o.kind === 'node' && nodes.get(o.id) && nodes.get(o.id).container == null));
  for (const it of top) if (it.kind === 'container') size(it.id);
  const horiz = direction === 'LR' || direction === 'RL';
  let cx = 40, cy = 40;
  const place = (cid, ox, oy) => { const c = containers.get(cid); abs.set('c_' + cid, { x: ox, y: oy, w: c._w, h: c._h }); for (const r of c._rel) { if (r.t === 'n') abs.set('n_' + r.id, { x: ox + r.x, y: oy + r.y, w: r.w, h: r.h }); else place(r.id, ox + r.x, oy + r.y); } };
  for (const it of top) { const w = it.kind === 'container' ? containers.get(it.id)._w : NW; const h = it.kind === 'container' ? containers.get(it.id)._h : NH; if (it.kind === 'container') place(it.id, cx, cy); else abs.set('n_' + it.id, { x: cx, y: cy, w: NW, h: NH }); if (horiz) cx += w + 60; else cy += h + 50; }
  return abs;
}

const gv = graphvizLayout();
const absGeo = gv || columnLayout();
const layoutEngine = gv ? 'graphviz' : 'colunas';

// 4. emit mxGraph (geometria relativa ao container pai)
const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
const relGeo = (id, parentCell) => { const a = absGeo.get(id); if (!a) return null; if (!parentCell || parentCell === '1') return a; const p = absGeo.get(parentCell); return p ? { x: a.x - p.x, y: a.y - p.y, w: a.w, h: a.h } : a; };
const emittedC = new Set();
function emitCont(cid) {
  if (emittedC.has(cid)) return; const c = containers.get(cid);
  if (c.parent && !emittedC.has(c.parent)) emitCont(c.parent);
  const parentCell = c.parent ? `c_${c.parent}` : '1';
  const g = relGeo('c_' + cid, parentCell) || { x: 0, y: 0, w: 220, h: 120 };
  const style = `rounded=1;arcSize=3;whiteSpace=wrap;html=1;fillColor=#fbfbfb;strokeColor=${c.stroke};verticalAlign=top;fontStyle=1;container=1;collapsible=0;`;
  cells.push(`<mxCell id="c_${cid}" value="${esc(c.title)}" style="${style}" vertex="1" parent="${parentCell}"><mxGeometry x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(g.w)}" height="${r2(g.h)}" as="geometry"/></mxCell>`);
  emittedC.add(cid);
}
for (const cid of containers.keys()) emitCont(cid);
for (const n of nodes.values()) {
  const parentCell = n.container ? `c_${n.container}` : '1';
  const g = relGeo('n_' + n.id, parentCell); if (!g) continue;
  cells.push(`<mxCell id="n_${n.id}" value="${esc(n.label)}" style="${nodeStyle(n)}" vertex="1" parent="${parentCell}"><mxGeometry x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(g.w)}" height="${r2(g.h)}" as="geometry"/></mxCell>`);
}

edges.forEach((e, i) => {
  if (!nodes.has(e.from) || !nodes.has(e.to)) return;
  const ls = linkStyles[i] || {};
  let st = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;';
  if (e.kind === 'dotted') st += 'dashed=1;';
  if (e.kind === 'thick') st += 'strokeWidth=3;';
  if (ls.color) st += `strokeColor=${ls.color};`;
  if (ls.width) st += `strokeWidth=${ls.width};`;
  cells.push(`<mxCell id="e${i}" value="${esc(e.label || '')}" style="${st}" edge="1" parent="1" source="n_${e.from}" target="n_${e.to}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
});

const xml = `<mxfile host="forge" type="device"><diagram id="forge-diagram" name="Diagram"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" math="0" shadow="0"><root>
${cells.join('\n')}
</root></mxGraphModel></diagram></mxfile>\n`;
writeFileSync(resolve(outFile), xml);
console.log(`OK ${outFile} (${nodes.size} nós, ${containers.size} grupos, ${edges.length} arestas; layout: ${layoutEngine})`);
