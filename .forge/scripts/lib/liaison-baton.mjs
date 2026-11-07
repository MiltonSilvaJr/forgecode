// liaison-baton.mjs — bastão de dono único sobre o liaison (add-liaison-handoff-baton).
//
// Fonte ÚNICA de verdade de `BATON_OPS`, `BATON_STATES`, `BATON_VERDICTS` e
// `BATON_VERB_FLAGS` (REQ-01, critério "os seis valores de op... vêm de uma única fonte no
// código"), de `validateBaton` (camada de bastão — a camada de envelope mora em
// liaison-merge.mjs::validateEnvelope) e de `foldBatons`/`stability` (REQ-04/REQ-05: a função
// pura que resolve o estado de cada bastão a partir só do que está gravado nas mensagens,
// nunca do relógio nem da configuração de quem lê).
//
// Dependência num só sentido (sem ciclo): importa de liaison-merge.mjs (threadOrder,
// compareSender, detectForks, detectGaps, BATON_OP_PATTERN) e reexporta BATON_OP_PATTERN.
// liaison-merge.mjs NUNCA importa daqui.
import { readFileSync, existsSync } from 'node:fs';
import { threadOrder, detectForks, detectGaps, BATON_OP_PATTERN } from './liaison-merge.mjs';

export { BATON_OP_PATTERN };

export const BATON_OPS = ['offer', 'claim', 'renew', 'release', 'complete', 'withdraw'];
export const BATON_STATES = ['available', 'held', 'completed', 'withdrawn'];

// Vereditos possíveis de uma operação de bastão na dobra (REQ-04) — conjunto fechado, na mesma
// ordem em que a tabela do requisito os decide (a implementação em foldBatons segue esta ordem
// como sequência de guardas).
export const BATON_VERDICTS = [
  'forked',
  'malformed',
  'offered',
  'pending-offer',
  'wrong-thread',
  'not-an-offer',
  'before-offer',
  'closed',
  'lease-over-max',
  'not-eligible',
  'won',
  'duplicate-claim',
  'lost-held',
  'renewed',
  'late-renew',
  'not-holder',
  'released',
  'completed',
  'not-offerer',
  'withdrawn',
  'withdraw-while-held',
];

// BATON_VERB_FLAGS — tabela do design §2.7, lida por liaison-ops.sh (via node) para validar as
// flags de cada verbo e montar a mensagem de erro; conferida pelo gate de documentação
// (REQ-16). Única fonte: liaison-ops.sh NUNCA declara uma segunda lista.
export const BATON_VERB_FLAGS = {
  offer: ['--thread', '--subject', '--body', '--body-file', '--from-handoff', '--for', '--max-lease', '--session'],
  claim: ['--lease', '--session'],
  renew: ['--lease', '--session'],
  release: ['--session', '--body', '--body-file'],
  complete: ['--session', '--body', '--body-file'],
  withdraw: ['--session', '--body', '--body-file'],
  status: ['--json'],
  list: ['--json'],
};

const SENDER_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
// NODE-202/SEC-202: o reason da dobra (impresso cru por `baton status`, texto e --json, fora da
// moldura untrusted-render) só interpola id que case com o padrão fechado de id e caiba em 128
// caracteres; qualquer outro valor vira '?'. `thread_id` e `in_reply_to` vêm do peer e o
// validateEnvelope não lhes impõe padrão — um `thread_id` multilinha entrava cru no contexto.
const REASON_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;
function reasonId(v) {
  return typeof v === 'string' && REASON_ID_RE.test(v) ? v : '?';
}
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// isWallClock(v) — true só para carimbo ISO 8601 UTC com segundo (o formato que o harness grava).
// NODE-003: quem MOSTRA `stamped_at` (CHANNEL.md, `baton status`, aviso de carimbo no futuro) usa
// isto antes de interpolar — o valor vem do peer, e `Date.parse` do V8 aceita texto arbitrário
// com quebra de linha ('Jan 1 2099 (\n## x)'), então "parseia" não é prova de forma.
export function isWallClock(v) {
  return typeof v === 'string' && WALL_CLOCK_RE.test(v) && Number.isFinite(Date.parse(v));
}
const LEASE_MIN = 60;
const LEASE_MAX = 86400;
const SKEW_MIN = 0;
const SKEW_MAX = 3600;
const ELIGIBLE_MIN = 1;
const ELIGIBLE_MAX = 64;

