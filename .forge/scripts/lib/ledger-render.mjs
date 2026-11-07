// ledger-render — deterministic renderer for .forge/ledger/LEDGER.md.
// Reads .forge/ledger/ledger.json and fills templates/ledger/LEDGER.md, one section per type.
// Ordering is (type section order -> priority -> severity -> id), NEVER by timestamp, so the same
// ledger.json always renders a byte-identical LEDGER.md (same guarantee as handoff-render).
// The "Notas" narrative block (between FORGE:NARRATIVE markers) is preserved across regenerations,
// so automatic capture (harvest) never destroys hand-curated notes.
//
// Entradas cujo "type" não está no enum de SECTIONS (schema em .forge/schemas/ledger.schema.json)
// NÃO são descartadas em silêncio: vão para um balde final, "### Fora do enum do schema", que só
// aparece quando não está vazio, e a contagem ativa desse balde entra na soma de totalActive — o
// resumo nunca pode divergir da contagem real do arquivo (LDG-0170; mesma classe de defeito do
// W202, agora dentro do próprio renderer).
//
// O QUE ESTE RENDERIZADOR EXPLICITAMENTE NÃO FAZ: não falha alto em "type" desconhecido. Falhar
// alto travaria a renderização de qualquer árvore que carregue uma entrada legada — inclusive a de
// um adotante, no primeiro `forge update`, como quebra imediata e não como aviso. O canal de
// liaison já registrou que o schema publicado por axis-go-cloud roda um enum ESTENDIDO, com
// "decision" e "test-gap" além dos cinco tipos daqui — um renderizador que falhasse alto quebraria
// aquele adotante em toda entrada desses dois tipos. O dano medido era invisibilidade; a cura da
// invisibilidade é mostrar num balde nomeado, não parar a máquina.
//
// Driven by env (set by ledger-ops.sh): LEDGER_ROOT (FORGE_ROOT), LEDGER_JSON, LEDGER_TPL, LEDGER_OUT.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const env = process.env;
const jsonPath = env.LEDGER_JSON;
const tplPath = env.LEDGER_TPL;
const out = env.LEDGER_OUT;

// Section order (drives the master file layout) and human labels.
const SECTIONS = [
  ['roadmap', 'SECTION_ROADMAP'],
  ['feature-idea', 'SECTION_FEATURE_IDEA'],
  ['tech-debt', 'SECTION_TECH_DEBT'],
  ['known-bug', 'SECTION_KNOWN_BUG'],
  ['follow-up', 'SECTION_FOLLOW_UP'],
];
const TYPE_LABEL = {
  roadmap: 'roadmap',
  'feature-idea': 'feature-idea',
  'tech-debt': 'tech-debt',
  'known-bug': 'known-bug',
  'follow-up': 'follow-up',
};
const CLOSED = new Set(['resolved', 'wont-fix', 'promoted', 'superseded']);
const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
const SEVERITY_RANK = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { entries: [] }; }
};

const rank = (map, v) => (v != null && map[v] != null ? map[v] : 99);

// Deterministic order: priority, then severity, then id (lexical — zero-padded LDG-NNNN sorts right).
function orderEntries(a, b) {
  const pr = rank(PRIORITY_RANK, a.priority) - rank(PRIORITY_RANK, b.priority);
  if (pr !== 0) return pr;
  const sv = rank(SEVERITY_RANK, a.severity) - rank(SEVERITY_RANK, b.severity);
  if (sv !== 0) return sv;
  return a.id.localeCompare(b.id);
}

function tag(entry) {
  const bits = [];
  if (entry.priority) bits.push(entry.priority);
  if (entry.severity) bits.push(entry.severity);
  return bits.length ? ` (${bits.join('/')})` : '';
}

