#!/usr/bin/env node
// forge graph build (engine: native, ADR 0001 — W4.1). Zero-dependency (Node >= 20).
// Builds .forge/graph/graph.json deterministically: nodes = source files
// (lang/loc/structural fingerprint/layer); edges = internal import/reference
// relations. LLM never runs here — summaries are carried over from the cache by
// fingerprint, so a cosmetic change (comment/whitespace) keeps the fingerprint,
// keeps the cached summary, and costs ZERO tokens (§16.2).
//
// Usage: graph-build.mjs <repo-root> [--out <dir>]
// Output: "OK .forge/graph/graph.json (N nodes, M edges; S summaries stale)" or "FAIL (...)".
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, extname, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { readForgeFrontmatter, compileLayerMap, resolveLayer, layerCoverage } from './graph-layers.mjs';

const root = resolve(process.argv[2] || '.');
const outArg = process.argv.indexOf('--out');
const outDir = outArg >= 0 ? resolve(process.argv[outArg + 1]) : join(root, '.forge/graph');
const cacheDir = join(outDir, 'cache');

// Build/output/vendored dirs are excluded: they hold generated artifacts (minified
// bundles, archived copies) that pollute the graph with non-source nodes (G2).
//
// `bin` is deliberately NOT here. The name means opposite things in different ecosystems: in
// .NET/Java it is where the compiler writes output, in Node it is the entrypoint declared in
// package.json — source code by any definition. Skipping it by name removed the CLI entrypoint
// from the graph of every Node project, silently, and /forge:impact, /forge:onboard and
// /forge:c4 all read that graph. The .NET meaning is handled by SKIP_UNDER_BIN below, which is
// contextual: only the build-output subdirectories of a `bin/` are pruned.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'obj', '.forge', 'coverage',
  '.next', 'vendor', 'storybook-static', 'wwwroot', '_archive', 'TestResults',
  '.vs', '.idea', '.venv', '__pycache__', '.turbo', '.cache',
]);
// Subdirectories of a `bin/` that are compiler output (.NET/Java): bin/Debug, bin/Release,
// bin/x64, bin/net8.0, … Pruned only when the PARENT directory is literally `bin` — a
// `src/Debug/` of someone's own making is not touched. This is what keeps generated `.cs`
// (which matches LANG) out of the graph now that `bin` itself is walked.
const SKIP_UNDER_BIN = /^(Debug|Release|x64|x86|AnyCPU|Any CPU|net[0-9]|netstandard|netcoreapp)/i;
// `.sh`/`.bash` entram como NÓ (lang: shell) e nada além disso (LDG-0027). Um script chamando
// outro por `bash caminho/x.sh` é dependência real, mas quase sempre via variável resolvida em
// runtime (`$SCRIPT_DIR/x.sh`, `$ROOT/.forge/scripts/x.sh`) — medido neste próprio repositório,
// é o idioma dominante em template/.forge/scripts/**. Uma aresta "resolvida" contra um literal de
// variável não resolvida seria precisão fingida (o oposto do que GO_IMPORT/PY_IMPORT fazem hoje,
// que ao menos preservam o identificador real, ainda que não resolvido). Nó sem aresta e dito
// aqui é honesto; aresta fantasma não é. Ver tests/w165-codegraph-scan-roots-gate.sh [3].
const LANG = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'js', '.ts': 'ts', '.tsx': 'ts', '.cs': 'csharp', '.go': 'go', '.py': 'python', '.kt': 'kotlin', '.kts': 'kotlin', '.java': 'java', '.sh': 'shell', '.bash': 'shell' };
// Broader census map for the coverage rule (§19.5): every programming language worth
// counting, INCLUDING ones the extractor does not model (swift/rust/…), so `validate
// graph` can name a dominant language that has no nodes (issue #18). Header-only C/C++
// extensions (.h/.hpp) are deliberately excluded: they are ambiguous (C vs C++) and are
// the dominant source of vendored/NDK noise that would falsely outrank real app code.
// Computed in the SAME walk that builds nodes, so validate never re-walks the tree.
const CENSUS_EXT = {
  ...LANG,
  '.swift': 'swift', '.rb': 'ruby', '.rs': 'rust', '.php': 'php', '.scala': 'scala',
  '.dart': 'dart', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.c': 'c', '.m': 'objc', '.mm': 'objc',
};
// Minified/generated files are not source — skip even when they carry a source extension (G2).
const SKIP_FILE = /\.min\.(js|css)$|\.bundle\.js$/;

