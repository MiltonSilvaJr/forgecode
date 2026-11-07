#!/usr/bin/env node
// forge validate rules (G3 drift detection, GW.2). Zero-dependency. Checks that
// every rule which declares `based_on: [ADR-NNNN, ...]` in its frontmatter is
// anchored to an ADR that (a) exists in the baseline (.forge/product/current/adr/)
// and (b) has Status: accepted. A rule contradicting/orphaned from its ADR is
// DRIFT — the exact failure mode of the pilot incident (a rule that claimed to
// follow an ADR but encoded the opposite decision).
//
// Rules with no `based_on` or `based_on: []` are conventions not tied to a
// specific decision — fine, skipped. The `based_on` mechanism is opt-in per
// project: a fresh template ships no ADRs, so template rules use `based_on: []`.
//
// ── rule-pack de domínio (LDG-0003) ─────────────────────────────────────────
// `pack: <nome>` e `opt_in: true` no frontmatter de rule não eram lidos por NINGUÉM — nem aqui,
// nem em sync-adapters.mjs, nem em schema algum —, e as duas rules de prioridade Alta que os
// declaram (architecture/authz-pdp-pep.md, architecture/pii-pci-classification.md) ficavam sem
// porta de entrada: `rules/README.md` e `capabilities/README.md` diziam, por escrito, que `pack:`
// era sinalização DOCUMENTAL até a chave existir.
//
// A chave é `rules.packs` no `.forge/forge.yaml`, por simetria explícita com `capabilities.active`,
// que já existe e funciona. O comportamento default para rule de pack INATIVO é exatamente o que a
// documentação já prometia — referência disponível, nunca gate imposto —, e o trabalho aqui é
// tornar MECÂNICA uma afirmação que era só prosa.
//
// Usage: validate-rules.mjs <forge-root>
// Output: "OK rules (N anchored, M unanchored)" or "FAIL (<drifts>)".
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const rulesDir = join(root, '.forge/rules');
const adrDir = join(root, '.forge/product/current/adr');
if (!existsSync(rulesDir)) { console.log('OK rules (no rules directory)'); process.exit(0); }

// Packs ativados em .forge/forge.yaml -> Set de nomes. Leitura própria e mínima (uma lista
// escalar), sem puxar o parser inteiro: este script é zero-dependência por contrato.
function readActivePacks(forgeRoot) {
  const p = join(forgeRoot, '.forge/forge.yaml');
  const out = new Set();
  if (!existsSync(p)) return out;
  const text = readFileSync(p, 'utf8');
  const lines = text.split('\n');
  let inRules = false;
  for (const line of lines) {
    if (/^rules:\s*$/.test(line)) { inRules = true; continue; }
    if (inRules && /^[A-Za-z_]/.test(line)) { inRules = false; }
    if (!inRules) continue;
    const inline = line.match(/^\s{2}packs:\s*\[([^\]]*)\]\s*$/);
    if (inline) {
      for (const v of inline[1].split(',')) {
        const n = v.trim().replace(/['"]/g, '');
        if (n) out.add(n);
      }
      break;
    }
    const csv = line.match(/^\s{2}packs:\s*(\S.*)$/);
    if (csv) {
      for (const v of csv[1].split(',')) {
        const n = v.trim().replace(/['"]/g, '');
        if (n) out.add(n);
      }
      break;
    }
  }
  return out;
}
const activePacks = readActivePacks(root);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.md') && e.name !== 'README.md') acc.push(p);
  }
  return acc;
}

// index baseline ADRs: number -> { status }
const adrs = new Map();
if (existsSync(adrDir)) {
  for (const f of readdirSync(adrDir)) {
    const m = f.match(/^([0-9]{4})-.*\.md$/);
    if (!m) continue;
    const text = readFileSync(join(adrDir, f), 'utf8');
    const st = text.match(/^[-*]?\s*\**Status:\**\s*([a-zA-Z ]+)/m);
    adrs.set(m[1], { status: st ? st[1].trim().toLowerCase().split(/\s+/)[0] : 'unknown' });
  }
}

const drifts = [];
let anchored = 0, unanchored = 0;
const packedActive = [];
const packedInactive = [];

for (const f of walk(rulesDir)) {
  const text = readFileSync(f, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const rel = f.slice(root.length + 1);
  if (!fm) { unanchored++; continue; }
  const packDecl = fm[1].match(/^pack:\s*(\S+)\s*$/m);
  if (packDecl) {
    const pk = packDecl[1].replace(/['"]/g, '');
    if (activePacks.has(pk)) packedActive.push(`${rel} (pack ${pk})`);
    else packedInactive.push(`${rel} (pack ${pk})`);
  }
  const bo = fm[1].match(/^based_on:\s*\[([^\]]*)\]/m);
  if (!bo || !bo[1].trim()) { unanchored++; continue; }
  const refs = bo[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  if (!refs.length) { unanchored++; continue; }
  anchored++;
  for (const ref of refs) {
    const num = ref.replace(/^ADR-/i, '');
    if (!adrs.has(num)) {
      drifts.push(`${rel}: based_on ${ref} — no such ADR in baseline (.forge/product/current/adr/)`);
    } else if (adrs.get(num).status !== 'accepted') {
      drifts.push(`${rel}: based_on ${ref} — ADR is "${adrs.get(num).status}", not accepted (drift)`);
    }
  }
}

// A incoerência que É decidível: `rules.packs` ativando um pack que NENHUMA rule declara. É o
// typo no arquivo que o humano edita, e o efeito é uma ativação sem conteúdo — o projeto acredita
// ter contratado uma política e não contratou nada.
//
// A direção oposta ("`pack:` no frontmatter referenciando pack desconhecido") NÃO é decidível sem
// inventar um catálogo de packs, e inventá-lo seria criar uma terceira fonte de verdade para
// resolver um problema de duas. Sem catálogo, um `pack:` que ninguém ativou é apenas um pack
// INATIVO — que é o estado legítimo e documentado (referência disponível, nunca gate imposto), e
// indistinguível de um typo. A distinção fica registrada como decisão, não improvisada aqui.
for (const pk of activePacks) {
  const temRule = packedActive.some((r) => r.endsWith(`(pack ${pk})`));
  if (!temRule) drifts.push(`rules.packs ativa "${pk}" e nenhuma rule de .forge/rules/ declara esse pack no frontmatter — ativação sem conteúdo`);
}

if (drifts.length) { console.log(`FAIL (${drifts.join('; ')})`); process.exit(1); }
// A classificação sai SEMPRE, inclusive vazia: "a rule de pack inativo não reprova" é satisfeito
// por um validador que não lê `pack:` nenhum — era exatamente esse o estado antes desta correção.
// Sem a linha, a asserção negativa do gate não prova nada.
console.log(`OK rules (${anchored} anchored, ${unanchored} unanchored)`);
console.log(`  packs: ${activePacks.size} ativo(s)${activePacks.size ? ' [' + [...activePacks].sort().join(', ') + ']' : ''}; ${packedActive.length} rule(s) contratada(s) por pack ativo; ${packedInactive.length} rule(s) de pack inativo — disponível como referência, nunca gate imposto`);
for (const r of packedActive) console.log(`    contratada: ${r}`);
for (const r of packedInactive) console.log(`    inativo (referência): ${r}`);
