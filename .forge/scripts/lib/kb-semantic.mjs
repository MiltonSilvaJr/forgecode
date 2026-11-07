// kb-semantic — camada semântica da busca unificada (/forge:kb): embeddings densos e re-rank por
// cross-encoder, locais. Carregada só por import() dinâmico (kb-cli.mjs), quando
// `.forge/kb/semantic/installed.json` existe e `--lexical` não foi pedido. Nunca lança para o CLI na
// carga: devolve {ok:false, reason} e o CLI cai para o modo lexical com o motivo.
//
// O runtime (onnxruntime-web, WASM, sem binário nativo) e o tokenizador (@huggingface/tokenizers, JS
// puro) vêm EXCLUSIVAMENTE de `.forge/kb/semantic/runtime/node_modules/`, instalados por
// `kb.sh semantic install` a partir dos pins (lib/kb-pins/). A resolução normal de pacote subiria a
// árvore e poderia carregar um pacote do projeto-alvo ou do próprio harness, sem versão fixada e fora
// da varredura de binário nativo — por isso todo caminho resolvido é conferido contra esse diretório.
//
// Nenhuma rede: só `node:fs`, `node:path`, `node:crypto`, `node:module`, `node:url`.
import { readFileSync, writeFileSync, mkdirSync, renameSync, realpathSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { verify } from './kb-integrity.mjs';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const SAVE_EVERY = 200;

// Resolve um pacote SÓ dentro de runtime/node_modules.
function resolveInside(runtimeDir, spec) {
  const req = createRequire(join(runtimeDir, 'package.json'));
  const p = realpathSync(req.resolve(spec));
  const root = realpathSync(resolve(runtimeDir, 'node_modules')) + sep;
  if (!p.startsWith(root)) throw new Error(`pacote do runtime faltando: ${spec} (resolvido fora de runtime/node_modules)`);
  return p;
}

// ---------- carga ----------
export async function loadSemantic(semDir, pinsDir, vectorsPath) {
  const v = verify(semDir, pinsDir);
  if (!v.ok) return { ok: false, reason: v.reason };
  const runtimeDir = join(semDir, 'runtime');
  let ort, Tokenizer;
  try {
    ort = await import(pathToFileURL(resolveInside(runtimeDir, 'onnxruntime-web')).href);
    ort = ort.InferenceSession ? ort : ort.default;
    const tk = await import(pathToFileURL(resolveInside(runtimeDir, '@huggingface/tokenizers')).href);
    Tokenizer = tk.Tokenizer ?? tk.default?.Tokenizer;
    if (!ort?.InferenceSession || !Tokenizer) throw new Error('API do runtime inesperada');
  } catch (e) { return { ok: false, reason: String(e.message || e).split('\n')[0] }; }
  try {
    const mdir = join(semDir, 'models');
    const mk = async (role) => {
      const cfg = v.models[role];
      const file = (r) => join(mdir, cfg.files.find((f) => f.role === r).path);
      const tok = new Tokenizer(JSON.parse(readFileSync(file('tokenizer'), 'utf8')), JSON.parse(readFileSync(file('tokenizer_config'), 'utf8')));
      const session = await ort.InferenceSession.create(new Uint8Array(readFileSync(file('model'))), { executionProviders: ['wasm'] });
      return { cfg, tok, session };
    };
    const emb = await mk('embedder');
    const rr = await mk('reranker');
    return { ok: true, semantic: makeSemantic(ort, emb, rr, vectorsPath, v.models) };
  } catch (e) { return { ok: false, reason: String(e.message || e).split('\n')[0] }; }
}

const clip = (ids, max) => (ids.length > max ? [...ids.slice(0, max - 1), ids[ids.length - 1]] : ids);

function feeds(ort, session, ids) {
  const L = ids.length;
  const f = { input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map((x) => BigInt(x))), [1, L]) };
  if (session.inputNames.includes('attention_mask')) f.attention_mask = new ort.Tensor('int64', new BigInt64Array(L).fill(1n), [1, L]);
  if (session.inputNames.includes('token_type_ids')) f.token_type_ids = new ort.Tensor('int64', new BigInt64Array(L), [1, L]);
  return f;
}

