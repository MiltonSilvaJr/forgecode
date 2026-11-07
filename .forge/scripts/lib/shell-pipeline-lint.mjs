#!/usr/bin/env node
// lib/shell-pipeline-lint.mjs — detector da forma `<produtor> | grep -q … || <ação>` (issue #49).
//
// Por que esta forma específica, e não "pipe" em geral: `grep -q` sai no PRIMEIRO casamento. Se o
// produtor ainda tem o que escrever, ele leva SIGPIPE, o pipeline devolve 141, e sob `pipefail`
// isso vira falha do pipeline INTEIRO. O `||` na sequência então executa a ação de "não casou" —
// `continue`, `exit`, um default — para uma linha que CASAVA. Com `&&`, o efeito é o inverso e
// pior: a asserção do lado direito não roda, e o teste passa sem ter medido nada. Medido no
// Axis.PadSimulator: 57 exit codes anômalos em 300 execuções com pipe, zero em 300 sem, sobre o
// parser cujo trabalho era exatamente não perder declaração.
//
// O produtor importa. `echo "$x" | grep -q …` e `printf '%s' "$x" | grep -q …` escrevem UMA
// string curta, que cabe inteira no buffer do pipe antes de o `grep` sair — não há escrita
// pendente, não há SIGPIPE. Acusar essas duas formas encheria o lint de falso positivo, e um lint
// ruidoso é desligado; o alvo são os produtores que continuam produzindo (`sed`, `awk`, `cat`,
// `node`, `git`, funções do próprio script).
//
// Correção esperada: capturar a saída ANTES do pipe e casar sem pipeline —
//   out="$(cmd 2>&1 || true)"
//   grep -q 'pat' <<<"$out" || { …; }        # here-string: comando único, rc é o do grep
// ou trocar o casamento por construção nativa (`case "$out" in *pat*) … esac`).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Mesmos diretórios gerados/vendored que o coletor dos gates de governança já ignora.
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', 'vendor',
  '.venv', '__pycache__', '.turbo', '.cache', '.idea', '.vs',
]);

// Produtores cuja saída é uma string curta escrita de uma vez: sem escrita pendente quando o
// `grep -q` sai, sem SIGPIPE, sem 141.
export const SAFE_PRODUCERS = new Set(['echo', 'printf', ':', 'true', 'false']);

// `grep` (ou variantes) com a flag -q em qualquer combinação (-q, -qE, -Eq, -Fq, -qi, -qx…),
// seguido, na MESMA linha, de `||` ou `&&`.
const GREP_Q = /\|\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*grep\b[^|]*?\s-[A-Za-z]*q[A-Za-z]*\b[^|]*?(\|\||&&)/;

// Qual comando escreve NO pipe. Precisa recortar tudo que vem antes dele na mesma linha —
// `if … ; then`, `{`, `&&`, `||`, `;`, atribuições de ambiente — senão o produtor reportado vira
// o `[` do teste anterior e um `echo` seguro passa por inseguro (e vice-versa).
export function producerOf(line, pipeIdx) {
  let seg = line.slice(0, pipeIdx);
  // Último separador de comando antes do pipe: o produtor é o que vem DEPOIS dele.
  const cut = /(?:;|&&|\|\||\{|\(|\bthen\b|\bdo\b|\belse\b|\|)/g;
  let last = -1, m;
  while ((m = cut.exec(seg)) !== null) last = m.index + m[0].length;
  if (last >= 0) seg = seg.slice(last);
  seg = seg.replace(/^\s+/, '')
    .replace(/^(?:!|if|while|until|elif)\s+/, '')
    .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
  const m2 = seg.match(/^[^\s;|&]+/);
  return m2 ? m2[0] : '';
}

export function lintText(text) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;                 // comentário: prosa, não código
    const m = line.match(GREP_Q);
    if (!m) return;
    const pipeIdx = line.indexOf(m[0]);
    const producer = producerOf(line, pipeIdx);
    if (SAFE_PRODUCERS.has(producer)) return;
    findings.push({
      lineNo: i + 1,
      op: m[1],
      producer: producer || '(indeterminado)',
      line: line.trim(),
    });
  });
  return findings;
}

export function collectShellFiles(paths) {
  const acc = [];
  const walk = (p) => {
    const rp = resolve(p);
    if (!existsSync(rp)) return;
    const st = statSync(rp);
    if (st.isDirectory()) {
      for (const e of readdirSync(rp, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(rp, e.name)); }
        else if (e.name.endsWith('.sh') || e.name.endsWith('.bash')) acc.push(join(rp, e.name));
      }
    } else if (rp.endsWith('.sh') || rp.endsWith('.bash')) acc.push(rp);
  };
  for (const p of [].concat(paths)) walk(p);
  return acc.sort();
}

