#!/usr/bin/env node
// preserve.mjs — gate: nenhum item de lista (entrada "- " ou "* ") do arquivo anterior pode
// desaparecer no arquivo novo, dentro do mesmo par <versão>|<seção>. Escrever um CHANGELOG novo não
// pode apagar história — só adicionar. Terminadores de linha são normalizados para LF antes da
// comparação (um arquivo CRLF não pode esconder a remoção de um bloco).
//
// Vacuidade: o arquivo anterior precisa EXISTIR — um caminho errado nunca passa como "0 blocos
// preservados". Para CHANGELOG recém-criado, o chamador passa um arquivo anterior vazio.
//
// Uso: preserve.mjs <changelog-antigo> <changelog-novo>
// Saída: "OK ..." / "FAIL preserve: ...", rc 0 (ok) / 1 (violação) / 2 (uso ou entrada inválida).
import { readFileSync, existsSync } from 'node:fs';

const [, , oldPath, newPath] = process.argv;
if (!oldPath || !newPath) {
  console.error('Uso: preserve.mjs <changelog-antigo> <changelog-novo>');
  process.exit(2);
}
for (const [label, p] of [['anterior', oldPath], ['novo', newPath]]) {
  if (!existsSync(p)) {
    console.error(`FAIL preserve: arquivo ${label} não encontrado: ${p} (para CHANGELOG recém-criado, passe um arquivo anterior vazio)`);
    process.exit(2);
  }
}

// Mapa "<versão>|<seção>" -> Set(itens de lista). <versão> é o texto do "## ..." mais próximo
// acima ("" antes do primeiro); <seção> é o texto do "### ..." mais próximo acima dentro do mesmo
// bloco de versão ("" quando o item fica direto sob a versão).
function extractSections(md) {
  const map = new Map();
  let currentVersion = '';
  let currentSection = '';
  for (const line of md.split('\n')) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) { currentVersion = h2[1].trim(); currentSection = ''; continue; }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) { currentSection = h3[1].trim(); continue; }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      const key = `${currentVersion}|${currentSection}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(bullet[1].trim());
    }
  }
  return map;
}

const norm = (s) => s.replace(/\r\n?/g, '\n');
const oldSections = extractSections(norm(readFileSync(oldPath, 'utf8')));
const newSections = extractSections(norm(readFileSync(newPath, 'utf8')));

const failures = [];
for (const [key, oldLines] of oldSections) {
  const newLines = newSections.get(key) || new Set();
  for (const line of oldLines) {
    if (!newLines.has(line)) {
      failures.push(`bloco removido sem substituto em "${key}": "${line}"`);
    }
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL preserve: ${f}`);
  process.exit(1);
}
console.log(`OK preserve — ${oldSections.size} bloco(s) do arquivo anterior preservado(s)`);
process.exit(0);
