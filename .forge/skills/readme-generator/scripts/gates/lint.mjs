#!/usr/bin/env node
// lint.mjs — gate de higiene de prosa nas entradas (itens de lista "- "/"* ") de um CHANGELOG.md.
// Checagens: travessão, quebra de linha dentro de parágrafo, acentuação ausente (palavra comum
// grafada sem o acento devido), placeholder, link markdown quebrado.
//
// Escopo: com --since <changelog-antigo>, só as entradas NOVAS (linhas que não existiam no arquivo
// anterior) são verificadas — um travessão histórico numa versão já publicada, que o gate released
// proíbe corrigir, não pode travar o comando para sempre. Sem --since, o arquivo inteiro é
// verificado. Terminadores de linha são normalizados para LF (CRLF não esconde violação).
//
// Uso: lint.mjs <changelog> [--since <changelog-antigo>]
// Saída: "OK ..." / "FAIL lint: ...", rc 0 (ok) / 1 (violação) / 2 (uso ou entrada inválida).
import { readFileSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
let path = null;
let since = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--since') { since = argv[++i]; continue; }
  if (!path) path = argv[i];
}
if (!path || (argv.includes('--since') && !since)) {
  console.error('Uso: lint.mjs <changelog> [--since <changelog-antigo>]');
  process.exit(2);
}
for (const p of [path, since].filter(Boolean)) {
  if (!existsSync(p)) {
    console.error(`FAIL lint: arquivo não encontrado: ${p}`);
    process.exit(2);
  }
}

const norm = (s) => s.replace(/\r\n?/g, '\n');
const lines = norm(readFileSync(path, 'utf8')).split('\n');

// Multiconjunto das linhas do arquivo anterior: uma linha só é "antiga" enquanto houver cópia dela
// no anterior (duas linhas idênticas novas contra uma antiga = uma nova).
const oldCount = new Map();
if (since) {
  for (const l of norm(readFileSync(since, 'utf8')).split('\n')) {
    oldCount.set(l, (oldCount.get(l) || 0) + 1);
  }
}
function isNewLine(l) {
  if (!since) return true;
  const n = oldCount.get(l) || 0;
  if (n > 0) { oldCount.set(l, n - 1); return false; }
  return true;
}

const failures = [];

// Palavras comuns em pt-BR que, grafadas sem acento, são sempre erro. Ficam de fora palavras cuja
// forma sem acento também é grafia correta ("esta", "exemplo", "pagina", "numero", "ultima"...).
const ASCII_WORDS = [
  'nao', 'sao', 'entao', 'estao', 'codigo', 'voce', 'ja', 'funcao', 'opcao', 'secao',
  'informacao', 'configuracao', 'implementacao', 'validacao', 'atraves', 'possivel', 'tambem',
  'usuario', 'historico', 'proprio', 'propria',
];
// Fronteira Unicode: \b do JS é ASCII e casaria "esta" dentro de "estação".
const ASCII_RE = new RegExp(`(?<![\\p{L}\\p{N}_])(${ASCII_WORDS.join('|')})(?![\\p{L}\\p{N}_])`, 'iu');

// Placeholders são marcadores em caixa alta; "todo" em minúscula é palavra do português.
const PLACEHOLDER_RE = /\b(TODO|FIXME|XXX|TBD)\b|<placeholder>/;
const BROKEN_LINK_RE = /\[[^\]]*\]\(\s*\)/; // [texto]() — url vazia

let inNewBullet = false;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const fresh = isNewLine(line);
  const bullet = line.match(/^\s*[-*]\s+(.+)$/);
  if (bullet) {
    inNewBullet = fresh;
    if (!fresh) continue;
    const text = bullet[1];
    // Código e URL não são prosa: `src/codigo/validacao.ts`, `ja-JP` ou um link não reprovam por
    // acentuação nem por placeholder.
    const prose = text.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, '] ');
    if (/[—–]/.test(text)) {
      failures.push(`linha ${i + 1}: travessão encontrado — "${text.trim()}"`);
    }
    const m = prose.match(ASCII_RE);
    if (m) {
      failures.push(`linha ${i + 1}: acentuação ausente ("${m[0]}") — "${text.trim()}"`);
    }
    if (PLACEHOLDER_RE.test(prose)) {
      failures.push(`linha ${i + 1}: placeholder encontrado — "${text.trim()}"`);
    }
    if (BROKEN_LINK_RE.test(text)) {
      failures.push(`linha ${i + 1}: link markdown quebrado (url vazia) — "${text.trim()}"`);
    }
    continue;
  }
  // Quebra de linha dentro de parágrafo: uma linha não vazia, que não é item de lista/heading,
  // imediatamente após um item de lista novo — indica hard-wrap manual no meio da frase.
  const isBlankOrStructural = /^\s*$/.test(line) || /^#/.test(line);
  if (inNewBullet && !isBlankOrStructural && fresh) {
    failures.push(`linha ${i + 1}: quebra de linha dentro de parágrafo — "${line.trim()}"`);
  }
  inNewBullet = false;
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL lint: ${f}`);
  process.exit(1);
}
console.log(`OK lint — sem travessão, quebra de linha indevida, acentuação ausente, placeholder ou link quebrado${since ? ' nas entradas novas' : ''}`);
process.exit(0);
