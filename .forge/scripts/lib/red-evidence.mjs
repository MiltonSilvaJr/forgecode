// lib/red-evidence.mjs — leitura e validação à mão de evidence/red/red-evidence.json
// (schema red-evidence/v1, template/.forge/schemas/red-evidence.schema.json). Espelha as
// regras do schema sem depender de ajv em runtime (mesmo padrão de validate-spec.mjs).
// Puro quanto possível: loadRedEvidence é o único ponto de I/O; o resto opera sobre o
// objeto já lido.
//
// Modelo de dados (Onda #139, redesenho de causa raiz — 4ª rodada de correção da issue #139):
//
//   1. `entries[]` é a ÚNICA fonte da verdade. Todo leitor e todo escritor opera sobre
//      `entries[]` — nunca sobre os escalares do topo diretamente.
//   2. Toda entrada tem `id` NÃO NULO e ESTÁVEL. `record` sem `--id` sobre um change com 0
//      entradas gera um id determinístico (`nextAutoId` — 'd1', 'd2', ...). A leitura de um
//      `red-evidence.json` legado de entrada única (sem `entries[]`) atribui o id fixo
//      `LEGACY_ID` ('legado') sem perder nem reinterpretar nenhum campo (`deriveEntries`).
//      Um arquivo que já tenha `entries[]` com algum `id: null` (estado possível só em builds
//      anteriores desta própria branch, antes deste redesenho) é migrado NA LEITURA para o
//      mesmo esquema — nunca fica um id nulo depois de `deriveEntries`.
//   3. Os escalares do topo são uma PROJEÇÃO derivada por uma única função pura,
//      `computeProjection(changeId, entries)`: o status do topo é `waived` quando TODAS as
//      entradas são `waived`, `observed` quando todas estão resolvidas (observed|waived) mas
//      nem todas são `waived`, e `pending` quando existem 0 entradas ou alguma ainda não
//      resolvida; os demais campos do topo são sempre os de `entries[0]` (a primeira entrada
//      declarada — legado migrado, ou o primeiro `record` de um change novo). `computeProjection`
//      roda de novo a cada escrita (`red-evidence-ops.mjs`) e NUNCA é lida como fonte — um topo
//      que diverge da projeção fresca de `entries[]` é adulteração (`topMatchesProjection`,
//      usada por `loadRedEvidence` para reprovar o arquivo como inválido).
//   4. `--rename-null` foi REMOVIDO (existia só para tornar endereçável uma entrada que nascia
//      sem id; no modelo novo toda entrada nasce com id não nulo — auto ou explícito — então
//      nunca há uma entrada inendereçável para renomear).
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REL_PATH = 'evidence/red/red-evidence.json';

export const STATUSES = ['pending', 'observed', 'waived', 'not-possible'];
export const CLASSIFICATIONS = ['behavioral', 'build-error', 'setup-exception', 'unknown'];
export const WAIVER_REASONS = ['non-behavioral', 'no-test-infra', 'external-unreproducible', 'hotfix-under-incident'];
// Estratégias de derivação da árvore base (lib/red-replay.mjs). Exportada em vez de repetida em
// literal: a lista vivia em dois lugares (aqui e no schema JSON) e o valor novo 'test-graft'
// chegou ao motor sem chegar ao validador — o change ficava travado com a evidência que ele
// mesmo acabara de produzir.
export const BASE_STRATEGIES = ['ancestry', 'revert-synthesis', 'test-graft'];

// LEGACY_ID — id fixo e documentado atribuído a uma entrada sem id na migração (deriveEntries):
// tanto a um red-evidence.json legado de verdade (formato de entrada única, sem `entries[]`,
// em voo em centenas de changes de consumidores) quanto a um `entries[]` que já contenha uma
// única entrada com `id: null` (estado só alcançável por um build anterior desta própria branch,
// antes de todo `record` passar a gerar id sempre) — as duas são, do ponto de vista de quem lê,
// indistinguíveis (uma entrada sem nome), e por isso recebem o mesmo nome.
export const LEGACY_ID = 'legado';
const AUTO_ID_PREFIX = 'd';

