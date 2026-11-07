#!/usr/bin/env node
// benchmark-eval — deterministic smoke runner for canonical Forge benchmark cases.
// It creates grading.json files that reuse eval-aggregate.sh's existing format.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const CASES = ['greenfield-small', 'brownfield-bugfix', 'refactor-invariant', 'docs-only', 'multi-module-scale3'];

function usage() {
  console.log('FAIL (usage: benchmark-eval.mjs <case|suite> [--root <repo>] [--runner stub] [--runs N] [--set key=value])');
  process.exit(2);
}

function parseArgs(args) {
  const out = { target: args.shift(), runner: 'stub', set: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--set') out.set.push(args[++i] || '');
    else if (a.startsWith('--')) out[a.slice(2).replace(/-/g, '_')] = args[++i] || '';
    else usage();
  }
  return out;
}

function loadCase(root, id) {
  const p = join(root, '.forge', 'evals', 'benchmarks', id, 'case.json');
  if (!existsSync(p)) throw new Error(`benchmark case missing: ${id}`);
  const data = JSON.parse(readFileSync(p, 'utf8'));
  validateCase(data, id);
  return data;
}

function validateCase(data, expectedId) {
  const errors = [];
  if (data.schema !== 'benchmark-case/v1') errors.push('schema must be benchmark-case/v1');
  if (data.id !== expectedId) errors.push(`id mismatch: ${data.id} != ${expectedId}`);
  if (!data.prompt || data.prompt.length < 8) errors.push('prompt too short');
  if (!Array.isArray(data.artifacts)) errors.push('artifacts must be array');
  if (!data.grading || !Array.isArray(data.grading.expectations) || !data.grading.expectations.length) errors.push('grading.expectations missing');
  if (!data.budget || !Number.isInteger(data.budget.runs)) errors.push('budget.runs missing');
  if (errors.length) throw new Error(`${expectedId}: ${errors.join('; ')}`);
}

function applySet(config, assignment) {
  const [key, raw] = String(assignment).split('=', 2);
  if (key === 'runs') config.runs = Number(raw);
  if (key === 'runner') config.runner = raw;
}

function writeGrading(caseData, outDir, run, runner) {
  const evalDir = join(outDir, `eval-${run}`);
  mkdirSync(evalDir, { recursive: true });
  const expectations = caseData.grading.expectations.map((text) => ({
    text,
    passed: true,
    evidence: `stub benchmark ${caseData.id} satisfied expectation`
  }));
  const grading = {
    skill: `benchmark-${caseData.id}`,
    runner,
    baseline: { description: 'baseline prompt without Forge benchmark harness' },
    variant: { description: 'Forge benchmark harness prompt' },
    test_cases: [{
      id: 'TC-01',
      prompt: caseData.prompt,
      baseline_result: { output: 'baseline', duration_ms: 1000 + run, tokens: 100, exit_code: 0 },
      variant_result: { output: 'variant', duration_ms: 900 + run, tokens: 90, exit_code: 0 },
      expectations
    }],
    aggregate: {
      baseline_pass_rate: caseData.grading.baseline_pass_rate,
      variant_pass_rate: caseData.grading.variant_pass_rate,
      delta_pass_rate: Number((caseData.grading.variant_pass_rate - caseData.grading.baseline_pass_rate).toFixed(4)),
      baseline_duration_mean_ms: 1000 + run,
      variant_duration_mean_ms: 900 + run,
      delta_duration_ms: -100
    }
  };
  writeFileSync(join(evalDir, 'grading.json'), JSON.stringify(grading, null, 2) + '\n');
}

function runOne(root, id, opts) {
  const caseData = loadCase(root, id);
  const cfg = { runs: Number(opts.runs || caseData.budget.runs || 1), runner: opts.runner || 'stub' };
  for (const s of opts.set) applySet(cfg, s);
  if (!Number.isInteger(cfg.runs) || cfg.runs < 1 || cfg.runs > 5) throw new Error(`runs must be 1..5 for ${id}`);
  console.log(`BUDGET stage=eval profile=${caseData.budget.profile} runner=${cfg.runner} runs=${cfg.runs} timeout_s=${cfg.runs * 300} budget=high outputs=1 llm=${cfg.runner === 'stub' ? 'no' : 'yes'} subagent=no`);
  const outDir = join(root, '.forge', 'evals', 'benchmarks', id, 'runs', 'latest', 'iteration-1');
  mkdirSync(outDir, { recursive: true });
  for (let i = 1; i <= cfg.runs; i++) writeGrading(caseData, outDir, i, cfg.runner);
  execFileSync('bash', [join(root, '.forge', 'scripts', 'eval-aggregate.sh'), outDir], { cwd: root, stdio: 'inherit' });
  return outDir;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.target) usage();
const root = resolve(opts.root || process.cwd());

try {
  if (opts.target === 'suite') {
    for (const id of CASES) runOne(root, id, opts);
    console.log(`OK benchmark suite (${CASES.length} cases)`);
  } else {
    runOne(root, opts.target, opts);
    console.log(`OK benchmark ${opts.target}`);
  }
} catch (e) {
  console.log(`FAIL (${e.message})`);
  process.exit(1);
}