function renderEntry(entry) {
  const src = entry.source || {};
  const from = src.change_id ? ` · via \`${src.change_id}\`${src.ref ? `#${src.ref}` : ''}` : '';
  // last_verified e supersedes (add-ledger-evidence-aging): só a DATA, nunca a idade — a idade
  // dependeria da data do render e quebraria a renderização byte-idêntica. Entrada sem os campos
  // novos renderiza exatamente como antes.
  const verified = entry.last_verified ? ` · reverificado em ${String(entry.last_verified).slice(0, 10)}` : '';
  let line = `- **${entry.id}** [${entry.status}]${tag(entry)} — ${entry.title}${from}${verified}`;
  if (entry.supersedes) line += `\n  ↳ substitui \`${entry.supersedes}\``;
  if (entry.detail) line += `\n  ${entry.detail.replace(/\n+/g, ' ').trim()}`;
  // Só mostra o elo de promoção enquanto ele vale: um item reaberto (close abandoned/rejected volta
  // a 'open') mantém promoted_to como histórico, mas renderizá-lo confundiria ("promovido para" um
  // change abandonado). Mostra apenas em promoted/resolved.
  const promotedTo = entry.links && entry.links.promoted_to;
  if (promotedTo && (entry.status === 'promoted' || entry.status === 'resolved')) {
    line += `\n  → promovido para \`${promotedTo}\``;
  }
  return line;
}

function renderSection(entries) {
  const active = entries.filter((e) => !CLOSED.has(e.status)).sort(orderEntries);
  const closed = entries.filter((e) => CLOSED.has(e.status));
  if (!active.length && !closed.length) return '_(nenhum)_';
  const parts = [];
  if (active.length) parts.push(active.map(renderEntry).join('\n'));
  else parts.push('_(nenhum ativo)_');
  if (closed.length) {
    const byStatus = {};
    for (const e of closed) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    const detail = Object.keys(byStatus).sort().map((s) => `${s} ${byStatus[s]}`).join(' · ');
    parts.push(`\n_Encerrados: ${closed.length} (${detail})_`);
  }
  return parts.join('\n');
}

const data = readJson(jsonPath);
const entries = Array.isArray(data.entries) ? data.entries : [];
const byType = {};
for (const [type] of SECTIONS) byType[type] = [];
for (const e of entries) if (byType[e.type]) byType[e.type].push(e);

// Summary line: active counts per type + total closed.
const activeCounts = SECTIONS
  .map(([type]) => [TYPE_LABEL[type], byType[type].filter((e) => !CLOSED.has(e.status)).length])
  .filter(([, n]) => n > 0);
let totalActive = activeCounts.reduce((s, [, n]) => s + n, 0);
let unknownBlock = '';
const totalClosed = entries.filter((e) => CLOSED.has(e.status)).length;

// BALDE:START — soma o balde de "fora do enum" ao resumo e monta o bloco a anexar ao final do
// arquivo, para que totalActive nunca divirja da contagem real de ativos do ledger.json.
const knownTypes = new Set(SECTIONS.map(([type]) => type));
const unknownEntries = entries.filter((e) => !knownTypes.has(e.type));
totalActive += unknownEntries.filter((e) => !CLOSED.has(e.status)).length;
if (unknownEntries.length) {
  unknownBlock = `\n### Fora do enum do schema\n\n${renderSection(unknownEntries)}\n`;
}
// BALDE:END
const summary = totalActive || totalClosed
  ? `**${totalActive} ${totalActive === 1 ? 'item ativo' : 'itens ativos'}**`
      + (activeCounts.length ? ' · ' + activeCounts.map(([l, n]) => `${l} ${n}`).join(' · ') : '')
      + (totalClosed ? ` · (${totalClosed} encerrado${totalClosed === 1 ? '' : 's'})` : '')
  : '_(ledger vazio — nada registrado ainda)_';

let content = readFileSync(tplPath, 'utf8');
content = content.replaceAll('{{SUMMARY}}', summary);
for (const [type, placeholder] of SECTIONS) {
  content = content.replaceAll(`{{${placeholder}}}`, renderSection(byType[type]));
}

// Preserve an already-written narrative ("Notas") block across regenerations.
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

// Anexa o balde de "fora do enum" ao final do arquivo — omitido quando vazio, para que o acervo
// normalizado (sem entradas fora do enum) nunca ganhe uma seção morta.
if (unknownBlock) content += unknownBlock;

writeFileSync(out, content);
