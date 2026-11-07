// handoff-render — deterministic renderer for .forge/HANDOFF.md (sections 1-3, 5).
// Reads the active change state (manifest/progress/deferrals) and fills the handoff template.
// The narrative delta (section 4) is preserved across regenerations when already filled, so a
// rule-based hook run never destroys a delta written by /forge:handoff.
//
// REGRA DE BYTES AUTORAIS (#120, 6ª rodada — merge em Buffer, digest restrito ao rodapé):
//
//   1. O render é uma função pura dos dados do change (manifest/progress/deferrals + git + FORGE.md).
//   2. "Bytes autorais" de um HANDOFF.md anterior são os bytes que esse render não explica.
//   3. A região do slot NARRATIVE-DELTA é sempre autoral por definição: seu conteúdo BRUTO, sem
//      trim e sem atalho de placeholder, é sempre copiado para a frente quando os dois arquivos —
//      o anterior e o novo render — têm o par de marcadores.
//   4. Para a região FORA do slot ("outside"), a 4ª rodada comparava contra uma "forma" (regex)
//      derivada do template, com cada `{{CAMPO}}` virando um coringa `[^\n]*`. Isso tem um furo: o
//      coringa também casa com texto autoral escrito na MESMA LINHA de um campo (ex.: uma nota
//      colada depois do valor de `{{CHANGE_ID}}` ou de `{{OPEN_DEFERRALS}}`), que então desaparece
//      com rc 0 e sem WARN — exatamente a classe de bug que a issue #120 denuncia. Nenhuma forma
//      derivada de regex fecha esse furo por completo (o campo não tem gramática fixa o bastante).
//   5. A regra atual não usa forma nenhuma: o próprio HANDOFF.md carrega, fora do slot, um
//      comentário `<!-- FORGE:HANDOFF-DIGEST sha256=<hash> -->` com o sha256 de tudo o que está fora
//      do slot NAQUELE arquivo (o comentário exclui a si mesmo do hash — ele descreve o resto do
//      documento, não a si próprio). Na próxima geração, o "outside" do arquivo anterior é
//      re-hasheado (com o comentário removido) e comparado ao hash que o próprio comentário
//      registra: se bater, nada foi tocado por fora desde que ESSE arquivo foi escrito — mesmo que
//      HEAD/data/progresso tenham mudado desde então, porque o hash foi calculado sobre os bytes já
//      atualizados na última geração, não sobre um estado anterior a ela. Se não bater (edição
//      manual, texto colado, truncamento) ou se o comentário não existir (arquivo legado, anterior a
//      esta regra), backup + WARN.
//   6. Comparação de digest é feita em Buffer bruto, nunca via string utf8 decodificada: o marcador
//      do digest é ASCII puro, que em UTF-8 (válido ou não) nunca aparece como byte de continuação,
//      então localizá-lo por Buffer.indexOf funciona mesmo que o resto do arquivo tenha bytes
//      inválidos — sem isso, decodificar para achar o marcador substituiria bytes ruins por U+FFFD e
//      quebraria o hash de qualquer arquivo que não seja UTF-8 limpo.
//   7. TUDO que envolve o arquivo ANTERIOR — localizar os marcadores, extrair o corpo do slot,
//      comparar e recortar o "outside" — opera em Buffer bruto do início ao fim, nunca em string
//      decodificada (achado MEDIUM da revisão do #120, 6ª rodada): decodificar o arquivo anterior
//      para localizar os marcadores e depois recodificar a string de volta para escrever trocava
//      bytes inválidos em UTF-8 dentro do próprio slot por U+FFFD, mesmo esses sendo exatamente o
//      tipo de byte autoral que a regra existe para preservar. O único texto tratado como string é o
//      NOVO render (`content`), que este próprio script produz a partir de UTF-8 válido.
//   8. O placeholder do digest (`<!-- FORGE:HANDOFF-DIGEST -->`) só é preenchido na região
//      ESTRITAMENTE DEPOIS do fim do slot (achado MEDIUM da revisão do #120, 6ª rodada) — nunca na
//      primeira ocorrência do documento inteiro. Um delta narrativo pode legitimamente citar o
//      próprio marcador como texto (por exemplo, para documentar este mecanismo, como este arquivo
//      faz agora); substituir a primeira ocorrência reescreveria essa citação em vez do rodapé real,
//      perdendo a citação em silêncio e deixando o placeholder verdadeiro sem preencher.
//   9. Se o template não tiver o marcador de digest (`<!-- FORGE:HANDOFF-DIGEST -->`) — um template
//      customizado, ou um template preservado pelo `update` antes desta regra existir — o gerador
//      grava o próprio rodapé de digest mesmo assim, ao final do documento (achado LOW da revisão do
//      #120, 6ª rodada). Decisão: gravar sempre, e não cair para comparação literal contra o render
//      novo. A comparação literal (a forma anterior a esta rodada) tem falso positivo em TODO commit
//      real — qualquer avanço de HEAD sha/data já é, por definição, uma mudança de bytes fora do
//      slot — e isso persistiria para sempre nesse template, gerando um WARN e um backup por commit
//      indefinidamente. A alternativa cogitada (degradar para a comparação literal só na primeira
//      geração e avisar uma única vez) exigiria um estado extra persistido entre execuções só para
//      saber que essa "primeira vez" já aconteceu; gravar o rodapé sempre resolve com o mecanismo que
//      já existe, ao custo de uma linha de comentário HTML que ninguém precisa ler.
//  10. O WARN distingue "nunca houve registro de digest neste arquivo" (arquivo gerado antes desta
//      regra — a primeira geração pós-upgrade) de "o digest não bate" (edição manual real depois de
//      um digest válido) — achado LOW da revisão do #120, 6ª rodada. Dizer "conteúdo fora do bloco"
//      quando nunca existiu um digest para comparar afirma uma comparação que não aconteceu; o texto
//      da 1ª geração é honesto sobre o motivo real (arquivo anterior a esta versão) e sobre a
//      consequência (o conteúdo anterior foi salvo por precaução, porque sem digest não há como
//      saber se ele mudou).
//
// Driven by env (set by handoff-gen.sh): HANDOFF_DIR, HANDOFF_TPL, FORGE_ROOT, HANDOFF_ID,
// HANDOFF_BRANCH, HANDOFF_SHA, HANDOFF_DATE, HANDOFF_TEST, HANDOFF_TYPECHECK, HANDOFF_LINT.
// Deterministic: no wall clock (uses HEAD commit date passed in), stable field order. The backup
// filename is prefixed by the deterministic HEAD commit date (HANDOFF_DATE, slugified — never wall
// clock) followed by a hash of the previous file's bytes: the date makes backups sortable by name
// in the chronological order they were made for, and the hash keeps the dedupe property — a rerun
// over the exact same previous bytes under the exact same HANDOFF_DATE overwrites the same path
// instead of growing forge-backups/ without bound, while previous content that genuinely differs
// (new state, new lost text) still gets its own file.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseYamlSubset } from './yaml-lite.mjs';