// ── governance: authz:/observability: blocks from FORGE.md frontmatter (§2.3) ──
// The frontmatter itself is read once by readForgeFrontmatter (lib/graph-layers.mjs) with the
// same zero-dep yaml-lite parser validate-spec.mjs uses — no second YAML dialect (NFR-01) and
// no second read of the file. Absence of FORGE.md, or of the blocks themselves, is a no-op:
// governanceBlocks stays {} and no node gets tagged, no `governance` is emitted
// (REQ-11 AC — never a false positive). This never touches the awk parsers of
// spec-verify.sh/pre-push, which only read `runtime:`.
function readGovernanceBlocks(fm) {
  const out = {};
  if (!fm || typeof fm !== 'object') return out;
  if (fm.authz && typeof fm.authz === 'object' && !Array.isArray(fm.authz)) out.authz = fm.authz;
  if (fm.observability && typeof fm.observability === 'object' && !Array.isArray(fm.observability)) out.observability = fm.observability;
  return out;
}

// glob → RegExp: `*` matches within one path segment (never `/`). The pattern
// matches the declared directory/file itself AND everything under it, since
// pep_paths/wrapper_paths name directories (e.g. "packages/pep") that own many
// source files, or occasionally a single file.
function globToRegExp(glob) {
  const escaped = String(glob).split('/')
    .map((seg) => seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('/');
  return new RegExp(`^${escaped}(?:/.*)?$`);
}

// Uma leitura só do frontmatter do FORGE.md serve os dois consumidores: os blocos de
// governança (§2.3) e o bloco `codegraph:` do mapa de camadas declarável (issue #38).
const forgeFrontmatter = readForgeFrontmatter(root);
const governanceBlocks = readGovernanceBlocks(forgeFrontmatter);
const layerMap = compileLayerMap(forgeFrontmatter);
// codegraph.include_paths (LDG-0027): caminhos que são código-fonte mesmo quando o nome bateria
// com o default de "pular" (prefixo de ponto ou SKIP_DIRS) — ver walk() abaixo e o cabeçalho de
// lib/graph-layers.mjs (responsabilidade 4). Vazio (bloco/arquivo ausente) = walk de hoje, byte
// a byte — é o que o gate w141[2] compara contra o golden pré-mudança.
const includeGlobs = layerMap.includeGlobs || [];
const pepPatterns = (governanceBlocks.authz && Array.isArray(governanceBlocks.authz.pep_paths)
  ? governanceBlocks.authz.pep_paths : []).map(globToRegExp);
const wrapperPatterns = (governanceBlocks.observability && Array.isArray(governanceBlocks.observability.wrapper_paths)
  ? governanceBlocks.observability.wrapper_paths : []).map(globToRegExp);
// roles: ["pep"] / ["otel-wrapper"] tag nodes whose id matches a declared glob —
// consumed by lib/graph-govern.mjs (TASK-12) for reachability from layer:api.
function rolesFor(id) {
  const roles = [];
  if (pepPatterns.some((re) => re.test(id))) roles.push('pep');
  if (wrapperPatterns.some((re) => re.test(id))) roles.push('otel-wrapper');
  return roles;
}

const census = {}; // census-lang -> file count (walk-populated, persisted in stats)
function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    // LDG-0027: um caminho declarado em codegraph.include_paths vence o default de "pular" —
    // tanto o prefixo de ponto quanto SKIP_DIRS/SKIP_UNDER_BIN. Sem declaração (includeGlobs
    // vazio, o caso de todo projeto consumidor) forcedInclude é sempre false e o walk abaixo é
    // idêntico ao de antes desta chave existir.
    const relId = relative(root, p);
    const forcedInclude = includeGlobs.length > 0 && includeGlobs.some((re) => re.test(relId));
    if (!forcedInclude && e.name.startsWith('.') && e.name !== '.') continue;
    if (e.isDirectory()) {
      if (!forcedInclude) {
        if (SKIP_DIRS.has(e.name)) continue;
        // contextual: só poda saída de compilação quando o pai é um `bin/` de verdade
        if (basename(dir) === 'bin' && SKIP_UNDER_BIN.test(e.name)) continue;
      }
      walk(p, acc);
    }
    else if (!SKIP_FILE.test(e.name)) {
      const ext = extname(e.name);
      const cl = CENSUS_EXT[ext];
      if (cl) census[cl] = (census[cl] || 0) + 1;
      if (LANG[ext]) acc.push(p);
    }
  }
  return acc;
}

