#!/usr/bin/env node
// lib/heredoc-hash-lint.mjs — detector do idioma `sustenido dentro de $( ) mata o script em
// silêncio` (LDG-0052).
//
// A armadilha: um heredoc — de QUALQUER forma de delimitador, `<<EOF`, `<<'EOF'`, `<<"EOF"` ou
// `<<\EOF` — cujo corpo vive dentro de um `$( ... )` (o idioma que todo script do harness usa
// para chamar `node`/`python`) NÃO é imune ao próprio sustenido. Quando uma linha do corpo tem um
// `(` sem aspas, seguido, na MESMA linha, por um `#` sem aspas, seguido por um `)` sem aspas —
// tipicamente um comentário em prosa do tipo "(issue #49, instância 1)" — o `bash` que escaneia o
// `$( )` por fora trata o sustenido como início de comentário e DESCARTA o resto da linha,
// levando junto o `)` que fecharia o `(` anterior. O parênteses do `$( )` externo nunca conta o
// fechamento que perdeu, o script morre em runtime com "bad substitution: no closing `)`" — e
// `bash -n` não vê nada, porque a sintaxe crua é válida; só o balanceamento pós-heredoc quebra.
//
// Medido: quatro variantes de delimitador (nenhuma aspas, aspas simples, aspas duplas,
// `\EOF`) quebram TODAS de forma idêntica com o mesmo corpo — a quotação do delimitador não
// protege nada; só protege quando o `#` em si está dentro de uma string aspeada DENTRO do corpo
// (aí o sustenido nunca é "visto" avulso). É por isso que a regra abaixo ignora a quotação do
// delimitador e, em vez disso, decota strings simples/duplas de cada linha do corpo antes de medir.
//
// Escopo: só heredocs que abrem enquanto um `$(` ainda está aberto. Um heredoc solto, ou dentro
// de um subshell `( … )` comum (sem o `$`), não reproduz — confirmado por medição.
//
// Uso:
//   collectShellFiles(paths)   — reexportado de shell-pipeline-lint.mjs (mesmo coletor)
//   lintText(text)             — array de achados { openLine, lineNo, delimiter, line }
export { collectShellFiles } from './shell-pipeline-lint.mjs';

// Decota `'…'` e `"…"` (aspas duplas com escape de \" respeitado, aspas simples sem escape — como
// o próprio bash) de uma linha, substituindo o conteúdo aspeado por nada. Sobra só a estrutura não
// aspeada: é nela que `(`, `#` e `)` avulsos importam.
export function stripQuotedSpans(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end === -1) { i = line.length; break; }
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === '"') break;
        j++;
      }
      if (j >= line.length) { i = line.length; break; }
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// `(` sem aspas ... `#` sem aspas ... `)` sem aspas, sem outro `(`/`)` entre eles — o par mais
// interno plausível. É a forma exata que engole o fechamento do `$( )` externo.
const PAREN_HASH_PAREN = /\([^()]*#[^()]*\)/;

// Varre UMA linha fora de heredoc, atualizando profundidade de `$(` e reportando heredocs que
// abrem nela. Não tenta ser um parser de bash completo — heurística line-based, como o precedente
// shell-pipeline-lint.mjs.
//
// Deliberadamente NÃO entra em modo "consome até a aspa fechar": o idioma onipresente no harness é
// `var="$(cmd <<'EOF'` — a aspa dupla abre e só fecha bem depois, na linha do `)"` que sucede o
// terminador do heredoc. Tratar aspas como span de UMA linha faria esse `"` engolir o resto da
// linha (incluindo o próprio `$(` e o `<<`) e o lint nunca veria o heredoc que abriu.
function scanOuterLine(line) {
  const opens = [];
  let depthDelta = 0;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '$' && line[i + 1] === '(') { depthDelta++; i += 2; continue; }
    if (c === ')') { depthDelta--; i++; continue; }
    if (c === '<' && line[i + 1] === '<') {
      let j = i + 2;
      let dashStrip = false;
      if (line[j] === '-') { dashStrip = true; j++; }
      let quote = null;
      if (line[j] === '\\') { j++; }
      else if (line[j] === "'" || line[j] === '"') { quote = line[j]; j++; }
      const wordStart = j;
      while (j < line.length && /[A-Za-z0-9_]/.test(line[j])) j++;
      const word = line.slice(wordStart, j);
      if (quote && line[j] === quote) j++;
      if (word) opens.push({ delimiter: word, dashStrip });
      i = j;
      continue;
    }
    i++;
  }
  return { depthDelta, opens };
}

export function lintText(text) {
  const lines = text.split('\n');
  const findings = [];
  let parenDepth = 0;
  let i = 0;
  while (i < lines.length) {
    const { depthDelta, opens } = scanOuterLine(lines[i]);
    parenDepth = Math.max(0, parenDepth + depthDelta);
    if (opens.length > 0) {
      // Só o primeiro heredoc declarado na linha é considerado — mais de um heredoc na mesma
      // linha é forma rara que este lint não persegue.
      const { delimiter, dashStrip } = opens[0];
      const openParenDepth = parenDepth;
      const openLineNo = i + 1;
      let j = i + 1;
      while (j < lines.length) {
        const raw = lines[j];
        const term = dashStrip ? raw.replace(/^\t+/, '') : raw;
        if (term === delimiter) break;
        if (openParenDepth > 0) {
          const stripped = stripQuotedSpans(raw);
          if (PAREN_HASH_PAREN.test(stripped)) {
            findings.push({ openLine: openLineNo, lineNo: j + 1, delimiter, line: raw.trim() });
          }
        }
        j++;
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return findings;
}
