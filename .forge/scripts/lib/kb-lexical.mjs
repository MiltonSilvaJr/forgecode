// kb-lexical — índice lexical da busca unificada (/forge:kb): normalização, BM25, entidades e grafo
// de links entre documentos. Zero-dep (só `node:*`). Determinístico: a mesma entrada produz o mesmo
// índice byte a byte (sem relógio, chaves ordenadas), o que permite comparar builds por diff.
//
// Por que BM25 em Node puro e não SQLite/FTS5: o piso do harness é Node 20 e `node:sqlite` só existe
// a partir do 22.5 (experimental); medido no corpus deste repositório (5.167 trechos), construir leva
// ~0,7 s e consultar menos de 1 ms. Ver evidence/corpus-measurement.md do change.
import { createHash } from 'node:crypto';
import { chunk, fingerprint, CHUNK_MAX } from './kb-corpus.mjs';

// Formato 4: cada doc do índice ganha `madr_status` (change extend-kb-corpus-sources, REQ-07) — o
// bump força a reconstrução automática de todo índice anterior (sem `madr_status` em nenhum doc) no
// próximo build/query, mesmo que nenhuma fonte tenha mudado de conteúdo (design §2.4). Formato 3:
// nomes genéricos de artefato (design.md, tasks.md, README.md, package.json…) e nomes de
// tecnologia (node.js, next.js) deixaram de ser entidade (code-evaluator do PR #252, achado LOG-001:
// medido no corpus real, o empate de idf entre dezenas de trechos com esses nomes subia documento
// irrelevante do BM25 #20 para o #3 do RRF só pela ordem alfabética do desempate). Formato 2: siglas
// genéricas em caixa alta deixaram de ser entidade (emenda do REQ-03, 2026-10-31). Índices de formato
// anterior são reconstruídos sozinhos na próxima consulta.
export const INDEX_FORMAT = 4;
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

const STOP = new Set(('a o os as um uma uns umas de da do das dos e em no na nos nas ao aos à às para por pelo pela com sem que se ' +
  'nao não é ser foi sao são como mais mas ou ja já the of and to in for is on it be as by or this that with from are an at was were not').split(' '));