const OFFER_ONLY_FIELDS = ['eligible', 'max_lease_seconds', 'skew_tolerance_seconds'];
const LEASE_FIELDS = ['lease_seconds', 'lease_until'];

// validateBaton(msg) -> string[] (vazio = válido). Camada de BASTÃO (REQ-01): chamada pelo CLI
// ANTES de gravar (nunca grava bastão inválido) e pela dobra (foldBatons) para dar `malformed`
// a toda mensagem com `baton` que falhe aqui — nunca pelo validateEnvelope, que só impõe a
// camada de envelope (op no padrão aberto, sem o conjunto fechado dos seis valores).
//
// NODE-003: as mensagens de erro NUNCA ecoam valor vindo da mensagem (só o nome do campo e o
// motivo). Elas viram o `reason` de `malformed` na dobra, e o reason é impresso por `baton status`
// e pelo render fora da moldura untrusted-render — um `session` de peer com quebra de linha
// entraria cru no contexto de quem lê. A exceção são valores já conferidos contra um padrão
// fechado antes de aparecerem na mensagem (id repetido de `eligible`, que casou SENDER_ID_RE; o
// `lease_until` esperado, calculado aqui).
export function validateBaton(msg) {
  const errors = [];
  if (!msg || typeof msg !== 'object') return ['mensagem não é um objeto'];
  const b = msg.baton;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ['baton ausente ou não é um objeto'];

  const op = b.op;
  if (typeof op !== 'string' || !BATON_OPS.includes(op)) {
    errors.push('baton.op fora do conjunto fechado');
    // Sem op válido não há como saber quais campos são obrigatórios/proibidos — para aqui.
    return errors;
  }

  if (b.session === undefined || b.session === null || b.session === '') {
    errors.push('baton.session obrigatório ausente');
  } else if (typeof b.session !== 'string' || !SESSION_RE.test(b.session)) {
    errors.push('baton.session fora do padrão');
  }

  if (b.stamped_at === undefined || b.stamped_at === null || b.stamped_at === '') {
    errors.push('baton.stamped_at obrigatório ausente');
  } else if (typeof b.stamped_at !== 'string' || !WALL_CLOCK_RE.test(b.stamped_at) || !Number.isFinite(Date.parse(b.stamped_at))) {
    errors.push('baton.stamped_at fora do padrão ISO 8601 UTC com segundo');
  }

  const isOffer = op === 'offer';
  const needsLease = op === 'claim' || op === 'renew';

  // eligible/max_lease_seconds/skew_tolerance_seconds: obrigatórios SÓ em offer, proibidos nas
  // demais operações.
  for (const f of OFFER_ONLY_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(b, f) && b[f] !== undefined && b[f] !== null;
    if (isOffer && !present) errors.push(`baton.${f} obrigatório ausente (offer)`);
    if (!isOffer && present) errors.push(`baton.${f} proibido fora de offer (op=${op})`);
  }
  if (isOffer) {
    if (!Array.isArray(b.eligible)) {
      errors.push('baton.eligible precisa ser array');
    } else {
      if (b.eligible.length < ELIGIBLE_MIN || b.eligible.length > ELIGIBLE_MAX) {
        errors.push(`baton.eligible fora de [${ELIGIBLE_MIN}, ${ELIGIBLE_MAX}] itens: ${b.eligible.length}`);
      }
      const seen = new Set();
      for (const id of b.eligible) {
        if (typeof id !== 'string' || !SENDER_ID_RE.test(id)) errors.push('baton.eligible com id fora do padrão');
        else if (seen.has(id)) errors.push(`baton.eligible com id repetido: ${id}`);
        seen.add(id);
      }
    }
    if (b.max_lease_seconds !== undefined && (!Number.isInteger(b.max_lease_seconds) || b.max_lease_seconds < LEASE_MIN || b.max_lease_seconds > LEASE_MAX)) {
      errors.push(`baton.max_lease_seconds fora de [${LEASE_MIN}, ${LEASE_MAX}]`);
    }
    if (b.skew_tolerance_seconds !== undefined && (!Number.isInteger(b.skew_tolerance_seconds) || b.skew_tolerance_seconds < SKEW_MIN || b.skew_tolerance_seconds > SKEW_MAX)) {
      errors.push(`baton.skew_tolerance_seconds fora de [${SKEW_MIN}, ${SKEW_MAX}]`);
    }
  }

  // lease_seconds/lease_until: obrigatórios SÓ em claim/renew, proibidos nas demais.
  for (const f of LEASE_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(b, f) && b[f] !== undefined && b[f] !== null;
    if (needsLease && !present) errors.push(`baton.${f} obrigatório ausente (${op})`);
    if (!needsLease && present) errors.push(`baton.${f} proibido fora de claim/renew (op=${op})`);
  }
  if (needsLease) {
    if (b.lease_seconds !== undefined && (!Number.isInteger(b.lease_seconds) || b.lease_seconds < LEASE_MIN || b.lease_seconds > LEASE_MAX)) {
      errors.push(`baton.lease_seconds fora de [${LEASE_MIN}, ${LEASE_MAX}]`);
    }
    if (b.lease_until !== undefined) {
      if (typeof b.lease_until !== 'string' || !WALL_CLOCK_RE.test(b.lease_until) || !Number.isFinite(Date.parse(b.lease_until))) {
        errors.push('baton.lease_until fora do padrão ISO 8601 UTC com segundo');
      } else if (typeof b.stamped_at === 'string' && WALL_CLOCK_RE.test(b.stamped_at) && Number.isInteger(b.lease_seconds)) {
        const expected = Date.parse(b.stamped_at) + b.lease_seconds * 1000;
        if (Date.parse(b.lease_until) !== expected) {
          errors.push(`baton.lease_until não é stamped_at + lease_seconds (esperado ${new Date(expected).toISOString().replace(/\.\d{3}Z$/, 'Z')}, achado ${b.lease_until})`);
        }
      }
    }
  }

  // in_reply_to: obrigatório (não nulo) fora da oferta; null na oferta.
  if (isOffer) {
    if (msg.in_reply_to !== null && msg.in_reply_to !== undefined) errors.push('in_reply_to deve ser null em offer');
  } else if (msg.in_reply_to === null || msg.in_reply_to === undefined || msg.in_reply_to === '') {
    errors.push(`in_reply_to obrigatório fora de offer (op=${op})`);
  }

  return errors;
}