// structural fingerprint: drop whole-line comments and blank lines, then collapse
// ALL whitespace (including line breaks) to single spaces and sha256. Stable
// against cosmetic edits — comment lines, blank lines, reindentation and line
// reflow (breaking one statement across lines); changes on structural edits
// (new import/declaration/token). Inline comments (code // foo) are a known
// limitation: they shift the fingerprint conservatively (re-process, never miss).
function structuralFingerprint(src) {
  const norm = src.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(\/\/|#|\*|\/\*|\*\/)/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(norm).digest('hex');
}

// Layer classification: o mapa DECLARADO em `codegraph.layers` (frontmatter do FORGE.md) vence,
// e a heurística embutida — convenções de pasta + sufixo de projeto .NET — é o default de quem
// não declarou nada. Ambos vivem em lib/graph-layers.mjs; ver o cabeçalho de lá para o porquê
// da configuração morar no FORGE.md e não no forge.yaml (issue #38).

// per-language import extraction → resolved internal edges
const JS_IMPORT = /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|require\s*\(\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
const CS_USING = /^\s*using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/gm;
const CS_NAMESPACE = /^\s*namespace\s+([A-Za-z_][\w.]*)/gm;
const GO_IMPORT = /(?:^\s*import\s+"([^"]+)"|^\s*"([^"]+)"\s*$)/gm;
const PY_IMPORT = /^\s*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;
// JVM (Java/Kotlin): package=directory convention makes import→file resolution
// deterministic (issue #18). Both capture only the fully-qualified spec and stop at the
// first space/`;`/comment, so a Kotlin alias (`import a.b.C as D`), a stray semicolon or a
// trailing `// comment` never breaks the match. Both support wildcard (`import a.b.*`).
// Static/nested member imports (`import static a.b.C.m`, Kotlin `import a.b.C.*` for an
// object) resolve by stripping trailing member segments until a declared type matches.
// The wildcard is `\*?` (not `(?:\.\*)?`) because `[\w.]*` already consumes the dot before
// `*`; anchoring the star separately avoids the greedy class swallowing it (there is no
// trailing `;` to force backtracking now that the match is not end-anchored).
const JAVA_IMPORT = /^\s*import\s+(?:static\s+)?([A-Za-z_][\w.]*\*?)/gm;
const KOTLIN_IMPORT = /^\s*import\s+([A-Za-z_][\w.]*\*?)/gm;
const JVM_PACKAGE = /^\s*package\s+([A-Za-z_][\w.]*)/m;
// top-level type declarations. `enum class X` (Kotlin) needs the optional `class` between
// `enum` and the name — otherwise the name is misparsed as the literal word "class".
// Java `enum X` (no `class`), `object`/`record`, and Java `@interface` are covered too.
const JVM_TYPE = /\b(?:class|interface|record|object)\s+([A-Za-z_]\w*)|\benum\s+(?:class\s+)?([A-Za-z_]\w*)|@interface\s+([A-Za-z_]\w*)/g;
// Kotlin top-level declarations (fun/val/const val/typealias) — column-0 anchored so
// indented class members are not indexed. Optional receiver (`fun String.trimAll`) and
// generics are skipped; the trailing identifier is the importable name.
const KT_TOPLEVEL = /^(?:(?:public|internal|private|expect|actual|external|inline|suspend|tailrec|operator|infix|annotation)\s+)*(?:fun|val|var|typealias|const\s+val)\s+(?:<[^>]*>\s*)?(?:[A-Za-z_][\w.<>?, ]*\.)?([A-Za-z_]\w*)/gm;
// strip block and line comments before scanning declarations, so a Javadoc/KDoc comment
// that merely mentions a type name does not register a phantom declaration (a comment
// `// see record UserPayload` must not make this file "declare" UserPayload).
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

function resolveJsTarget(fromFile, spec, fileSet) {
  if (!spec.startsWith('.')) return null; // external dep
  const base = resolve(dirname(fromFile), spec);
  const cands = [base, base + '.ts', base + '.tsx', base + '.js', base + '.mjs', base + '.jsx',
    join(base, 'index.ts'), join(base, 'index.js'), join(base, 'index.mjs')];
  for (const c of cands) if (fileSet.has(c)) return c;
  return null;
}

const files = walk(root);
const fileSet = new Set(files);
const nodes = [];
const edges = [];
const srcCache = new Map();
const read = (f) => { if (!srcCache.has(f)) srcCache.set(f, readFileSync(f, 'utf8')); return srcCache.get(f); };

// C#: index namespace -> declaring files (for using resolution)
const nsToFiles = new Map();
for (const f of files) {
  if (LANG[extname(f)] !== 'csharp') continue;
  for (const m of read(f).matchAll(CS_NAMESPACE)) {
    const ns = m[1];
    if (!nsToFiles.has(ns)) nsToFiles.set(ns, []);
    nsToFiles.get(ns).push(f);
  }
}

// JVM (Java/Kotlin): index fully-qualified type name -> declaring file(s), plus
// package -> files (for wildcard imports). Two keys per declared type: pkg.TypeName
// (authoritative — handles multiple types per file and Kotlin's filename≠class case)
// and pkg.FileBasename (fallback, Java's one-public-class-per-file convention).
const jvmDeclToFiles = new Map();   // "com.foo.Bar" -> [files]
const jvmPkgToFiles = new Map();    // "com.foo" -> [files]
const addTo = (map, key, f) => { if (!map.has(key)) map.set(key, []); if (!map.get(key).includes(f)) map.get(key).push(f); };
for (const f of files) {
  const lang = LANG[extname(f)];
  if (lang !== 'java' && lang !== 'kotlin') continue;
  const raw = read(f);
  const pm = raw.match(JVM_PACKAGE);
  if (!pm) continue; // no package → cannot resolve by convention (e.g. default package)
  const pkg = pm[1];
  const src = stripComments(raw);
  addTo(jvmPkgToFiles, pkg, f);
  const base = f.split('/').pop().replace(/\.[^.]+$/, '');
  addTo(jvmDeclToFiles, `${pkg}.${base}`, f);
  for (const m of src.matchAll(JVM_TYPE)) {
    const name = m[1] || m[2] || m[3];
    if (name) addTo(jvmDeclToFiles, `${pkg}.${name}`, f);
  }
  // Kotlin top-level fun/val/typealias are importable by name but are not types;
  // index them so `import pkg.trimAll` resolves to the declaring file.
  if (lang === 'kotlin') {
    for (const m of src.matchAll(KT_TOPLEVEL)) {
      if (m[1]) addTo(jvmDeclToFiles, `${pkg}.${m[1]}`, f);
    }
  }
}

// Resolve a JVM import spec to internal declaring file(s). A wildcard is either a package
// wildcard (`pkg.*` → every file in the package) or an object/class member wildcard
// (Kotlin `pkg.Obj.*` → the file declaring Obj); try both. A non-wildcard spec strips
// trailing member/nested segments until a declared type matches. Returns [] for external
// deps (androidx.*, java.util.*, …), which — like C# — produce no edge.
function resolveJvmTargets(spec) {
  if (spec.endsWith('.*')) {
    const base = spec.slice(0, -2);
    return jvmPkgToFiles.get(base) || jvmDeclToFiles.get(base) || [];
  }
  let s = spec;
  while (s.includes('.')) {
    if (jvmDeclToFiles.has(s)) return jvmDeclToFiles.get(s);
    s = s.slice(0, s.lastIndexOf('.'));
  }
  return [];
}

for (const f of files) {
  const src = read(f);
  const lang = LANG[extname(f)];
  const id = relative(root, f);
  const { layer, declared } = resolveLayer(id, layerMap);
  const node = { id, lang, loc: src.split('\n').length, fingerprint: structuralFingerprint(src), layer, summary: null };
  // `taxonomy: "out"` só nasce de uma DECLARAÇÃO explícita de `layer: unknown` — é a afirmação
  // "a taxonomia domain/application/infrastructure/api/contracts não descreve este path"
  // (frontend, tooling, conteúdo estático). `unknown` por queda da heurística continua sendo
  // lacuna, e um repositório que não declara nada produz exatamente o grafo de antes.
  if (declared && layer === 'unknown') node.taxonomy = 'out';
  const roles = rolesFor(id);
  if (roles.length) node.roles = roles;
  nodes.push(node);

  if (lang === 'js' || lang === 'ts') {
    for (const m of src.matchAll(JS_IMPORT)) {
      const target = resolveJsTarget(f, m[1], fileSet);
      if (m[1].startsWith('.')) edges.push({ from: id, to: target ? relative(root, target) : m[1], kind: 'import', resolved: !!target });
    }
  } else if (lang === 'csharp') {
    for (const m of src.matchAll(CS_USING)) {
      const targets = nsToFiles.get(m[1]);
      if (targets) for (const t of targets) { if (t !== f) edges.push({ from: id, to: relative(root, t), kind: 'namespace', resolved: true }); }
    }
  } else if (lang === 'go') {
    for (const m of src.matchAll(GO_IMPORT)) {
      const spec = m[1] || m[2];
      if (spec && spec.includes('/')) edges.push({ from: id, to: spec, kind: 'import', resolved: false });
    }
  } else if (lang === 'python') {
    for (const m of src.matchAll(PY_IMPORT)) {
      const spec = m[1] || m[2];
      if (spec && spec.startsWith('.')) edges.push({ from: id, to: spec, kind: 'import', resolved: false });
    }
  } else if (lang === 'java' || lang === 'kotlin') {
    const re = lang === 'java' ? JAVA_IMPORT : KOTLIN_IMPORT;
    const seen = new Set();
    for (const m of src.matchAll(re)) {
      for (const t of resolveJvmTargets(m[1])) {
        if (t === f) continue;
        const to = relative(root, t);
        if (seen.has(to)) continue; // dedup wildcard fan-in from the same file
        seen.add(to);
        edges.push({ from: id, to, kind: 'import', resolved: true });
      }
    }
  }
}

// carry over cached summaries by fingerprint (zero tokens on cosmetic changes)
let summariesStale = 0;
const prevSummaries = existsSync(join(cacheDir, 'summaries.json'))
  ? JSON.parse(readFileSync(join(cacheDir, 'summaries.json'), 'utf8')) : {};
for (const n of nodes) {
  const cached = prevSummaries[n.id];
  if (cached && cached.fingerprint === n.fingerprint && cached.summary) n.summary = cached.summary;
  else if (n.summary === null) summariesStale++;
}

nodes.sort((a, b) => a.id.localeCompare(b.id));
edges.sort((a, b) => (a.from + a.to + a.kind).localeCompare(b.from + b.to + b.kind));

const langs = [...new Set(nodes.map((n) => n.lang))].sort();
const censusSorted = Object.fromEntries(Object.entries(census).sort((a, b) => a[0].localeCompare(b[0])));
const graph = {
  schema: 'graph/v0',
  generated_at: new Date().toISOString(),
  engine: 'native',
  root,
  // layer_coverage é métrica DERIVADA (não muda classificação nenhuma): classificados sobre a
  // população em escopo da taxonomia. O que o repositório declarou fora da taxonomia sai do
  // denominador — ver lib/graph-layers.mjs (issue #38).
  stats: { nodes: nodes.length, edges: edges.length, languages: langs, summaries_stale: summariesStale, census: censusSorted, layer_coverage: layerCoverage(nodes) },
  nodes,
  edges,
};
// governance: only emitted when the FORGE.md frontmatter declared authz:/observability:
// (§2.3). Absence ⇒ key absent ⇒ downstream gates (graph-govern.mjs) see no governance
// and stay a no-op — never a false positive (REQ-11 AC).
if (governanceBlocks.authz || governanceBlocks.observability) {
  graph.governance = {};
  if (governanceBlocks.authz) graph.governance.authz = governanceBlocks.authz;
  if (governanceBlocks.observability) graph.governance.observability = governanceBlocks.observability;
}

mkdirSync(cacheDir, { recursive: true });
writeFileSync(join(outDir, 'graph.json'), JSON.stringify(graph, null, 2) + '\n');
// fingerprints cache (drives incremental update)
const fp = {}; for (const n of nodes) fp[n.id] = n.fingerprint;
writeFileSync(join(cacheDir, 'fingerprints.json'), JSON.stringify(fp, null, 2) + '\n');
// summaries cache (preserve carried-over)
const sum = {}; for (const n of nodes) if (n.summary) sum[n.id] = { fingerprint: n.fingerprint, summary: n.summary };
writeFileSync(join(cacheDir, 'summaries.json'), JSON.stringify(sum, null, 2) + '\n');
// report.md (human-readable, deterministic)
const cov = graph.stats.layer_coverage;
const byLayer = {};
for (const n of nodes) byLayer[n.layer] = (byLayer[n.layer] || 0) + 1;
const report = [
  `# Code Graph — report`, '',
  `- Engine: native (zero-dep)`,
  `- Nodes: ${nodes.length} · Edges: ${edges.length}`,
  `- Languages: ${langs.join(', ') || '—'}`,
  `- Summaries stale (need LLM curation): ${summariesStale}`, '',
  `## Nodes per layer`, '',
  ...Object.entries(byLayer).sort().map(([l, c]) => `- ${l}: ${c}`), '',
  `## Layer coverage`, '',
  `- Classified: ${cov.classified} of ${cov.denominator} node(s) in taxonomy scope` + (cov.ratio === null ? ' (no node in scope — coverage undefined)' : ` (${(cov.ratio * 100).toFixed(1)}%)`),
  `- Out of taxonomy (declared in codegraph.layers as \`unknown\`): ${cov.out_of_taxonomy} — excluded from the denominator, NOT a gap`,
  `- Unclassified (heuristic found no layer): ${cov.unclassified}` + (cov.unclassified ? ' — declare the layout in `codegraph.layers` (FORGE.md) if these are backend code' : ''), '',
  `## Unresolved edges (external deps or unknown targets)`, '',
  `- ${edges.filter((e) => !e.resolved).length} unresolved`, '',
].join('\n');
writeFileSync(join(outDir, 'report.md'), report + '\n');

console.log(`OK .forge/graph/graph.json (${nodes.length} nodes, ${edges.length} edges; ${summariesStale} summaries stale)`);
