#!/usr/bin/env node
// lib/red-evidence-ops.mjs — orquestração dos subcomandos `record` e `replay` de
// red-evidence.sh (Onda C). `status` e `waive` NÃO vivem aqui: são delegados por
// red-evidence.sh direto a check-red-first.sh (Onda B) — mesma política, uma fonte só.
//
//   record <change-dir> --test-path <p> --command <c> --failure-pattern <p> [--test-id <id>]
//          [--fix-files a,b,c] [--setup-command <c>] [--positive-control <c>]
//          [--reproduces <txt>] [--excerpt <txt>]
//     Declara a intenção (test_path/command/failure_pattern/fix_files/...). NUNCA marca
//     status:'observed' — essa transição só acontece via `replay` bem-sucedido (é o ponto
//     central da Onda C: sem replay, a evidência é só uma declaração que o agente pode
//     fabricar). Sempre grava status:'pending' e limpa replayed_at/replay_head (uma nova
//     declaração invalida qualquer replay anterior). failure_pattern é OBRIGATÓRIO (Furo 10 —
//     sem ele, o item 4 da rule nunca é avaliável; opcional era o mesmo que ausente).
//
//   replay <change-dir> [--id <defeito>] [--timeout <segundos>]
//     Chama lib/red-replay.mjs sobre os dados já declarados. Três desfechos:
//       observed     -> grava status/base_commit/base_strategy/classification/excerpt/
//                        excerpt_sha256/base_result/replayed_at/replay_head (Furo 1 — replay_head
//                        é o sha do HEAD no momento do replay; metadado informativo, NENHUM
//                        caminho de decisão o lê — ver Onda E abaixo).
//       fail         -> NUNCA deixa um status:'observed' falso: volta para 'pending' (com o
//                        excerpt/classification da tentativa, para diagnóstico) e imprime o
//                        item da rule que falhou. exit 1.
//       not-possible -> grava status:'not-possible' (não conta como resolvido — check-red-first
//                        Onda B continua bloqueando até /forge:red waive). exit 1.
//
// Onda E (decisão do orquestrador) — elimina o cache local de replay (lib/red-replay-cache.mjs,
// removido): duas rodadas de auditoria mostraram que qualquer atalho de custo baseado em estado
// local (campo do artefato, depois cache local) vira, cedo ou tarde, o alvo que os próprios
// gates passam a exigir para aprovar — inclusive evidência fabricada. A partir desta Onda,
// `ensure` executa o replay SEMPRE, sem cache-check algum: o único atalho é `status: 'waived'`
// (política própria, não observação de Red pendente — ver cmdEnsure). Isso tem custo real (mede
// no comentário de cmdEnsure abaixo) — aceito deliberadamente em troca de eliminar (a) o furo do
// cache versionável em projetos que instalaram o harness antes do patch do .gitignore e (b) o
// livelock relatado quando o cache invalidava por motivo alheio ao conteúdo do teste/correção.
//
// Onda #139, redesenho de causa raiz (4ª rodada de correção) — `entries[]` (lib/red-evidence.mjs)
// é a ÚNICA fonte da verdade: `applyRecord` sempre opera sobre `deriveEntries(...)` (nunca sobre
// os escalares do topo), toda entrada tem `id` não nulo e estável (auto-gerado — `nextAutoId` —
// quando o change tem 0 entradas e `record` não declara `--id`; migrado na leitura quando o
// arquivo já tem uma entrada sem nome, legado ou não), e os escalares do topo são recalculados
// por `computeProjection` a cada escrita. `--rename-null` foi REMOVIDO: existia só para nomear
// uma entrada que nascia sem id — no modelo novo toda entrada já nasce com id, então nunca há
// nada para renomear.
import { existsSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseYamlSubset } from './yaml-lite.mjs';
import {
  loadRedEvidence, REL_PATH, ENTRY_SCALAR_FIELDS,
  emptyEntry, deriveEntries, computeProjection, deriveTopStatus, nextAutoId, resolveEntryId,
} from './red-evidence.mjs';
import { replay as runReplay, replayTask } from './red-replay.mjs';
import { isDefectFixing } from './defect-scope.mjs';

const root = resolve(process.env.FORGE_ROOT || '.');