// ENTRY_SCALAR_FIELDS — os campos por-defeito que hoje moram no topo (Onda #139: entries[]).
// Fonte única para quem projeta o topo a partir de entries[0] (computeProjection) e para quem
// valida cada entrada aqui — evita que as duas listas divirjam como a de STATUSES/
// CLASSIFICATIONS antes desta constante existir. Exclui 'id', 'id_explicit', 'status',
// 'fix_files' e 'waiver', que têm forma/validação própria (ver validateEntryFields abaixo).
export const ENTRY_SCALAR_FIELDS = [
  'test_path', 'test_id', 'command', 'base_commit', 'failure_pattern', 'positive_control', 'excerpt', 'excerpt_sha256',
  'classification', 'base_result', 'base_strategy', 'graft_from', 'revert_patch', 'replay_head',
  'setup_command', 'reproduces', 'recorded_at', 'replayed_at', 'waived_at',
];

// validateEntryFields: mesma checagem de tipo/enum/pattern do topo, aplicada a um item de
// entries[] (Onda #139). Duplicada em vez de compartilhada com validateRedEvidence porque o topo
// tem campos que uma entrada não tem (schema, change_id) e vice-versa (id) — extrair um
// compartilhamento genérico arriscaria o validador do topo, já em produção, por um ganho de DRY
// que a lista ENTRY_SCALAR_FIELDS acima já cobre para o risco real (as duas listas divergirem).
function validateEntryFields(e, idx, errors) {
  const p = `entries[${idx}]`;
  if (!e || typeof e !== 'object' || Array.isArray(e)) { errors.push(`${p}: not an object`); return; }
  if (e.id !== undefined && e.id !== null && typeof e.id !== 'string') errors.push(`${p}.id must be string|null`);
  if (e.id_explicit !== undefined && typeof e.id_explicit !== 'boolean') errors.push(`${p}.id_explicit must be boolean`);
  if (!STATUSES.includes(e.status)) errors.push(`${p}.status invalid: ${e.status} (allowed: ${STATUSES.join('|')})`);
  for (const k of ['test_path', 'test_id', 'command', 'failure_pattern', 'positive_control', 'excerpt', 'reproduces'])
    if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string') errors.push(`${p}.${k} must be string|null`);
  if (e.base_commit !== undefined && e.base_commit !== null) {
    if (typeof e.base_commit !== 'string' || !/^[a-f0-9]{7,40}$/.test(e.base_commit))
      errors.push(`${p}.base_commit must match ^[a-f0-9]{7,40}$`);
  }
  if (e.excerpt_sha256 !== undefined && e.excerpt_sha256 !== null) {
    if (typeof e.excerpt_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(e.excerpt_sha256))
      errors.push(`${p}.excerpt_sha256 must be a 64-hex sha256`);
  }
  if (e.classification !== undefined && e.classification !== null && !CLASSIFICATIONS.includes(e.classification))
    errors.push(`${p}.classification invalid: ${e.classification} (allowed: ${CLASSIFICATIONS.join('|')}|null)`);
  if (e.base_result !== undefined && e.base_result !== null && !['failed', 'passed', 'unknown'].includes(e.base_result))
    errors.push(`${p}.base_result invalid: ${e.base_result} (allowed: failed|passed|unknown|null)`);
  if (e.base_strategy !== undefined && e.base_strategy !== null && !BASE_STRATEGIES.includes(e.base_strategy))
    errors.push(`${p}.base_strategy invalid: ${e.base_strategy} (allowed: ${BASE_STRATEGIES.join('|')}|null)`);
  if (e.graft_from !== undefined && e.graft_from !== null) {
    if (typeof e.graft_from !== 'string' || !/^[a-f0-9]{7,40}$/.test(e.graft_from))
      errors.push(`${p}.graft_from must match ^[a-f0-9]{7,40}$`);
  }
  for (const k of ['revert_patch', 'setup_command'])
    if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string') errors.push(`${p}.${k} must be string|null`);
  if (e.replay_head !== undefined && e.replay_head !== null) {
    if (typeof e.replay_head !== 'string' || !/^[a-f0-9]{7,40}$/.test(e.replay_head))
      errors.push(`${p}.replay_head must match ^[a-f0-9]{7,40}$`);
  }
  if (e.fix_files !== undefined) {
    if (!Array.isArray(e.fix_files) || e.fix_files.some((f) => typeof f !== 'string'))
      errors.push(`${p}.fix_files must be an array of strings`);
  }
  if (e.waiver !== undefined && e.waiver !== null) {
    if (typeof e.waiver !== 'object' || Array.isArray(e.waiver)) errors.push(`${p}.waiver must be object|null`);
    else {
      if (!WAIVER_REASONS.includes(e.waiver.reason))
        errors.push(`${p}.waiver.reason invalid: ${e.waiver.reason} (allowed: ${WAIVER_REASONS.join('|')})`);
      if (e.waiver.deferral_id != null && !/^DEFER-[0-9]+/.test(e.waiver.deferral_id))
        errors.push(`${p}.waiver.deferral_id must match ^DEFER-[0-9]+`);
    }
  }
}

