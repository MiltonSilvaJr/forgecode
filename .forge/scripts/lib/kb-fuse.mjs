// kb-fuse — fusão dos canais da busca unificada (/forge:kb) por Reciprocal Rank Fusion ponderado, e
// combinação do re-rank. Funções puras, sem import: o que decide a ordem do resultado está todo aqui,
// com as constantes à vista e emitidas no `--json` para que cada posição seja explicável.
//
// Constantes calibradas SÓ na partição de calibração do conjunto de avaliação
// (tests/fixtures/kb/eval/calibration.json); o holdout é reportado, nunca otimizado. Números e
// grade testada em evidence/semantic-feasibility.md do change add-unified-knowledge-search.

export const RRF_K = 60;
export const WEIGHTS = Object.freeze({ bm25: 1.0, entities: 0.2, vector: 1.0 });
// Links não são canal RRF: são propagação de score sobre a fusão (medido — semantic-feasibility.md
// §3.1). Cada um dos LINK_TOP primeiros transfere LINK_ALPHA × seu score aos vizinhos, amortecido
// por sqrt(grau_origem × grau_vizinho).
export const LINK_ALPHA = 0.1;
export const LINK_TOP = 10;
export const RERANK_K = 10;
// Os N primeiros do BM25 sempre entram no pool do re-rank, mesmo abaixo de RERANK_K.
export const RERANK_LEXICAL_EXTRA = 3;
export const RERANK_RRF_K = 5;
export const RERANK_WEIGHTS = Object.freeze({ cross_encoder: 1.0, fusion: 1.0 });

// rrf(channels) — channels: {nome: Map(docId → rank 1-based)}. Devolve [{doc, score, channels:
// {nome: {rank, contribution}}}] ordenado por score desc e, no empate, por id (determinístico).
export function rrf(channels, weights = WEIGHTS, k = RRF_K) {
  const acc = new Map();
  for (const name of Object.keys(channels).sort()) {
    const w = weights[name] ?? 0;
    for (const [doc, rank] of channels[name]) {
      if (!acc.has(doc)) acc.set(doc, { doc, score: 0, channels: {} });
      const contribution = w / (k + rank);
      const e = acc.get(doc);
      e.score += contribution;
      e.channels[name] = { rank, contribution };
    }
  }
  return [...acc.values()].sort((a, b) => b.score - a.score || (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : 0));
}

// propagateLinks(fused, links) — fused: saída de rrf(); links: {docId: [vizinhos]}. Devolve nova
// lista ordenada; cada linha ganha `channels.links = {contribution, from: [origens]}` quando recebe
// propagação. Vizinho que não estava na fusão entra com o score propagado (só ele).
export function propagateLinks(fused, links, alpha = LINK_ALPHA, top = LINK_TOP) {
  const rows = new Map(fused.map((r) => [r.doc, { doc: r.doc, score: r.score, channels: { ...r.channels } }]));
  const boost = new Map();
  for (const src of fused.slice(0, top)) {
    const nb = links[src.doc] || [];
    for (const n of nb) {
      const v = (alpha * src.score) / Math.sqrt(nb.length * Math.max(1, (links[n] || []).length));
      if (!boost.has(n)) boost.set(n, { contribution: 0, from: [] });
      const b = boost.get(n); b.contribution += v; b.from.push(src.doc);
    }
  }
  for (const [d, b] of boost) {
    if (!rows.has(d)) rows.set(d, { doc: d, score: 0, channels: {} });
    const r = rows.get(d); r.score += b.contribution; r.channels.links = { contribution: b.contribution, from: b.from.sort() };
  }
  return [...rows.values()].sort((a, b) => b.score - a.score || (a.doc < b.doc ? -1 : a.doc > b.doc ? 1 : 0));
}

// combineRerank(fused, ceScores) — fused: lista ordenada de docIds (a fusão); ceScores: Map(docId →
// score do cross-encoder) para os K primeiros. A ordem final dos K é RRF entre a posição do
// cross-encoder e a posição da fusão (k = RERANK_RRF_K): nenhum dos dois sinais decide sozinho. Os
// documentos além de K mantêm a ordem da fusão. Empate no score combinado é desempatado pela posição
// do cross-encoder (emenda do REQ-07: pela posição propagada, uma inversão simétrica dos extremos
// mantinha o primeiro no lugar).
export function combineRerank(fused, ceScores, k = RERANK_K, extra = []) {
  // Pool do re-rank: os k primeiros do ranking propagado mais os `extra` (o topo do BM25), em ordem de
  // posição no ranking propagado. Sem os extras, um documento que o lexical acha em 1º mas que a fusão
  // com o canal vetorial empurra para baixo de k nunca chegava ao cross-encoder (diagnóstico de
  // 2026-10-31: documentos longos, com centenas de trechos, ganham o máximo de similaridade por
  // documento e dominam o canal vetorial; a entrada curta do ledger caía para 20º–24º).
  const pos = new Map(fused.map((d, i) => [d, i + 1]));
  const pool = [...new Set([...fused.slice(0, k), ...extra.filter((d) => pos.has(d))])].sort((a, b) => pos.get(a) - pos.get(b));
  const inPool = new Set(pool);
  const ceOrder = [...pool].sort((a, b) => (ceScores.get(b) ?? -Infinity) - (ceScores.get(a) ?? -Infinity) || pos.get(a) - pos.get(b));
  const ceRank = new Map(ceOrder.map((d, i) => [d, i + 1]));
  const rows = pool.map((d) => {
    const fr = pos.get(d); const cr = ceRank.get(d);
    const score = RERANK_WEIGHTS.cross_encoder / (RERANK_RRF_K + cr) + RERANK_WEIGHTS.fusion / (RERANK_RRF_K + fr);
    return { doc: d, score, fusion_rank: fr, ce_rank: cr, ce_score: ceScores.get(d) ?? null };
  });
  rows.sort((a, b) => b.score - a.score || a.ce_rank - b.ce_rank);
  return [...rows, ...fused.filter((d) => !inPool.has(d)).map((d) => ({ doc: d, score: null, fusion_rank: pos.get(d), ce_rank: null, ce_score: null }))];
}

export const RERANK_FORMULA = `score = ${RERANK_WEIGHTS.cross_encoder}/(${RERANK_RRF_K} + rank_cross_encoder) + ${RERANK_WEIGHTS.fusion}/(${RERANK_RRF_K} + rank_propagado), sobre os ${RERANK_K} primeiros do ranking propagado mais os ${RERANK_LEXICAL_EXTRA} primeiros do BM25; empate desempatado pela posição do cross-encoder`;