function readManifest(changeDir) {
  const p = join(resolve(changeDir), 'manifest.yaml');
  if (!existsSync(p)) return null;
  try { return parseYamlSubset(readFileSync(p, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(path, obj) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

function nowIso() { return new Date().toISOString(); }

function sha256(s) { return createHash('sha256').update(String(s)).digest('hex'); }

function truncate(s, max = 6000) {
  const text = String(s || '');
  return text.length <= max ? text : `…(truncado — ${text.length} chars)…\n${text.slice(-max)}`;
}

function requireDefectFixing(changeDir) {
  const man = readManifest(changeDir);
  if (!man) { console.log('FAIL (manifest.yaml ausente/ilegível)'); process.exit(1); }
  if (!isDefectFixing(man)) { console.log(`FAIL (red-evidence só se aplica a change sujeito ao red-first — type:bugfix ou fixes_defects declarado, got type: ${man.type})`); process.exit(1); }
  return man;
}

function requireEvidence(changeDir) {
  const ev = loadRedEvidence(changeDir);
  if (!ev.exists) { console.log(`FAIL (${REL_PATH} ausente — se este change já existe, rode 'red-evidence.sh init <change-id>' para escaffoldar; para um change novo, use /forge:spec new --type bugfix)`); process.exit(1); }
  if (ev.errors.length) { console.log(`FAIL (${REL_PATH} inválido: ${ev.errors.join('; ')})`); process.exit(1); }
  return ev;
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

// hasFlagWithValue: distingue "--id não foi passado" de "--id foi passado sem valor utilizável"
// (achado MEDIUM da correção da #139) — `parseFlags` sozinho não faz essa distinção: com `--id`
// como último token, ou seguido de outra flag (`--id --test-path ...`), `flags.id` vira
// `undefined` OU o texto da flag seguinte, e o chamador degradava em silêncio para o caminho
// "sem --id" (record atualiza a entrada errada) em vez de recusar. Vazio (`--id ""`) é o mesmo
// buraco com outro sintoma (cria uma entrada com id vazio).
function hasFlagWithValue(argv, name, value) {
  if (!argv.includes(`--${name}`)) return true; // flag ausente — nada a validar aqui
  return typeof value === 'string' && value.length > 0 && !value.startsWith('--');
}

// applyRecord: pura (sem I/O) — usada por cmdRecord e pelo PBT do gate w218. Lança Error com a
// mensagem de FAIL em vez de decidir exit code (isso é responsabilidade do caller). Opera SEMPRE
// sobre `deriveEntries(prevData)` (entries[] normalizado, ids nunca nulos) — nunca sobre os
// escalares do topo.
//
// Endereçamento (redesenho de causa raiz da #139, 4ª rodada):
//   --id declarado         -> endereça (ou cria) a entrada daquele id; SEMPRE marca
//                              `id_explicit: true` (mesmo promovendo uma entrada auto-nomeada).
//   0 entradas, sem --id   -> cria a PRIMEIRA entrada com um id AUTO-GERADO e estável
//                              (`nextAutoId` — 'd1', 'd2', ...; `id_explicit: false`), nunca
//                              `id: null` — é isso que torna toda entrada sempre endereçável por
//                              `replay --id`/`waive --id`, mesmo quando o autor nunca escolheu um
//                              nome (item 2 do redesenho).
//   1 entrada, sem --id,
//   id AINDA auto (não
//   `id_explicit`)         -> atualiza essa mesma entrada (fluxo comum, retrocompatível: um
//                              change de defeito único nunca precisa de `--id`).
//   1 entrada, sem --id,
//   id JÁ `id_explicit`    -> RECUSA (fail-closed): a entrada já foi nomeada de propósito, e um
//                              record sem --id a partir daqui seria tão ambíguo quanto com 2+.
//   2+ entradas, sem --id  -> RECUSA sempre (fail-closed contra quimera — o próprio defeito
//                              original da issue).
export function applyRecord(prevData, changeId, flags) {
  const entries = deriveEntries(prevData || {});
  const hasId = flags.id !== undefined;

  let idx = -1;
  let targetId;
  let explicit;

  if (hasId) {
    targetId = flags.id;
    idx = entries.findIndex((e) => e.id === targetId);
    explicit = true;
  } else if (entries.length === 0) {
    targetId = nextAutoId(new Set());
    explicit = false;
  } else if (entries.length === 1 && !entries[0].id_explicit) {
    targetId = entries[0].id;
    idx = 0;
    explicit = false;
  } else if (entries.length === 1) {
    throw new Error(`--id é obrigatório — a entrada registrada já tem id declarado (${entries[0].id}); use --id ${entries[0].id} para atualizá-la, ou um --id novo para declarar outro defeito`);
  } else {
    const ids = entries.map((e) => e.id).join(', ');
    throw new Error(`--id é obrigatório — este change já tem ${entries.length} entradas registradas (${ids}); declare a qual defeito este record se refere`);
  }

  const target = idx >= 0 ? { ...entries[idx] } : emptyEntry(targetId);
  target.id = targetId;
  target.id_explicit = explicit;

  if (flags['test-path']) target.test_path = flags['test-path'];
  if (flags['test-id']) target.test_id = flags['test-id'];
  if (flags['command']) target.command = flags['command'];
  if (flags['fix-files']) target.fix_files = flags['fix-files'].split(',').map((s) => s.trim()).filter(Boolean);
  if (flags['failure-pattern']) target.failure_pattern = flags['failure-pattern'];
  if (flags['setup-command']) target.setup_command = flags['setup-command'];
  if (flags['positive-control']) target.positive_control = flags['positive-control'];
  if (flags['reproduces']) target.reproduces = flags['reproduces'];
  if (flags['excerpt']) {
    target.excerpt = flags['excerpt'];
    target.excerpt_sha256 = sha256(flags['excerpt']);
  }

  // Furo 10 — failure_pattern obrigatório: sem ele o item 4 da rule nunca é avaliável (a
  // ausência do campo desliga o gate silenciosamente, indistinguível de "não se aplica").
  // Onda D, item 3 — test_id agora TAMBÉM obrigatório: sem ele, a derivação de base (ancestry)
  // volta a ancorar na criação do ARQUIVO de teste (não do CASO), e os guardas
  // caseExistsInContent/outputMentionsCase do motor de replay (Furo 2) passam por vacuidade —
  // "sem test_id declarado, nada a exigir" deixa de ser uma degradação aceitável quando test_id
  // é obrigatório por contrato.
  if (!target.test_path || !target.test_id || !target.command || !target.failure_pattern) {
    throw new Error('--test-path, --test-id, --command e --failure-pattern são obrigatórios para record');
  }
  if (!Array.isArray(target.fix_files)) target.fix_files = [];

  // record é DECLARAÇÃO, não observação — o replay é quem prova. Uma nova declaração invalida
  // qualquer replay anterior (o teste/comando declarado pode ter mudado).
  target.status = 'pending';
  target.replayed_at = null;
  target.replay_head = null;
  target.recorded_at = nowIso();

  const nextEntries = entries.slice();
  if (idx >= 0) nextEntries[idx] = target; else nextEntries.push(target);

  return { data: computeProjection(changeId, nextEntries), entry: target };
}

function cmdRecord(changeDir, argv) {
  requireDefectFixing(changeDir);
  const ev = requireEvidence(changeDir);
  const f = parseFlags(argv);

  if (!hasFlagWithValue(argv, 'id', f.id)) {
    console.log('FAIL (--id exige um valor não vazio e que não comece com "--" — sem isso o record degradaria em silêncio para o caminho sem --id)');
    process.exit(1);
  }

  let result;
  try {
    result = applyRecord(ev.data, ev.data.change_id, f);
  } catch (e) {
    console.log(`FAIL (${e.message})`);
    process.exit(1);
  }

  writeJsonAtomic(ev.path, result.data);
  console.log(`OK record — ${result.entry.test_path} declarado (status: pending — rode /forge:red replay para observar)`);
}

// upsertSingleEntry: escrita compartilhada por `replay`/`ensure`/`waive` (check-red-first.mjs).
// `!Array.isArray(prevData.entries)` (checagem sobre o dado BRUTO, nunca `deriveEntries`) sinaliza
// um `red-evidence.json` que nunca passou por `record` desta Onda — legado de verdade, ou o
// scaffold nunca gravado — e o CALLER mantém o caminho de escrita no topo tal como antes desta
// Onda (`legacy:true`): nem `ensure`/`replay`/`waive` introduzem `entries[]` em arquivo legado só
// por rodar — isso seria uma migração de formato silenciosa disparada por toda chamada de rotina
// de /forge:verify e /forge:archive, fora do escopo desta issue (o escopo dela é `record`). É
// também o que preserva a superfície de detecção de forja de w106/w107 [3-FORJA]: o TOPO só é
// vetor de replay no legado de verdade (arquivo sem a chave `entries[]`); com `entries[]` presente
// no arquivo bruto — mesmo com 0 ou 1 entrada —, `ensure` sempre replaya `projectEntryToFlat` de
// cada entrada não dispensada (`entries[0]` isolada, ou cada uma, com 2+) e endereça a escrita por
// id — ver comentário de `cmdEnsure` — e o resultado é gravado aqui.
//
// Com `entries[]` já presente (qualquer `record` desta Onda já rodou), a escrita SEMPRE endereça
// por id via `resolveEntryId` — toda entrada tem id não nulo e estável (redesenho da #139), então
// esta função nunca mais esbarra numa entrada sem nome para adivinhar.
export function upsertSingleEntry(prevData, changeId, patchEntry, opts) {
  const data = prevData || {};
  if (!Array.isArray(data.entries)) return { legacy: true, refused: false };
  const entries = deriveEntries(data);
  const resolved = resolveEntryId(entries, opts && opts.id !== undefined ? { id: opts.id } : {});
  if (!resolved.ok) return { legacy: false, refused: true, reason: resolved.reason, count: entries.length };
  const merged = patchEntry({ ...entries[resolved.index] });
  const nextEntries = entries.slice();
  nextEntries[resolved.index] = merged;
  return { legacy: false, refused: false, data: computeProjection(changeId, nextEntries) };
}

// resolveTargetEntry: endereçamento para `replay` explícito — por `--id` quando declarado, ou a
// única entrada quando o change tem `entries[]` de tamanho 1 (fluxo retrocompatível, sem --id).
// `legacy:true` sinaliza arquivo sem `entries[]` (nunca migrado por um record desta Onda) — o
// caller mantém o caminho de leitura/escrita no topo tal como antes desta Onda.
function resolveTargetEntry(data, flags) {
  if (!Array.isArray(data.entries)) return { legacy: true };
  const entries = deriveEntries(data);
  const resolved = resolveEntryId(entries, flags);
  if (!resolved.ok) return { refused: true, reason: resolved.reason };
  return { entry: entries[resolved.index] };
}

// projectEntryToFlat: projeta UMA entrada de entries[] no formato "achatado" que
// lib/red-replay.mjs consome (os mesmos campos que hoje moram no topo) — permite rodar o motor
// de replay sobre uma entrada ESPECÍFICA, condição necessária para replay/ensure por entrada.
function projectEntryToFlat(changeId, entry) {
  const doc = { schema: 'red-evidence/v1', change_id: changeId, status: entry.status };
  for (const k of ENTRY_SCALAR_FIELDS) doc[k] = entry[k] ?? null;
  doc.fix_files = Array.isArray(entry.fix_files) ? entry.fix_files : [];
  doc.waiver = entry.waiver ?? null;
  return doc;
}

// persistReplayResult: único ponto que TRADUZ um veredito do motor de replay (lib/red-replay.mjs)
// em escrita do red-evidence.json, usado tanto por `replay` (explícito) quanto por `ensure`
// (chamado incondicionalmente por spec-verify.sh/archive-spec.sh/validate-spec.mjs). Fonte
// única — sem isso, os dois caminhos podiam divergir em como gravam status/campos.
function persistReplayResult(ev, data, result, opts) {
  // base_strategy/revert_patch são resetados aqui e só voltam a ser gravados no ramo 'observed'
  // abaixo — sem isso, um replay que falha DEPOIS de um replay 'observed' anterior deixaria
  // base_strategy/revert_patch de uma tentativa antiga (e potencialmente inválida) lingerindo na
  // evidência, confundindo quem ler o JSON. replayed_at/replay_head permanecem como metadado
  // INFORMATIVO (quando o último replay rodou, sobre qual HEAD) — nenhum caminho de decisão em
  // check-red-first.mjs lê esses dois campos para concluir 'observed' (Onda D: a prova mora na
  // execução — cache local ou o próprio replay ao vivo — não no artefato).
  // graft_from acompanha base_strategy no reset: é o par que explica de onde veio a árvore base,
  // e um graft_from remanescente de uma tentativa anterior descreveria uma base que não é a desta.
  const patch = { replayed_at: nowIso(), replay_head: result.replay_head || null, base_strategy: null, revert_patch: null, graft_from: null };

  if (result.verdict === 'observed') {
    patch.status = 'observed';
    patch.base_commit = result.base_commit || null;
    patch.base_strategy = result.base_strategy || null;
    patch.classification = result.classification || null;
    patch.excerpt = truncate(result.excerpt);
    patch.excerpt_sha256 = sha256(patch.excerpt);
    patch.base_result = result.base_result || 'failed';
    patch.revert_patch = result.revert_patch || null;
    patch.graft_from = result.graft_from || null;
  } else if (result.verdict === 'not-possible') {
    patch.status = 'not-possible';
    if (result.diagnostic) {
      patch.excerpt = truncate(result.diagnostic.excerpt);
      patch.excerpt_sha256 = sha256(patch.excerpt);
      patch.classification = result.diagnostic.classification || null;
    }
  } else {
    // fail — nunca deixa um status:'observed' falso na árvore; volta para pending com o
    // diagnóstico da tentativa anexado (útil para o próximo replay).
    patch.status = 'pending';
    patch.base_result = result.base_result || null;
    if (result.base) patch.base_strategy = result.base.strategy || null;
    if (result.diagnostic) {
      patch.excerpt = truncate(result.diagnostic.excerpt);
      patch.excerpt_sha256 = sha256(patch.excerpt);
      patch.classification = result.diagnostic.classification || null;
    }
  }

  const upsert = upsertSingleEntry(data, data.change_id, (entry) => ({ ...entry, ...patch }), opts);
  if (upsert.refused) return { refused: true, count: upsert.count, reason: upsert.reason };
  const updated = upsert.legacy ? { ...data, ...patch } : upsert.data;
  writeJsonAtomic(ev.path, updated);
  return { data: updated };
}

// cmdReplay — aceita `--id <id>` para endereçar qual entrada de entries[] este replay observa.
// Sem --id, só 0/1 entrada é aceitável (fluxo retrocompatível). A resolução (`resolveTargetEntry`)
// roda ANTES de chamar o motor de replay — sem isso, um change ambíguo pagava worktree+execução
// de teste só para descartar o resultado no fim.
async function cmdReplay(changeDir, argv) {
  requireDefectFixing(changeDir);
  const ev = requireEvidence(changeDir);
  const data = ev.data;
  const f = parseFlags(argv);

  if (!hasFlagWithValue(argv, 'id', f.id)) {
    console.log('FAIL (--id exige um valor não vazio e que não comece com "--")');
    process.exit(1);
  }

  const resolved = resolveTargetEntry(data, f);
  if (resolved.refused) {
    console.log(`FAIL (replay recusado — ${resolved.reason}. Nada foi escrito.)`);
    process.exit(1);
  }
  const legacyMode = !!resolved.legacy;
  const view = legacyMode ? data : projectEntryToFlat(data.change_id, resolved.entry);
  if (!view.test_path || !view.command) {
    console.log('FAIL (test_path/command ausentes — rode /forge:red record antes de replay)');
    process.exit(1);
  }

  const timeoutS = f.timeout ? parseInt(f.timeout, 10) : undefined;
  const result = await runReplay({ root, evidence: view, timeoutS });
  const persisted = persistReplayResult(ev, data, result, legacyMode ? undefined : { id: resolved.entry.id });
  if (persisted.refused) {
    // inalcançável em condições normais — resolveTargetEntry já filtrou a ambiguidade acima;
    // mantido fail-closed (defesa em profundidade) contra uma corrida entre a resolução e a
    // escrita (outro processo alterando entries[] no meio do replay, que é CARO — roda teste
    // de verdade).
    console.log(`FAIL (replay recusado — ${persisted.reason || 'a entrada mudou entre a resolução e a escrita'}. Nada foi escrito.)`);
    process.exit(1);
  }

  if (result.verdict === 'observed') {
    console.log(`OK replay — Red observado (${result.strategy}, base ${result.base_commit ? String(result.base_commit).slice(0, 7) : '?'}) e Green confirmado em HEAD`);
    return;
  }
  if (result.verdict === 'not-possible') {
    console.log(`NOT-POSSIBLE replay — ${result.reason} (grave /forge:red waive --reason <motivo> para prosseguir)`);
    process.exit(1);
  }
  console.log(`FAIL replay (item ${result.ruleItem}) — ${result.reason}`);
  process.exit(1);
}

// cmdEnsure — chamado INCONDICIONALMENTE por spec-verify.sh, pelo pré-flight de archive-spec.sh
// e por validate-spec.mjs (na transição para verified), para todo change type:bugfix. Onda E —
// SEM cache: `ensure` executa o motor de replay de verdade toda vez que roda (o único atalho que
// resta é o status agregado 'waived', que é política própria, não observação de Red pendente de
// prova). O custo é real e proporcional ao teste declarado (um `npx vitest run <arquivo>`/`node
// --test <arquivo>` típico, não a suíte inteira) — pago a cada /forge:verify e a cada
// /forge:archive. Nunca sai com rc≠0 por um veredito desfavorável — quem decide bloquear é
// check-red-first.mjs, que roda em seguida e lê o que ESTA chamada acabou de gravar. rc≠0 aqui é
// reservado a erro de setup genuíno (manifest ilegível).
//
// Redesenho de causa raiz da #139 (5ª rodada, modelo final): `entries[]` no arquivo bruto é o
// sinal de que o TOPO deixou de ser vetor de replay — `data.entries` presente e vazio (scaffold
// ou topo legado ainda preenchido sem nenhuma entrada declarada) sai limpo, sem tocar o motor de
// replay (`check-red-first.mjs` cobre a ausência de declaração); com 1 entrada, `ensure` replaya
// SEMPRE `projectEntryToFlat(entries[0])` e endereça a escrita por id — nunca mais o TOPO bruto —,
// o que fecha o furo MEDIUM da revisão adversarial (w218): tratar um `entries[]` vazio como o
// mesmo caso de "≤1 entrada, replay pelo topo" caía no ramo de legado com um topo possivelmente
// incompleto, produzindo TypeError ou um replay espúrio. O TOPO só continua sendo a ÚNICA fonte no
// legado de verdade — arquivo sem a chave `entries[]` —, onde não existe segunda fonte para
// divergir (`extractEntryFromTop`, `deriveEntries`); é esse caso, e só ele, que preserva a
// detecção de forja de w106/w107 [3-FORJA]. Com 2+ entradas, o topo é ambíguo (só reflete
// entries[0]) e `ensure` ITERA cada entrada não dispensada (`status !== 'waived'`), replayando a
// projeção de CADA UMA — como toda entrada tem id não nulo (item 2 do redesenho da 4ª rodada), o
// endereçamento nunca mais recusa por "entrada sem nome" (o furo HIGH-1/HIGH-2 medido na 3ª
// rodada de correção: uma entrada com `id: null` era pulada em silêncio pelo laço, e sua forja
// sobrevivia porque `persistReplayResult` nunca conseguia escrever nela).
async function cmdEnsure(changeDir, argv) {
  const man = readManifest(changeDir);
  if (!man) { console.log('FAIL (manifest.yaml ausente/ilegível)'); process.exit(1); }
  if (!isDefectFixing(man)) { console.log(`OK ensure (n/a — type: ${man.type})`); return; }

  const ev = loadRedEvidence(changeDir);
  if (!ev.exists) { console.log('OK ensure (evidência ausente — nada a garantir; check-red-first cobre o item 1)'); return; }
  if (ev.errors.length) { console.log(`OK ensure (evidência inválida: ${ev.errors.join('; ')} — check-red-first cobre)`); return; }
  const data = ev.data;
  const entries = ev.entries;

  const f = parseFlags(argv);
  const timeoutS = f.timeout ? parseInt(f.timeout, 10) : undefined;

  // o topo NUNCA é lido como fonte (item 3/4 do redesenho) — mesmo este atalho barato decide por
  // `deriveTopStatus(entries)`, nunca por `data.status` bruto, para não deixar um topo adulterado
  // ('waived' forjado) pular o replay inteiro em silêncio.
  if (deriveTopStatus(entries) === 'waived') { console.log("OK ensure — status: waived (nada a replayar)"); return; }

  // Correção da #139 (revisão adversarial, achado MEDIUM, w218): `entries: []` no arquivo bruto
  // (scaffold recém-criado por `record`, ou topo legado ainda preenchido sem nenhuma entrada
  // declarada) é um `entries[]` VAZIO, não um legado — `data.entries` já é array, então o ramo de
  // legado abaixo (que assume o TOPO como única fonte) nunca deveria ser alcançado neste caso; sem
  // esta guarda, `entries.length <= 1` era verdadeiro, mas nada em `entries[]` havia para replayar
  // e o fluxo caía no ramo de legado tratando um topo possivelmente incompleto como declaração de
  // teste, produzindo TypeError ou um replay espúrio. `check-red-first.mjs` já cobre a ausência de
  // declaração (item 1 da rule); aqui só precisamos sair limpo, sem tocar o motor de replay.
  if (Array.isArray(data.entries) && data.entries.length === 0) {
    console.log('OK ensure (entries[] vazio — nada a replayar; check-red-first cobre)');
    return;
  }

  if (entries.length <= 1) {
    // Correção da #139 (revisão adversarial, achado HIGH): com `entries[]` presente (o change já
    // passou por um `record` desta Onda), `entries[0]` é a ÚNICA fonte da verdade — replayar o
    // TOPO em vez da entrada permitia que uma forja isolada em `entries[0]` (uma declaração que
    // nunca reproduz nada) fosse lavada para 'observed': `ensure` reexecutava o teste genuíno
    // ainda declarado no topo intacto e `persistReplayResult`/`upsertSingleEntry` gravavam esse
    // veredito legítimo NA ENTRADA forjada (endereçamento por índice único, sem — até aqui —
    // conferir se a entrada concorda com o que foi de fato executado). O topo bruto como vetor
    // de replay fica exclusivo do legado de verdade, sem `entries[]` no arquivo — ali não existe
    // segunda fonte: o próprio topo É a entrada (`extractEntryFromTop`, `deriveEntries`).
    if (Array.isArray(data.entries) && entries.length > 0) {
      const entry = entries[0];
      const view = projectEntryToFlat(data.change_id, entry);
      const result = await runReplay({ root, evidence: view, timeoutS });
      const persisted = persistReplayResult(ev, data, result, { id: entry.id });
      if (persisted.refused) {
        // inalcançável em condições normais desde que toda entrada tenha id não nulo (redesenho
        // da #139) — mesmo tratamento fail-closed do laço de 2+ entradas abaixo (defesa em
        // profundidade contra uma corrida com outro processo escrevendo entries[] no meio do
        // replay); sem esta checagem, `persisted.data` é `undefined` aqui e o acesso a
        // `.status` estourava TypeError em vez de reportar a recusa.
        console.log(`OK ensure — entrada ${entry.id}: replay recusado (${persisted.reason}); nada escrito para ela`);
        return;
      }
      console.log(`OK ensure — replay executado (verdict: ${result.verdict}, status: ${persisted.data.status})`);
      return;
    }

    // legado de verdade (sem `entries[]` no arquivo bruto): o topo é a ÚNICA fonte.
    const result = await runReplay({ root, evidence: data, timeoutS });
    const persisted = persistReplayResult(ev, data, result);
    console.log(`OK ensure — replay executado (verdict: ${result.verdict}, status: ${persisted.data.status})`);
    return;
  }

  let current = data;
  let replayed = 0;
  let skippedWaived = 0;
  let skippedIncomplete = 0;
  for (const entry of entries) {
    if (entry.status === 'waived') { skippedWaived++; continue; }
    const view = projectEntryToFlat(current.change_id, entry);
    if (!view.test_path || !view.command) { skippedIncomplete++; continue; }
    // eslint-disable-next-line no-await-in-loop -- LDG-0232: cada entrada é UM teste real,
    // deliberadamente sequencial (mesmo espírito do "sem cache" da Onda E: custo proporcional,
    // nunca paralelo demais para o replay efêmero em worktree git que lib/red-replay.mjs já usa).
    const result = await runReplay({ root, evidence: view, timeoutS });
    const persisted = persistReplayResult(ev, current, result, { id: entry.id });
    if (persisted.refused) {
      // inalcançável em condições normais desde que toda entrada tenha id não nulo (redesenho da
      // #139) — mantido fail-closed contra uma corrida com outro processo escrevendo entries[]
      // no meio do laço.
      console.log(`OK ensure — entrada ${entry.id}: replay recusado (${persisted.reason}); nada escrito para ela`);
      continue;
    }
    current = persisted.data;
    replayed++;
  }
  console.log(`OK ensure — ${replayed} entrada(s) replayada(s), ${skippedWaived} dispensada(s), ${skippedIncomplete} incompleta(s) (status do topo: ${current.status})`);
}

// cmdTask (issue #156): vermelho/verde de uma TASK delegada, por execução — enxerto do teste do
// verde, infraestrutura intocada no vermelho e topologia, ver replayTask em red-replay.mjs. Sem
// change-id e sem artefato: o veredito é o rc e a linha impressa. Flags
// estritas — desconhecida ou sem valor recusa; o valor é literal (um failure-pattern pode começar
// com "--", ex.: "--- FAIL:" do Go).
async function cmdTask(taskRoot, argv) {
  const known = new Set(['red', 'green', 'task-base', 'task-id', 'command', 'failure-pattern', 'setup-command', 'timeout']);
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (!name || !known.has(name)) { console.log(`FAIL task [entrada] argumento desconhecido: ${a}`); process.exit(1); }
    if (i + 1 >= argv.length) { console.log(`FAIL task [entrada] --${name} sem valor`); process.exit(1); }
    f[name] = argv[++i];
  }
  let timeoutS;
  if (f.timeout !== undefined) {
    timeoutS = Number(f.timeout);
    if (!Number.isInteger(timeoutS) || timeoutS < 1) { console.log(`FAIL task [entrada] --timeout inválido: ${f.timeout}`); process.exit(1); }
  }
  const res = await replayTask({
    root: resolve(taskRoot), red: f.red, green: f.green || null,
    taskBase: f['task-base'] || null, taskId: f['task-id'] || null, command: f.command,
    failurePattern: f['failure-pattern'], setupCommand: f['setup-command'] || null,
    ...(timeoutS ? { timeoutS } : {}),
  });
  if (res.ok) { console.log(`OK task — ${res.reason}`); process.exit(0); }
  console.log(`FAIL task [${res.code}] ${res.reason}`);
  if (res.excerpt) console.log(res.excerpt.split('\n').slice(-15).map((l) => `  | ${l}`).join('\n'));
  process.exit(1);
}

// ── main guard (mesmo padrão de sync-adapters.mjs, issue #130/w216) ────────────────────────────
// Sem isto, `import { applyRecord } from './red-evidence-ops.mjs'` (o que o PBT do gate w218 e
// qualquer leitor futuro de `applyRecord` precisam fazer) executava o bloco de dispatch abaixo
// como efeito colateral do import — `!cmd` seria verdadeiro (import não passa argv de CLI) e o
// processo importador morria com `process.exit(1)` antes de expor coisa alguma.
function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const [, , cmd, changeDir, ...rest] = process.argv;
  if (!cmd || !changeDir) {
    console.log('FAIL (usage: red-evidence-ops.mjs record|replay|ensure <change-dir> [...] | task <root> --red <sha> [...])');
    process.exit(1);
  }
  switch (cmd) {
    case 'record': cmdRecord(changeDir, rest); break;
    case 'replay': await cmdReplay(changeDir, rest); break;
    case 'ensure': await cmdEnsure(changeDir, rest); break;
    case 'task': await cmdTask(changeDir, rest); break;
    default: console.log(`FAIL (unknown subcommand: ${cmd})`); process.exit(1);
  }
}
