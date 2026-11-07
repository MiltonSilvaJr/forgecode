// liaison-merge — funções PURAS do subsistema liaison (canal de mensagens ordenadas entre
// agentes de repositórios distintos). Nenhuma função aqui toca disco, relógio de parede ou
// aleatoriedade — todo I/O (ler *.jsonl, escrever state.json/conflicts/) vive em liaison-ops.sh.
//
// Modelo:
//   - Store: um JSONL append-only POR REMETENTE (log/<sender>.jsonl). Single-writer por arquivo
//     é o invariante que torna o merge livre de conflito.
//   - Thread é campo da mensagem, não arquivo — várias threads convivem no mesmo conjunto de logs.
//   - Lamport é POR THREAD (não por canal): um remetente com participação parcial só conhece as
//     mensagens das threads em que está — um relógio por canal exigiria ver threads alheias.
//   - Ordem dentro da thread: (lamport, sender, seq). Entre threads não há ordem definida.
//   - seq é monotônico e sem buracos por remetente — é o detector de mensagem perdida.
//   - Abertura de thread (kind: thread-open) e entrada de participante (kind: join) são
//     mensagens, não configuração — a composição da thread converge pelo mesmo mecanismo do
//     resto e é auditável. Visibilidade: a lista de participantes da thread ROTEIA e organiza
//     (quem é cobrado por ack, para quem o roteamento se dirige) — NÃO confina leitura. Com hub
//     compartilhado, quem alcança o transporte lê tudo; confidencialidade real exige canal
//     separado, não a lista de participantes da thread.
import { createHash } from 'node:crypto';

// --- Envelope / integridade -------------------------------------------------

// Serialização canônica (chaves ordenadas recursivamente) — usada para content_sha e para
// qualquer comparação byte-a-byte. Arrays preservam ordem (são dado, não chave).
export function canonicalStringify(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = sortKeysDeep(v[k]); return acc; }, {});
  }
  return v;
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// content_sha cobre o envelope MENOS content_sha (auto-referente) e MENOS trust — trust é
// carimbado no IMPORT (nunca pelo remetente), então não pode fazer parte da integridade
// calculada na origem, ou toda cópia importada divergiria da cópia local por definição.
export function computeContentSha(msg) {
  const { content_sha, trust, ...rest } = msg;
  return sha256Hex(canonicalStringify(rest));
}

// --- Contadores monotônicos --------------------------------------------------

// Próximo seq (POR REMETENTE): maior seq conhecido + 1, começando em 1. `messages` deve conter
// só mensagens do mesmo remetente (o caller filtra).
export function nextSeq(messagesForSender) {
  const max = messagesForSender.reduce((m, e) => Math.max(m, Number(e.seq) || 0), 0);
  return max + 1;
}

// Próximo lamport (POR THREAD): maior lamport conhecido entre TODOS os remetentes da thread + 1,
// começando em 1 (abertura da thread). `messages` deve conter só mensagens da mesma thread.
export function nextLamport(messagesForThread) {
  const max = messagesForThread.reduce((m, e) => Math.max(m, Number(e.lamport) || 0), 0);
  return max + 1;
}

// --- Ordenação ---------------------------------------------------------------