// validateRedEvidence(data): espelho do schema — additionalProperties:false não é
// reforçado aqui (não é o ponto de risco; a lista fixa de campos abaixo já é o contrato),
// mas todo campo presente é conferido quanto a tipo/enum/pattern.
export function validateRedEvidence(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['red-evidence: not an object'];
  if (data.schema !== 'red-evidence/v1') errors.push(`schema must be "red-evidence/v1": ${data.schema}`);
  if (typeof data.change_id !== 'string' || !data.change_id.length) errors.push('change_id missing');
  if (!STATUSES.includes(data.status)) errors.push(`status invalid: ${data.status} (allowed: ${STATUSES.join('|')})`);
  for (const k of ['test_path', 'test_id', 'command', 'failure_pattern', 'positive_control', 'excerpt', 'reproduces'])
    if (data[k] !== undefined && data[k] !== null && typeof data[k] !== 'string') errors.push(`${k} must be string|null`);
  if (data.base_commit !== undefined && data.base_commit !== null) {
    if (typeof data.base_commit !== 'string' || !/^[a-f0-9]{7,40}$/.test(data.base_commit))
      errors.push('base_commit must match ^[a-f0-9]{7,40}$');
  }
  if (data.excerpt_sha256 !== undefined && data.excerpt_sha256 !== null) {
    if (typeof data.excerpt_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.excerpt_sha256))
      errors.push('excerpt_sha256 must be a 64-hex sha256');
  }
  if (data.classification !== undefined && data.classification !== null && !CLASSIFICATIONS.includes(data.classification))
    errors.push(`classification invalid: ${data.classification} (allowed: ${CLASSIFICATIONS.join('|')}|null)`);
  if (data.base_result !== undefined && data.base_result !== null && !['failed', 'passed', 'unknown'].includes(data.base_result))
    errors.push(`base_result invalid: ${data.base_result} (allowed: failed|passed|unknown|null)`);
  if (data.base_strategy !== undefined && data.base_strategy !== null && !BASE_STRATEGIES.includes(data.base_strategy))
    errors.push(`base_strategy invalid: ${data.base_strategy} (allowed: ${BASE_STRATEGIES.join('|')}|null)`);
  if (data.graft_from !== undefined && data.graft_from !== null) {
    if (typeof data.graft_from !== 'string' || !/^[a-f0-9]{7,40}$/.test(data.graft_from))
      errors.push('graft_from must match ^[a-f0-9]{7,40}$');
  }
  for (const k of ['revert_patch', 'setup_command'])
    if (data[k] !== undefined && data[k] !== null && typeof data[k] !== 'string') errors.push(`${k} must be string|null`);
  if (data.replay_head !== undefined && data.replay_head !== null) {
    if (typeof data.replay_head !== 'string' || !/^[a-f0-9]{7,40}$/.test(data.replay_head))
      errors.push('replay_head must match ^[a-f0-9]{7,40}$');
  }
  if (data.fix_files !== undefined) {
    if (!Array.isArray(data.fix_files) || data.fix_files.some((f) => typeof f !== 'string'))
      errors.push('fix_files must be an array of strings');
  }
  if (data.waiver !== undefined && data.waiver !== null) {
    if (typeof data.waiver !== 'object' || Array.isArray(data.waiver)) errors.push('waiver must be object|null');
    else {
      if (!WAIVER_REASONS.includes(data.waiver.reason))
        errors.push(`waiver.reason invalid: ${data.waiver.reason} (allowed: ${WAIVER_REASONS.join('|')})`);
      if (data.waiver.deferral_id != null && !/^DEFER-[0-9]+/.test(data.waiver.deferral_id))
        errors.push('waiver.deferral_id must match ^DEFER-[0-9]+');
    }
  }
  // entries — Onda #139 (issue #139): propriedade ADITIVA e opcional; um red-evidence.json
  // legado (centenas de changes de consumidores em voo) não tem esta chave e continua válido.
  if (data.entries !== undefined) {
    if (!Array.isArray(data.entries)) errors.push('entries must be an array');
    else {
      data.entries.forEach((e, i) => validateEntryFields(e, i, errors));
      // MEDIUM da correção da #139: id vazio ('') e ids duplicados passavam sem erro — o próprio
      // formato quimera que `record` sem `--id` (fail-closed) evita do lado da escrita, mas que
      // um red-evidence.json escrito à mão (ou por versão anterior desta lib) podia introduzir
      // sem que a validação estática avisasse.
      const idsPresent = data.entries.filter((e) => e && typeof e === 'object' && e.id !== null && e.id !== undefined).map((e) => e.id);
      if (idsPresent.some((id) => id === '')) errors.push('entries[].id must not be an empty string');
      const seen = new Set();
      const dupes = new Set();
      for (const id of idsPresent) { if (seen.has(id)) dupes.add(id); seen.add(id); }
      if (dupes.size) errors.push(`entries[].id duplicated: ${[...dupes].join(', ')}`);
    }
  }
  return errors;
}

