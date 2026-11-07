#!/usr/bin/env node
// forge discover (lite, W2.3 — §16.1): cheap deterministic inventory BEFORE the
// full graph (MVP4). Zero-dependency (Node >= 20). Detects stack, run/test/build
// commands, structure, boundaries, git changed files, build-manifest fingerprints
// and affected paths; writes .forge/graph/manifest.json (no graph.json yet).
// Usage: node discover-lite.mjs [<repo-root>]   (default: two levels above .forge/scripts/lib)
// Output: "OK .forge/graph/manifest.json (<stack>)" or "FAIL (...)".
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] || join(here, '../../..'));

const sh = (cmd) => {
  try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }).toString().trim(); }
  catch { return null; }
};
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const has = (rel) => existsSync(join(ROOT, rel));
const topEntries = readdirSync(ROOT, { withFileTypes: true });
const topFiles = topEntries.filter((e) => e.isFile()).map((e) => e.name);
const topDirs = topEntries.filter((e) => e.isDirectory()).map((e) => e.name)
  .filter((d) => !['node_modules', 'dist', 'build', 'out', '.git', '.idea', '.vscode'].includes(d) && !d.startsWith('.forge.bak'));

// ── stack + commands ──────────────────────────────────────────────────────────
const stack = [];
const commands = { run: null, test: null, build: null, typecheck: null, lint: null };
const fingerprints = {};
const fp = (rel) => { if (has(rel)) fingerprints[rel] = sha256(join(ROOT, rel)); };

if (has('package.json')) {
  stack.push('node-ts');
  fp('package.json');
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const s = pkg.scripts || {};
    if (s.start || s.dev) commands.run = `npm run ${s.dev ? 'dev' : 'start'}`;
    if (s.test) commands.test = 'npm test';
    if (s.build) commands.build = 'npm run build';
    if (s.typecheck) commands.typecheck = 'npm run typecheck';
    if (s.lint) commands.lint = 'npm run lint';
  } catch { /* unparseable package.json: stack detected, commands unknown */ }
}
const sln = topFiles.find((f) => f.endsWith('.sln'));
if (sln || topFiles.some((f) => f.endsWith('.csproj')) || topDirs.some((d) => existsSync(join(ROOT, d)) && readdirSync(join(ROOT, d)).some((f) => f.endsWith('.sln')))) {
  stack.push('dotnet');
  if (sln) fp(sln);
  commands.test = commands.test || 'dotnet test';
  commands.build = commands.build || 'dotnet build';
}
if (has('pyproject.toml') || has('requirements.txt')) {
  stack.push('python');
  fp('pyproject.toml'); fp('requirements.txt');
  commands.test = commands.test || 'pytest';
}
if (has('pom.xml') || has('src/main/java')) {
  stack.push('java');
  fp('pom.xml');
  commands.test = commands.test || (has('pom.xml') ? 'mvn test' : './gradlew test');
  commands.build = commands.build || (has('pom.xml') ? 'mvn package' : './gradlew build');
}
if (has('build.gradle') || has('build.gradle.kts') || has('settings.gradle') || has('settings.gradle.kts')) {
  stack.push('kotlin-android');
  fp('build.gradle'); fp('build.gradle.kts'); fp('settings.gradle'); fp('settings.gradle.kts');
  commands.test = commands.test || './gradlew test';
  commands.build = commands.build || './gradlew assembleDebug';
}
if (has('go.mod')) {
  stack.push('go');
  fp('go.mod');
  commands.test = commands.test || 'go test ./...';
  commands.build = commands.build || 'go build ./...';
}

// ── structure + boundaries ────────────────────────────────────────────────────
const BOUNDARY_HINTS = ['src', 'services', 'apps', 'packages', 'libs', 'contracts', 'platform', 'infra', 'docs', 'tests'];
const boundaries = topDirs.filter((d) => BOUNDARY_HINTS.includes(d));

// ── git: changed files + staleness ───────────────────────────────────────────
const isRepo = sh('git rev-parse --is-inside-work-tree') === 'true';
let git = { repo: false, last_commit: null, dirty: false, changed_files: [] };
if (isRepo) {
  const porcelain = sh('git status --porcelain') || '';
  const changed = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  git = {
    repo: true,
    last_commit: sh('git log -1 --format=%cI') || null,
    dirty: changed.length > 0,
    changed_files: changed,
  };
}
const affected = [...new Set(git.changed_files.map((f) => {
  const parts = f.split('/');
  return parts.length > 1 ? parts.slice(0, 2).join('/') : f;
}))].sort();

// ── write manifest ────────────────────────────────────────────────────────────
const manifest = {
  schema: 'graph-manifest/v0',
  generated_at: new Date().toISOString(),
  mode: 'lite',
  root: ROOT,
  stack,
  commands,
  structure: topDirs.sort(),
  boundaries,
  git,
  fingerprints,
  affected_paths: affected,
};

const outDir = join(ROOT, '.forge/graph');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`OK .forge/graph/manifest.json (stack: ${stack.length ? stack.join(',') : 'none'}; changed: ${git.changed_files.length})`);