// readBatonConfig(forgeYamlPath) -> { defaultLeaseSeconds, maxLeaseSeconds, skewToleranceSeconds,
// autoRenew, errors } — lê o sub-bloco liaison.baton do forge.yaml (design §2.6), aplica
// defaults às chaves ausentes e aponta valores fora de faixa em `errors` (quem chama decide se
// isso bloqueia; offer/claim bloqueiam, os demais verbos nunca leem esta função). Puro quanto a
// efeitos — só leitura de arquivo, sem rede nem relógio alheio ao que o arquivo contém.
const DEFAULTS = { defaultLeaseSeconds: 1800, maxLeaseSeconds: 14400, skewToleranceSeconds: 120, autoRenew: true };

export function readBatonConfig(forgeYamlPath) {
  const result = { ...DEFAULTS, errors: [] };
  if (!forgeYamlPath || !existsSync(forgeYamlPath)) return result;
  let text;
  try {
    text = readFileSync(forgeYamlPath, 'utf8');
  } catch {
    return result;
  }
  // yaml-lite: busca o bloco `liaison:` > `baton:` por indentação, sem depender de um parser
  // YAML completo (o resto do harness já evita essa dependência — NFR-01).
  const lines = text.split('\n');
  let inLiaison = false;
  let inBaton = false;
  let liaisonIndent = -1;
  let batonIndent = -1;
  const raw = {};
  for (const line of lines) {
    const m = line.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];
    const val = m[3].replace(/\s*#.*$/, '').trim();
    if (!inLiaison && key === 'liaison') {
      inLiaison = true;
      liaisonIndent = indent;
      continue;
    }
    if (inLiaison && indent <= liaisonIndent && key !== 'liaison') {
      inLiaison = false;
      inBaton = false;
    }
    if (inLiaison && !inBaton && key === 'baton') {
      inBaton = true;
      batonIndent = indent;
      continue;
    }
    if (inBaton && indent <= batonIndent) {
      inBaton = false;
    }
    if (inBaton && val !== '') {
      raw[key] = val;
    }
  }
  if (raw.default_lease_seconds !== undefined) result.defaultLeaseSeconds = Number(raw.default_lease_seconds);
  if (raw.max_lease_seconds !== undefined) result.maxLeaseSeconds = Number(raw.max_lease_seconds);
  if (raw.skew_tolerance_seconds !== undefined) result.skewToleranceSeconds = Number(raw.skew_tolerance_seconds);
  if (raw.auto_renew !== undefined) result.autoRenew = raw.auto_renew !== 'false';

  if (!Number.isInteger(result.defaultLeaseSeconds) || result.defaultLeaseSeconds < LEASE_MIN) {
    result.errors.push(`liaison.baton.default_lease_seconds inválido: ${raw.default_lease_seconds}`);
  }
  if (!Number.isInteger(result.maxLeaseSeconds) || result.maxLeaseSeconds > 86400) {
    result.errors.push(`liaison.baton.max_lease_seconds inválido: ${raw.max_lease_seconds}`);
  }
  if (result.defaultLeaseSeconds > result.maxLeaseSeconds) {
    result.errors.push('liaison.baton.default_lease_seconds maior que max_lease_seconds');
  }
  if (!Number.isInteger(result.skewToleranceSeconds) || result.skewToleranceSeconds < 0 || result.skewToleranceSeconds > 3600) {
    result.errors.push(`liaison.baton.skew_tolerance_seconds inválido: ${raw.skew_tolerance_seconds}`);
  }
  return result;
}