const env = process.env;
const dir = env.HANDOFF_DIR;
const root = env.FORGE_ROOT;
const out = join(root, '.forge', 'HANDOFF.md');

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const dash = (v) => (v === undefined || v === null || v === '' ? 'n/d' : String(v));

const manifest = parseYamlSubset(readFileSync(join(dir, 'manifest.yaml'), 'utf8'));
const progress = readJson(join(dir, 'progress.json')) || {};
const deferrals = readJson(join(dir, 'deferrals.json'));

const openDeferrals = Array.isArray(deferrals)
  ? deferrals.filter((d) => d && d.status === 'open').map((d) => d.id)
  : (deferrals && Array.isArray(deferrals.deferrals)
      ? deferrals.deferrals.filter((d) => d && d.status === 'open').map((d) => d.id)
      : []);

const map = {
  CHANGE_ID: dash(env.HANDOFF_ID),
  TYPE: dash(manifest.type),
  SCALE: dash(manifest.scale),
  PHASE: dash(manifest.status),
  BRANCH: dash(env.HANDOFF_BRANCH),
  SHA: dash(env.HANDOFF_SHA),
  DATE: dash(env.HANDOFF_DATE),
  WAVE: dash(progress.current_wave),
  STORIES_DONE: dash(progress.done_stories ?? 0),
  STORIES_TOTAL: dash(progress.total_stories ?? 0),
  TASKS_DONE: dash(progress.done_tasks ?? 0),
  TASKS_TOTAL: dash(progress.total_tasks ?? 0),
  OPEN_DEFERRALS: openDeferrals.length ? openDeferrals.join(', ') : 'nenhum',
  RUNTIME_TEST: dash(env.HANDOFF_TEST),
  RUNTIME_TYPECHECK: dash(env.HANDOFF_TYPECHECK),
  RUNTIME_LINT: dash(env.HANDOFF_LINT),
};