// ── entries[] — fonte única de verdade (redesenho de causa raiz, 4ª rodada da #139) ────────────

export function resolvedEntry(e) { return e.status === 'observed' || e.status === 'waived'; }

export function emptyEntry(id) {
  const e = { id: id ?? null, id_explicit: false, status: 'pending', fix_files: [], waiver: null };
  for (const k of ENTRY_SCALAR_FIELDS) e[k] = null;
  return e;
}

// "evidência gravada" — mesmo predicado do item 3d em check-red-first.mjs (exclui o scaffold
// trivial que /forge:spec new grava para TODO change bugfix: status:'pending', recorded_at:null).
// Achado LOW da correção da #139: `recorded_at`/`status` sozinhos não bastam — um artefato
// legado escrito à mão (w106/w144, plano L5 §6.4) pode ter test_path/test_id/command/
// failure_pattern/fix_files preenchidos com `recorded_at:null` e `status:'pending'` (nunca
// passou pelo `record` da CLI, que sempre carimba `recorded_at`), e o predicado antigo tratava
// esse conteúdo real como scaffold vazio, descartando-o no primeiro `record --id`.
// LEGACY_SIGNAL_FIELDS — subconjunto de ENTRY_SCALAR_FIELDS que só um `record` de verdade (CLI
// ou escrito à mão, w106/w144) preenche. Exclui deliberadamente 'reproduces': o scaffold do
// `templates/bugfix/red-evidence.json` já grava `"reproduces": "bugfix.md §1"` como default
// ESTÁTICO em todo change bugfix novo, então esse campo sozinho não distingue "nunca gravado" de
// "gravado" — usá-lo aqui faria todo scaffold recém-criado, mesmo sem nenhum record, parecer
// legado real (regressão do cenário de scaffold vazio).
const LEGACY_SIGNAL_FIELDS = ENTRY_SCALAR_FIELDS.filter((k) => k !== 'reproduces');

function isRealLegacyData(data) {
  if (!data) return false;
  if (data.recorded_at || (data.status && data.status !== 'pending')) return true;
  if (Array.isArray(data.fix_files) && data.fix_files.length) return true;
  return LEGACY_SIGNAL_FIELDS.some((k) => data[k] !== undefined && data[k] !== null && data[k] !== '');
}

function extractEntryFromTop(data) {
  const e = { id: null, id_explicit: false, status: data.status || 'pending' };
  for (const k of ENTRY_SCALAR_FIELDS) e[k] = data[k] ?? null;
  e.fix_files = Array.isArray(data.fix_files) ? data.fix_files : [];
  e.waiver = data.waiver ?? null;
  return e;
}

// nextAutoId: id determinístico e estável para uma entrada sem `--id` explícito — 'd1', 'd2',
// ... — o primeiro nome livre do padrão, nunca colidindo com um id já em uso (auto ou
// explícito). Exportada para que `record` (0 entradas) e `migrateNullIds` (leitura) usem a
// MESMA função — a garantia de "toda entrada tem id estável" depende de as duas nunca
// divergirem em como geram o próximo nome.
export function nextAutoId(usedIds) {
  let n = 1;
  while (usedIds.has(`${AUTO_ID_PREFIX}${n}`)) n++;
  return `${AUTO_ID_PREFIX}${n}`;
}