export function normalize(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
// Redução de sufixos comuns do português; o mesmo corte é aplicado à consulta e ao texto, então
// "decisões" e "decisão" convergem. Só em palavras longas, para não destruir ids e siglas curtas.
export function stem(w) {
  if (w.length <= 4 || /\d/.test(w)) return w;
  let s = w.replace(/(oes|aes)$/, 'ao').replace(/([^s])s$/, '$1');
  if (s.length > 5) s = s.replace(/(mente|idade|cao|ado|ada|ando|endo|ar|er|ir)$/, '');
  return s;
}
export function tokenize(s) {
  return normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

// Entidades: identificadores que o harness usa como chave. Correspondência exata (sem stem). Siglas
// genéricas em caixa alta (README, TDD, API…) NÃO são entidade: medido no verify, casavam documentos
// errados e eram a causa da perda do lexical contra o BM25 isolado.
const ENTITY_RE = /(?<![A-Za-z0-9_./:-])(LDG-\d{4}|ADR[ -]?\d{4}|REQ-[A-Z0-9][A-Z0-9-]*|TASK-\d+|STORY-\d+|w\d{2,3}(?:-[a-z0-9]+)*|[A-Za-z0-9_.-]+\.(?:sh|mjs|cjs|js|md|ya?ml|json)|\/forge:[a-z-]+)(?![A-Za-z0-9_])/g;

// Nomes genéricos de artefato (qualquer documento pode se chamar assim) e nomes de tecnologia cujo
// radical é palavra comum — nenhum dos dois identifica um documento específico, então não deveriam
// virar entidade (LOG-001): o canal de entidades existe para ids reais, não para rótulos repetidos
// em centenas de trechos.
const GENERIC_ENTITY = /^(proposal|design|tasks|requirements|manifest|approvals|verification|analysis|readme|changelog|spec|spec-delta|bugfix|refactor|epic_context|index|package|package-lock|tsconfig|node|next)\.(?:sh|mjs|cjs|js|md|ya?ml|json)$/i;

export function entities(s) {
  const out = new Set();
  for (const m of String(s).matchAll(ENTITY_RE)) {
    const raw = m[1];
    if (GENERIC_ENTITY.test(raw)) continue;
    out.add(raw.toLowerCase().replace(/^adr[ -]?/, 'adr-'));
  }
  return [...out].sort();
}

const GENERIC = /^(proposal|design|tasks|requirements|manifest|approvals|verification|analysis|readme|changelog|spec|spec-delta|bugfix|refactor|epic_context|index)\.(md|ya?ml)$/i;

// links(docs) → adjacência não direcionada {docId: [docId...]} (ordenada).
export function buildLinks(docs) {
  const byLedger = new Map(); const byBase = new Map(); const baseCount = new Map(); const byChange = new Map();
  for (const d of docs) {
    if (d.kind === 'ledger') byLedger.set(d.id.slice('ledger:'.length), d.id);
    if (d.kind !== 'ledger' && d.kind !== 'liaison') {
      const base = d.id.split('/').pop();
      if (!GENERIC.test(base)) { baseCount.set(base, (baseCount.get(base) || 0) + 1); byBase.set(base, d.id); }
    }
    const m = /^\.forge\/specs\/archived\/\d{4}-\d{2}-\d{2}-([a-z0-9-]+)\//.exec(d.id);
    if (m) { if (!byChange.has(m[1])) byChange.set(m[1], []); byChange.get(m[1]).push(d.id); }
  }
  const adj = new Map(docs.map((d) => [d.id, new Set()]));
  const link = (a, b) => { if (a !== b && adj.has(a) && adj.has(b)) { adj.get(a).add(b); adj.get(b).add(a); } };
  const changeRe = byChange.size ? new RegExp(`\\b(${[...byChange.keys()].sort((a, b) => b.length - a.length).map((x) => x.replace(/[-]/g, '\\-')).join('|')})\\b`, 'g') : null;
  for (const d of docs) {
    for (const m of d.text.matchAll(/LDG-\d{4}/g)) { const t = byLedger.get(m[0]); if (t) link(d.id, t); }
    for (const m of d.text.matchAll(/[A-Za-z0-9_.-]+\.(?:md|ya?ml)/g)) { if (baseCount.get(m[0]) === 1) link(d.id, byBase.get(m[0])); }
    if (changeRe) for (const m of d.text.matchAll(changeRe)) { const t = byChange.get(m[1]); if (t) { const own = t.some((x) => x === d.id); if (!own) link(d.id, t.find((x) => /proposal\.md$/.test(x)) || t[0]); } }
  }
  const out = {};
  for (const id of [...adj.keys()].sort()) out[id] = [...adj.get(id)].sort();
  return out;
}

// buildIndex(docs) → {index, texts}: o índice serializável (determinístico) e o Buffer com o texto dos
// trechos concatenado. O texto fica fora do JSON porque é ~60% do tamanho e o parse dele dominava a
// latência da consulta lexical (design §2.4); cada trecho guarda deslocamento e tamanho em bytes.
export function buildIndex(docs, quick = null) {
  const chunks = []; const bufs = []; let off = 0;
  for (const d of docs) for (const c of chunk(d)) {
    const b = Buffer.from(c.text, 'utf8');
    chunks.push({ doc: d.id, heading: c.heading, line: c.line, off, len: b.length, text: c.text });
    bufs.push(b); off += b.length;
  }
  const texts = Buffer.concat(bufs);
  const postings = new Map(); const ent = new Map(); const len = [];
  chunks.forEach((c, i) => {
    const toks = tokenize(`${c.doc} ${c.heading} ${c.text}`);
    len.push(toks.length);
    const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, f] of tf) { if (!postings.has(t)) postings.set(t, []); postings.get(t).push([i, f]); }
    for (const e of entities(`${c.doc} ${c.text}`)) { if (!ent.has(e)) ent.set(e, []); ent.get(e).push(i); }
  });
  const sortObj = (m) => Object.fromEntries([...m.keys()].sort().map((k) => [k, m.get(k)]));
  for (const c of chunks) delete c.text;
  const index = {
    format: INDEX_FORMAT,
    chunk_max: CHUNK_MAX,
    fingerprint: fingerprint(docs),
    quick_fingerprint: quick,
    docs: docs.map((d) => ({ id: d.id, kind: d.kind, sha256: d.sha256, madr_status: d.madr_status ?? null })),
    chunks,
    len,
    postings: sortObj(postings),
    entities: sortObj(ent),
    links: buildLinks(docs),
    texts_sha256: createHash('sha256').update(texts).digest('hex'),
  };
  attachTexts(index, texts);
  return { index, texts };
}

// attachTexts(index, buf) — liga ao índice o acesso ao texto do trecho i (não serializado).
export function attachTexts(index, buf) {
  Object.defineProperty(index, 'chunkText', { enumerable: false, value: (i) => { const c = index.chunks[i]; return buf.toString('utf8', c.off, c.off + c.len); } });
  return index;
}

export function serializeIndex(idx) {
  return JSON.stringify(idx) + '\n';
}

// Busca por canal. Cada função devolve [[chunkIdx, score], ...] ordenado por score desc, índice asc.
const byScore = (a, b) => b[1] - a[1] || a[0] - b[0];

export function bm25(idx, query) {
  const N = idx.chunks.length; if (!N) return [];
  const avg = idx.len.reduce((a, b) => a + b, 0) / N || 1;
  const scores = new Map();
  for (const t of new Set(tokenize(query))) {
    const p = idx.postings[t]; if (!p) continue;
    const idf = Math.log(1 + (N - p.length + 0.5) / (p.length + 0.5));
    for (const [i, f] of p) scores.set(i, (scores.get(i) || 0) + idf * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * idx.len[i] / avg)));
  }
  return [...scores].sort(byScore);
}

export function entityMatch(idx, query) {
  const N = idx.chunks.length; const scores = new Map();
  for (const e of entities(query)) {
    const p = idx.entities[e]; if (!p) continue;
    const idf = Math.log(1 + N / p.length);
    for (const i of p) scores.set(i, (scores.get(i) || 0) + idf);
  }
  return [...scores].sort(byScore);
}

// toDocRanks([[chunkIdx, score]]) → Map(docId → {rank, chunk, score}) pela melhor ocorrência.
export function toDocRanks(idx, chunkScores) {
  const m = new Map();
  for (const [i, sc] of chunkScores) { const d = idx.chunks[i].doc; if (!m.has(d)) m.set(d, { rank: m.size + 1, chunk: i, score: sc }); }
  return m;
}