// ── Segunda classe (LDG-0141): atribuição por substituição de comando sob `set -e` + `pipefail`
//
// `X="$(ls -1 "$D" 2>/dev/null | sort)"` num arquivo que declara `set -e` JUNTO com `pipefail`
// mata o script sem uma linha de saída: o produtor falha, `pipefail` promove a falha do pipeline,
// e `set -e` encerra. Foi a forma que derrubou o `w20-spec-gate` no CI três execuções seguidas.
//
// O predicado NÃO é "qualquer atribuição via $( ) com pipeline" — medido sobre template/, tests/ e
// bin/, isso acusa 46 linhas do próprio harness e um lint ruidoso é um lint desligado. É a
// INTERSEÇÃO de duas condições, e nenhuma das duas é arbitrária:
//
//   1. o produtor é da família falível (`ls`, `find`, `grep`, `git`, `rg`, `jq`, `comm`, `diff`);
//   2. o produtor silencia o próprio stderr com `2>/dev/null`.
//
// A segunda é a assinatura do defeito: é o autor declarando que ESPERA falha ali e, no mesmo
// gesto, escondendo a única pista que restaria quando `pipefail` mais `set -e` transformarem essa
// falha em morte silenciosa.
//
// Dois recortes de contexto que o predicado precisa fazer, e que custam caro se faltarem:
//
//   - Só vale em arquivo que declara `set -e` JUNTO com `pipefail`. Dos 198 `.sh` do harness, 139
//     declaram os dois e 40 declaram `pipefail` sem `-e`; nesses últimos a classe não morde, e
//     ignorar a condição adiciona dezenas de falsos positivos de uma vez — entre eles o próprio
//     `check-shell-pipeline.sh`.
//   - Substituição de PROCESSO não é substituição de COMANDO: `while … done < <(ls … | sort)` não
//     mata o pai sob `set -e`, e `tests/run-all.sh` — o arquivo que executa a suíte inteira — usa
//     essa forma. Marcá-la faria o lint reprovar o próprio runner. O reconhecedor só olha
//     `NOME=$(` / `NOME="$(`, então `< <(` nunca entra.
//
// O ESCAPE é o `||` que governa a PRÓPRIA substituição — nunca "qualquer `||` na linha".
// `[ -n "$files" ] || files="$( … )"` tem um `||`, e mesmo assim morre: ali o `||` é a guarda do
// teste anterior, a atribuição é o ÚLTIMO comando da lista OR, e sob `set -euo pipefail` a falha
// do produtor mata o script. É literalmente `impact.sh:21`. Medido:
//
//   set -euo pipefail
//   files=""
//   [ -n "$files" ] || files="$(false 2>/dev/null | sed 's/^...//' | paste -sd, -)"
//   echo "SOBREVIVEU"          # nunca é impresso; rc=1
//
// Ponto de mutação do gate `w145[15]`: virar esta constante para `false` faz o reconhecedor
// acusar pipeline sem `2>/dev/null`, e o cenário `[13]` (contrapositiva) reprova.
export const REQUIRE_SILENCED_STDERR = true;

export const FALLIBLE_PRODUCERS = new Set([
  'ls', 'find', 'grep', 'egrep', 'fgrep', 'rg', 'git', 'jq', 'comm', 'diff',
]);

// `set -e` e `pipefail` declarados no arquivo. `set -o errexit` e `set -euo pipefail` contam;
// `set -uo pipefail` NÃO liga errexit — é exatamente a diferença que evita os falsos positivos.
export function fileGuards(text) {
  let errexit = false, pipefail = false;
  for (const raw of text.split('\n')) {
    if (/^\s*#/.test(raw)) continue;
    const idx = raw.search(/(?:^|[;&|(]\s*)set\s+-/);
    if (idx < 0) continue;
    const rest = raw.slice(raw.indexOf('set ', idx));
    if (/\bpipefail\b/.test(rest)) pipefail = true;
    if (/\berrexit\b/.test(rest)) errexit = true;
    const flags = rest.match(/^set\s+(-[A-Za-z]+)/);
    if (flags && flags[1].includes('e')) errexit = true;
  }
  return { errexit, pipefail };
}

// Índice do ')' que fecha o '(' em `open`. -1 quando não fecha na mesma linha (substituição
// multilinha — fora do alcance deste reconhecedor, e declarado como tal).
function matchParen(line, open) {
  let depth = 0, quote = null;
  for (let i = open; i < line.length; i += 1) {
    const c = line[i];
    if (quote) { if (c === quote && line[i - 1] !== '\\') quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

// Segmentos de um pipeline no nível de topo do texto dado, e se há `||` no nível de topo.
function topLevel(inner) {
  const segs = [];
  let cur = '', depth = 0, quote = null, hasOr = false;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (quote) { cur += c; if (c === quote && inner[i - 1] !== '\\') quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (c === '|' && depth === 0) {
      if (inner[i + 1] === '|') { hasOr = true; cur += '||'; i += 1; continue; }
      if (inner[i - 1] === '|') { cur += c; continue; }
      segs.push(cur); cur = ''; continue;
    }
    cur += c;
  }
  segs.push(cur);
  return { segs, hasOr };
}

function firstWord(seg) {
  const t = seg.replace(/^\s+/, '')
    .replace(/^(?:!|if|while|until|elif)\s+/, '')
    .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
  const m = t.match(/^[^\s;|&<>]+/);
  if (!m) return '';
  const parts = m[0].split('/');
  return parts[parts.length - 1];
}

export function lintCmdSubst(text) {
  const { errexit, pipefail } = fileGuards(text);
  if (!errexit || !pipefail) return [];
  const findings = [];
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const re = /([A-Za-z_][A-Za-z0-9_]*)=("?)\$\(/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchParen(line, open);
      if (close < 0) continue;
      const inner = line.slice(open + 1, close);
      const { segs, hasOr } = topLevel(inner);
      if (segs.length < 2) continue;         // sem pipeline, a classe não existe
      if (hasOr) continue;                   // `|| true` DENTRO da substituição já protege
      let after = line.slice(close + 1);
      if (m[2]) after = after.replace(/^"/, '');
      if (/^\s*\|\|/.test(after)) continue;   // escape que governa a PRÓPRIA substituição
      const prodSeg = segs[0];
      const producer = firstWord(prodSeg);
      if (!FALLIBLE_PRODUCERS.has(producer)) continue;
      if (REQUIRE_SILENCED_STDERR && !/2>\s*(?:&1\s*)?\/dev\/null/.test(prodSeg)) continue;
      findings.push({ lineNo: i + 1, producer, line: line.trim() });
    }
  });
  return findings;
}
