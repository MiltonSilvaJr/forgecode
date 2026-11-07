#!/usr/bin/env node
// forge shared engine — collect() + scan(). Zero-dependency. Extracted from
// check-data-governance.mjs (GW.3) so every governance gate (data, authz,
// observability) can reuse the same file-collector and line-matrix scanner
// without a new engine per gate — only the ANTI matrix differs per caller.
//
// collect(paths, opts): walks paths (files or dirs), returns absolute paths
// of files whose extension is in opts.exts (default { '.md' } — retrocompat
// with the original check-data-governance collector), skipping opts.skipDirs
// directories (default: the same generated/vendored dirs graph-build.mjs
// excludes from the code graph).
//
// scan(files, matrix, opts): reads each file, applies every { re, why, allow }
// entry of matrix per line, emitting "rel:line: why" findings — skipping a
// match when the line also matches that entry's allow pattern. opts.rel is an
// optional function(absolutePath) -> string to compute the reported path
// (default: the /specs/active/ relativization check-data-governance.mjs used).
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

// Same generated/vendored/build dirs graph-build.mjs's SKIP_DIRS excludes —
// kept in sync deliberately so gates scanning source code don't walk into
// noise the code graph already ignores.
export const DEFAULT_SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'bin', 'obj', '.forge', 'coverage',
  '.next', 'vendor', 'storybook-static', 'wwwroot', '_archive', 'TestResults',
  '.vs', '.idea', '.venv', '__pycache__', '.turbo', '.cache',
]);

export function collect(paths, { exts = new Set(['.md']), skipDirs = DEFAULT_SKIP } = {}) {
  const acc = [];
  function walk(p) {
    const rp = resolve(p);
    if (!existsSync(rp)) return;
    if (statSync(rp).isDirectory()) {
      for (const e of readdirSync(rp, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(join(rp, e.name)); }
        else if (exts.has(extname(e.name))) acc.push(join(rp, e.name));
      }
    } else if (exts.has(extname(rp))) acc.push(rp);
  }
  for (const p of [].concat(paths)) walk(p);
  return acc;
}

function defaultRel(f) {
  return f.includes('/specs/active/') ? f.slice(f.indexOf('/specs/active/') + 1) : f;
}

export function scan(files, matrix, opts = {}) {
  const rel = opts.rel || defaultRel;
  const findings = [];
  for (const f of files) {
    const r = rel(f);
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const a of matrix) {
        if (a.re.test(line) && !a.allow.test(line)) findings.push(`${r}:${i + 1}: ${a.why}`);
      }
    });
  }
  return findings;
}