// migrateNullIds: nenhuma entrada sai daqui com `id: null` — ponto único de migração (item 2 do
// redesenho). Uma ÚNICA entrada sem id (legado de verdade extraído do topo, OU um `entries[]` já
// existente com uma única entrada null — só alcançável por um build anterior desta branch) recebe
// LEGACY_ID; com 2+ entradas, cada `id: null` recebe o próximo auto-id livre, na ordem em que
// aparece no array — nunca reordena nem reinterpreta nenhum outro campo.
function migrateNullIds(entries) {
  if (!entries.some((e) => e.id == null)) return entries;
  if (entries.length === 1) {
    return [{ ...entries[0], id: LEGACY_ID, id_explicit: false }];
  }
  const used = new Set(entries.filter((e) => e.id != null).map((e) => e.id));
  return entries.map((e) => {
    if (e.id != null) return e;
    const id = nextAutoId(used);
    used.add(id);
    return { ...e, id, id_explicit: false };
  });
}

// deriveEntries(data): entries[] JÁ NORMALIZADO — sempre um array, ids nunca nulos. `entries`
// presente no JSON -> usa como está, normalizando campos ausentes por item e migrando qualquer
// id null (item 2). Ausente mas com dado real (J-14, legado em voo em centenas de changes de
// consumidores) -> PRESERVA o legado como entries[0] com id LEGACY_ID, nunca descarta e nunca
// recomeça `entries:[novo]` (esse seria o próprio defeito original da issue, aplicado ao caminho
// de migração). Scaffold trivial (nunca gravado) -> [] (nada a preservar; ver comentário de
// isRealLegacyData).
export function deriveEntries(data) {
  const raw = Array.isArray(data.entries)
    ? data.entries.map((e) => ({ ...emptyEntry(e && e.id), ...e }))
    : (isRealLegacyData(data) ? [extractEntryFromTop(data)] : []);
  return migrateNullIds(raw);
}

// deriveTopStatus: item 3 do redesenho (status do topo). 0 entradas -> pending; 1 entrada -> o
// status dela (passa 'not-possible' adiante — só 0/1 entrada pode chegar a esse status hoje);
// 2+ entradas -> 'waived' só se TODAS forem waived, 'observed' se todas resolvidas mas nem
// todas waived (mistura observed+waived conta como observed — a política de waiver de cada
// entrada dispensada já foi verificada individualmente), senão 'pending'.
export function deriveTopStatus(entries) {
  if (!entries.length) return 'pending';
  if (entries.length === 1) return entries[0].status;
  if (entries.every(resolvedEntry)) return entries.every((e) => e.status === 'waived') ? 'waived' : 'observed';
  return 'pending';
}

// computeProjection: a ÚNICA função pura que deriva os escalares do topo a partir de
// entries[] (item 3 do redesenho) — usada por TODA escrita (red-evidence-ops.mjs,
// check-red-first.mjs) e por `topMatchesProjection` abaixo para detectar adulteração. Os
// escalares (test_path, excerpt, ...) são sempre os de entries[0] — a primeira entrada
// declarada, nunca a última tocada — mantendo um leitor antigo (que só lê o topo) vendo o mesmo
// conteúdo que via antes desta Onda quando o change tem uma única entrada.
export function computeProjection(changeId, entries) {
  const first = entries[0] || emptyEntry(null);
  const doc = { schema: 'red-evidence/v1', change_id: changeId, status: deriveTopStatus(entries) };
  for (const k of ENTRY_SCALAR_FIELDS) doc[k] = first[k] ?? null;
  doc.fix_files = Array.isArray(first.fix_files) ? first.fix_files : [];
  doc.waiver = first.waiver ?? null;
  doc.entries = entries;
  return doc;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(a[k], b[k]));
}

// topMatchesProjection: item 4 do redesenho — um topo que não bate com a projeção FRESCA de
// entries[] é tratado como adulteração. Só se aplica quando existe ao menos 1 entrada: com 0
// entradas (scaffold nunca gravado), o topo é o que o template escaffoldou (ex.: `reproduces`
// com o default estático "bugfix.md §1") e não há projeção alguma para comparar ainda — exigir
// igualdade aqui reprovaria todo change bugfix recém-criado, antes de qualquer `record`.
export function topMatchesProjection(data, entries) {
  if (!entries.length) return true;
  // Correção da #139 (revisão adversarial, achado MEDIUM): sem `entries[]` no arquivo BRUTO, o
  // topo é a ÚNICA fonte — `entries` aqui é só `extractEntryFromTop(data)` (deriveEntries), uma
  // projeção do próprio `data`, nunca uma segunda declaração independente. Comparar as duas era
  // comparar `data` contra si mesmo através de uma normalização que zera campos ausentes de forma
  // diferente da representação crua (ex.: `fix_files` ausente no topo é `undefined` -> `null` na
  // comparação, mas `computeProjection` sempre normaliza para `[]`): todo legado escrito à mão
  // (w106/w144) sem a chave `fix_files` virava "adulterado" para sempre, mesmo depois de um
  // `waive` genuinamente válido (nem `waive` nem `ensure` gravam `fix_files` no caminho legado).
  if (!Array.isArray(data.entries)) return true;
  const projection = computeProjection(data.change_id, entries);
  const keys = ['status', ...ENTRY_SCALAR_FIELDS, 'fix_files', 'waiver'];
  return keys.every((k) => deepEqual(data[k] ?? null, projection[k] ?? null));
}

