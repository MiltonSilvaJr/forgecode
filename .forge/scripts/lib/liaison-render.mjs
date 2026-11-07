// liaison-render — gera .forge/liaison/<channel>/CHANNEL.md deterministicamente a partir dos
// logs (log/<sender>.jsonl) do canal, via merge puro (liaison-merge.mjs). Mesmo padrão do
// ledger-render.mjs: só o bloco <!-- FORGE:NARRATIVE:START/END --> sobrevive entre gerações.
//
// Ordenação: threads pela ordem de abertura (opened_at do thread-open, com desempate por
// thread_id) SÓ para o índice — dentro de cada thread a ordem é sempre (lamport, sender, seq),
// nunca timestamp. Determinístico: a mesma união de mensagens sempre produz o mesmo CHANNEL.md
// byte-a-byte, não importa a ordem em que os arquivos log/*.jsonl foram lidos ou importados.
//
// Driven by env (set by liaison-ops.sh): LIAISON_ROOT, LIAISON_CHANNEL, LIAISON_CHANNEL_DIR,
// LIAISON_TPL, LIAISON_OUT, LIAISON_SELF.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { renderUntrusted } from './untrusted-render.mjs';
import { join } from 'node:path';
import { mergeLogs, formatSkew } from './liaison-merge.mjs';
import { readQuarantinedPositions } from './liaison-import.mjs';
import { foldBatons, isWallClock } from './liaison-baton.mjs';

const env = process.env;
const channel = env.LIAISON_CHANNEL;
const channelDir = env.LIAISON_CHANNEL_DIR;
const tplPath = env.LIAISON_TPL;
const out = env.LIAISON_OUT;
const self = env.LIAISON_SELF || '(desconhecido)';

function readJsonl(p) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* linha corrompida: ignorada pelo render, sinalizada pelo doctor */ }
  }
  return out;
}

function readAllMessages(dir) {
  const logDir = join(dir, 'log');
  if (!existsSync(logDir)) return [];
  const files = readdirSync(logDir).filter((f) => f.endsWith('.jsonl')).sort();
  const all = [];
  for (const f of files) all.push(...readJsonl(join(logDir, f)));
  return all;
}

const messages = readAllMessages(channelDir);
const { threads, quarantined, gaps, forks, clockSkews } = mergeLogs(messages);
// Posições retidas por reescrita de história (issue #48). Vêm de conflicts/, não do merge: são
// mensagens que NUNCA entraram no log local, então nenhuma leitura dos *.jsonl as revelaria.
const divergentPositions = readQuarantinedPositions(channelDir);

// Bastão (add-liaison-handoff-baton, REQ-01/REQ-04): a dobra é PURA (só o que está gravado nas
// mensagens, nunca o relógio de quem gera), então o resultado é o mesmo em qualquer réplica sob
// qualquer relógio — é essa propriedade que faz o CHANNEL.md ficar byte a byte idêntico sob TZ e
// relógios diferentes (REQ-08). `verdictByMsgId` indexa o veredito de CADA mensagem de bastão
// (inclusive órfãs) por `msg_id`, para `renderMessage` não precisar conhecer a dobra inteira.
const { batons: batonFold, orphans: batonOrphans } = foldBatons(messages);
const verdictByMsgId = new Map();
for (const [, b] of batonFold) for (const h of b.history) verdictByMsgId.set(h.msgId, h.verdict);
for (const h of batonOrphans) verdictByMsgId.set(h.msgId, h.verdict);

const threadIds = Object.keys(threads).sort((a, b) => {
  const ta = threads[a].opened_at || '';
  const tb = threads[b].opened_at || '';
  if (ta !== tb) return ta.localeCompare(tb);
  return a.localeCompare(b);
});

function fmtTag(m) {
  const bits = [m.kind];
  if (m.requires_ack) bits.push('ack?');
  return bits.join(' · ');
}