function makeSemantic(ort, emb, rr, vectorsPath, models) {
  const modelId = `${models.embedder.id}@${models.embedder.files.find((f) => f.role === 'model').sha256.slice(0, 16)}`;
  async function embed(text, prefix) {
    const ids = clip(emb.tok.encode(prefix + text).ids, emb.cfg.max_tokens);
    const out = await emb.session.run(feeds(ort, emb.session, ids));
    const h = out[emb.cfg.output] || out[emb.session.outputNames[0]];
    const [, L, D] = h.dims;
    const v = new Float32Array(D);
    for (let t = 0; t < L; t++) for (let k = 0; k < D; k++) v[k] += h.data[t * D + k];
    let n = 0; for (let k = 0; k < D; k++) n += v[k] * v[k];
    n = Math.sqrt(n) || 1; for (let k = 0; k < D; k++) v[k] /= n;
    return v;
  }
  // Cache de vetores num arquivo só (rename atômico de um arquivo, nunca um par inconsistente):
  // 'FKBV' | u32 versão | u32 dim | u32 quantidade | u32 tamanho do JSON | JSON {model_id, keys} | Float32[].
  // O cabeçalho também impede que os bytes iniciais casem por acaso uma assinatura de executável.
  const vecFile = vectorsPath;
  const EMPTY = { dim: 0, keys: {}, data: new Float32Array(0) };
  function loadVectors() {
    let b; try { b = readFileSync(vecFile); } catch { return EMPTY; }
    if (b.length < 20 || b.toString('latin1', 0, 4) !== 'FKBV' || b.readUInt32LE(4) !== 1) return EMPTY;
    const dim = b.readUInt32LE(8), n = b.readUInt32LE(12), jl = b.readUInt32LE(16);
    if (b.length !== 20 + jl + n * dim * 4) return EMPTY;
    let meta; try { meta = JSON.parse(b.toString('utf8', 20, 20 + jl)); } catch { return EMPTY; }
    if (meta.model_id !== modelId) return EMPTY;
    const start = 20 + jl;
    const data = new Float32Array(n * dim);
    for (let i = 0; i < n * dim; i++) data[i] = b.readFloatLE(start + i * 4);
    return { dim, keys: meta.keys, data };
  }
  function saveVectors(dim, entries) {
    const keys = {}; entries.forEach(([k], i) => { keys[k] = i; });
    const json = Buffer.from(JSON.stringify({ model_id: modelId, keys }), 'utf8');
    const head = Buffer.alloc(20); head.write('FKBV', 0, 'latin1'); head.writeUInt32LE(1, 4); head.writeUInt32LE(dim, 8); head.writeUInt32LE(entries.length, 12); head.writeUInt32LE(json.length, 16);
    const data = Buffer.alloc(entries.length * dim * 4);
    entries.forEach(([, v], i) => { for (let k = 0; k < dim; k++) data.writeFloatLE(v[k], (i * dim + k) * 4); });
    mkdirSync(dirname(vecFile), { recursive: true });
    const tmp = `${vecFile}.tmp-${process.pid}`;
    writeFileSync(tmp, Buffer.concat([head, json, data])); renameSync(tmp, vecFile);
  }
  const chunkKey = (idx, i) => sha256(`${idx.chunks[i].doc}\n${idx.chunkText(i)}`);
  let cache = null;
  return {
    modelId,
    async buildVectors(idx, progress) {
      const t = Date.now();
      const old = loadVectors();
      const have = new Map(Object.entries(old.keys).map(([k, i]) => [k, old.data.subarray(i * old.dim, (i + 1) * old.dim)]));
      const want = idx.chunks.map((c, i) => chunkKey(idx, i));
      const wantSet = new Set(want);
      const keep = new Map([...have].filter(([k]) => wantSet.has(k)));
      const removed = have.size - keep.size;
      let computed = 0; let dim = old.dim;
      const missing = [...new Set(want)].filter((k) => !keep.has(k));
      const byKey = new Map(idx.chunks.map((c, i) => [want[i], i]));
      for (const k of missing) {
        const i = byKey.get(k);
        const v = await embed(`${idx.chunks[i].doc}\n${idx.chunkText(i)}`, emb.cfg.passage_prefix);
        dim = v.length; keep.set(k, v); computed++;
        if (computed % SAVE_EVERY === 0) { saveVectors(dim, [...keep].sort((a, b) => (a[0] < b[0] ? -1 : 1))); if (progress) progress(computed, missing.length); }
      }
      if (dim) saveVectors(dim, [...keep].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
      cache = null;
      return { computed, reused: keep.size - computed, removed, ms: Date.now() - t };
    },
    async vectorSearch(idx, q) {
      if (!cache) cache = loadVectors();
      const qv = await embed(q, emb.cfg.query_prefix);
      const scores = []; let missing = 0;
      if (!cache.keyOf) cache.keyOf = idx.chunks.map((c, i) => chunkKey(idx, i));
      idx.chunks.forEach((c, i) => {
        const slot = cache.keys[cache.keyOf[i]];
        if (slot === undefined || cache.dim !== qv.length) { missing++; return; }
        let s = 0; const o = slot * cache.dim; for (let k = 0; k < cache.dim; k++) s += cache.data[o + k] * qv[k];
        scores.push([i, s]);
      });
      scores.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const ranks = new Map();
      for (const [i, s] of scores) { const d = idx.chunks[i].doc; if (!ranks.has(d)) ranks.set(d, { rank: ranks.size + 1, chunk: i, score: s }); }
      return { ranks, missing, queryVector: qv };
    },
    // Trecho representante de um documento para o cross-encoder: o de maior similaridade vetorial
    // com a consulta (cai para o melhor trecho lexical se não houver vetor).
    representative(idx, doc, q, qv, fallback) {
      if (!cache || !qv) return fallback ?? idx.chunks.findIndex((c) => c.doc === doc);
      let best = fallback ?? -1; let bs = -Infinity;
      idx.chunks.forEach((c, i) => {
        if (c.doc !== doc) return;
        const slot = cache.keys[(cache.keyOf || [])[i] ?? chunkKey(idx, i)]; if (slot === undefined) return;
        let s = 0; const o = slot * cache.dim; for (let k = 0; k < cache.dim; k++) s += cache.data[o + k] * qv[k];
        if (s > bs) { bs = s; best = i; }
      });
      return best >= 0 ? best : idx.chunks.findIndex((c) => c.doc === doc);
    },
    async crossScore(q, passage) {
      const a = rr.tok.encode(q).ids; const b = rr.tok.encode(passage).ids;
      const qa = clip(a, rr.cfg.max_query_tokens); const pb = clip(b, rr.cfg.max_passage_tokens);
      // formato de par XLM-R: <s> A </s></s> B </s> — os dois encode() já trazem <s>…</s>
      const ids = [...qa, qa[qa.length - 1], ...pb.slice(1)];
      const out = await rr.session.run(feeds(ort, rr.session, ids));
      const o = out[rr.cfg.output] || out[rr.session.outputNames[0]];
      return Number(o.data[0]);
    },
  };
}

