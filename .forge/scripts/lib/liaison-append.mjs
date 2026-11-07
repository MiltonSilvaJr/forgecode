// liaison-append.mjs — escritor único do log próprio (REQ-09, REQ-11, design §2.2, §2.4).
//
// `appendOwn` é o único lugar que escreve `log/<self>.jsonl`: sob `withOwnLogLock`, relê o canal
// inteiro, chama `build(all)` (que devolve o envelope SEM `seq`/`lamport`/`msg_id`/`content_sha`),
// completa esses quatro campos, valida com `validateEnvelope` e grava por tmp + rename. Imediata-
// mente antes do `renameSync` final, confere `stillOwned()` — se a trava foi recuperada por outro
// processo no meio da seção crítica, apaga o tmp e lança sem gravar (nunca deixa um escritor cuja
// trava já não é dele sobrescrever o que o recuperador possa ter produzido).
//
// `appendOwnDecided` é a variante do bastão: `decide(all)` pode recusar sem gravar
// (`{ refuse: true, reason, fold }`) ou aceitar (`{ envelope, afterWrite(allWithNew) }`); depois
// da gravação, `afterWrite` roda AINDA sob a trava e recebe o canal com a mensagem nova — é assim
// que `baton claim` devolve `won`/`lost-held` já calculado sobre o estado que ele mesmo gravou,
// sem reabrir a trava.
//
// Modo CLI (`node liaison-append.mjs union-own <chDir> <self> <arquivo-do-hub>`, design §2.4):
// usado pelo push do `sync` no lugar do `cp "$hubf" "$own"` — sob a mesma trava, une o log
// próprio relido com o arquivo do hub (sem perder nada gravado depois da leitura que alimentou o
// push) e grava. Consumido a partir da TASK-07 (`transports/_common.sh`).

import { readFileSync, writeFileSync, readdirSync, existsSync, renameSync, unlinkSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withOwnLogLock } from './liaison-lock.mjs';

const selfModuleUrl = import.meta.url;

async function loadMerge() {
  // Resolução relativa à URL do próprio módulo: `new URL(...).pathname` devolveria o caminho
  // percent-encoded (`Projetos%20A%C3%A7%C3%A3o`) e o import falharia em todo caminho com espaço
  // ou acento.
  return import(new URL('./liaison-merge.mjs', selfModuleUrl).href);
}

export function readAllMessages(logDir) {
  const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
  const all = [];
  for (const f of files) {
    const text = readFileSync(join(logDir, f), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t) all.push(JSON.parse(t));
    }
  }
  return all;
}

export class AppendValidationError extends Error {
  constructor(errors) {
    super(`envelope inválido: ${errors.join('; ')}`);
    this.name = 'AppendValidationError';
    this.errors = errors;
  }
}

export class LockLostError extends Error {
  constructor(msg) {
    super(msg || 'liaison-append: trava perdida antes da gravação final — nada escrito');
    this.name = 'LockLostError';
  }
}

async function finishEnvelope(partial, all, self) {
  const M = await loadMerge();
  const own = all.filter((m) => m.sender === self);
  const seq = M.nextSeq(own);
  const threadMsgs = all.filter((m) => m.thread_id === partial.thread_id);
  const lamport = M.nextLamport(threadMsgs);
  const msgId = `${self}-${String(seq).padStart(4, '0')}`;
  const msg = { ...partial, msg_id: msgId, sender: self, seq, lamport };
  msg.content_sha = M.computeContentSha(msg);
  const errs = M.validateEnvelope(msg);
  if (errs.length) throw new AppendValidationError(errs);
  return { msg, own };
}