function renderMessage(m) {
  // Mensagem de bastão (design S2.7): `[baton <op>] sessão <session> · <stamped_at> → <veredito>`
  // em vez do cabeçalho genérico — `session` e o veredito vêm da dobra, nunca do relógio de quem
  // gera (stamped_at é dado da mensagem, REQ-06). `session` de peer passa por renderUntrusted como
  // o subject de qualquer mensagem (REQ-08): é texto autodeclarado, não validado por nós.
  if (m.baton) {
    const verdict = verdictByMsgId.get(m.msg_id) || '?';
    const sessionText = m.sender !== self ? renderUntrusted(String(m.baton.session), m.sender) : m.baton.session;
    // NODE-003: stamped_at é dado do peer e sai fora da moldura nesta linha — só é interpolado
    // quando tem a forma de relógio de parede; senão sai '?' (a mensagem é `malformed` na dobra).
    const stampText = isWallClock(m.baton.stamped_at) ? m.baton.stamped_at : '?';
    const lines = [`- **${m.msg_id}** [baton ${m.baton.op}] \`${m.sender}\` sessão ${sessionText} · ${stampText} → ${verdict}`];
    if (m.in_reply_to) lines.push(`  ↳ em resposta a \`${m.in_reply_to}\``);
    if (m.body) lines.push(...renderUntrusted(m.body, m.sender).split('\n').map((l) => `  ${l}`));
    else if (m.body_ref) lines.push(`  corpo em \`${m.body_ref}\``);
    return lines.join('\n');
  }
  const lines = [`- **${m.msg_id}** [${fmtTag(m)}] \`${m.sender}\` (lamport ${m.lamport}) — ${m.subject || '(sem assunto)'}`];
  if (m.in_reply_to) lines.push(`  ↳ em resposta a \`${m.in_reply_to}\``);
  // Corpo de mensagem é texto arbitrário escrito por OUTRO repositório. Vai sempre embrulhado
  // (banner + fence + neutralização), inclusive o que nós mesmos escrevemos: um render que trata
  // conteúdo próprio e alheio de formas diferentes convida ao erro no dia em que a origem do
  // registro deixar de ser óbvia — e o custo de embrulhar o próprio é uma linha a mais.
  //
  // REQ-02/design §2.4: via=cross-session mostra `via: cross-session` e o nome declarado
  // rotulado como autodeclarado, DENTRO da mesma moldura (neutralizado pela mesma função).
  const cs = m.via === 'cross-session' && m.cross_session ? m.cross_session : null;
  const extra = cs ? [`via: cross-session`, `nome declarado (autodeclarado): ${cs.from_name}`] : [];
  if (m.body) {
    const composite = extra.length ? `${extra.join('\n')}\n\n${m.body}` : m.body;
    lines.push(...renderUntrusted(composite, m.sender).split('\n').map((l) => `  ${l}`));
  } else if (m.body_ref) {
    if (extra.length) lines.push(...renderUntrusted(extra.join('\n'), m.sender).split('\n').map((l) => `  ${l}`));
    lines.push(`  corpo em \`${m.body_ref}\``);
  } else if (extra.length) {
    lines.push(...renderUntrusted(extra.join('\n'), m.sender).split('\n').map((l) => `  ${l}`));
  }
  const refs = m.refs || {};
  const refBits = [];
  if (refs.change_id) refBits.push(`change \`${refs.change_id}\``);
  if (Array.isArray(refs.contract_files) && refs.contract_files.length) refBits.push(`contratos: ${refs.contract_files.join(', ')}`);
  if (refs.commit) refBits.push(`commit \`${refs.commit}\``);
  if (refBits.length) lines.push(`  ${refBits.join(' · ')}`);
  return lines.join('\n');
}

function renderThreadIndex() {
  if (!threadIds.length) return '_(nenhuma thread aberta)_';
  return threadIds.map((id) => {
    const t = threads[id];
    return `- **${id}** — ${t.subject || '(sem assunto)'} · participantes: ${t.participants.join(', ')} · ${t.order.length} mensagem(ns)`;
  }).join('\n');
}

function renderThreadViews() {
  if (!threadIds.length) return '_(nenhuma thread aberta)_';
  return threadIds.map((id) => {
    const t = threads[id];
    const body = t.messages.map(renderMessage).join('\n');
    return `### ${id} — ${t.subject || '(sem assunto)'}\n\nParticipantes: ${t.participants.join(', ')} · aberta por \`${t.opened_by}\`\n\n${body}`;
  }).join('\n\n');
}

function renderBatons() {
  const ids = [...batonFold.keys()].sort();
  if (!ids.length) return '_(nenhum bastão)_';
  return ids.map((id) => {
    const b = batonFold.get(id);
    const holderTxt = b.holder ? `\`${b.holder.sender}\`/${b.holder.session}` : '(nenhuma)';
    const subjectText = b.offer.sender !== self ? renderUntrusted(b.offer.subject || '', b.offer.sender) : (b.offer.subject || '(sem assunto)');
    const leaseBit = b.leaseUntil ? ` · lease_until \`${b.leaseUntil}\`` : '';
    return `- **${id}** — ${b.state} · ofertante \`${b.offer.sender}\` · titular: ${holderTxt}${leaseBit} · assunto: ${subjectText}`;
  }).join('\n');
}

