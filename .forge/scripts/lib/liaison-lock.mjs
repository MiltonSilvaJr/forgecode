// liaison-lock.mjs — trava exclusiva por arquivo (REQ-09, design §2.4).
//
// Caminho: `<root>/.forge/cache/liaison-locks/<name>.lock/` (diretório), com `owner.json`
// `{ pid, host, started_at, nonce, cmd }`. `.forge/cache/` é gitignored (installer/gitignore.patch),
// nunca versionado, nunca compartilhado entre clones — por isso a trava só precisa resolver
// vivacidade DENTRO de um host.
//
// Aquisição: `mkdirSync` sem `recursive` (atômico; falha com EEXIST) depois de garantir o
// diretório pai PASSO A PASSO (nunca `mkdirSync(..., { recursive: true })` direto, que aceita
// silenciosamente um symlink pré-existente em qualquer segmento do caminho — lição do
// `heavy-mutex.sh` citada no design).
//
// Espera ativa (25 ms + jitter até 10 ms) até `waitMs` (default 10000, honra
// `FORGE_LIAISON_LOCK_WAIT_MS` limitado a [0, 10000] quando o chamador não passa `waitMs`
// explícito). Esgotado, lança nomeando pid/host/started_at do dono.
//
// Recuperação de trava abandonada: mesmo host e processo dono inexistente (ESRCH; EPERM = vivo,
// nunca abandonado) OU idade acima de `STALE_AGE_MS` (120 s). A recuperação é exclusiva e
// conferida por um guarda `<lock>.recover/` (mkdirSync atômico): só prossegue se o `nonce`
// relido sob o guarda ainda é o que foi observado como abandonado; então renomeia a trava para
// `<lock>.stale-<nonce>`, remove o renomeado, remove o guarda, avisa em stderr. Guarda com mais
// de `RECOVER_GUARD_STALE_MS` (10 s) é reclamado pelo próximo recuperador por renomeação para
// nome único seguida de conferência do `mtime` do renomeado: se ainda estiver realmente velho,
// é removido de verdade; se não (outro recuperador acabou de recriá-lo bem na janela da
// renomeação), o reclamante desiste SEM desfazer a própria renomeação (abandona o nome único —
// resíduo inofensivo, documentado no design) e volta a esperar.
//
// `stillOwned()`: relê `owner.json` e confere `nonce`, para o chamador rodar imediatamente antes
// do `renameSync` final da sua própria gravação (janela residual de microssegundos registrada
// como limite no design/rule).