const rawTpl = readFileSync(env.HANDOFF_TPL, 'utf8');
let content = rawTpl;
for (const [k, v] of Object.entries(map)) content = content.replaceAll(`{{${k}}}`, v);

function slugDate(v) {
  const s = (v || '').replace(/[^0-9A-Za-z]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'sem-data';
}

// Backs up the previous HANDOFF.md before any of it is discarded (#120). Mirrors the backup
// resolution the `update` flow uses since #76 (bin/forge.mjs): git-dir-relative and outside the
// working tree whenever one is resolvable (so it works from a linked worktree too, and never shows
// up in `git status` or gets swept by a gate that scans the tree), with a same-directory fallback
// for a non-git target. Takes the previous file as a raw Buffer, never the utf8-decoded string:
// decoding invalid UTF-8 replaces bad bytes with U+FFFD, and re-encoding that string back to disk
// changes the byte count and breaks the "byte-idêntico" contract for any HANDOFF.md that isn't
// clean UTF-8 (e.g. saved once from Latin-1/CP1252, or carrying a stray byte). Returns the absolute
// backup path and the exact byte length of what was saved, read from the buffer, not a decoded
// string.
function backupPreviousHandoff(root, prevBuf) {
  const bytes = prevBuf.length;
  const hash = createHash('sha256').update(prevBuf).digest('hex').slice(0, 16);
  const stamp = `${slugDate(env.HANDOFF_DATE)}-${hash}`;
  let gitDir = null;
  try {
    gitDir = resolvePath(root, execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { gitDir = null; }
  const backupPath = gitDir
    ? join(gitDir, 'forge-backups', `handoff-${stamp}.md`)
    : join(root, '.forge', `HANDOFF.md.bak-${stamp}`);
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, prevBuf);
  return { path: backupPath, bytes };
}

const START = '<!-- FORGE:NARRATIVE-DELTA:START -->';
const END = '<!-- FORGE:NARRATIVE-DELTA:END -->';
const DIGEST_PLACEHOLDER = '<!-- FORGE:HANDOFF-DIGEST -->';
// Matches either the unfilled placeholder or an already-filled digest line (with its trailing
// newline, if any), so the same helper strips it in either form. Only ever applied to text this
// script itself produced (never to previous-file bytes — see rule item 7 above).
const DIGEST_LINE_STR_RE = /<!-- FORGE:HANDOFF-DIGEST(?: sha256=[0-9a-f]{64})? -->\r?\n?/;

// Buffer-level digest-line lookup: the marker is pure ASCII, and any byte below 0x80 is
// unambiguous in a UTF-8 stream regardless of what invalid sequences surround it elsewhere in the
// buffer, so this never needs to decode the buffer as text (see rule item 6 above).
const DIGEST_PREFIX = Buffer.from('<!-- FORGE:HANDOFF-DIGEST sha256=', 'ascii');
const DIGEST_SUFFIX = Buffer.from(' -->', 'ascii');
const DIGEST_HEX_LEN = 64;

function findDigestLine(buf) {
  const start = buf.indexOf(DIGEST_PREFIX);
  if (start < 0) return null;
  const hexStart = start + DIGEST_PREFIX.length;
  const hexBuf = buf.subarray(hexStart, hexStart + DIGEST_HEX_LEN);
  const hex = hexBuf.toString('ascii');
  if (hexBuf.length !== DIGEST_HEX_LEN || !/^[0-9a-f]{64}$/.test(hex)) return null;
  const suffixStart = hexStart + DIGEST_HEX_LEN;
  if (buf.subarray(suffixStart, suffixStart + DIGEST_SUFFIX.length).compare(DIGEST_SUFFIX) !== 0) return null;
  let end = suffixStart + DIGEST_SUFFIX.length;
  if (buf[end] === 0x0d) end += 1; // \r
  if (buf[end] === 0x0a) end += 1; // \n
  return { start, end, hex };
}

function stripDigestLine(buf, found) {
  if (!found) return buf;
  return Buffer.concat([buf.subarray(0, found.start), buf.subarray(found.end)]);
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// Raw-template markers, all in Buffer domain (rule item 7): the template's own placeholder body —
// what "nothing to preserve here" is measured against — can itself contain accented text (see
// templates/handoff/HANDOFF.md), so it is compared as bytes, never as a decoded string.
const rawTplBuf = Buffer.from(rawTpl, 'utf8');
const rawCsB = rawTplBuf.indexOf(START);
const rawCeB = rawTplBuf.indexOf(END);
const tplHasSlot = rawCsB >= 0 && rawCeB > rawCsB;
const tplHasDigestPlaceholder = rawTpl.includes(DIGEST_PLACEHOLDER);

// The freshly rendered content, as bytes. From this point on the previous file is handled purely
// in Buffer domain; `content` (a string) is only ever read again to compute the digest's hash
// input, which excludes the slot entirely and is therefore unaffected by anything the previous
// file's slot contains.
let outBuf = Buffer.from(content, 'utf8');
const csB = outBuf.indexOf(START);
const ceB = outBuf.indexOf(END);
const contentHasSlot = csB >= 0 && ceB > csB;
let ceFinal = ceB; // moves only if the slot body's byte length changes during the merge below

let backupInfo = null;
if (existsSync(out)) {
  const prevBuf = readFileSync(out);
  const psB = prevBuf.indexOf(START);
  const peB = prevBuf.indexOf(END);
  const bothHaveMarkersBuf = psB >= 0 && peB > psB && contentHasSlot;

  // The "outside" region of the PREVIOUS file, in raw bytes: everything except the slot's own raw
  // body (never decoded — rule item 7).
  const prevOutsideBuf = bothHaveMarkersBuf
    ? Buffer.concat([prevBuf.subarray(0, psB + START.length), prevBuf.subarray(peB)])
    : prevBuf;

  const found = findDigestLine(prevOutsideBuf);
  const strippedPrevOutside = stripDigestLine(prevOutsideBuf, found);
  const noDigestFound = !found;
  const digestMismatch = !!found && found.hex !== sha256Hex(strippedPrevOutside);
  const wouldLoseBytes = noDigestFound || digestMismatch;

  // If the previous bytes already had a valid, matching digest there is nothing to lose, so no
  // backup; likewise an empty previous file (0 bytes) has nothing to recover, so it is skipped too
  // — the backup and WARN exist to make real prior content recoverable, not to leave a trace on
  // every run.
  if (wouldLoseBytes && prevBuf.length > 0) {
    backupInfo = {
      ...backupPreviousHandoff(root, prevBuf),
      bothHaveMarkers: bothHaveMarkersBuf,
      // "First digest generation": markers are present but no digest line was ever found in the
      // previous file at all (rule item 10) — distinct from a digest that was present and no
      // longer matches.
      firstDigestGen: bothHaveMarkersBuf && noDigestFound,
    };
  }

  // Slot merge, RAW previous bytes, never decoded — #120 rule item 7 (6ª rodada). The only thing
  // that means "nothing to preserve here" is the previous slot being byte-for-byte the template's
  // own raw placeholder; anything else, however it starts or ends or whatever bytes it contains
  // (including invalid UTF-8), is authorial and is copied forward as-is.
  if (bothHaveMarkersBuf) {
    const prevSlotRawBuf = prevBuf.subarray(psB + START.length, peB);
    const tplSlotRawBuf = rawTplBuf.subarray(rawCsB + START.length, rawCeB);
    if (!prevSlotRawBuf.equals(tplSlotRawBuf)) {
      outBuf = Buffer.concat([outBuf.subarray(0, csB + START.length), prevSlotRawBuf, outBuf.subarray(ceB)]);
      ceFinal = csB + START.length + prevSlotRawBuf.length;
    }
  }
}

// Stamp the digest of everything outside the slot in THIS render, so the next regeneration can
// tell a state-only change (fields the renderer itself controls) apart from an authorial byte
// (anything a human wrote that this renderer would not have produced) without matching against a
// template "shape" — see rule items 4-5 above for why the shape approach undercounts loss.
const outsideNowBuf = contentHasSlot
  ? Buffer.concat([outBuf.subarray(0, csB + START.length), outBuf.subarray(ceFinal)])
  : outBuf;
const outsideForHash = outsideNowBuf.toString('utf8').replace(DIGEST_LINE_STR_RE, '');
const digestHex = sha256Hex(Buffer.from(outsideForHash, 'utf8'));
const digestLine = `<!-- FORGE:HANDOFF-DIGEST sha256=${digestHex} -->`;

if (tplHasDigestPlaceholder) {
  // Fill the placeholder only in the FOOTER — the region strictly after the slot (rule item 8) —
  // never inside it, so authorial text that quotes the marker (like this file's own header
  // comment, if ever pasted into a delta) survives untouched.
  const footerStart = contentHasSlot ? ceFinal + END.length : 0;
  const placeholderIdx = outBuf.indexOf(DIGEST_PLACEHOLDER, footerStart);
  if (placeholderIdx >= 0) {
    outBuf = Buffer.concat([
      outBuf.subarray(0, placeholderIdx),
      Buffer.from(digestLine, 'ascii'),
      outBuf.subarray(placeholderIdx + DIGEST_PLACEHOLDER.length),
    ]);
  }
} else {
  // Template without the marker: append our own digest footer anyway (rule item 9). No separator
  // is inserted before it: `stripDigestLine` only ever removes the marker's own bytes (from its
  // prefix through its own trailing newline), so anything placed BEFORE it — including a
  // separating blank line — would survive every strip and permanently drift the recomputed hash
  // away from the one this same line records, defeating the whole mechanism on every subsequent
  // run. Appending directly keeps the round trip exact: reading this file back and stripping the
  // digest line yields the identical bytes that were hashed to produce it.
  outBuf = Buffer.concat([outBuf, Buffer.from(`${digestLine}\n`, 'ascii')]);
}

writeFileSync(out, outBuf);
if (backupInfo) {
  const reason = !backupInfo.bothHaveMarkers
    ? 'HANDOFF.md sem marcadores NARRATIVE-DELTA'
    : backupInfo.firstDigestGen
      ? 'primeira geração com registro de digest (HANDOFF.md gerado antes desta versão) — conteúdo anterior salvo por precaução'
      : 'HANDOFF.md com conteúdo fora do bloco NARRATIVE-DELTA';
  process.stderr.write(
    `WARN: ${reason} — conteúdo anterior (${backupInfo.bytes} bytes) salvo em ${backupInfo.path}\n`,
  );
}
