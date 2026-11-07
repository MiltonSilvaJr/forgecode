#!/usr/bin/env node
// validate-stage-contract — deterministic I/O contract checks for Forge stages.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { parseYamlSubset } from './yaml-lite.mjs';

const argv = process.argv.slice(2);
const cmd = argv.shift();

function usage() {
  console.log('FAIL (usage: stage-contract.mjs validate-contracts|check --root <repo> [--stage <stage>] [--change <id>] [--dir <dir>])');
  process.exit(2);
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) out[a.slice(2).replace(/-/g, '_')] = args[++i] || '';
    else usage();
  }
  return out;
}

function contractDir(root) {
  return join(root, '.forge', 'contracts', 'stages');
}

function listContracts(root) {
  const dir = contractDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => join(dir, f));
}

function loadContract(root, stage) {
  const p = join(contractDir(root), `${stage}.yaml`);
  if (!existsSync(p)) throw new Error(`contract missing: ${stage}`);
  return parseYamlSubset(readFileSync(p, 'utf8'));
}

function validateContract(c, name) {
  const errors = [];
  if (!c.stage) errors.push(`${name}: stage missing`);
  if (!Array.isArray(c.required_inputs)) errors.push(`${name}: required_inputs must be list`);
  if (!Array.isArray(c.required_outputs)) errors.push(`${name}: required_outputs must be list`);
  if (!Array.isArray(c.validators)) errors.push(`${name}: validators must be list`);
  if (!c.budget_class) errors.push(`${name}: budget_class missing`);
  if (typeof c.evidence_required !== 'boolean') errors.push(`${name}: evidence_required must be boolean`);
  return errors;
}

function baseDir(root, opts) {
  if (opts.dir) return resolve(root, opts.dir);
  if (opts.change) return join(root, '.forge', 'specs', 'active', opts.change);
  return root;
}

function globToRegex(pattern) {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}

function walk(dir, base, acc = []) {
  if (!existsSync(dir)) return acc;
  const st = statSync(dir);
  if (st.isFile()) {
    acc.push(relative(base, dir).replace(/\\/g, '/'));
    return acc;
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    walk(join(dir, e.name), base, acc);
  }
  return acc;
}

function existsPattern(base, rel) {
  const optional = rel.endsWith('?');
  const pattern = optional ? rel.slice(0, -1) : rel;
  if (pattern.includes('*')) {
    const files = walk(base, base);
    return optional || files.some((f) => globToRegex(pattern).test(f));
  }
  return optional || existsSync(join(base, pattern));
}

function validateContracts(opts) {
  const root = resolve(opts.root || process.cwd());
  const files = listContracts(root);
  const errors = [];
  if (!files.length) errors.push('no stage contracts found');
  for (const f of files) {
    try { errors.push(...validateContract(parseYamlSubset(readFileSync(f, 'utf8')), relative(root, f))); }
    catch (e) { errors.push(`${relative(root, f)}: ${e.message}`); }
  }
  if (errors.length) {
    console.log(`FAIL (${errors.join('; ')})`);
    process.exit(1);
  }
  console.log(`OK stage-contracts (${files.length})`);
}

function check(opts) {
  const root = resolve(opts.root || process.cwd());
  const stage = opts.stage;
  if (!stage) usage();
  let c;
  try { c = loadContract(root, stage); }
  catch (e) { console.log(`FAIL (${e.message})`); process.exit(1); }
  const errors = validateContract(c, `${stage}.yaml`);
  const base = baseDir(root, opts);
  if (!existsSync(base)) errors.push(`base dir missing: ${relative(root, base)}`);
  for (const p of c.required_inputs || []) if (!existsPattern(base, String(p))) errors.push(`missing input: ${p}`);
  for (const p of c.required_outputs || []) if (!existsPattern(base, String(p))) errors.push(`missing output: ${p}`);
  if (errors.length) {
    console.log(`FAIL (${errors.join('; ')})`);
    process.exit(1);
  }
  console.log(`OK stage-contract ${stage}`);
}

const opts = parseArgs(argv);
if (cmd === 'validate-contracts') validateContracts(opts);
else if (cmd === 'check') check(opts);
else usage();