// --- Dobra (REQ-04/REQ-05) ---------------------------------------------------------------------

function truncateReason(holder) {
  if (!holder) return '';
  return ` (titular: ${holder.sender}/${holder.session})`;
}

// foldBatons(channelMessages) -> { batons: Map<baton_id, BatonState>, orphans: Array }
//
// BatonState: { state, offer, holder: {sender, session} | null, holderClaimMsgId, leaseUntil,
//               leaseSeconds (lease_seconds do claim/renew que produziu o leaseUntil vigente —
//               TASK-21: 'renew' sem --lease repete este valor, design §2.6), lastOp,
//               history: [{ msgId, sender, session, op, stampedAt, verdict, reason }] }
//
// Pura: só dados gravados nas mensagens. Chamada do zero a cada vez — não há estado
// incremental, então uma `pending-offer` é reavaliada naturalmente quando a oferta chega
// (REQ-04, nota).
export function foldBatons(channelMessages) {
  const all = Array.isArray(channelMessages) ? channelMessages : [];

  // Posições forkadas no CANAL INTEIRO, antes de agrupar por thread — a mesma lógica de
  // detectForks, mas aplicada deliberadamente ANTES do agrupamento por thread para que duas
  // versões da mesma posição em THREADS DIFERENTES também sejam vistas.
  const forks = detectForks(all);
  const forkedKeys = new Set(forks.map((f) => `${f.sender}:${f.seq}`));

  // Índice de ofertas por msg_id, sobre o canal inteiro (para wrong-thread/pending-offer).
  const offersByMsgId = new Map();
  for (const m of all) {
    if (m && m.baton && m.baton.op === 'offer' && !forkedKeys.has(`${m.sender}:${m.seq}`)) {
      offersByMsgId.set(m.msg_id, m);
    }
  }

  const byThread = new Map();
  for (const m of all) {
    if (!m || !m.thread_id) continue;
    if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []);
    byThread.get(m.thread_id).push(m);
  }

  const batons = new Map();
  const orphans = [];

  for (const [threadId, threadMsgsRaw] of byThread) {
    const batonMsgs = threadMsgsRaw.filter((m) => m && m.baton);
    const ordered = threadOrder(batonMsgs);

    for (const m of ordered) {
      const key = `${m.sender}:${m.seq}`;
      const entry = {
        msgId: m.msg_id,
        sender: m.sender,
        session: m.baton && m.baton.session,
        op: m.baton && m.baton.op,
        stampedAt: m.baton && m.baton.stamped_at,
      };

      // 1. posição forkada — para TODAS as versões da posição, sem efeito.
      if (forkedKeys.has(key)) {
        recordOrphanOrHistory(batons, orphans, m, { ...entry, verdict: 'forked', reason: 'posição forkada (sender/seq com content_sha divergente)' });
        continue;
      }

      // 2. forma inválida (validateBaton), inclusive op desconhecido.
      const vErrs = validateBaton(m);
      if (vErrs.length) {
        recordOrphanOrHistory(batons, orphans, m, { ...entry, verdict: 'malformed', reason: vErrs.join('; ') });
        continue;
      }

      const op = m.baton.op;

      // 3. offer — cria o bastão.
      if (op === 'offer') {
        batons.set(m.msg_id, {
          state: 'available',
          offer: m,
          holder: null,
          holderClaimMsgId: null,
          leaseUntil: null,
          leaseSeconds: null,
          lastOp: 'offer',
          history: [{ ...entry, verdict: 'offered', reason: '' }],
        });
        continue;
      }

      const baseBatonId = m.in_reply_to;
      const offerMsg = offersByMsgId.get(baseBatonId);

      // 4. oferta referida ausente da réplica — pending-offer (nunca definitivo).
      if (!offerMsg) {
        // Mas se o msg_id REFERIDO existe na réplica e não é uma oferta aplicável (nota comum,
        // outra operação de bastão, oferta malformed/forked), o veredito é not-an-offer, nunca
        // pending-offer — a distinção que o REQ-04 exige.
        const referenced = all.find((x) => x && x.msg_id === baseBatonId);
        if (referenced) {
          recordOrphanOrHistory(batons, orphans, m, { ...entry, verdict: 'not-an-offer', reason: `in_reply_to '${reasonId(baseBatonId)}' não é oferta aplicável` });
        } else {
          orphans.push({ ...entry, verdict: 'pending-offer', reason: `oferta '${reasonId(baseBatonId)}' ainda não vista na réplica` });
        }
        continue;
      }

      // 5. oferta existe mas em OUTRA thread.
      if (offerMsg.thread_id !== threadId) {
        recordOrphanOrHistory(batons, orphans, m, { ...entry, verdict: 'wrong-thread', reason: `oferta '${reasonId(baseBatonId)}' pertence à thread '${reasonId(offerMsg.thread_id)}'` });
        continue;
      }

      const baton = batons.get(baseBatonId);

      // 6. a oferta está na mesma thread mas ainda não foi aplicada na passada (vem depois na
      // ordem) — só alcançável com carimbo de ordem forjado.
      if (!baton) {
        recordOrphanOrHistory(batons, orphans, m, { ...entry, verdict: 'before-offer', reason: `oferta '${reasonId(baseBatonId)}' ainda não aplicada na ordem da thread` });
        continue;
      }

      // 7. terminal.
      if (baton.state === 'completed' || baton.state === 'withdrawn') {
        baton.history.push({ ...entry, verdict: 'closed', reason: `bastão já ${baton.state}` });
        continue;
      }

      // 8. lease acima do máximo da oferta (claim/renew).
      if ((op === 'claim' || op === 'renew') && m.baton.lease_seconds > offerMsg.baton.max_lease_seconds) {
        baton.history.push({ ...entry, verdict: 'lease-over-max', reason: `lease_seconds ${m.baton.lease_seconds} > max_lease_seconds ${offerMsg.baton.max_lease_seconds} da oferta` });
        continue;
      }

      const eligible = offerMsg.baton.eligible || [];
      const skew = offerMsg.baton.skew_tolerance_seconds || 0;
      const stampedMs = Date.parse(m.baton.stamped_at);

      if (op === 'claim') {
        if (!eligible.includes(m.sender)) {
          baton.history.push({ ...entry, verdict: 'not-eligible', reason: `'${m.sender}' fora de eligible [${eligible.join(', ')}]` });
          continue;
        }
        if (baton.state === 'available') {
          applyWon(baton, entry, m);
          continue;
        }
        // held — compara contra a titular corrente.
        const holder = baton.holder;
        const sameHolder = holder && holder.sender === m.sender && holder.session === m.baton.session;
        const T = Date.parse(baton.leaseUntil);
        if (sameHolder) {
          if (stampedMs <= T) {
            baton.history.push({ ...entry, verdict: 'duplicate-claim', reason: 'titular corrente já detém com lease vigente' });
          } else {
            applyWon(baton, entry, m); // retomada após vencimento própria
          }
          continue;
        }
        if (stampedMs >= T + skew * 1000) {
          applyWon(baton, entry, m, { expiredHolder: holder });
        } else {
          baton.history.push({ ...entry, verdict: 'lost-held', reason: `titular corrente${truncateReason(holder)} ainda dentro do lease ou da folga` });
        }
        continue;
      }

      if (op === 'renew') {
        const holder = baton.holder;
        const isHolder = baton.state === 'held' && holder && holder.sender === m.sender && holder.session === m.baton.session;
        if (!isHolder) {
          baton.history.push({ ...entry, verdict: 'not-holder', reason: `titular corrente${truncateReason(holder)}` });
          continue;
        }
        const T = Date.parse(baton.leaseUntil);
        if (stampedMs > T) {
          baton.history.push({ ...entry, verdict: 'late-renew', reason: `lease venceu em ${baton.leaseUntil}` });
          continue;
        }
        baton.leaseUntil = m.baton.lease_until;
        baton.leaseSeconds = m.baton.lease_seconds;
        baton.holderClaimMsgId = baton.holderClaimMsgId; // mantém C (a claim original) — renovação não muda C
        baton.lastOp = 'renew';
        baton.history.push({ ...entry, verdict: 'renewed', reason: '' });
        continue;
      }

      if (op === 'release' || op === 'complete') {
        const holder = baton.holder;
        const isHolder = baton.state === 'held' && holder && holder.sender === m.sender && holder.session === m.baton.session;
        if (!isHolder) {
          baton.history.push({ ...entry, verdict: 'not-holder', reason: `titular corrente${truncateReason(holder)}` });
          continue;
        }
        if (op === 'release') {
          baton.state = 'available';
          baton.holder = null;
          baton.holderClaimMsgId = null;
          baton.leaseUntil = null;
          baton.lastOp = 'release';
          baton.history.push({ ...entry, verdict: 'released', reason: '' });
        } else {
          baton.state = 'completed';
          baton.lastOp = 'complete';
          baton.history.push({ ...entry, verdict: 'completed', reason: '' });
        }
        continue;
      }

      if (op === 'withdraw') {
        if (m.sender !== offerMsg.sender) {
          baton.history.push({ ...entry, verdict: 'not-offerer', reason: `ofertante é '${offerMsg.sender}'` });
          continue;
        }
        const T = baton.leaseUntil ? Date.parse(baton.leaseUntil) : null;
        const expiredEnough = baton.state === 'available' || (baton.state === 'held' && T !== null && stampedMs >= T + skew * 1000);
        if (expiredEnough) {
          baton.state = 'withdrawn';
          baton.lastOp = 'withdraw';
          baton.history.push({ ...entry, verdict: 'withdrawn', reason: '' });
        } else {
          baton.history.push({ ...entry, verdict: 'withdraw-while-held', reason: `titular corrente${truncateReason(baton.holder)} ainda dentro do lease ou da folga` });
        }
        continue;
      }
    }
  }

  return { batons, orphans };
}

