#!/usr/bin/env node
// released.mjs — gate: cada seção "## [X.Y.Z]" do arquivo anterior tem que estar idêntica, byte a
// byte (com terminadores de linha normalizados para LF), no arquivo novo. [Unreleased] não entra
// nesta regra (é o bloco em construção). O bloco de uma versão vai do seu cabeçalho até o próximo
// cabeçalho de versão (ou o fim do arquivo).
//
// Vacuidade: o arquivo anterior precisa EXISTIR — um caminho errado nunca pode passar como "0
// seções verificadas". Para o caso legítimo de CHANGELOG criado agora, o chamador passa um arquivo
// anterior vazio. Arquivo anterior com cabeçalhos "## " fora de [Unreleased] mas nenhuma versão
// reconhecida também reprova (formato não suportado), em vez de aprovar sem ter conferido nada.
//
// Uso: released.mjs <changelog-antigo> <changelog-novo>
// Saída: "OK ..." / "FAIL released: ...", rc 0 (ok) / 1 (violação) / 2 (uso ou entrada inválida).
import { readFileSync, existsSync } from 'node:fs';

const [, , oldPath, newPath] = process.argv;
if (!oldPath || !newPath) {
  console.error('Uso: released.mjs <changelog-antigo> <changelog-novo>');
  process.exit(2);
}
for (const [label, p] of [['anterior', oldPath], ['novo', newPath]]) {
  if (!existsSync(p)) {
    console.error(`FAIL released: arquivo ${label} não encontrado: ${p} (para CHANGELOG recém-criado, passe um arquivo anterior vazio)`);
    process.exit(2);
  }
}

const VERSION_RE = /^##\s*\[v?(\d+\.\d+\.\d+[^\]]*)\]/gm;

function extractVersionBlocks(md) {
  const blocks = new Map(); // versão -> texto completo do bloco
  const dups = [];
  const matches = [...md.matchAll(VERSION_RE)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : md.length;
    const v = matches[i][1];
    if (blocks.has(v)) dups.push(v);
    else blocks.set(v, md.slice(start, end));
  }
  return { blocks, dups };
}

function otherH2Count(md) {
  return md.split('\n').filter((l) => /^##\s+/.test(l) && !/^##\s*\[?unreleased\]?/i.test(l)).length;
}

const norm = (s) => s.replace(/\r\n?/g, '\n');
const oldMd = norm(readFileSync(oldPath, 'utf8'));
const newMd = norm(readFileSync(newPath, 'utf8'));

const { blocks: oldBlocks } = extractVersionBlocks(oldMd);
const { blocks: newBlocks, dups: newDups } = extractVersionBlocks(newMd);

if (oldBlocks.size === 0 && otherH2Count(oldMd) > 0) {
  console.error('FAIL released: o arquivo anterior tem cabeçalhos "## " de versão, mas nenhum no formato "## [X.Y.Z]" — formato não suportado, nada foi conferido');
  process.exit(2);
}

const failures = [];
for (const v of newDups) {
  failures.push(`seção [${v}] duplicada no arquivo novo`);
}
for (const [version, oldBlock] of oldBlocks) {
  if (!newBlocks.has(version)) {
    failures.push(`seção [${version}] presente no arquivo anterior e ausente no novo (versão removida)`);
    continue;
  }
  if (newBlocks.get(version) !== oldBlock) {
    failures.push(`seção [${version}] divergente do arquivo anterior`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL released: ${f}`);
  process.exit(1);
}
console.log(`OK released — ${oldBlocks.size} seção(ões) de versão publicada intacta(s)`);
process.exit(0);
