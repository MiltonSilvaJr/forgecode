#!/usr/bin/env node
// forge graph symbols — camada SÍMBOLO-NÍVEL opt-in (inspirada no tree-sitter do
// Understand-Anything, mas regex zero-dep). Extrai declarações (classe/interface/
// record/struct/enum/função) por arquivo e arestas de HERANÇA entre símbolos.
//
// Honestidade: por ser regex (não AST), NÃO há call graph (resolução de chamada exige
// AST/tree-sitter); herança é best-effort por nome. Para o grafo de arquivos use
// `graph build` (preciso). Escreve .forge/graph/symbols.json (não polui graph.json).
//
// Uso: graph-symbols.mjs <forge-root>
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, relative } from 'node:path';

const root = resolve(process.argv[2] || '.');
const graphPath = join(root, '.forge/graph/graph.json');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', '.forge', 'coverage', '.next', 'vendor', 'storybook-static', 'wwwroot', '_archive', 'TestResults', '.vs', '.idea', '.venv', '__pycache__', '.turbo', '.cache']);
const LANG = { '.cs': 'csharp', '.ts': 'ts', '.tsx': 'ts', '.js': 'js', '.jsx': 'js', '.mjs': 'js', '.cjs': 'js', '.py': 'python', '.java': 'jvm', '.kt': 'jvm', '.kts': 'jvm' };
const SKIP_FILE = /\.min\.(js|css)$|\.bundle\.js$/;

// reaproveita as camadas já calculadas no graph.json quando existir
const layerByFile = new Map();
if (existsSync(graphPath)) { try { for (const n of JSON.parse(readFileSync(graphPath, 'utf8')).nodes) layerByFile.set(n.id, n.layer); } catch { /* ignore */ } }

function walk(dir, acc = []) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, acc); }
    else if (LANG[extname(e.name)] && !SKIP_FILE.test(e.name)) acc.push(p);
  }
  return acc;
}

// declarações + base de herança por linguagem
const DECL = {
  csharp: /\b(class|interface|record|struct|enum)\s+([A-Za-z_]\w*)(?:\s*<[^>]*>)?(?:\s*:\s*([A-Za-z_][\w.<>, ]*))?/g,
  ts: /\b(class|interface|enum)\s+([A-Za-z_]\w*)(?:\s*<[^>]*>)?(?:\s+extends\s+([A-Za-z_][\w.<>]*))?|\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)/g,
  js: /\b(class)\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_][\w.]*))?|\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)/g,
  python: /\b(class)\s+([A-Za-z_]\w*)\s*(?:\(\s*([A-Za-z_][\w., ]*)\))?|\bdef\s+([A-Za-z_]\w*)/g,
  // Java/Kotlin: type keyword + name + optional inheritance base (extends/implements/`:`).
  // `(?:class\s+)?` absorbs the `class` of Kotlin's `enum class X`, so the name is X, not
  // the literal word "class". Base capture stops before '(' so a Kotlin superclass
  // constructor call (Bar()) yields Bar.
  jvm: /\b(class|interface|record|object|enum)\s+(?:class\s+)?([A-Za-z_]\w*)(?:\s*<[^>]*>)?(?:\s*(?::|extends|implements)\s+([A-Za-z_][\w.<>, ]*))?/g,
};

const files = walk(root);
const symbols = [];      // {id, file, name, type, line, layer}
const inherit = [];      // {from, base}
const byName = new Map();

for (const f of files) {
  const lang = LANG[extname(f)];
  const rel = relative(root, f);
  const layer = layerByFile.get(rel) || 'unknown';
  let src; try { src = readFileSync(f, 'utf8'); } catch { continue; }
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const re = DECL[lang]; re.lastIndex = 0;
  for (const m of src.matchAll(re)) {
    let type, name, base = null;
    if (m[1] && m[2]) { type = m[1]; name = m[2]; base = m[3] || null; }     // class/interface/...
    else if (m[4]) { type = 'function'; name = m[4]; }                        // ts function
    else if (m[5]) { type = 'function'; name = m[5]; }                        // js function
    else if (m[6]) { type = 'function'; name = m[6]; }                        // py def
    else continue;
    const id = `${rel}#${name}`;
    symbols.push({ id, file: rel, name, type, line: lineOf(m.index), layer });
    if (!byName.has(name)) byName.set(name, id);
    if (base) for (const b of base.split(',').map((s) => s.trim().replace(/<.*/, '')).filter(Boolean)) inherit.push({ from: id, base: b });
  }
}

// resolve herança por nome (best-effort; primeiro símbolo com aquele nome)
const edges = inherit.map(({ from, base }) => {
  const to = byName.get(base);
  return { from, to: to || base, kind: 'inherits', resolved: !!to };
});

symbols.sort((a, b) => a.id.localeCompare(b.id));
edges.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
const byType = {}; for (const s of symbols) byType[s.type] = (byType[s.type] || 0) + 1;

const out = {
  schema: 'symbols/v0',
  engine: 'native-regex',
  note: 'declarações + herança (best-effort). Sem call graph (exige AST/tree-sitter).',
  stats: { symbols: symbols.length, by_type: byType, inherit_edges: edges.length, resolved: edges.filter((e) => e.resolved).length },
  symbols,
  edges,
};
writeFileSync(join(root, '.forge/graph/symbols.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`OK symbols.json (${symbols.length} símbolos: ${Object.entries(byType).map(([t, n]) => `${n} ${t}`).join(', ')}; ${edges.length} herança, ${out.stats.resolved} resolvidas)`);