function writeOwnLog(logDir, self, messages, stillOwned) {
  const target = join(logDir, `${self}.jsonl`);
  const tmp = `${target}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const body = messages.map((m) => JSON.stringify(m)).join('\n') + (messages.length ? '\n' : '');
  writeFileSync(tmp, body);
  if (!stillOwned()) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best-effort */
    }
    throw new LockLostError();
  }
  renameSync(tmp, target);
}

const JOURNAL_MAX_ENTRIES = 500;

// appendJournal({ root, channel, msg }) — registra seq/content_sha da mensagem recém-gravada em
// `<root>/.forge/cache/liaison-baton/<channel>/append-journal.json` (design §2.4, "escritor de
// versão antiga"). Chamado SÓ DEPOIS do `renameSync` bem-sucedido (para que uma gravação abortada
// por `stillOwned()` nunca gere aviso falso) e AINDA sob a trava do log que `appendOwn` já detém
// — por isso não precisa de trava própria. Mantém só as últimas `JOURNAL_MAX_ENTRIES`. Melhor
// esforço: uma falha aqui nunca desfaz a gravação real (ela já aconteceu).
function appendJournal({ root, channel, msg }) {
  if (!root || !channel || !msg) return;
  try {
    const dir = join(root, '.forge', 'cache', 'liaison-baton', channel);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'append-journal.json');
    let entries = [];
    if (existsSync(file)) {
      try {
        entries = JSON.parse(readFileSync(file, 'utf8'));
        if (!Array.isArray(entries)) entries = [];
      } catch {
        entries = [];
      }
    }
    entries.push({ msg_id: msg.msg_id, seq: msg.seq, content_sha: msg.content_sha, at: new Date().toISOString() });
    if (entries.length > JOURNAL_MAX_ENTRIES) entries = entries.slice(entries.length - JOURNAL_MAX_ENTRIES);
    const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(tmp, JSON.stringify(entries));
    renameSync(tmp, file);
  } catch {
    /* best-effort — a gravação real já aconteceu; o diário é diagnóstico, não autoridade */
  }
}

// readJournal(root, channel) -> array de entradas (ou []).
export function readJournal(root, channel) {
  try {
    const file = join(root, '.forge', 'cache', 'liaison-baton', channel, 'append-journal.json');
    if (!existsSync(file)) return [];
    const entries = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

// checkJournalIntegrity({ root, channel, chDir, self }) -> [{ msg_id, reason }] — entradas do
// diário cujo msg_id não está mais no log próprio com o MESMO content_sha (reescrito por um
// escritor sem trava — design §2.4, limite declarado do "escritor de versão antiga").
export function checkJournalIntegrity({ root, channel, chDir, self }) {
  const entries = readJournal(root, channel);
  if (!entries.length) return [];
  const logDir = join(chDir, 'log');
  const current = new Map(readAllMessages(logDir).filter((m) => m.sender === self).map((m) => [m.msg_id, m.content_sha]));
  const bad = [];
  for (const e of entries) {
    const sha = current.get(e.msg_id);
    if (sha === undefined || sha !== e.content_sha) bad.push({ msg_id: e.msg_id, seq: e.seq });
  }
  return bad;
}

// appendOwn({ root, chDir, channel, self, build, waitMs }) -> { msg, all }
export async function appendOwn({ root, chDir, channel, self, build, waitMs } = {}) {
  if (!root || !chDir || !channel || !self || typeof build !== 'function') {
    throw new Error('appendOwn: root/chDir/channel/self/build obrigatórios');
  }
  return withOwnLogLock({ root, channel, self, waitMs }, async ({ stillOwned }) => {
    const logDir = join(chDir, 'log');
    const all = readAllMessages(logDir);
    const partial = await build(all);
    const { msg, own } = await finishEnvelope(partial, all, self);
    const senderMsgs = own.concat([msg]).sort((a, b) => a.seq - b.seq);
    writeOwnLog(logDir, self, senderMsgs, stillOwned);
    appendJournal({ root, channel, msg });
    return { msg, all: all.concat([msg]) };
  });
}

// appendOwnDecided({ root, chDir, channel, self, decide, waitMs }) -> ver cabeçalho do arquivo.
export async function appendOwnDecided({ root, chDir, channel, self, decide, waitMs } = {}) {
  if (!root || !chDir || !channel || !self || typeof decide !== 'function') {
    throw new Error('appendOwnDecided: root/chDir/channel/self/decide obrigatórios');
  }
  return withOwnLogLock({ root, channel, self, waitMs }, async ({ stillOwned }) => {
    const logDir = join(chDir, 'log');
    const all = readAllMessages(logDir);
    const decision = await decide(all);
    // Passa adiante TODO campo extra de uma recusa (ex.: rc e already do bastão, design §2.7) —
    // não só reason/fold. decide(all) é o único lugar que sabe o SIGNIFICADO da recusa (pré-
    // condição inócua vs. sessão já titular); esta função é infraestrutura compartilhada e não
    // deve conhecer esses significados para repassá-los.
    if (decision && decision.refuse) {
      return { ...decision, refused: true };
    }
    if (!decision || !decision.envelope) {
      throw new Error('appendOwnDecided: decide(all) precisa devolver { refuse } ou { envelope }');
    }
    const { msg, own } = await finishEnvelope(decision.envelope, all, self);
    const senderMsgs = own.concat([msg]).sort((a, b) => a.seq - b.seq);
    writeOwnLog(logDir, self, senderMsgs, stillOwned);
    appendJournal({ root, channel, msg });
    const allWithNew = all.concat([msg]);
    const fold = typeof decision.afterWrite === 'function' ? await decision.afterWrite(allWithNew) : null;
    return { msg, all: allWithNew, fold };
  });
}

// unionOwn({ root, chDir, channel, self, hubFile, waitMs }) -> { msg_ids, count } — une o log
// próprio relido (sob a trava) com o arquivo do hub, sem perder nada gravado depois da leitura
// que alimentou o push (design §2.4, "Escritor único da gravação"). Usado no lugar de
// `cp "$hubf" "$own"` pelo push do `sync`.
export async function unionOwn({ root, chDir, channel, self, hubFile, waitMs } = {}) {
  if (!root || !chDir || !channel || !self || !hubFile) {
    throw new Error('unionOwn: root/chDir/channel/self/hubFile obrigatórios');
  }
  return withOwnLogLock({ root, channel, self, waitMs }, async ({ stillOwned }) => {
    const logDir = join(chDir, 'log');
    const ownFile = join(logDir, `${self}.jsonl`);
    const ownNow = existsSync(ownFile)
      ? readFileSync(ownFile, 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
    const hubMsgs = existsSync(hubFile)
      ? readFileSync(hubFile, 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
    const bySeq = new Map();
    for (const m of hubMsgs) bySeq.set(Number(m.seq), m);
    for (const m of ownNow) bySeq.set(Number(m.seq), m); // o log próprio relido vence em empate
    const union = [...bySeq.values()].sort((a, b) => Number(a.seq) - Number(b.seq));
    writeOwnLog(logDir, self, union, stillOwned);
    return { count: union.length, msg_ids: union.map((m) => m.msg_id) };
  });
}

// --- modo CLI -----------------------------------------------------------------------------------
async function mainCli() {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'union-own') {
    const [chDir, self, hubFile] = rest;
    if (!chDir || !self || !hubFile) {
      console.error('Uso: liaison-append.mjs union-own <chDir> <self> <arquivo-do-hub>');
      process.exit(1);
    }
    // ROOT: mesma resolução do resto do liaison — --git-common-dir a partir do chDir (o chDir
    // vive em <root>/.forge/liaison/<channel>, então root é dois níveis acima de dois níveis).
    const root = process.env.FORGE_ROOT || dirname(dirname(dirname(chDir)));
    const channel = chDir.split('/').filter(Boolean).pop();
    try {
      const res = await unionOwn({ root, chDir, channel, self, hubFile });
      process.stdout.write(`${res.count}\n`);
    } catch (e) {
      console.error(`FAIL union-own: ${e && e.message ? e.message : e}`);
      process.exit(1);
    }
    return;
  }
  console.error(`Uso: liaison-append.mjs union-own <chDir> <self> <arquivo-do-hub> (recebido: ${cmd || '(nenhum)'})`);
  process.exit(1);
}

// Guarda de módulo principal por caminho REAL nos dois lados: o Node resolve symlink no módulo
// principal (import.meta.url), mas argv[1] chega lógico (`/tmp` é symlink no macOS, e quem chama
// deriva o caminho com `cd ... && pwd`). Comparar sem realpath fazia o CLI virar no-op com rc 0.
let isMain = false;
try { isMain = realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] || ''); } catch { isMain = false; }
if (isMain) {
  mainCli();
}
