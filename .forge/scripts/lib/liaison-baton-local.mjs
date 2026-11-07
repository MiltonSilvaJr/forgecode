// liaison-baton-local.mjs — estado local NÃO VERSIONADO do bastão (design §2.4/§2.5/§2.8):
// `<tronco>/.forge/cache/liaison-baton/<channel>/baton-local.json`, sob `<channel>@<self>@local.lock`
// (liaison-lock.mjs::withLocalLock — a MESMA disciplina de concorrência de qualquer outro estado
// local lido/regravado por mais de um processo, tmp de nome único + rename).
//
// Dois papéis, no MESMO arquivo:
//   claims  — toda claim PRÓPRIA que recebeu rc 0 vencedora (REQ-05: perda tardia — uma sessão
//             que venceu, mas que a dobra, depois de importar mais réplicas, não aponta mais como
//             titular corrente, é perda tardia; consumido por `baton status`/início de sessão,
//             TASK-23/24, ainda não implementados).
//   holders — índice de bastões que ESTE repositório detém, com `nextRenewAt` (lease_until menos
//             a metade do lease_seconds recém-gravado) e o tamanho/mtime do log próprio no
//             momento, para o caminho rápido do gancho de renovação (design §2.8, TASK-26,
//             ainda não implementado) invalidar o cache quando o log próprio mudar por fora.
//
// Puro quanto a efeitos exceto a leitura/escrita deste arquivo — nunca lê o canal, nunca grava
// no log do liaison. `recordWon` é chamado pelo `claim` SÓ quando a claim de fato grava (verdict
// 'won'); a claim recusada "sessão já titular com lease vigente" não grava nada no canal e
// também não precisa tocar este cache (o holder já existe de quando a claim original venceu).
import { existsSync, readFileSync, writeFileSync, renameSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { withLocalLock } from './liaison-lock.mjs';
import { foldBatons } from './liaison-baton.mjs';

function filePath(root, channel) {
  return join(root, '.forge', 'cache', 'liaison-baton', channel, 'baton-local.json');
}

function readState(path) {
  if (!existsSync(path)) return { claims: {}, holders: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return { claims: parsed.claims || {}, holders: parsed.holders || {} };
  } catch {
    return { claims: {}, holders: {} };
  }
}

function writeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

// Truncado ao SEGUNDO, nunca ao milissegundo: o gancho de renovação (design §2.8, TASK-26/27)
// confere esta invalidação com `stat -f %m`/`stat -c %Y` em bash puro (sem node no caminho
// rápido), que só devolve segundos inteiros em qualquer plataforma — gravar a precisão de
// milissegundo do node faria a comparação nunca bater e o caminho rápido cair em frio sempre.
function ownLogStat(chDir, self) {
  const p = join(chDir, 'log', `${self}.jsonl`);
  if (!existsSync(p)) return { size: 0, mtimeMs: 0 };
  const st = statSync(p);
  return { size: st.size, mtimeMs: Math.floor(st.mtimeMs / 1000) * 1000 };
}

// nextRenewAtFor(leaseUntil, leaseSeconds) — metade do prazo, ARREDONDADA PARA CIMA ao segundo
// (ARCH-001). O gancho compara texto ISO em segundos inteiros; com `lease_seconds` ímpar a metade
// cai no meio segundo, e truncar para baixo fazia o gancho chamar o renew 0,5 s antes da metade que
// o próprio renew usa — e receber "ainda não é hora". Para cima, `now_iso >= nextRenewAt` implica
// `Date.now() >= metade`.
export function nextRenewAtFor(leaseUntil, leaseSeconds) {
  const halfMs = Date.parse(leaseUntil) - (leaseSeconds * 1000) / 2;
  return new Date(Math.ceil(halfMs / 1000) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
}

// recordWon({root, channel, chDir, self, batonId, msgId, session, leaseSeconds, leaseUntil})
// `msgId` é SEMPRE o da claim que deu a posse (a claim C da dobra, `holderClaimMsgId`), inclusive
// quando quem chama é o renew (LGC-002): a perda tardia compara este msgId com o
// `holderClaimMsgId` corrente, e a renovação não muda C.
export async function recordWon({ root, channel, chDir, self, batonId, msgId, session, leaseSeconds, leaseUntil }) {
  if (!root || !channel || !chDir || !self || !batonId || !msgId || !session || !leaseSeconds || !leaseUntil) {
    throw new Error('recordWon: root/channel/chDir/self/batonId/msgId/session/leaseSeconds/leaseUntil obrigatórios');
  }
  return withLocalLock({ root, channel, self }, () => {
    const path = filePath(root, channel);
    const state = readState(path);
    state.claims[batonId] = { msgId, session, leaseUntil };
    const nextRenewAt = nextRenewAtFor(leaseUntil, leaseSeconds);
    const { size, mtimeMs } = ownLogStat(chDir, self);
    state.holders[batonId] = { session, leaseUntil, nextRenewAt, ownLogSize: size, ownLogMtimeMs: mtimeMs };
    writeState(path, state);
    return state;
  });
}

// removeHolder({root, channel, self, batonId, dropClaim}) — tira a entrada do índice de titulares.
// Por padrão o histórico em `claims` permanece (é o que a perda tardia consulta): é o caso do
// gancho de renovação diante de perda real. `dropClaim: true` é o caso de release/complete/withdraw
// PRÓPRIOS (LGC-002): a sessão abriu mão do bastão por ato dela, então a claim registrada deixa de
// ser candidata a perda tardia — o design §2.5 manda não acusar perda nesse caso.
export async function removeHolder({ root, channel, self, batonId, dropClaim = false }) {
  if (!root || !channel || !self || !batonId) {
    throw new Error('removeHolder: root/channel/self/batonId obrigatórios');
  }
  return withLocalLock({ root, channel, self }, () => {
    const path = filePath(root, channel);
    const state = readState(path);
    delete state.holders[batonId];
    if (dropClaim) delete state.claims[batonId];
    writeState(path, state);
    return state;
  });
}

// readBatonLocal(root, channel) -> { claims, holders } — leitura direta, sem trava (consumidores
// só-leitura como `baton status`/início de sessão toleram uma leitura em trânsito; quem PRECISA
// de consistência forte lê sob withLocalLock como os escritores acima).
export function readBatonLocal(root, channel) {
  return readState(filePath(root, channel));
}

export function batonLocalPath(root, channel) {
  return filePath(root, channel);
}

// rebuildHolders({root, channel, chDir, self}) — cache FRIO (design §2.8, TASK-26/27): relê o
// canal inteiro, roda a dobra e SUBSTITUI `holders` pelo que ela diz agora (nunca funde com o
// que já estava — um bastão que este repositório deixou de deter, por perda tardia importada ou
// por release/complete de outra réplica, não pode sobreviver no índice). `claims` nunca é
// tocado aqui: é histórico de rc 0 passados, não estado corrente. Chamado pelo gancho de
// renovação quando o tamanho/mtime do log próprio no cache não bate com o atual (invalidação),
// ou quando o cache nem existe ainda (primeira chamada da sessão).
export async function rebuildHolders({ root, channel, chDir, self }) {
  if (!root || !channel || !chDir || !self) {
    throw new Error('rebuildHolders: root/channel/chDir/self obrigatórios');
  }
  const logDir = join(chDir, 'log');
  const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
  const all = [];
  for (const f of files) {
    const text = readFileSync(join(logDir, f), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t) all.push(JSON.parse(t));
    }
  }
  const { batons } = foldBatons(all);
  return withLocalLock({ root, channel, self }, () => {
    const path = filePath(root, channel);
    const state = readState(path);
    const holders = {};
    const { size, mtimeMs } = ownLogStat(chDir, self);
    for (const [batonId, b] of batons) {
      if (b.state === 'held' && b.holder && b.holder.sender === self) {
        const nextRenewAt = nextRenewAtFor(b.leaseUntil, b.leaseSeconds);
        holders[batonId] = { session: b.holder.session, leaseUntil: b.leaseUntil, nextRenewAt, ownLogSize: size, ownLogMtimeMs: mtimeMs };
      }
    }
    state.holders = holders;
    writeState(path, state);
    return state;
  });
}
