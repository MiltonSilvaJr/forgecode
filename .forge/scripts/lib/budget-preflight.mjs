#!/usr/bin/env node
// budget-preflight — cheap profile/override resolver for expensive Forge stages.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseYamlSubset, parseScalar } from './yaml-lite.mjs';

const PROFILES = {
  quick: { runs: 1, timeout_s: 120, runner: 'claude-code', budget_class: 'low', uses_llm: true, uses_subagent: false },
  standard: { runs: 2, timeout_s: 300, runner: 'claude-code', budget_class: 'medium', uses_llm: true, uses_subagent: true },
  regulated: { runs: 3, timeout_s: 600, runner: 'claude-code', budget_class: 'high', uses_llm: true, uses_subagent: true },
  'brownfield-heavy': { runs: 2, timeout_s: 600, runner: 'claude-code', budget_class: 'high', uses_llm: true, uses_subagent: true },
};

function usage() {
  console.log('FAIL (usage: budget-preflight.mjs --stage <stage> [--change <id>] [--profile <profile>] [--set key=value] [--json])');
  process.exit(2);
}

function parseArgs(args) {
  const out = { set: [], json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--set') out.set.push(args[++i] || '');
    else if (a === '--json') out.json = true;
    else if (a.startsWith('--')) out[a.slice(2).replace(/-/g, '_')] = args[++i] || '';
    else usage();
  }
  return out;
}

function readYaml(path) {
  try { return parseYamlSubset(readFileSync(path, 'utf8')); }
  catch { return {}; }
}

function readFrontmatterProfile(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try {
    const fm = parseYamlSubset(m[1]);
    return fm.execution_profile || (fm.quality && fm.quality.execution_profile) || null;
  } catch { return null; }
}

function manifestProfile(root, change) {
  if (!change) return null;
  const p = join(root, '.forge', 'specs', 'active', change, 'manifest.yaml');
  if (!existsSync(p)) return null;
  const m = readYaml(p);
  return m.execution_profile || (m.dev_loop && m.dev_loop.execution_profile) || null;
}

function forgeProfile(root) {
  const fy = join(root, '.forge', 'forge.yaml');
  if (existsSync(fy)) {
    const y = readYaml(fy);
    if (y.execution_profile) return y.execution_profile;
    if (y.quality && y.quality.execution_profile) return y.quality.execution_profile;
  }
  return readFrontmatterProfile(join(root, '.forge', 'FORGE.md'));
}

function applySet(obj, assignment) {
  const [key, rawValue] = String(assignment).split('=', 2);
  if (!key) return;
  const value = parseScalar(rawValue || '');
  const normalized = key === 'expected_runs' ? 'runs' : key;
  obj[normalized] = value;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.stage) usage();
const root = resolve(opts.root || process.cwd());
const profile = opts.profile || manifestProfile(root, opts.change) || forgeProfile(root) || 'standard';
if (!PROFILES[profile]) {
  console.log(`FAIL (unknown execution profile: ${profile})`);
  process.exit(1);
}
const resolved = { stage: opts.stage, profile, ...PROFILES[profile] };
for (const s of opts.set) applySet(resolved, s);
resolved.estimated_timeout_s = Number(resolved.timeout_s) * Number(resolved.runs || 1);
resolved.outputs = opts.outputs ? String(opts.outputs).split(',').filter(Boolean).length : 0;

if (opts.json) {
  console.log(JSON.stringify(resolved, null, 2));
} else {
  console.log(
    `BUDGET stage=${resolved.stage} profile=${resolved.profile} runner=${resolved.runner} ` +
    `runs=${resolved.runs} timeout_s=${resolved.estimated_timeout_s} budget=${resolved.budget_class} ` +
    `outputs=${resolved.outputs} llm=${resolved.uses_llm ? 'yes' : 'no'} subagent=${resolved.uses_subagent ? 'yes' : 'no'}`
  );
}
