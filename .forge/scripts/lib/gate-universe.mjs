#!/usr/bin/env node
// lib/gate-universe.mjs — o gêmeo Node de lib/gate-universe.sh (issue #49).
//
// Mesma regra, mesmo arquivo de justificativa, mesma redação das três linhas: os gates de
// governança (authz, observability, data-governance) iteram em JavaScript, e ter duas políticas
// de vacuidade — uma no shell e outra no node — reintroduziria a ambiguidade por outra porta.
//
//   universeCheck({ root, gate, count, item, scope }) -> { ok, line, stream, extra: [] }
//
// `ok:false` é o default do universo vazio. A única saída é uma entrada em
// `.forge/empty-universe-allowlist.txt` no formato `<gate-key>  # motivo: <justificativa>`;
// entrada sem `# motivo:` reprova por integridade (isenção anônima esvazia o gate).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function allowlistPath(root) {
  return process.env.FORGE_EMPTY_UNIVERSE_ALLOWLIST || join(root || '.', '.forge/empty-universe-allowlist.txt');
}

// -> { kind: 'none' } | { kind: 'motivo', motivo } | { kind: 'anonima', lineNo }
export function universeWaiver(root, gate) {
  const file = allowlistPath(root);
  if (!existsSync(file)) return { kind: 'none' };
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return { kind: 'none' }; }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*#/.test(raw) || /^\s*$/.test(raw)) continue;
    const key = raw.replace(/\s*#.*$/, '').trim();
    if (key !== gate) continue;
    const m = raw.match(/#\s*motivo:\s*(\S.*)$/);
    return m ? { kind: 'motivo', motivo: m[1].trim() } : { kind: 'anonima', lineNo: i + 1 };
  }
  return { kind: 'none' };
}

export function universeCheck({ root, gate, count, item, scope }) {
  const n = Number.isFinite(count) ? count : 0;
  if (n > 0) {
    return { ok: true, stream: 'out', line: `OK ${gate}/universo — ${n} ${item} examinado(s) (${scope})`, extra: [] };
  }
  const w = universeWaiver(root, gate);
  if (w.kind === 'motivo') {
    return {
      ok: true,
      stream: 'out',
      line: `OK ${gate}/universo-vazio — 0 ${item} examinado(s) (${scope}); justificativa declarada: ${w.motivo}`,
      extra: [],
    };
  }
  if (w.kind === 'anonima') {
    return {
      ok: false,
      stream: 'err',
      line: `FAIL ${gate}/universo-vazio — isenção de '${gate}' em ${allowlistPath(root)} (linha ${w.lineNo}) sem '# motivo:'.`,
      extra: ["      Isenção anônima é como um gate é esvaziado — declare '<gate>  # motivo: <justificativa>'."],
    };
  }
  return {
    ok: false,
    stream: 'err',
    line: `FAIL ${gate}/universo-vazio — 0 ${item} examinado(s) (${scope}): o gate não examinou nada.`,
    extra: [
      '      Universo vazio não é ausência de violação, é ausência de verificação — os dois não',
      '      podem colapsar no mesmo verde. Confira o alvo, o glob e o range.',
      `      Se o vazio for legítimo, declare em ${allowlistPath(root)}: '${gate}  # motivo: <justificativa>'.`,
    ],
  };
}

// Emite o resultado e devolve o rc (0/1) — açúcar para os três gates que só precisam disso.
export function emitUniverse(res) {
  const sink = res.stream === 'err' ? console.error : console.log;
  sink(res.line);
  for (const l of res.extra) sink(l);
  return res.ok ? 0 : 1;
}