function renderQuarantine() {
  if (!quarantined.length) return '_(nenhuma)_';
  return quarantined.map((m) => `- \`${m.msg_id}\` (thread \`${m.thread_id}\`, remetente \`${m.sender}\`) — ${m.quarantine_reason}`).join('\n');
}

function renderDivergences() {
  if (!divergentPositions.length) return '_(nenhuma)_';
  const sh = (v) => (v ? String(v).slice(0, 12) : '?');
  return divergentPositions.map((p) => `- \`${p.sender}\`@seq=${p.seq} — recebida \`${p.msg_id || '?'}\` (\`${sh(p.content_sha)}\`), conhecida localmente \`${p.known_msg_id || '?'}\` (\`${sh(p.known_content_sha)}\`) · registro em \`conflicts/${p.file}\``).join('\n');
}

function renderDiagnostics() {
  const parts = [];
  if (gaps.length) parts.push(gaps.map((g) => `- **buraco de seq** em \`${g.sender}\`: faltando ${g.missing.join(', ')}`).join('\n'));
  if (forks.length) parts.push(forks.map((f) => `- **fork** em \`${f.sender}\` seq ${f.seq}: ${f.msg_ids.join(' vs ')}`).join('\n'));
  // created_at incoerente com a causalidade: a resposta é anterior à mensagem que ela responde.
  // Não bloqueia e não reordena nada (a ordem é lamport/sender/seq) — é sinal de relógio de parede
  // errado, que no caso da issue #36 era a única pista externa de que o log de um remetente estava
  // sendo escrito por duas cópias em paralelo.
  if (clockSkews.length) {
    parts.push(clockSkews.map((c) => `- **created_at incoerente** em \`${c.msg_id}\` (\`${c.sender}\`, thread \`${c.thread_id}\`): \`${c.created_at}\` é ANTERIOR ao de \`${c.in_reply_to}\` (\`${c.ref_created_at}\`, \`${c.ref_sender}\`), que ela responde — ${formatSkew(c.behind_ms)} antes. A ordem da thread não depende de timestamp; suspeite do relógio da origem ou de duas cópias do mesmo log escrevendo em paralelo.`).join('\n'));
  }
  return parts.length ? parts.join('\n') : '_(nenhum)_';
}

const totalMessages = threadIds.reduce((s, id) => s + threads[id].order.length, 0);
const divergentBit = divergentPositions.length ? ` · ${divergentPositions.length} posição(ões) retida(s) por divergência` : '';
const summary = threadIds.length || quarantined.length || divergentPositions.length
  ? `**${threadIds.length} thread(s)** · ${totalMessages} mensagem(ns) · ${quarantined.length} em quarentena${divergentBit}`
  : '_(canal vazio — nenhuma mensagem ainda)_';

let content = readFileSync(tplPath, 'utf8');
content = content
  .replaceAll('{{CHANNEL}}', channel)
  .replaceAll('{{SELF}}', self)
  .replaceAll('{{SUMMARY}}', summary)
  .replaceAll('{{THREAD_INDEX}}', renderThreadIndex())
  .replaceAll('{{THREAD_VIEWS}}', renderThreadViews())
  .replaceAll('{{BATONS}}', renderBatons())
  .replaceAll('{{QUARANTINE}}', renderQuarantine())
  .replaceAll('{{DIVERGENCES}}', renderDivergences())
  .replaceAll('{{DIAGNOSTICS}}', renderDiagnostics());

// Preserva o bloco narrativo já escrito ("Notas") entre regenerações.
const START = '<!-- FORGE:NARRATIVE:START -->';
const END = '<!-- FORGE:NARRATIVE:END -->';
if (existsSync(out)) {
  const prev = readFileSync(out, 'utf8');
  const ps = prev.indexOf(START), pe = prev.indexOf(END);
  const cs = content.indexOf(START), ce = content.indexOf(END);
  if (ps >= 0 && pe > ps && cs >= 0 && ce > cs) {
    const prevBody = prev.slice(ps + START.length, pe).trim();
    const placeholder = content.slice(cs + START.length, ce).trim();
    if (prevBody && !prevBody.startsWith('_(Espaço livre') && prevBody !== placeholder) {
      content = content.slice(0, cs + START.length) + '\n' + prevBody + '\n' + content.slice(ce);
    }
  }
}

writeFileSync(out, content);