// resolveEntryId: endereçamento COMPARTILHADO por replay/waive (item 5 do redesenho) — decide,
// ANTES de qualquer efeito colateral, qual `id` de `entries[]` um comando explícito afeta: por
// `--id` quando declarado (entrada precisa existir), ou o id da entrada única quando o change
// tem exatamente 1 (fluxo comum, `--id` opcional). Nunca cria entrada — isso é exclusivo de
// `record`. Como toda entrada tem id não nulo (item 2), este endereçamento nunca esbarra numa
// entrada sem nome: `entries[]` normalizado por `deriveEntries` é a única entrada esperada aqui.
export function resolveEntryId(entries, flags) {
  const hasId = flags && flags.id !== undefined;
  if (hasId) {
    const idx = entries.findIndex((e) => e.id === flags.id);
    if (idx < 0) {
      const ids = entries.map((e) => e.id).join(', ') || '(nenhuma)';
      return { ok: false, reason: `id não encontrado: ${flags.id} (entradas: ${ids})` };
    }
    return { ok: true, id: flags.id, index: idx };
  }
  if (entries.length === 0) return { ok: false, reason: 'nenhuma entrada registrada — rode /forge:red record antes' };
  if (entries.length >= 2) {
    const ids = entries.map((e) => e.id).join(', ');
    return { ok: false, reason: `--id é obrigatório — este change tem ${entries.length} entradas registradas (${ids}); declare a qual defeito este comando se refere` };
  }
  return { ok: true, id: entries[0].id, index: 0 };
}

// loadRedEvidence(changeDir): { path, exists, data, errors, entries, tampered }. Ausente ⇒
// exists:false, data:null, errors:[], entries:[], tampered:false (não é erro — status implícito
// é "sem evidência", tratado pelo caller). Malformado (JSON inválido, enum/tipo inválido) ⇒
// exists:true, data:null|raw, errors com a(s) mensagem(ns) — isso SIM bloqueia `record`/`replay`/
// `ensure` (requireEvidence), porque não há como calcular `entries[]` de dado estruturalmente
// incoerente. `entries` é SEMPRE a versão normalizada (deriveEntries) quando `data` é
// estruturalmente válido — entries[] é a única fonte de verdade (item 1 do redesenho): todo
// caller opera sobre `entries`, nunca sobre os escalares de `data` diretamente para decidir o
// que fazer. `tampered` é DELIBERADAMENTE separado de `errors`: um topo que diverge da projeção
// fresca de `entries[]` (item 4 — adulteração) não impede `record`/`replay`/`ensure` de operar
// sobre `entries[]` e regravar o topo correto como efeito colateral (autocura pela própria
// escrita) — só `check-red-first.mjs` (avaliação estática, nunca escreve) trata `tampered` como
// achado bloqueante, porque é o único caminho que roda sem nunca reexecutar nada por trás.
export function loadRedEvidence(changeDir) {
  const path = join(resolve(changeDir), REL_PATH);
  if (!existsSync(path)) return { path, exists: false, data: null, errors: [], entries: [], tampered: false };
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { path, exists: true, data: null, errors: [`red-evidence.json: parse error (${e.message})`], entries: [], tampered: false }; }
  const errors = validateRedEvidence(data);
  if (errors.length) return { path, exists: true, data, errors, entries: [], tampered: false };
  const entries = deriveEntries(data);
  const tampered = !topMatchesProjection(data, entries);
  return { path, exists: true, data, errors, entries, tampered };
}

// isResolved: contrato literal da rule/validate-spec — "não estiver 'observed' nem
// 'waived'" bloqueia verified. 'not-possible' e 'pending' NÃO contam como resolvidos
// (not-possible é estado transitório; o caminho normativo para Red inviável é
// /forge:red waive, que grava status:'waived').
export function isResolved(data) {
  return !!data && (data.status === 'observed' || data.status === 'waived');
}
