#!/usr/bin/env node
// run-manifest/v1 — deterministic execution evidence inspired by DeepSpec
// provenance logging. Stores metadata and hashes only; never stores raw diffs.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const cmd = argv.shift();

function usage() {
  console.log('FAIL (usage: run-manifest.mjs write|validate --root <repo> --stage <stage> [--change <id>] [--dir <dir>] [--status passed|failed|skipped|running] [--inputs a,b] [--outputs a,b] [--command name::cmd::status])');
  process.exit(2);
}

function parseArgs(args) {
  const out = { commands: [], set: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--command') out.commands.push(args[++i] || '');
    else if (a === '--set') out.set.push(args[++i] || '');
    else if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '_');
      const value = args[++i] || '';
      // Chave escalar repetida com valores DIFERENTES é recusada — a última ocorrência
      // vencendo em silêncio era como o --root interno do wrapper descartava o --root do
      // chamador (#128). Repetição com o MESMO valor é inofensiva e continua aceita.
      if (Object.prototype.hasOwnProperty.call(out, key) && out[key] !== value) {
        console.log(`FAIL: --${a.slice(2)} informado duas vezes com valores diferentes`);
        process.exit(1);
      }
      out[key] = value;
    }
    else usage();
  }
  return out;
}

function sha256Text(s) {
  return createHash('sha256').update(String(s)).digest('hex');
}