// Desempate de `sender` por CODE POINT (design §2.6.1, REQ-04), nunca por `localeCompare`: este
// último segue colação ICU e o locale do processo, então ids que diferem só por pontuação
// (`[a-z0-9._-]`) podem ordenar diferente em réplicas com locales diferentes. Como os ids são
// ASCII nessa faixa, code point e bytes UTF-8 coincidem, e a ordem fica determinística entre
// réplicas independente de LANG/LC_ALL. Exportado para ser o único lugar que decide essa ordem.
export function compareSender(a, b) {
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// Ordem total dentro de uma thread: (lamport, sender, seq). Como (sender, seq) é único por
// mensagem, o tie-break é total — a ordem resultante independe da ordem de entrada do array
// (propriedade central: embaralhar a entrada não muda a saída).
export function threadOrder(messages) {
  return messages.slice().sort((a, b) => {
    const l = (Number(a.lamport) || 0) - (Number(b.lamport) || 0);
    if (l !== 0) return l;
    const s = compareSender(a.sender, b.sender);
    if (s !== 0) return s;
    return (Number(a.seq) || 0) - (Number(b.seq) || 0);
  });
}

// --- Diagnósticos (não bloqueantes) -----------------------------------------

// Buracos de seq por remetente: para cada remetente com pelo menos uma mensagem, espera-se
// 1..max contíguo. Relata só remetentes com buraco real (não relata "ainda não enviou o N+1").
export function detectGaps(messages) {
  const bySender = new Map();
  for (const m of messages) {
    if (!bySender.has(m.sender)) bySender.set(m.sender, []);
    bySender.get(m.sender).push(Number(m.seq) || 0);
  }
  const gaps = [];
  for (const [sender, seqs] of bySender) {
    const seen = new Set(seqs);
    const max = Math.max(0, ...seqs);
    const missing = [];
    for (let i = 1; i < max; i++) if (!seen.has(i)) missing.push(i);
    if (missing.length) gaps.push({ sender, missing });
  }
  return gaps.sort((a, b) => a.sender.localeCompare(b.sender));
}

// Forks: mesma (sender, seq) com content_sha divergente — duas versões da "mesma" posição no
// log de um remetente. Nunca deveria acontecer com single-writer honesto; sinaliza corrupção ou
// spoofing que escapou da validação de import.
export function detectForks(messages) {
  const byKey = new Map();
  for (const m of messages) {
    const key = `${m.sender}:${m.seq}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(m);
  }
  const forks = [];
  for (const [key, group] of byKey) {
    const shas = new Set(group.map((m) => m.content_sha));
    if (shas.size > 1) {
      const [sender, seq] = key.split(':');
      forks.push({
        sender,
        seq: Number(seq),
        msg_ids: group.map((m) => m.msg_id).sort(),
        content_shas: [...shas].sort(),
      });
    }
  }
  return forks.sort((a, b) => a.sender.localeCompare(b.sender) || a.seq - b.seq);
}

// Causalidade de relógio de PAREDE (diagnóstico NÃO bloqueante, issue #36). A ordem da thread é
// (lamport, sender, seq) e nunca timestamp — por isso um `created_at` errado não corrompe nada e
// não pode reter mensagem. Mas ele é sintoma barato de detectar de um defeito caro: no caso
// reportado, o log de um remetente estava sendo escrito por DUAS cópias em paralelo, cada uma com
// o relógio da própria máquina, e o primeiro sinal disponível era um `ack` datado quase um dia
// ANTES da mensagem que ele respondia. O Lamport da thread estava coerente, o de parede não, e
// nada sinalizava.
//
// Só compara contra a mensagem REFERENCIADA em `in_reply_to`, e só quando ela já é conhecida
// localmente: sem a referência não há relação causal a violar, e acusar por ausência transformaria
// sincronização parcial (que é o estado normal do canal) em ruído permanente. Datas ilegíveis são
// ignoradas em silêncio aqui — forma de envelope é assunto de validateEnvelope, não deste
// diagnóstico.
//
// Date.parse e não comparação de string: os dois carimbos podem vir com offsets diferentes
// (-03:00 e Z são o formato real produzido por `git log %cI` em máquinas distintas), e "2026-07-30T
// 23:00:00Z" é POSTERIOR a "2026-07-30T21:00:00-03:00" apesar de ordenar antes lexicograficamente.
// add-liaison-handoff-baton, REQ-06/design §2.6 — mensagens de bastão respondem SEMPRE à
// oferta (`in_reply_to`), e um repositório com HEAD mais antigo que o do ofertante geraria este
// aviso de forma sistemática e sem valor, porque a causalidade do bastão já é dada pelo
// `lamport` (REQ-04) — `stamped_at`, não `created_at`, decide o que importa para o bastão
// (vencimento de lease), e tem o próprio aviso dedicado ("carimbo de bastão no futuro",
// liaison-ops.sh status/baton status). Ignora SÓ mensagens com `baton`; para as demais, nada
// muda.
export function detectClockSkew(messages) {
  const byId = new Map();
  for (const m of messages) if (m && m.msg_id !== undefined && m.msg_id !== null && !byId.has(m.msg_id)) byId.set(m.msg_id, m);
  const out = [];
  for (const m of byId.values()) {
    if (m.baton) continue;
    if (!m.in_reply_to) continue;
    const ref = byId.get(m.in_reply_to);
    if (!ref) continue;
    const t = Date.parse(m.created_at || '');
    const tRef = Date.parse(ref.created_at || '');
    if (!Number.isFinite(t) || !Number.isFinite(tRef)) continue;
    if (t >= tRef) continue;
    out.push({
      sender: m.sender,
      msg_id: m.msg_id,
      seq: Number(m.seq) || 0,
      thread_id: m.thread_id,
      kind: m.kind,
      created_at: m.created_at,
      in_reply_to: ref.msg_id,
      ref_sender: ref.sender,
      ref_created_at: ref.created_at,
      behind_ms: tRef - t,
    });
  }
  return out.sort((a, b) => String(a.msg_id).localeCompare(String(b.msg_id)));
}

// Formata a defasagem para leitura humana (dias/horas/minutos). Um número em milissegundos não diz
// se o relógio está minutos ou um dia fora, que é justamente a diferença entre ruído e defeito.
export function formatSkew(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const min = Math.floor((total % 3600) / 60);
  const bits = [];
  if (d) bits.push(`${d}d`);
  if (h) bits.push(`${h}h`);
  if (min || !bits.length) bits.push(`${min}min`);
  return bits.join(' ');
}

// --- Merge central ------------------------------------------------------------

// Recebe o conjunto (união) de mensagens de TODOS os arquivos log/<sender>.jsonl atualmente
// conhecidos localmente — em QUALQUER ordem — e produz uma view determinística:
//   threads[thread_id] = { subject, opened_by, participants[], order: [msg_id...], messages[] }
//   quarantined: mensagens cuja thread não tem thread-open correspondente (ainda) — retidas até
//     a abertura chegar; sincronização parcial não pode inventar thread.
//   gaps / forks / clockSkews: diagnósticos não bloqueantes (ver acima).
// Pura: nenhuma leitura de disco, nenhum relógio de parede. Determinística sob permutação da
// entrada — é a propriedade que garante que N réplicas convirjam para o mesmo CHANNEL.md.
export function mergeLogs(messages) {
  // União de verdade: msg_id repetido colapsa para uma ocorrência. O nome já dizia "conjunto",
  // mas nada garantia — e a diferença só aparece quando a mesma mensagem chega por dois caminhos
  // (um import que gravou duas vezes, dois arquivos com a mesma linha, um merge feito à mão).
  // Sem a deduplicação, a mensagem aparecia DUAS vezes na ordem da thread, e como a ordem é o que
  // todas as réplicas comparam para dizer que convergiram, duas réplicas com o mesmo conteúdo
  // pareceriam divergentes. Encontrado por property-based testing (idempotência de mergeLogs),
  // não por caso de exemplo: é precisamente o tipo de entrada que ninguém escreve à mão.
  const seen = new Set();
  const unique = [];
  for (const m of messages) {
    const id = m && m.msg_id;
    if (id !== undefined && id !== null) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    unique.push(m);
  }

  const byThread = new Map();
  for (const m of unique) {
    if (!byThread.has(m.thread_id)) byThread.set(m.thread_id, []);
    byThread.get(m.thread_id).push(m);
  }

  const threads = {};
  const quarantined = [];

  for (const [threadId, msgs] of byThread) {
    const opens = msgs.filter((m) => m.kind === 'thread-open').sort((a, b) => {
      const l = (Number(a.lamport) || 0) - (Number(b.lamport) || 0);
      if (l !== 0) return l;
      const s = compareSender(a.sender, b.sender);
      if (s !== 0) return s;
      return (Number(a.seq) || 0) - (Number(b.seq) || 0);
    });
    if (!opens.length) {
      for (const m of msgs) quarantined.push({ ...m, quarantine_reason: 'thread-open ausente' });
      continue;
    }
    const opener = opens[0];
    const order = threadOrder(msgs);
    const participants = new Set(Array.isArray(opener.participants) ? opener.participants : []);
    participants.add(opener.sender);
    for (const m of order) if (m.kind === 'join') participants.add(m.sender);
    threads[threadId] = {
      subject: opener.subject || '',
      opened_by: opener.sender,
      opened_at: opener.created_at || null,
      participants: [...participants].sort(),
      order: order.map((m) => m.msg_id),
      messages: order,
    };
  }

  return {
    threads,
    quarantined: quarantined.sort((a, b) => a.thread_id.localeCompare(b.thread_id) || a.sender.localeCompare(b.sender) || (Number(a.seq) || 0) - (Number(b.seq) || 0)),
    gaps: detectGaps(messages),
    forks: detectForks(messages),
    clockSkews: detectClockSkew(unique),
  };
}

// --- Validação de envelope (reimplementação à mão do schema — sem ajv em runtime) -------------

export const KINDS = ['note', 'question', 'answer', 'contract-change', 'ack', 'thread-open', 'join'];
export const ACK_FORBIDDEN_KINDS = new Set(['ack', 'answer']);
export const BODY_MAX_BYTES = 2048;
export const BLOB_MAX_BYTES = 65536;
export const IMPORT_MAX_MESSAGES = 200;
export const BODY_REF_RE = /^blobs\/[A-Za-z0-9._-]+$/;
export const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
// REQ-02/design §4.1 — mesmas regras do schema liaison-message.schema.json para `via` e
// `cross_session`, reimplementadas aqui à mão (sem ajv em runtime), igual ao resto deste arquivo.
export const VIA_VALUES = ['ask-peer', 'divergence-resolve', 'cross-session'];
export const CROSS_SESSION_FIELDS = ['from_addr', 'from_name', 'from_mode', 'native_ref', 'origin_verified'];
export const CROSS_SESSION_TEXT_FIELDS = ['from_addr', 'from_name', 'from_mode'];
export const CROSS_SESSION_TEXT_MAX = 128;
export const CROSS_SESSION_CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
export const NATIVE_REF_RE = /^[0-9a-f]{64}$/;
// add-liaison-handoff-baton, design §2.2/§4.1 — padrão de `op` da camada de ENVELOPE (aberto,
// sem enum fechado): uma operação de versão futura do harness entra na réplica sem virar
// conflito nem buraco de `seq`. O conjunto fechado das seis operações é responsabilidade de
// `validateBaton` (lib/liaison-baton.mjs), que reexporta este padrão em vez de duplicá-lo.
export const BATON_OP_PATTERN = /^[a-z][a-z-]{0,31}$/;

// Valida a forma do envelope (campos obrigatórios, enums, tetos). Não decide política de
// import (spoofing, duplicata, quarentena) — isso mora em liaison-ops.sh, que tem o contexto de
// "em qual arquivo esta mensagem chegou". Retorna array de strings de erro (vazio = válido).
export function validateEnvelope(msg) {
  const errors = [];
  if (!msg || typeof msg !== 'object') return ['mensagem não é um objeto'];
  const req = ['msg_id', 'channel', 'thread_id', 'sender', 'seq', 'lamport', 'kind', 'subject', 'created_at', 'content_sha', 'trust'];
  for (const f of req) if (msg[f] === undefined || msg[f] === null || msg[f] === '') errors.push(`campo obrigatório ausente: ${f}`);
  if (msg.kind && !KINDS.includes(msg.kind)) errors.push(`kind inválido: ${msg.kind}`);
  if (msg.requires_ack === undefined) errors.push('campo obrigatório ausente: requires_ack');
  if (msg.requires_ack === true && ACK_FORBIDDEN_KINDS.has(msg.kind)) errors.push(`requires_ack proibido em kind=${msg.kind}`);
  if (msg.kind === 'thread-open' && (!Array.isArray(msg.participants) || msg.participants.length < 1)) {
    errors.push('thread-open requer participants não vazio');
  }
  const hasBody = typeof msg.body === 'string' && msg.body.length > 0;
  const hasBodyRef = typeof msg.body_ref === 'string' && msg.body_ref.length > 0;
  // body e body_ref são ambos opcionais (thread-open/join costumam não ter corpo substantivo,
  // o subject já basta) — mas mutuamente exclusivos quando presentes.
  if (hasBody && hasBodyRef) errors.push('mensagem com body E body_ref (no máximo um é permitido)');
  if (hasBody && Buffer.byteLength(msg.body, 'utf8') > BODY_MAX_BYTES) errors.push(`body excede ${BODY_MAX_BYTES} bytes`);
  if (hasBodyRef && !BODY_REF_RE.test(msg.body_ref)) errors.push(`body_ref fora do padrão permitido: ${msg.body_ref}`);
  if (msg.trust && !['self', 'untrusted-peer'].includes(msg.trust)) errors.push(`trust inválido: ${msg.trust}`);

  // REQ-02/design §4.1 — `via` e `cross_session` com as MESMAS regras do schema (mão dupla: um
  // exige o outro). `cross_session` presente é testado por chave, não por truthiness — um objeto
  // vazio ainda conta como presente para esta condição; a validade interna dele é checada abaixo.
  if (msg.via !== undefined && !VIA_VALUES.includes(msg.via)) errors.push(`via inválido: ${msg.via}`);
  const isCrossSessionVia = msg.via === 'cross-session';
  const hasCrossSession = Object.prototype.hasOwnProperty.call(msg, 'cross_session') && msg.cross_session !== null;
  if (isCrossSessionVia) {
    if (!msg.authored_by) errors.push('via=cross-session exige authored_by');
    if (!hasCrossSession) errors.push('via=cross-session exige cross_session');
  }
  if (hasCrossSession && !isCrossSessionVia) errors.push("cross_session exige via: 'cross-session'");
  if (hasCrossSession) {
    const cs = msg.cross_session;
    if (typeof cs !== 'object' || Array.isArray(cs)) {
      errors.push('cross_session não é um objeto');
    } else {
      for (const f of CROSS_SESSION_FIELDS) if (cs[f] === undefined) errors.push(`cross_session.${f} obrigatório ausente`);
      for (const k of Object.keys(cs)) if (!CROSS_SESSION_FIELDS.includes(k)) errors.push(`cross_session com campo não declarado: ${k}`);
      for (const f of CROSS_SESSION_TEXT_FIELDS) {
        if (typeof cs[f] !== 'string') continue;
        if (cs[f].length > CROSS_SESSION_TEXT_MAX) errors.push(`cross_session.${f} excede ${CROSS_SESSION_TEXT_MAX} caracteres`);
        if (CROSS_SESSION_CONTROL_CHAR_RE.test(cs[f])) errors.push(`cross_session.${f} contém caractere de controle`);
      }
      if (cs.native_ref !== undefined && typeof cs.native_ref === 'string' && !NATIVE_REF_RE.test(cs.native_ref)) {
        errors.push(`cross_session.native_ref fora do padrão sha256 hex: ${cs.native_ref}`);
      }
      if (cs.origin_verified !== undefined && typeof cs.origin_verified !== 'boolean') {
        errors.push('cross_session.origin_verified deve ser boolean');
      }
    }
  }

  // add-liaison-handoff-baton, REQ-01/design §2.2 — camada de ENVELOPE, a única que este
  // validador impõe sobre `baton`: objeto, só em kind=note com requires_ack=false, `op` no
  // padrão aberto. A validação COMPLETA (campos por `op`, limites, aritmética do lease) é a de
  // `validateBaton`, chamada pelo CLI antes de gravar e pela dobra — nunca aqui, para que uma
  // mensagem de bastão malformada entre na réplica (sem buraco de `seq`) e receba `malformed`
  // na dobra, em vez de virar conflito no import.
  if (Object.prototype.hasOwnProperty.call(msg, 'baton') && msg.baton !== null) {
    const b = msg.baton;
    if (typeof b !== 'object' || Array.isArray(b)) {
      errors.push('baton não é um objeto');
    } else {
      if (msg.kind !== 'note') errors.push('baton só é permitido em kind=note');
      if (msg.requires_ack === true) errors.push('baton exige requires_ack=false');
      if (typeof b.op !== 'string' || !BATON_OP_PATTERN.test(b.op)) errors.push(`baton.op fora do padrão: ${b.op}`);
    }
  }
  return errors;
}