import { mkdirSync, rmSync, renameSync, writeFileSync, readFileSync, existsSync, statSync, lstatSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

export const STALE_AGE_MS = 120_000;
export const RECOVER_GUARD_STALE_MS = 10_000;
const DEFAULT_WAIT_MS = 10_000;
const POLL_INTERVAL_MS = 25;
const POLL_JITTER_MS = 10;

export function locksDir(root) {
  return join(root, '.forge', 'cache', 'liaison-locks');
}

export function lockDirFor(root, name) {
  return join(locksDir(root), `${name}.lock`);
}

// Garante cada segmento do caminho, um a um, sem nunca aceitar um symlink pré-existente em
// qualquer ancestral — ao contrário de `mkdirSync(p, { recursive: true })`.
function ensureRealDirChain(base, relSegments) {
  let cur = base;
  if (!existsSync(cur)) {
    throw new Error(`liaison-lock: base '${base}' não existe`);
  }
  for (const seg of relSegments) {
    const next = join(cur, seg);
    if (existsSync(next)) {
      const st = lstatSync(next);
      if (st.isSymbolicLink()) {
        throw new Error(`liaison-lock: '${next}' é um symlink — recusado (mkdir -p aceitaria silenciosamente)`);
      }
      if (!st.isDirectory()) {
        throw new Error(`liaison-lock: '${next}' existe e não é diretório`);
      }
    } else {
      try {
        mkdirSync(next);
      } catch (e) {
        if (e && e.code !== 'EEXIST') throw e;
      }
    }
    cur = next;
  }
  return cur;
}

function ensureLocksDirExists(root) {
  const rel = ['.forge', 'cache', 'liaison-locks'];
  return ensureRealDirChain(root, rel);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDead(pid) {
  try {
    process.kill(pid, 0);
    return false; // vivo (ou não podemos saber — EPERM cai no catch abaixo)
  } catch (e) {
    if (e && e.code === 'ESRCH') return true;
    return false; // EPERM (vivo, outro usuário) ou erro desconhecido: nunca trata como abandonada
  }
}

function readOwnerSafe(lockDir) {
  try {
    const raw = readFileSync(join(lockDir, 'owner.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function lockAgeMs(lockDir, owner) {
  if (owner && owner.started_at) {
    const t = Date.parse(owner.started_at);
    if (Number.isFinite(t)) return Date.now() - t;
  }
  try {
    const st = statSync(lockDir);
    return Date.now() - st.mtimeMs;
  } catch {
    return Infinity; // já não existe — "idade infinita" deixa o chamador tratar como livre
  }
}

function isRecoverable(lockDir, owner) {
  if (owner && owner.host === hostname() && typeof owner.pid === 'number' && isDead(owner.pid)) return true;
  return lockAgeMs(lockDir, owner) > STALE_AGE_MS;
}

// Reclama um guarda de recuperação velho (`<lock>.recover`, dono morto no meio da recuperação).
// rc true se reclamou (removeu) e a trava de recuperação está livre para este processo tentar de
// novo; rc false se desistiu (outro recuperador estava de fato vivo/recriou).
function reclaimStaleGuard(guardDir) {
  let st;
  try {
    st = statSync(guardDir);
  } catch {
    return true; // já não existe — livre
  }
  if (Date.now() - st.mtimeMs <= RECOVER_GUARD_STALE_MS) return false; // ainda "jovem"
  const uniq = `${guardDir}.reclaim-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    renameSync(guardDir, uniq);
  } catch {
    return false; // sumiu ou foi renomeado por outro — desiste, volta a esperar
  }
  let st2;
  try {
    st2 = statSync(uniq);
  } catch {
    return true;
  }
  if (Date.now() - st2.mtimeMs > RECOVER_GUARD_STALE_MS) {
    // confirmadamente velho — remove de verdade
    try {
      rmSync(uniq, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    process.stderr.write(`liaison-lock: guarda de recuperação abandonado removido (${guardDir})\n`);
    return true;
  }
  // janela rara: o que renomeamos acabou de ser recriado por outro recuperador — não desfaz a
  // renomeação (resíduo inofensivo, design §2.4), só desiste e deixa o chamador esperar de novo.
  return false;
}

// Tenta recuperar a trava abandonada em `lockDir`. rc true se recuperou (trava removida, livre
// para `mkdirSync` de novo); rc false se não conseguiu (outro recuperador venceu, ou não está
// mais elegível).
function tryRecover(lockDir) {
  const observed = readOwnerSafe(lockDir);
  if (!isRecoverable(lockDir, observed)) return false;
  const guardDir = `${lockDir}.recover`;
  try {
    mkdirSync(guardDir);
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      reclaimStaleGuard(guardDir);
      return false; // mesmo se reclamou, o chamador tenta de novo no próximo ciclo
    }
    throw e;
  }
  try {
    const reobserved = readOwnerSafe(lockDir);
    const sameNonce = (observed == null && reobserved == null) || (observed && reobserved && observed.nonce === reobserved.nonce);
    if (!sameNonce) {
      // alguém adquiriu de novo entre a observação e o guarda — não é mais a mesma trava abandonada
      return false;
    }
    if (!isRecoverable(lockDir, reobserved)) return false;
    const staleName = `${lockDir}.stale-${reobserved && reobserved.nonce ? reobserved.nonce : 'sem-owner'}`;
    try {
      renameSync(lockDir, staleName);
    } catch (e) {
      if (e && e.code === 'ENOENT') return false; // já não existia
      throw e;
    }
    try {
      rmSync(staleName, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    process.stderr.write(
      `liaison-lock: trava abandonada recuperada (${lockDir}); dono anterior: pid=${observed && observed.pid} host=${observed && observed.host} started_at=${observed && observed.started_at}\n`,
    );
    return true;
  } finally {
    try {
      rmSync(guardDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

function resolveWaitMs(waitMs) {
  if (typeof waitMs === 'number' && Number.isFinite(waitMs)) return Math.max(0, Math.min(waitMs, 10_000));
  const envRaw = process.env.FORGE_LIAISON_LOCK_WAIT_MS;
  if (envRaw !== undefined && envRaw !== '') {
    const n = Number(envRaw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(n, 10_000));
  }
  return DEFAULT_WAIT_MS;
}

// acquireLock({ root, name, waitMs }) -> { nonce, lockDir, release(), stillOwned() }
export async function acquireLock({ root, name, waitMs } = {}) {
  if (!root) throw new Error('liaison-lock: root ausente');
  if (!name) throw new Error('liaison-lock: name ausente');
  ensureLocksDirExists(root);
  const lockDir = lockDirFor(root, name);
  const deadline = Date.now() + resolveWaitMs(waitMs);
  let lastOwnerForMessage = null;

  for (;;) {
    try {
      mkdirSync(lockDir);
      const nonce = randomUUID();
      const owner = {
        pid: process.pid,
        host: hostname(),
        started_at: new Date().toISOString(),
        nonce,
        cmd: process.argv.slice(1).join(' ').slice(0, 300),
      };
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify(owner));
      const release = () => releaseLock({ root, name, nonce });
      const stillOwned = () => checkStillOwned(lockDir, nonce);
      return { nonce, lockDir, release, stillOwned };
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      lastOwnerForMessage = readOwnerSafe(lockDir);
      if (tryRecover(lockDir)) continue; // trava livre agora — tenta mkdir de novo sem esperar
      if (Date.now() >= deadline) {
        const o = lastOwnerForMessage || readOwnerSafe(lockDir);
        const who = o ? `pid=${o.pid} host=${o.host} started_at=${o.started_at}` : '(sem owner.json)';
        throw new Error(`liaison-lock: trava ocupada após ${resolveWaitMs(waitMs)}ms — dono: ${who}`);
      }
      await sleep(POLL_INTERVAL_MS + Math.floor(Math.random() * POLL_JITTER_MS));
    }
  }
}

function checkStillOwned(lockDir, nonce) {
  const o = readOwnerSafe(lockDir);
  return !!(o && o.nonce === nonce);
}

export function releaseLock({ root, name, nonce }) {
  const lockDir = lockDirFor(root, name);
  const o = readOwnerSafe(lockDir);
  if (!o || o.nonce !== nonce) return false; // não é mais nosso — não toca
  try {
    rmSync(join(lockDir, 'owner.json'), { force: true });
  } catch {
    /* best-effort */
  }
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  return true;
}

// withLock({ root, name, waitMs }, fn) — adquire, roda fn({ nonce, stillOwned, lockDir }), libera
// sempre (mesmo em exceção).
export async function withLock({ root, name, waitMs } = {}, fn) {
  const { nonce, lockDir, release, stillOwned } = await acquireLock({ root, name, waitMs });
  try {
    return await fn({ nonce, lockDir, stillOwned });
  } finally {
    release();
  }
}

// withOwnLogLock({ root, channel, self, waitMs }, fn) — trava do log próprio: nome
// `<channel>@<self>@log.lock` (design §2.4, §1 — `@` não pertence a `[a-z0-9._-]`, então não
// colide com canal/self que usem ponto, nem com um canal chamado `locks`).
export async function withOwnLogLock({ root, channel, self, waitMs } = {}, fn) {
  return withLock({ root, name: `${channel}@${self}@log`, waitMs }, fn);
}

// withLocalLock({ root, channel, self, waitMs }, fn) — trava de `baton-local.json` (por canal e
// `self`): `<channel>@<self>@local.lock`.
export async function withLocalLock({ root, channel, self, waitMs } = {}, fn) {
  return withLock({ root, name: `${channel}@${self}@local`, waitMs }, fn);
}

// withStateLock({ root, channel, waitMs }, fn) — trava de `state.json` do canal (compartilhada
// entre `self`s, porque `state.json` guarda cursores de todos): `<channel>@state.lock`.
export async function withStateLock({ root, channel, waitMs } = {}, fn) {
  return withLock({ root, name: `${channel}@state`, waitMs }, fn);
}