function sha256File(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function git(root, args, { trim = true } = {}) {
  try {
    const out = execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    return trim ? out.trim() : out;
  } catch { return null; }
}

function gitProvenance(root) {
  const repo = git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  if (!repo) {
    return {
      repo: false,
      branch: null,
      head_sha: null,
      dirty: false,
      changed_files: [],
      diff_stat: '',
      diff_sha256: null,
    };
  }
  // untrimmed: porcelain status lines carry meaningful leading whitespace (e.g. " M app.txt")
  // that an outer .trim() would eat from the FIRST line only, corrupting its filename (slice(3)
  // would then drop 3 chars of the name itself instead of the 2-char status + separator).
  const porcelain = git(root, ['status', '--porcelain'], { trim: false }) || '';
  const changedFiles = porcelain.split('\n').filter(Boolean).map((l) => l.slice(3).trim()).sort();
  const unstaged = git(root, ['diff', '--stat']) || '';
  const staged = git(root, ['diff', '--cached', '--stat']) || '';
  const rawDiff = `${git(root, ['diff', '--binary']) || ''}\n${git(root, ['diff', '--cached', '--binary']) || ''}`;
  return {
    repo: true,
    branch: git(root, ['branch', '--show-current']) || null,
    head_sha: git(root, ['rev-parse', 'HEAD']) || null,
    dirty: changedFiles.length > 0,
    changed_files: changedFiles,
    diff_stat: [unstaged, staged].filter(Boolean).join('\n'),
    diff_sha256: sha256Text(rawDiff),
  };
}

function splitList(value) {
  if (!value) return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

function walkFiles(absDir, rel = '', acc = []) {
  const abs = rel ? join(absDir, rel) : absDir;
  if (!existsSync(abs)) return acc;
  const st = statSync(abs);
  if (st.isFile()) acc.push(rel);
  else if (st.isDirectory()) {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      walkFiles(absDir, rel ? join(rel, e.name) : e.name, acc);
    }
  }
  return acc;
}

// Records inputs/outputs relative to `base` (the change/run dir the manifest itself lives
// under — see baseDir/manifestPath), not relative to `root`. The manifest is always written
// inside `base` (evidence/runs/<runId>/run-manifest.json), so when the whole `base` folder
// moves atomically as one unit (e.g. archive-spec.sh moving specs/active/<id> to
// specs/archived/<date>-<id>), a path recorded relative to `base` still resolves correctly
// after the move — only paths anchored to `root` (which encode the now-stale specs/active/<id>
// segment) would break. `root` is still used as the containment boundary: an input/output that
// resolves outside the repo is recorded as missing rather than followed.
function artifact(root, base, relPath) {
  const normalized = String(relPath).replace(/^\.\//, '');
  const abs = resolve(base, normalized);
  const inside = !relative(root, abs).startsWith('..');
  if (!inside) return { path: normalized, exists: false, sha256: null, bytes: null };
  if (!existsSync(abs)) return { path: normalized, exists: false, sha256: null, bytes: null };
  const st = statSync(abs);
  if (st.isDirectory()) {
    const files = walkFiles(abs).sort();
    const digest = createHash('sha256');
    for (const f of files) digest.update(`${f}:${sha256File(join(abs, f))}\n`);
    return { path: normalized, exists: true, sha256: digest.digest('hex'), bytes: null, kind: 'directory' };
  }
  return { path: normalized, exists: true, sha256: sha256File(abs), bytes: st.size, kind: 'file' };
}

function parseCommand(s) {
  const [name, command, status] = String(s).split('::');
  return {
    name: name || 'command',
    command: command || '',
    status: status || 'unknown',
  };
}

function baseDir(root, opts) {
  if (opts.dir) return resolve(root, opts.dir);
  if (opts.change) return join(root, '.forge', 'specs', 'active', opts.change);
  return root;
}

function manifestPath(root, opts, runId) {
  if (opts.output) return resolve(root, opts.output);
  if (opts.change) return join(root, '.forge', 'specs', 'active', opts.change, 'evidence', 'runs', runId, 'run-manifest.json');
  if (opts.dir) return join(resolve(root, opts.dir), 'evidence', 'runs', runId, 'run-manifest.json');
  return join(root, '.forge', 'runs', runId, 'run-manifest.json');
}

function validateManifest(obj) {
  const errors = [];
  for (const k of ['schema', 'run_id', 'stage', 'status', 'started_at', 'finished_at', 'duration_ms', 'git', 'inputs', 'commands', 'outputs', 'runner', 'budgets']) {
    if (obj[k] === undefined) errors.push(`missing ${k}`);
  }
  if (obj.schema !== 'run-manifest/v1') errors.push(`schema must be run-manifest/v1 (got ${obj.schema})`);
  if (!['running', 'passed', 'failed', 'skipped'].includes(obj.status)) errors.push(`status invalid: ${obj.status}`);
  if (!Array.isArray(obj.inputs)) errors.push('inputs must be array');
  if (!Array.isArray(obj.commands)) errors.push('commands must be array');
  if (!Array.isArray(obj.outputs)) errors.push('outputs must be array');
  if (typeof obj.duration_ms !== 'number' || obj.duration_ms < 0) errors.push('duration_ms must be non-negative number');
  if (JSON.stringify(obj).includes('diff --git')) errors.push('raw git diff content must not be stored');
  return errors;
}

function applySet(obj, assignment) {
  const [key, rawValue] = String(assignment).split('=', 2);
  if (!key) return;
  let value = rawValue;
  if (rawValue === 'true') value = true;
  else if (rawValue === 'false') value = false;
  else if (/^-?[0-9]+$/.test(rawValue || '')) value = Number(rawValue);
  const parts = key.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function write(opts) {
  const root = resolve(opts.root || process.cwd());
  const runId = opts.run_id || `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const startedAt = opts.started_at || new Date().toISOString();
  const finishedAt = opts.finished_at || new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const base = baseDir(root, opts);
  const manifest = {
    schema: 'run-manifest/v1',
    run_id: runId,
    stage: opts.stage || 'unknown',
    status: opts.status || 'passed',
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: Number(opts.duration_ms || durationMs || 0),
    git: gitProvenance(root),
    inputs: splitList(opts.inputs).map((p) => artifact(root, base, p)),
    commands: opts.commands.map(parseCommand),
    outputs: splitList(opts.outputs).map((p) => artifact(root, base, p)),
    runner: {
      name: opts.runner || 'local',
      profile: opts.profile || 'standard',
    },
    budgets: {
      profile: opts.profile || 'standard',
      budget_class: opts.budget_class || 'medium',
      expected_runs: Number(opts.expected_runs || 1),
      estimated_timeout_s: Number(opts.estimated_timeout_s || 0),
      uses_llm: opts.uses_llm === 'true' || opts.uses_llm === true,
      uses_subagent: opts.uses_subagent === 'true' || opts.uses_subagent === true,
    },
  };
  for (const s of opts.set) applySet(manifest, s);
  const errors = validateManifest(manifest);
  if (errors.length) {
    console.log(`FAIL (${errors.join('; ')})`);
    process.exit(1);
  }
  const out = manifestPath(root, opts, runId);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`OK run-manifest ${relative(root, out)}`);
}

function validate(opts) {
  const file = resolve(opts.file || opts._file || '');
  if (!file || !existsSync(file)) {
    console.log('FAIL (run-manifest file missing)');
    process.exit(1);
  }
  const obj = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateManifest(obj);
  if (errors.length) {
    console.log(`FAIL (${basename(file)}: ${errors.join('; ')})`);
    process.exit(1);
  }
  console.log(`OK ${obj.run_id}`);
}

if (!cmd) usage();
const opts = parseArgs(argv);
if (cmd === 'write' || cmd === 'start' || cmd === 'end') write(opts);
else if (cmd === 'validate') validate(opts);
else usage();
