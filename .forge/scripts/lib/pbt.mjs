// pbt — property-based testing zero-dep para os gates do harness.
//
// Existe porque a rule testing/tdd.md exige PBT onde há propriedade verificável, e as ferramentas
// que ela indica por stack (fast-check, FsCheck, Kotest Property) vivem no projeto adotante — não
// aqui. Os gates do Forge rodam com `node` puro sobre template/.forge/**, que é zero-dependência
// por contrato. Uma norma de PBT que o próprio harness não consegue exercitar é uma norma que
// ninguém verifica, e este arquivo é o que fecha essa lacuna nos nossos próprios testes.
//
// Não pretende competir com fast-check: não há geradores arbitrários derivados de tipo, nem
// integração com runner, nem shrinking sofisticado. Tem o que um gate determinista precisa —
// geração reprodutível por seed, busca de contraexemplo e shrinking suficiente para que a falha
// ensine algo.
//
// TRÊS DECISÕES QUE IMPORTAM:
//
// 1. Reprodutibilidade por seed é obrigatória, não conveniência. Uma falha de PBT que não
//    reproduz é uma falha que ninguém depura — vira "roda de novo até passar", que é o oposto
//    do que o teste existe para fazer. Daí PRNG explícito, nunca Math.random (que, além disso,
//    é proibido nos scripts deste repo justamente por quebrar determinismo).
//
// 2. Shrinking é o que separa PBT útil de PBT decorativo. "Falhou com [8,3,91,7,42]" não ensina
//    nada; "falhou com [0,0,0]" aponta o defeito. Sem minimizar, o contraexemplo carrega ruído
//    aleatório junto com o sinal, e o autor descarta o achado como caso exótico.
//
// 3. A propriedade recebe os valores como ARGUMENTOS SEPARADOS (`forAll([g1,g2], (a,b) => ...)`)
//    e não um array — assinatura que lê como a matemática que ela expressa.

// --- aleatoriedade determinística ------------------------------------------------------------

// mulberry32: pequeno, rápido e com distribuição boa o bastante para geração de casos de teste.
export function makeRandom(seed) {
  let a = (seed >>> 0) || 1;
  return {
    next() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); },
  };
}

// Embaralhamento Fisher-Yates determinístico — usado pelas propriedades de invariância sob
// permutação, que é o formato de várias garantias do liaison.
export function shuffle(list, rnd) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- geradores ---------------------------------------------------------------------------------
//
// Um gerador é { generate(rnd, size) -> valor, shrink(valor) -> [candidatos menores] }. `size`
// cresce ao longo da execução: os primeiros casos são pequenos (onde defeitos de contorno moram)
// e os últimos são grandes (onde moram os de escala).

function mk(generate, shrink = () => []) { return { generate, shrink }; }

export const gen = {
  int: (min, max) => mk(
    (rnd) => rnd.int(min, max),
    // encolhe na direção de zero (ou do menor valor válido), que é onde o caso mínimo costuma estar
    (v) => {
      const target = min <= 0 && max >= 0 ? 0 : min;
      if (v === target) return [];
      const half = target + Math.trunc((v - target) / 2);
      return [...new Set([target, half, v - Math.sign(v - target)])].filter((c) => c !== v && c >= min && c <= max);
    },
  ),

  bool: () => mk((rnd) => rnd.next() < 0.5, (v) => (v ? [false] : [])),

  oneOf: (values) => mk(
    (rnd) => values[rnd.int(0, values.length - 1)],
    (v) => { const i = values.indexOf(v); return i > 0 ? [values[0]] : []; },
  ),

  array: (item, min = 0, max = 20) => mk(
    (rnd, size) => {
      const cap = Math.max(min, Math.min(max, min + Math.round((max - min) * size)));
      const n = rnd.int(min, cap);
      return Array.from({ length: n }, () => item.generate(rnd, size));
    },
    // encolhe primeiro o TAMANHO (metade, e remoção de um elemento por vez) e depois os itens:
    // um array menor é sempre um contraexemplo mais legível que um array com itens menores.
    (v) => {
      if (v.length <= min) return [];
      const out = [];
      const half = Math.max(min, Math.floor(v.length / 2));
      if (half < v.length) out.push(v.slice(0, half));
      for (let i = 0; i < v.length && out.length < 12; i++) out.push([...v.slice(0, i), ...v.slice(i + 1)]);
      return out.filter((c) => c.length >= min);
    },
  ),

  record: (shape) => mk(
    (rnd, size) => {
      const o = {};
      for (const k of Object.keys(shape)) o[k] = shape[k].generate(rnd, size);
      return o;
    },
    (v) => {
      const out = [];
      for (const k of Object.keys(shape)) {
        for (const c of shape[k].shrink(v[k])) out.push({ ...v, [k]: c });
      }
      return out.slice(0, 12);
    },
  ),
};

// --- execução -----------------------------------------------------------------------------------

const MAX_SHRINK_STEPS = 300;

// Minimiza um contraexemplo: repete a busca por um vizinho menor que ainda falha, até não achar.
// Guloso e limitado por passos — não busca o mínimo global, busca um caso legível em tempo finito.
function shrinkCounterexample(gens, prop, values) {
  let current = values;
  let steps = 0;
  let improved = true;
  while (improved && steps < MAX_SHRINK_STEPS) {
    improved = false;
    for (let i = 0; i < gens.length; i++) {
      for (const candidate of gens[i].shrink(current[i])) {
        if (steps++ >= MAX_SHRINK_STEPS) break;
        const attempt = current.slice();
        attempt[i] = candidate;
        let holds;
        try { holds = prop(...attempt); } catch { holds = false; }
        if (!holds) { current = attempt; improved = true; break; }
      }
      if (improved) break;
    }
  }
  return current;
}

// Roda a propriedade contra casos gerados. Devolve { ok, runs, seed, counterexample?, error? }
// em vez de lançar: quem chama é um gate, e um gate quer a informação para formatar a mensagem.
export function forAll(gens, prop, opts = {}) {
  const runs = opts.runs ?? 100;
  const seed = opts.seed ?? 1;
  const rnd = makeRandom(seed);
  for (let i = 0; i < runs; i++) {
    const size = runs === 1 ? 1 : i / (runs - 1);   // cresce de 0 a 1 ao longo da execução
    const values = gens.map((g) => g.generate(rnd, size));
    let holds, error = null;
    try { holds = prop(...values); } catch (e) { holds = false; error = String(e && e.message || e); }
    if (!holds) {
      const minimal = shrinkCounterexample(gens, prop, values);
      return { ok: false, runs: i + 1, seed, counterexample: minimal, original: values, error };
    }
  }
  return { ok: true, runs, seed };
}

// Açúcar para uso direto em gate: lança com mensagem formatada quando a propriedade falha.
export function check(name, gens, prop, opts = {}) {
  const r = forAll(gens, prop, opts);
  if (!r.ok) {
    const ce = JSON.stringify(r.counterexample);
    throw new Error(`propriedade "${name}" falhou após ${r.runs} caso(s) (seed ${r.seed})\n  contraexemplo minimizado: ${ce}${r.error ? `\n  erro: ${r.error}` : ''}`);
  }
  return r;
}