function applyWon(baton, entry, msg, { expiredHolder } = {}) {
  if (expiredHolder) {
    baton.history.push({
      sender: expiredHolder.sender, session: expiredHolder.session, msgId: baton.holderClaimMsgId,
      op: 'claim', stampedAt: null, verdict: 'expired', reason: 'lease vencido além da folga',
    });
  }
  baton.state = 'held';
  baton.holder = { sender: msg.sender, session: msg.baton.session };
  baton.holderClaimMsgId = msg.msg_id;
  baton.leaseUntil = msg.baton.lease_until;
  baton.leaseSeconds = msg.baton.lease_seconds;
  baton.lastOp = 'claim';
  baton.history.push({ ...entry, verdict: 'won', reason: '' });
}

function recordOrphanOrHistory(batons, orphans, msg, entry) {
  const baton = batons.get(msg.in_reply_to);
  if (baton) baton.history.push(entry);
  else orphans.push(entry);
}

// stability(baton, channelMessages) -> { stable: boolean, missing: string[], gap: object|null }
//
// Só se aplica a bastão `held` (REQ-05). required = (eligible ∪ {ofertante}) \ {C.sender}, onde
// C é a reivindicação que deu a posse à titular corrente (guardada em baton.holderClaimMsgId —
// renovações não mudam C). Estável se, para cada repositório exigido, a réplica tem o log dele
// com seq contíguo de 1 até alguma mensagem na thread com lamport >= C.lamport.
export function stability(baton, channelMessages) {
  if (!baton || baton.state !== 'held') return { stable: true, missing: [], gap: null };
  const offer = baton.offer;
  const eligible = (offer && offer.baton && offer.baton.eligible) || [];
  const offerer = offer ? offer.sender : null;
  const holderSender = baton.holder ? baton.holder.sender : null;
  const required = [...new Set([...eligible, offerer].filter(Boolean))].filter((s) => s !== holderSender);

  const cMsg = (channelMessages || []).find((m) => m && m.msg_id === baton.holderClaimMsgId);
  const cLamport = cMsg ? Number(cMsg.lamport) || 0 : 0;
  const threadId = offer ? offer.thread_id : null;

  const missing = [];
  let gap = null;
  for (const repo of required) {
    const repoMsgs = (channelMessages || []).filter((m) => m && m.sender === repo);
    const gaps = detectGaps(repoMsgs);
    const repoGap = gaps.find((g) => g.sender === repo);
    const hasLaterInThread = repoMsgs.some((m) => m.thread_id === threadId && (Number(m.lamport) || 0) >= cLamport);
    if (!hasLaterInThread) {
      missing.push(repo);
      continue;
    }
    if (repoGap) {
      missing.push(repo);
      gap = gap || { sender: repo, missing: repoGap.missing };
    }
  }
  return { stable: missing.length === 0, missing, gap };
}
