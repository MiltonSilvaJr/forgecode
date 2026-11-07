#!/usr/bin/env node
// forge check-red-first (Onda B/D, rule testing/regression-red-first.md) — verificação
// ESTÁTICA do protocolo Red-first em change type:bugfix: NENHUM teste é executado aqui
// (isso é o replay — lib/red-replay.mjs, disparado por `red-evidence.sh replay|ensure`, nunca
// por este arquivo). Este script lê os dados JÁ REGISTRADOS em evidence/red/red-evidence.json
// e classifica achados com lib/gate-mode.mjs:
//
//   itens 1-4 (rule, "Bloqueiam")  -> enforceable:true  (INEGOCIÁVEL, ignora modo/yolo)
//   itens 5-8 (rule, "Avisam")     -> enforceable:false (sempre WARN — a rule não define
//                                     um interruptor warn|enforce para red-first, ao
//                                     contrário de authz/observability; ver design decisions
//                                     no retorno da Onda B)
//
// Onda D — "mover a prova do ARTEFATO para a EXECUÇÃO": duas tentativas anteriores tentaram
// fechar a forja acrescentando campos auto-declarados ao artefato (excerpt/classification,
// depois replayed_at/replay_head) e as duas caíram pelo MESMO motivo — todo campo do artefato é
// escrito por quem está sendo verificado, então "ler o campo X" para decidir "houve replay?" é
// circular, não importa qual campo X seja.
//
// Onda E (decisão do orquestrador) — uma TERCEIRA tentativa (cache local de replay,
// lib/red-replay-cache.mjs) tentou fechar a mesma lacuna sem reler campo algum do artefato, mas
// criou problemas próprios: o cache é estado local que projetos que instalaram o harness antes do
// patch do .gitignore podiam versionar por acidente, e era fonte de um livelock relatado. O cache
// foi REMOVIDO. A partir desta Onda, evaluateRedFirst() — usado por `check-red-first.sh check`
// (rápido, NUNCA executa teste algum: pre-push e doctor dependem disso) — valida só o que é
// estático: (a) completude da declaração, (b) o que é verificável contra realidade EXTERNA ao
// artefato — diff real (git), grafo de código, classify() sobre o excerpt, deferral/ledger de
// verdade por trás de um waiver — e explicitamente NÃO tenta mais corroborar que um replay real
// aconteceu por trás de um status:'observed'. Essa garantia agora vem de outro lugar: quem decide
// TRANSICIONAR um change para verified (validate-spec.mjs) ou arquivá-lo (archive-spec.sh) chama
// `red-evidence.sh ensure` incondicionalmente ANTES de avaliar — ensure executa o motor de replay
// de verdade toda vez (sem cache), sobrescrevendo qualquer conteúdo forjado com o resultado real
// antes que este módulo o leia. `check-red-first.sh check`, chamado sozinho (pre-push, doctor,
// `/forge:red status`), continua sem essa garantia — é um limite aceito e documentado na rule
// (seção Verificação), não um descuido: esses caminhos precisam ser rápidos e não podem pagar o
// custo de um replay a cada invocação.
//
// Subcomandos (delegados por check-red-first.sh, padrão de check-authz.sh):
//   check  <change-dir>                                — roda os itens, imprime OK/CONFLICT/WARN
//   status <change-dir>                                — one-liner de status (nunca bloqueia)
//   waive  <change-dir> --reason <r> [--note <n>]       — grava waiver tipado (§ Quando o Red não é possível)
//
// evaluateRedFirst(changeDir) é exportado para reuso por lib/validate-spec.mjs — mesma fonte de
// verdade nos dois lugares (antes, validate-spec.mjs tinha sua própria checagem rasa que só
// olhava isResolved(), incapaz de reprovar uma evidência 'observed' forjada à mão).
//
// FORGE_ROOT (env) — raiz do projeto: usada para .forge/graph/graph.json, .forge/cache/red-replay,
// para invocar deferral-ops.sh/ledger-ops.sh (waivers no-test-infra/external-unreproducible/
// hotfix-under-incident) e para relativizar git log (item 6).
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseYamlSubset } from './yaml-lite.mjs';
import { loadRedEvidence, WAIVER_REASONS, REL_PATH, deriveTopStatus, resolvedEntry, resolveEntryId } from './red-evidence.mjs';
import { upsertSingleEntry } from './red-evidence-ops.mjs';
import { checkReachability } from './red-level.mjs';
import { applyMode } from './gate-mode.mjs';
import { classify, countsAsRed } from './red-classify.mjs';
import { isDefectFixing, defectIds } from './defect-scope.mjs';

const RULE_REF = 'rule testing/regression-red-first.md';
const root = resolve(process.env.FORGE_ROOT || '.');

function readManifest(changeDir) {
  const p = join(resolve(changeDir), 'manifest.yaml');
  if (!existsSync(p)) return null;
  try { return parseYamlSubset(readFileSync(p, 'utf8')); } catch { return null; }
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function sha256(s) { return createHash('sha256').update(String(s)).digest('hex'); }

// ── item 6 — teste e correção no mesmo commit (git log, sem rodar teste algum) ────────
function lastCommitOf(relPath) {
  try {
    const out = execFileSync('git', ['-C', root, 'log', '-1', '--format=%H', '--', relPath], { encoding: 'utf8' }).trim();
    return out || null;
  } catch { return null; }
}

// ── item 7 — nome do teste referencia o defeito? heurística por palavra-chave/slug ────
function testNameReferencesDefect(data, changeId) {
  const name = String(data.test_id || data.test_path || '').toLowerCase();
  if (!name) return true; // sem nome não há o que avaliar — não sinaliza (evita falso positivo)
  const KEYWORDS = ['bug', 'regress', 'defect', 'defeito', 'issue', 'repro', 'fix'];
  if (KEYWORDS.some((k) => name.includes(k))) return true;
  const slugWords = String(changeId || '').split('-').filter((w) => w.length > 2);
  return slugWords.some((w) => name.includes(w));
}

// ── item 8 — mock de símbolo exportado por arquivo corrigido ──────────────────────────
// Furo 7 (correção): a regex original exigia que o path do mock terminasse EXATAMENTE no
// basename sem extensão (`vi.mock('../src/a.ts')` escapava — sobra ".ts" antes da aspa) e
// um guard `if (!/\bmock/i...)` matava jest/vi.spyOn e sinon.stub inteiramente (nenhum dos
// dois contém a substring "mock"). Corrigido: extensão de módulo opcional na regex de mock,
// e o guard agora cobre as três famílias de token (mock|spyOn|stub) em vez de matar duas.
const MODULE_EXT_RE = '(?:\\.(?:tsx?|jsx?|mjs|cjs))?';
function checkMockOfFixSymbol(testPath, fixFiles) {
  const testFile = join(root, testPath);
  if (!existsSync(testFile)) return null;
  let testText;
  try { testText = readFileSync(testFile, 'utf8'); } catch { return null; }
  if (!/\b(?:mock|spyOn|stub)\b/i.test(testText)) return null;
  for (const fx of fixFiles) {
    const base = basename(fx).replace(/\.[^.]+$/, '');
    if (!base) continue;
    const moduleMockRe = new RegExp(`\\b(?:jest|vi|vitest)\\.mock\\s*\\(\\s*['"\`][^'"\`]*${escapeRe(base)}${MODULE_EXT_RE}['"\`]`);
    if (moduleMockRe.test(testText)) return { fixFile: fx, symbol: base, via: 'mock do módulo inteiro' };
    const fixPath = join(root, fx);
    let fixText = '';
    if (existsSync(fixPath)) { try { fixText = readFileSync(fixPath, 'utf8'); } catch { fixText = ''; } }
    const symbols = [...fixText.matchAll(/export\s+(?:default\s+)?(?:const|function|class|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    for (const sym of symbols) {
      const symRe = new RegExp(`\\b(?:jest\\.spyOn|vi\\.spyOn|sinon\\.(?:mock|stub))\\s*\\([^)]*\\b${escapeRe(sym)}\\b`);
      if (symRe.test(testText)) return { fixFile: fx, symbol: sym, via: 'spy/stub de símbolo exportado' };
    }
  }
  return null;
}

// campos que uma evidência status:observed precisa ter preenchidos para os itens 2-4 serem
// verificáveis de fato — sem eles, a barra efetiva era "existe arquivo com excerpt não-vazio"
// (Furo 4). REQUIRED_OBSERVED_FIELDS não inclui excerpt (checado à parte, msg própria) nem
// base_result (opcional — só vira achado quando presente e 'passed'). test_id (Onda D, item 3):
// sem ele, a derivação de base do replay volta a ancorar na criação do ARQUIVO de teste, e os
// guardas caseExistsInContent/outputMentionsCase do motor (Furo 2) passam por vacuidade — sem
// test_id não há veredito 'observed' possível, no máximo 'not-possible'.
const REQUIRED_OBSERVED_FIELDS = ['test_path', 'test_id', 'command', 'base_commit', 'classification', 'failure_pattern'];
function missingObservedFields(data) {
  return REQUIRED_OBSERVED_FIELDS.filter((k) => data[k] === null || data[k] === undefined || String(data[k]).trim() === '');
}

function readJsonSafe(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// deferralOf: lê deferrals.json DO CHANGE (não do FORGE_ROOT — mesmo arquivo que
// deferral-ops.sh opera). Retorna o registro OU null (id ausente, arquivo ausente, ou não achado)
// — usado para reaplicar a política dos quatro motivos de waiver (item 3a, Onda E): um
// deferral_id colado à mão no red-evidence.json sem um DEFER-NN correspondente de verdade não
// corrobora nada.
function deferralOf(changeDir, deferralId) {
  if (!deferralId) return null;
  const data = readJsonSafe(join(resolve(changeDir), 'deferrals.json'));
  if (!data || !Array.isArray(data.deferrals)) return null;
  return data.deferrals.find((d) => d.id === deferralId) || null;
}

// ledgerEntryOf: lê o ledger GLOBAL do projeto (.forge/ledger/ledger.json) e confere que a
// entrada existe E referencia ESTE change — um ledger_id copiado de outro change (ou inventado)
// não corrobora.
function ledgerEntryOf(ledgerId, changeId) {
  if (!ledgerId) return null;
  const data = readJsonSafe(join(root, '.forge/ledger/ledger.json'));
  if (!data || !Array.isArray(data.entries)) return null;
  return data.entries.find((e) => e.id === ledgerId && e.source && e.source.change_id === changeId) || null;
}

// ── evaluateRedFirst: os itens da rule, sem executar teste algum — pura, sem console.log/exit,
// para ser reusável tanto pela CLI (cmdCheck) quanto por lib/validate-spec.mjs. Retorna
// { applicable, findings, status, changeId } ou { manifestError: true }.
export function evaluateRedFirst(changeDir) {
  const man = readManifest(changeDir);
  if (!man) return { manifestError: true };
  if (!isDefectFixing(man)) {
    // item 3d — mudar de type (ou apagar fixes_defects) após ter evidência gravada desliga toda
    // a política red-first em silêncio (o caminho normal deste próprio bloco é `return` antes de
    // olhar a evidência). Isso pode ser legítimo (change recategorizado bugfix -> refactor, ou
    // fixes_defects esvaziado) — não trava, mas deixa rastro em vez de silêncio total.
    // "Evidência gravada" exclui o scaffold trivial (status:'pending', recorded_at:null) que
    // /forge:spec new cria para TODO change bugfix recém-criado — recategorizar antes de
    // qualquer /forge:red record não é sinal de nada. Issue #138: esta checagem só dispara
    // quando `isDefectFixing` é `false` — um change `type: feature` com `fixes_defects`
    // declarado nunca entra aqui, então o WARN de "type mudou" não se aplica a ele (a lista
    // sozinha já basta para manter a política ligada).
    const findings = [];
    const evAfterTypeChange = loadRedEvidence(changeDir);
    if (evAfterTypeChange.exists && !evAfterTypeChange.errors.length && evAfterTypeChange.data
      && (evAfterTypeChange.data.recorded_at || evAfterTypeChange.data.status !== 'pending')) {
      findings.push({ enforceable: false, msg: `change tem evidência de Red gravada (status: ${evAfterTypeChange.data.status}) mas deixou de ser sujeito ao red-first (type: '${man.type}', fixes_defects: ${JSON.stringify(man.fixes_defects ?? [])}) — a política foi desligada por essa mudança; confirme que a recategorização é legítima (item 3d, ${RULE_REF})` });
    }
    return { applicable: false, type: man.type, findings, status: null, changeId: man.id };
  }

  const findings = [];
  const ev = loadRedEvidence(changeDir);

  // item 1 — ausência de evidência resolvida (bloqueia, enforceable:true). Redesenho de causa
  // raiz da #139 (4ª rodada): `entries[]` é a ÚNICA fonte de verdade — o veredito de resolução
  // vem de `deriveTopStatus(ev.entries)`/`resolvedEntry`, nunca de `ev.data.status` bruto (item 3
  // do redesenho: o topo é projeção, nunca lido como fonte).
  const entries = ev.entries || [];
  const topStatus = deriveTopStatus(entries);
  const fullyResolved = entries.length > 0 && entries.every(resolvedEntry);
  if (!ev.exists) {
    findings.push({ enforceable: true, msg: `${REL_PATH} ausente — change sujeito ao red-first (type:bugfix ou fixes_defects declarado) sem evidência de Red (item 1, ${RULE_REF}) — escaffolde com 'red-evidence.sh init ${man.id}' e grave com /forge:red record + replay, ou dispense com /forge:red waive --reason <motivo>` });
  } else if (ev.errors.length) {
    findings.push({ enforceable: true, msg: `${REL_PATH} inválido: ${ev.errors.join('; ')} (item 1, ${RULE_REF})` });
  } else if (ev.tampered) {
    // item 4 do redesenho — um topo que não bate com a projeção FRESCA de entries[] é
    // adulteração: entries[] é a fonte única, e o topo é sempre recalculado nas escritas
    // (computeProjection); só diverge por edição manual fora do fluxo record/replay/ensure/waive.
    // Preserva a detecção de forja do w106/w107 [3-FORJA] (que forja só os escalares do topo,
    // deixando entries[] intacto) como um achado ESTÁTICO adicional — a garantia real, que
    // reexecuta o teste declarado, continua vindo de `ensure` (chamado incondicionalmente por
    // validate-spec.mjs/archive-spec.sh antes de qualquer decisão de bloqueio).
    findings.push({ enforceable: true, msg: `${REL_PATH} adulterado — os campos do topo não correspondem à projeção de entries[] (entries[] é a fonte única de verdade; rode /forge:red ensure para recalcular o topo a partir dela) (item 4, ${RULE_REF})` });
  } else if (!fullyResolved) {
    // achado HIGH-2/b da correção da #139 (iteração 3): com 2+ entradas em entries[], `replay` e
    // `waive` exigem `--id <id>` — a mensagem passa a nomear isso explicitamente em vez de mandar
    // para comandos que recusariam sem --id (o próprio conflito que a correção fecha: `ensure`,
    // chamado por /forge:verify e /forge:archive, resolve as demais entradas por iteração própria
    // e não precisa de --id). Toda entrada tem id não nulo (redesenho da #139) — a lista de ids na
    // mensagem nunca mais precisa do placeholder "(sem id)".
    const idHint = entries.length >= 2 ? ` --id <id> (uma de: ${entries.map((e) => e.id).join(', ')})` : '';
    const pendingIds = entries.filter((e) => !resolvedEntry(e)).map((e) => e.id);
    const which = entries.length >= 2 && pendingIds.length ? ` — pendente(s): ${pendingIds.join(', ')}` : '';
    findings.push({ enforceable: true, msg: `${REL_PATH} status '${topStatus}' — Red ainda não observado nem dispensado (item 1, ${RULE_REF})${which} — rode /forge:red replay${idHint} ou dispense com /forge:red waive --reason <motivo>${idHint}` });
  }

  // fixes_defects (issue #138) — cobrança POR ID, independente do que os quatro ramos acima já
  // concluíram. `fullyResolved` só enxerga as entradas que EXISTEM em entries[]; um change que
  // declara `fixes_defects: [D1, D2]` e só registrou evidência para D1 fica `fullyResolved` se a
  // entrada de D1 estiver resolvida — D2 nunca foi examinado e o ramo acima não tem como saber
  // que ele deveria existir. Roda sempre que a lista é declarada, com `type` bugfix ou não, e
  // independente de `ev.exists` (entries é [] quando não há evidência nenhuma, e o `missing`
  // abaixo vira a lista inteira — a mensagem nomeia cada id em vez de deixar o achado genérico do
  // item 1 acima ser o único rastro).
  const declaredDefectIds = defectIds(man);
  if (declaredDefectIds.length) {
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const missingDefectIds = declaredDefectIds.filter((id) => {
      const entry = entryById.get(id);
      return !entry || !resolvedEntry(entry);
    });
    if (missingDefectIds.length) {
      findings.push({ enforceable: true, msg: `fixes_defects declara ${declaredDefectIds.join(', ')} mas falta evidência de Red resolvida (observed|waived) para: ${missingDefectIds.join(', ')} — grave com /forge:red record --id <id> + replay, ou dispense com /forge:red waive --id <id> --reason <motivo> (fixes_defects, ${RULE_REF})` });
    }
  }

  // waiver: Onda D/E, item 3a — a política de CADA um dos quatro motivos é REAPLICADA aqui a
  // cada `check`, não só na hora de gravar (cmdWaive). Sem isso, um waiver colado à mão
  // diretamente no JSON — sem jamais passar por cmdWaive — escapa de qualquer validação: os
  // outros três motivos (no-test-infra/external-unreproducible/hotfix-under-incident) podiam
  // referenciar um deferral_id/ledger_id inventado (ou null) sem que nada conferisse se o
  // DEFER-NN/LDG-NNNN correspondente existe de verdade. Redesenho da #139: avaliado POR ENTRADA
  // — um change com a 1ª entrada dispensada e a 2ª observada precisa que a política do waiver da
  // 1ª seja checada mesmo quando o topo agregado é 'observed' (a mistura nunca aparece no topo).
  const waivedEntries = entries.filter((e) => e.status === 'waived' && e.waiver);
  if (waivedEntries.length) {
    const nonBehavioralVerdict = waivedEntries.some((e) => e.waiver.reason === 'non-behavioral')
      ? nonBehavioralTouchesGraph(changeDir)
      : null;
    for (const entry of waivedEntries) {
      const { reason } = entry.waiver;
      const tag = entries.length > 1 ? `entrada ${entry.id}: ` : '';
      if (reason === 'non-behavioral') {
        const verdict = nonBehavioralVerdict;
        if (verdict.unverifiable) {
          findings.push({ enforceable: true, msg: `${tag}waiver non-behavioral não pôde ser verificado — grafo de código ausente/malformado e a tentativa de regeneração (graph.sh update) não produziu um grafo utilizável; a política nunca concede non-behavioral em silêncio quando não dá para conferir se o diff toca código (item 3c, § Quando o Red não é possível, ${RULE_REF})` });
        } else if (verdict.touched) {
          findings.push({ enforceable: true, msg: `${tag}waiver non-behavioral inválido — o diff real toca arquivo de código presente no grafo (${verdict.touched}); a política nunca permite non-behavioral quando o diff toca código, independente do que o waiver declare (item 1, ${RULE_REF})` });
        }
      } else if (WAIVER_REASONS.includes(reason)) {
        // no-test-infra | external-unreproducible | hotfix-under-incident — um waiver desses
        // motivos precisa ter o deferral (e, p/ no-test-infra, também o ledger) DE VERDADE
        // registrados — não só referenciados por id no JSON.
        const def = deferralOf(changeDir, entry.waiver.deferral_id);
        if (!def) {
          findings.push({ enforceable: true, msg: `${tag}waiver '${reason}' sem deferral correspondente registrado em deferrals.json (deferral_id declarado: ${entry.waiver.deferral_id ?? 'null'}) — a política exige um DEFER-NN de verdade, não só a referência no JSON (item 3a, § Quando o Red não é possível, ${RULE_REF})` });
        } else if (reason === 'hotfix-under-incident' && !(Array.isArray(def.blocks) && def.blocks.includes('archive'))) {
          findings.push({ enforceable: true, msg: `${tag}waiver 'hotfix-under-incident' exige deferral com blocks:[archive] (${def.id} tem blocks: ${JSON.stringify(def.blocks || [])}) — sem isso o archive não fica travado até o teste chegar (item 3a, § Quando o Red não é possível, ${RULE_REF})` });
        }
        if (reason === 'no-test-infra') {
          const ledgerEntry = ledgerEntryOf(entry.waiver.ledger_id, man.id);
          if (!ledgerEntry) {
            findings.push({ enforceable: true, msg: `${tag}waiver 'no-test-infra' sem entrada correspondente registrada em .forge/ledger/ledger.json (ledger_id declarado: ${entry.waiver.ledger_id ?? 'null'}) — a política exige dívida técnica de verdade, não só a referência no JSON (item 3a, § Quando o Red não é possível, ${RULE_REF})` });
          }
        }
      }
    }
  }

  // itens 2-8 só fazem sentido sobre uma entrada VÁLIDA com status observed (sobre dados já
  // registrados — nenhuma execução acontece aqui; o replay real é responsabilidade de
  // `red-evidence.sh replay|ensure`, chamado por /forge:red, spec-verify.sh e archive-spec.sh).
  // Redesenho da #139 (item 4 do redesenho, "check/ensure avaliam por entrada"): iterado sobre
  // CADA entrada observada de `entries[]`, nunca sobre a projeção do topo — a mistura observed+
  // waived do achado HIGH-3 (1ª entrada dispensada, 2ª observada) trava para sempre se os itens
  // 2-4 continuam avaliando só a projeção de entries[0] (a dispensada, sem excerpt/base_commit)
  // mesmo quando o topo agregado é 'observed'.
  const observedEntries = entries.filter((e) => e.status === 'observed');
  for (const entry of observedEntries) {
    const tag = entries.length > 1 ? `entrada ${entry.id}: ` : '';

    // completude de replay — status:observed sem os campos que só existem depois de um
    // replay real (Furo 4). Sem isso, itens 2-4 abaixo avaliam campos ausentes como
    // "silenciosamente ok" em vez de sinalizar a lacuna — a barra vira apenas "arquivo
    // existe com excerpt não-vazio", que é exatamente o furo original.
    const missing = missingObservedFields(entry);
    if (missing.length) {
      findings.push({ enforceable: true, msg: `${tag}status 'observed' com evidência de replay incompleta — campos obrigatórios ausentes: ${missing.join(', ')} (rule, ${RULE_REF})` });
    }

    // Onda E — SEM cache, este check ESTÁTICO não tenta mais corroborar que um replay real
    // aconteceu por trás de status:'observed' (ver nota no topo do arquivo — limite aceito e
    // documentado na rule). Quem precisa dessa garantia chama `red-evidence.sh ensure` antes de
    // avaliar (validate-spec.mjs na transição para verified; archive-spec.sh no pré-flight) —
    // ensure roda o motor de verdade incondicionalmente e sobrescreve o artefato com o resultado
    // real antes deste módulo o ler.

    // Furo 11 — excerpt_sha256 conferido de fato: sem isso o campo é decorativo (nada impedia
    // editar excerpt/classification à mão sem recalcular o hash, ou vice-versa).
    if (entry.excerpt && entry.excerpt_sha256) {
      const actual = sha256(entry.excerpt);
      if (actual !== entry.excerpt_sha256) {
        findings.push({ enforceable: true, msg: `${tag}excerpt_sha256 não corresponde ao excerpt registrado — evidência pode ter sido editada à mão (rule, ${RULE_REF})` });
      }
    }

    // item 2 — "não reproduz": observed sem trecho de saída capturado é declaração sem lastro.
    if (!entry.excerpt || !String(entry.excerpt).trim()) {
      findings.push({ enforceable: true, msg: `${tag}status 'observed' sem excerpt registrado — sem evidência de falha na base (item 2, ${RULE_REF})` });
    }
    // item 2 — teste que já passava na base (base_result é escrito pelo replay real; ausência
    // não é falso positivo — só 'passed' explícito é achado).
    if (entry.base_result === 'passed') {
      findings.push({ enforceable: true, msg: `${tag}base_result 'passed' — teste já passava na árvore base, não reproduz o defeito relatado (item 2, ${RULE_REF})` });
    }

    // item 3 — a classificação REAL do excerpt (via red-classify, não o campo auto-declarado)
    // decide. Um excerpt de erro de build com classification:"behavioral" declarado não passa
    // mais (Furo 3) — e uma declaração que diverge da classificação real também é sinalizada.
    if (entry.excerpt && String(entry.excerpt).trim()) {
      const classified = classify(entry.excerpt);
      // issue #191 — mesma política do replay (countsAsRed): 'setup-exception' só conta com
      // failure_pattern declarado que casa com o excerpt.
      if (!countsAsRed(classified, entry.excerpt, entry.failure_pattern)) {
        const why = classified === 'setup-exception'
          ? 'exceção de setup sem failure_pattern declarado que case com o excerpt'
          : 'não é comportamental';
        findings.push({ enforceable: true, msg: `${tag}excerpt classifica como '${classified}' via red-classify — ${why}, independente do campo 'classification' declarado ('${entry.classification ?? 'null'}') (item 3, ${RULE_REF})` });
      } else if (entry.classification && entry.classification !== classified) {
        findings.push({ enforceable: true, msg: `${tag}classification declarada ('${entry.classification}') diverge da classificação real do excerpt ('${classified}') (item 3, ${RULE_REF})` });
      }
    }

    // item 4 — a saída observada precisa casar com o failure_pattern declarado.
    if (entry.failure_pattern && entry.excerpt) {
      let matches;
      try { matches = new RegExp(entry.failure_pattern).test(entry.excerpt); }
      catch { matches = entry.excerpt.includes(entry.failure_pattern); }
      if (!matches) findings.push({ enforceable: true, msg: `${tag}excerpt não casa com o failure_pattern declarado ('${entry.failure_pattern}') (item 4, ${RULE_REF})` });
    }

    // itens 5-8 — avisos de qualidade (enforceable:false), só avaliáveis com dados suficientes.
    if (entry.test_path && Array.isArray(entry.fix_files) && entry.fix_files.length) {
      const graphPath = join(root, '.forge/graph/graph.json');
      let graph = null;
      if (existsSync(graphPath)) { try { graph = JSON.parse(readFileSync(graphPath, 'utf8')); } catch { graph = null; } }
      const reach = checkReachability({ graph, testPath: entry.test_path, fixFiles: entry.fix_files });
      if (reach.status === 'no-intersection') {
        findings.push({ enforceable: false, msg: `${tag}teste não alcança, no grafo de código, nenhum arquivo corrigido (item 5, ${RULE_REF})` });
      }

      const testCommit = lastCommitOf(entry.test_path);
      if (testCommit) {
        const sameCommitFix = entry.fix_files.find((fx) => lastCommitOf(fx) === testCommit);
        if (sameCommitFix) {
          findings.push({ enforceable: false, msg: `${tag}teste (${entry.test_path}) e correção (${sameCommitFix}) no mesmo commit ${testCommit.slice(0, 7)} (item 6, ${RULE_REF})` });
        }
      }

      const mock = checkMockOfFixSymbol(entry.test_path, entry.fix_files);
      if (mock) {
        findings.push({ enforceable: false, msg: `${tag}possível mock de símbolo exportado por arquivo corrigido — '${mock.symbol}' (${mock.via}) em ${mock.fixFile} (item 8, ${RULE_REF})` });
      }
    }
    if (!testNameReferencesDefect(entry, man.id)) {
      findings.push({ enforceable: false, msg: `${tag}nome de teste sem referência aparente ao defeito (item 7, ${RULE_REF})` });
    }
  }

  return { applicable: true, findings, status: topStatus, changeId: man.id };
}

// ── "check": CLI sobre evaluateRedFirst — formata OK/CONFLICT/WARN e decide o exit code ────
function cmdCheck(changeDir) {
  const result = evaluateRedFirst(changeDir);
  if (result.manifestError) { console.log('FAIL (manifest.yaml ausente/ilegível)'); process.exit(1); }
  if (!result.applicable) {
    // item 3d — n/a (type != bugfix) ainda pode carregar um WARN de recategorização (findings
    // aqui são sempre enforceable:false — nunca bloqueia um change legitimamente não-bugfix).
    if (result.findings && result.findings.length) {
      console.log(`WARN (${result.findings.map((f) => f.msg).join('; ')})`);
    } else {
      console.log(`OK check-red-first (n/a — type: ${result.type})`);
    }
    process.exit(0);
  }

  // Sem block de governance específico para red_first (a rule não define um interruptor
  // warn|enforce como authz/observability) — applyMode({}) resolve mode:'warn' por default,
  // então itens enforceable:false permanecem WARN sempre; enforceable:true bloqueia sempre.
  const applied = applyMode(result.findings, {});
  const lines = [];
  if (applied.blocking.length) lines.push(`CONFLICT (${applied.blocking.map((f) => f.msg).join('; ')})`);
  if (applied.warnings.length) lines.push(`WARN (${applied.warnings.map((f) => f.msg).join('; ')})`);
  if (lines.length) { console.log(lines.join('\n')); process.exit(applied.exitCode); }
  console.log(`OK check-red-first (${result.changeId} — status: ${result.status ?? 'n/a'})`);
}

// ── "status": one-liner não-bloqueante (sempre exit 0) ─────────────────────────────────
function cmdStatus(changeDir) {
  const man = readManifest(changeDir);
  if (!man) { console.log('FAIL (manifest.yaml ausente/ilegível)'); return; }
  if (!isDefectFixing(man)) { console.log(`OK (n/a — type: ${man.type})`); return; }
  const ev = loadRedEvidence(changeDir);
  if (!ev.exists) { console.log(`MISSING (${REL_PATH} ausente)`); return; }
  if (ev.errors.length) { console.log(`INVALID (${ev.errors.join('; ')})`); return; }
  // Redesenho de causa raiz da #139 (4ª rodada) — o topo NUNCA é lido como fonte (item 3/4): o
  // veredito e o status exibidos vêm de `deriveTopStatus(ev.entries)`, a mesma projeção pura que
  // toda escrita recalcula, nunca de `ev.data.status` bruto. Change com múltiplas entradas mostra
  // quantas já estão resolvidas (observed|waived) — informativo; iterar entries[] para o veredito
  // ITEM A ITEM é escopo da #138.
  const entries = ev.entries;
  const topStatus = deriveTopStatus(entries);
  const suffix = entries.length > 1
    ? ` — ${entries.filter(resolvedEntry).length}/${entries.length} entrada(s) resolvida(s)`
    : '';
  if (ev.tampered) { console.log(`INVALID (red-evidence.json adulterado — topo diverge da projeção de entries[]; rode /forge:red ensure)`); return; }
  const resolved = topStatus === 'observed' || topStatus === 'waived';
  console.log(resolved ? `OK (status: ${topStatus}${suffix})` : `PENDING (status: ${topStatus}${suffix})`);
}

// ── "waive": grava waiver tipado (§ Quando o Red não é possível) ───────────────────────
function writeJsonAtomic(path, obj) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

// affectedPathsOf: FALLBACK apenas — usado quando o repositório não é um worktree git
// (Furo 2). A fonte de verdade é o diff real (realDiffPaths); a rule diz explicitamente
// "recusado automaticamente se o diff tocar código presente no grafo", não "se o manifest
// declarar". Aceita as três formas que o manifest pode assumir: bloco YAML, flow inline
// (`[a, b]`) e ausência/vazio (`[]` ou campo nem presente) — as duas primeiras retornam a
// lista declarada, a terceira [] (nada declarado, nada a recusar).
function affectedPathsOf(manifestText) {
  const flow = manifestText.match(/^affected_paths:\s*\[([^\]]*)\]\s*$/m);
  if (flow) {
    return flow[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  const block = manifestText.match(/^affected_paths:\s*\n((?:[ \t]*-\s.*\n?)*)/m);
  if (block && block[1].trim()) {
    return block[1].split('\n').map((l) => l.replace(/^[ \t]*-\s*/, '').trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return [];
}

// gitAvailable: root é (ou está dentro de) um worktree git de verdade? Decide se usamos o
// diff real ou caímos no fallback declarativo.
function gitAvailable(dir) {
  try { execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// realDiffPaths: os arquivos que o DIFF de verdade toca (Furo 2 — a rule fala do diff, não
// do que o autor declarou sobre si mesmo). Fontes, união:
//   (a) merge-base(HEAD, <branch padrão>) .. worktree — "a base do change" quando o change
//       vive numa branch derivada de develop/main/master;
//   (a2) Furo (item 6, Onda D) — quando merge-base(HEAD, <base>) === HEAD (o caso comum de
//       commitar DIRETO na própria branch base: develop/main/master), a fonte (a) sai vazia por
//       CONSTRUÇÃO — HEAD já É a base, não porque o change não toque código. Sem isso, um waiver
//       non-behavioral aceito logo após um commit direto na base escapava (o diff "real" parecia
//       vazio). Cai para o diff introduzido pelo range de commits do próprio change; sem um
//       conceito de "início do change" numa branch única, usa o ÚLTIMO commit (HEAD~1..HEAD) —
//       na pior hipótese, o commit mais recente sempre faz parte do trabalho sob avaliação. Commit
//       raiz (sem pai) usa `git show` (diff contra a árvore vazia) como equivalente.
//   (b) diff HEAD — cobre staged+unstaged de uma vez (o caso comum: o change ainda está
//       em progresso, não commitado — este próprio repositório, agora, é um exemplo);
//   (c) `git status --porcelain` para arquivos novos, não rastreados — `git diff` não os
//       enxerga de jeito nenhum.
// Nunca lança — qualquer comando git que falhe é ignorado (best-effort), a união dos que
// funcionaram é o retorno.
function realDiffPaths(dir) {
  const out = new Set();
  const runDiff = (args) => {
    try {
      execFileSync('git', ['-C', dir, 'diff', '--name-only', ...args], { encoding: 'utf8' })
        .split('\n').map((s) => s.trim()).filter(Boolean).forEach((p) => out.add(p));
    } catch { /* best-effort */ }
  };
  let headSha = null;
  try { headSha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* sem commits ainda */ }
  for (const candidate of ['dev', 'develop', 'main', 'master']) {
    try {
      execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', candidate], { stdio: 'ignore' });
      const mergeBase = execFileSync('git', ['-C', dir, 'merge-base', 'HEAD', candidate], { encoding: 'utf8' }).trim();
      if (mergeBase && headSha && mergeBase === headSha) {
        // (a2) — HEAD já é a base; diff contra ela é vazio por construção. Cai para o último
        // commit (ou, se HEAD é a raiz, o diff desse commit contra a árvore vazia via `git show`).
        try {
          execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', 'HEAD~1'], { stdio: 'ignore' });
          runDiff(['HEAD~1', 'HEAD']);
        } catch {
          try {
            execFileSync('git', ['-C', dir, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' })
              .split('\n').map((s) => s.trim()).filter(Boolean).forEach((p) => out.add(p));
          } catch { /* best-effort */ }
        }
      } else if (mergeBase) {
        runDiff([mergeBase]);
      }
      break;
    } catch { /* tenta a próxima branch candidata */ }
  }
  runDiff(['HEAD']);
  try {
    execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => /^\?\?/.test(l))
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
      .forEach((p) => out.add(p));
  } catch { /* best-effort */ }
  return [...out];
}

// pathTouchesGraph: casa um path (do diff real ou do fallback declarado) contra os ids do
// grafo por PREFIXO de diretório, não igualdade exata (Furo 2 — "template/.forge/" é a forma
// que TODOS os changes deste próprio repositório usam em affected_paths, e igualdade exata
// nunca casa um prefixo de diretório contra o arquivo específico que o grafo indexa).
function pathTouchesGraph(p, ids) {
  const norm = String(p).replace(/^\.\//, '').replace(/\/+$/, '');
  if (!norm) return null;
  for (const id of ids) {
    if (id === norm) return id;
    if (id.startsWith(`${norm}/`)) return id;
    if (norm.startsWith(`${id}/`)) return id;
  }
  return null;
}

function runOps(script, args) {
  return execFileSync('bash', [join(root, '.forge/scripts', script), ...args], {
    encoding: 'utf8', env: { ...process.env, FORGE_ROOT: root },
  });
}

// graphUsable: o grafo em disco parseia e tem um nodes[] utilizável?
function graphUsable(graphPath) {
  if (!existsSync(graphPath)) return false;
  try {
    const g = JSON.parse(readFileSync(graphPath, 'utf8'));
    return !!g && Array.isArray(g.nodes);
  } catch { return false; }
}

// ensureGraphUsable: item 3c — "grafo ausente/stale desliga a política do non-behavioral em
// silêncio, e graph.json é gitignorado — logo em CI e em clone novo a política nunca se aplica".
// Antes de desistir (e sinalizar 'não pôde ser verificada'), tenta regenerar o grafo de verdade
// (`graph.sh update` — determinista, zero LLM, ADR 0001): é barato o suficiente para valer a
// tentativa, e resolve o caso mais comum (grafo simplesmente nunca construído neste clone) sem
// exigir intervenção humana. Best-effort — falha ao regenerar não lança, só deixa graphUsable()
// decidir o resultado final.
function ensureGraphUsable(rootDir) {
  const graphPath = join(rootDir, '.forge/graph/graph.json');
  if (graphUsable(graphPath)) return true;
  const graphScript = join(rootDir, '.forge/scripts/graph.sh');
  if (existsSync(graphScript)) {
    try { execFileSync('bash', [graphScript, 'update'], { cwd: rootDir, env: { ...process.env, FORGE_ROOT: rootDir }, stdio: 'ignore' }); }
    catch { /* best-effort — graphUsable() abaixo decide o resultado real */ }
  }
  return graphUsable(graphPath);
}

// nonBehavioralTouchesGraph: a POLÍTICA do waiver non-behavioral (§ tabela — "recusado
// automaticamente se o diff tocar código presente no grafo"), extraída como função pura o
// suficiente para ser chamada tanto por cmdWaive (na hora de gravar) quanto por
// evaluateRedFirst (reaplicada a CADA `check`, não só na hora de gravar; ver comentário no
// call-site). git indisponível ⇒ cai no fallback declarativo (affected_paths). Grafo ausente ou
// malformado (mesmo após a tentativa de regeneração) ⇒ { unverifiable: true } — item 3c: a
// política NUNCA concede non-behavioral em silêncio só porque não dá para conferir. Retorna
// { touched: <id do node tocado, ou null>, unverifiable: false } quando o grafo é utilizável.
function nonBehavioralTouchesGraph(changeDir) {
  const graphPath = join(root, '.forge/graph/graph.json');
  if (!ensureGraphUsable(root)) return { touched: null, unverifiable: true };
  let graph = null;
  try { graph = JSON.parse(readFileSync(graphPath, 'utf8')); } catch { graph = null; }
  if (!graph || !Array.isArray(graph.nodes)) return { touched: null, unverifiable: true };
  const ids = new Set(graph.nodes.map((n) => n.id));
  let manifestText = '';
  try { manifestText = readFileSync(join(resolve(changeDir), 'manifest.yaml'), 'utf8'); } catch { manifestText = ''; }
  const diffPaths = gitAvailable(root) ? realDiffPaths(root) : affectedPathsOf(manifestText);
  for (const p of diffPaths) {
    const touched = pathTouchesGraph(p, ids);
    if (touched) return { touched, unverifiable: false };
  }
  return { touched: null, unverifiable: false };
}

function cmdWaive(changeDir, argv) {
  let reason = '';
  let note = '';
  let force = false;
  let id; // achado HIGH-2 da correção da #139 (iteração 3) — endereçamento por entrada
  let idProvided = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reason') reason = argv[++i] || '';
    else if (argv[i] === '--note') note = argv[++i] || '';
    else if (argv[i] === '--force') force = true;
    else if (argv[i] === '--id') { id = argv[++i]; idProvided = true; }
  }
  if (!WAIVER_REASONS.includes(reason)) {
    console.log(`FAIL (--reason obrigatório, um de: ${WAIVER_REASONS.join('|')})`);
    process.exit(1);
  }
  if (idProvided && (id === undefined || id === '' || id.startsWith('--'))) {
    console.log('FAIL (--id exige um valor não vazio e que não comece com "--")');
    process.exit(1);
  }
  const man = readManifest(changeDir);
  if (!man) { console.log('FAIL (manifest.yaml ausente/ilegível)'); process.exit(1); }
  if (!isDefectFixing(man)) { console.log(`FAIL (waive só se aplica a change sujeito ao red-first — type:bugfix ou fixes_defects declarado, got: ${man.type})`); process.exit(1); }
  const ev = loadRedEvidence(changeDir);
  if (!ev.exists) { console.log(`FAIL (${REL_PATH} ausente — nada para dispensar; rode 'red-evidence.sh init ${man.id}' para escaffoldar em cima deste change existente)`); process.exit(1); }
  if (ev.errors.length) { console.log(`FAIL (${REL_PATH} inválido: ${ev.errors.join('; ')})`); process.exit(1); }

  // Achado HIGH da correção da #139 (iteração 2), estendido na iteração 3: `waive` grava na
  // ENTRADA (não só no topo). Com 2+ entradas registradas, `--id` diz QUAL entrada este waiver
  // dispensa — sem ele, escolher uma seria adivinhar, e a recusa é fail-closed ANTES de qualquer
  // efeito colateral (deferral-ops/ledger-ops abaixo), para não deixar deferral ou entrada de
  // ledger órfã de um waiver que não foi gravado. Com --id declarado mas inexistente, mesma
  // recusa (nunca cria entrada — isso é exclusivo de record). Redesenho de causa raiz da #139
  // (4ª rodada): endereça via `resolveEntryId` sobre `ev.entries` (já normalizado por
  // `loadRedEvidence` — toda entrada tem id não nulo e estável), o MESMO endereçamento
  // compartilhado que `replay` usa — nenhuma entrada fica inendereçável por falta de nome.
  let targetEntry = null;
  if (Array.isArray(ev.data.entries)) {
    const resolved = resolveEntryId(ev.entries, idProvided ? { id } : {});
    if (!resolved.ok) {
      console.log(`FAIL (waive recusado — ${resolved.reason}. Nada foi escrito.)`);
      process.exit(1);
    }
    targetEntry = ev.entries[resolved.index];
  }

  // Furo 6 — idempotência: um segundo waive sem --force não pode (a) reabrir outro deferral/
  // entrada de ledger em cima de um waiver já existente, nem (b) rebaixar em silêncio uma
  // evidência 'observed' de verdade (um Red real e replicado) para 'waived'. Conferido contra a
  // ENTRADA alvo (targetEntry), não mais só o topo — com 2+ entradas o topo nunca reflete cada
  // uma individualmente (deriveTopStatus só é 'observed'/'waived' quando TODAS resolvem).
  const currentStatus = targetEntry ? targetEntry.status : ev.data.status;
  const currentWaiver = targetEntry ? targetEntry.waiver : ev.data.waiver;
  if (currentStatus === 'waived' && currentWaiver && !force) {
    const prev = currentWaiver;
    console.log(`FAIL (evidência já dispensada — waiver existente: ${prev.reason}${prev.note ? ` (${prev.note})` : ''}; use --force para substituir deliberadamente)`);
    process.exit(1);
  }
  if (currentStatus === 'observed' && !force) {
    console.log('FAIL (evidência já observada — waive rebaixaria um Red real e replicado; use --force para sobrescrever deliberadamente)');
    process.exit(1);
  }

  // non-behavioral: recusado automaticamente se o DIFF REAL tocar arquivo que seja node de
  // código no graph.json (§ tabela de waivers — "recusado se o diff tocar código", não "se o
  // manifest declarar"). Mesma política de evaluateRedFirst — uma fonte só. Item 3c: grafo
  // ausente/malformado (mesmo após a tentativa de regeneração) NUNCA concede em silêncio —
  // recusa também, pedindo para regenerar o grafo antes de tentar de novo.
  if (reason === 'non-behavioral') {
    const verdict = nonBehavioralTouchesGraph(changeDir);
    if (verdict.unverifiable) {
      console.log('FAIL (waiver non-behavioral recusado — grafo de código ausente/malformado e a regeneração automática não produziu um grafo utilizável; rode `graph.sh build` e tente de novo)');
      process.exit(1);
    }
    if (verdict.touched) {
      console.log(`FAIL (waiver non-behavioral recusado — diff toca arquivo de código presente no grafo: ${verdict.touched})`);
      process.exit(1);
    }
  }

  const changeId = man.id;
  const noteText = note || `Red waived (${reason}) — ${changeId}`;

  // Furo 9 — --force SUBSTITUI, não acumula: um waiver anterior (deferral + entrada de ledger)
  // que está prestes a ser sobrescrito por este waive precisa ser marcado resolved ANTES de
  // levantar um novo — sem isso, 3x --force com o mesmo reason (ex.: no-test-infra) deixava 4
  // deferrals e 4 entradas de ledger, TODOS open, e um deferral open sozinho já basta para
  // travar o archive (mesmo depois de o waiver corrente ter sido "substituído" no JSON). O
  // registro anterior não é apagado (auditoria) — só deixa de contar como pendência aberta.
  const prevWaiver = currentWaiver || null;
  if (force && prevWaiver) {
    if (prevWaiver.deferral_id) {
      try { runOps('deferral-ops.sh', ['resolve', changeId, prevWaiver.deferral_id, '--note', `substituído por novo /forge:red waive --force (${reason}) em ${changeId}`]); }
      catch { /* best-effort — já pode estar resolved/tested, ou nunca ter existido de fato */ }
    }
    if (prevWaiver.ledger_id) {
      try { runOps('ledger-ops.sh', ['resolve', prevWaiver.ledger_id, '--note', `substituído por novo /forge:red waive --force (${reason}) em ${changeId}`]); }
      catch { /* best-effort */ }
    }
  }

  let deferralId = null;
  let ledgerId = null;

  if (reason === 'no-test-infra' || reason === 'external-unreproducible' || reason === 'hotfix-under-incident') {
    const args = ['raise', changeId, '--reason', noteText];
    if (reason === 'hotfix-under-incident') args.push('--blocks', 'archive');
    let out;
    try { out = runOps('deferral-ops.sh', args); }
    catch (e) { console.log(`FAIL (deferral-ops raise falhou: ${e.message})`); process.exit(1); }
    const m = out.match(/DEFER-\d+/);
    deferralId = m ? m[0] : null;
  }

  if (reason === 'no-test-infra') {
    try {
      const out = runOps('ledger-ops.sh', ['add', '--type', 'tech-debt', '--title', `Red waived (no-test-infra) — ${changeId}`, '--detail', noteText, '--change', changeId]);
      const m = out.match(/LDG-\d+/);
      ledgerId = m ? m[0] : null;
    } catch (e) { console.log(`FAIL (ledger-ops add falhou: ${e.message})`); process.exit(1); }
  }

  // Furo 6 — waived_at é campo PRÓPRIO: sobrescrever recorded_at apagaria quando a evidência
  // foi originalmente declarada (útil para auditoria, sobretudo em waive --force sobre uma
  // evidência que já tinha sido record()ada antes).
  //
  // Achado HIGH da correção da #139 (iteração 2): a escrita usa `upsertSingleEntry` em vez de
  // gravar só no topo — sem isso, um `record --id` posterior reconstrói o topo a partir de
  // `entries[0]` (nunca tocado por este waive) e o waiver graduado aqui, incluindo o deferral/
  // ledger recém-criados acima, some do arquivo em silêncio. Iteração 3: `opts.id` (quando
  // `targetEntry` foi resolvido por --id) endereça a entrada certa mesmo com 2+ registradas.
  const patch = {
    status: 'waived',
    waiver: { reason, note: note || null, deferral_id: deferralId, ledger_id: ledgerId },
    waived_at: new Date().toISOString(),
  };
  const upsert = upsertSingleEntry(ev.data, changeId, (entry) => ({ ...entry, ...patch }), targetEntry && targetEntry.id != null ? { id: targetEntry.id } : undefined);
  // upsert.refused é inalcançável aqui — já recusado acima antes de qualquer efeito colateral —
  // mas o caminho fica explícito (fail-closed) em vez de assumir silenciosamente upsert.data.
  if (upsert.refused) { console.log(`FAIL (waive recusado — ${upsert.reason || 'entries[] ambíguo'})`); process.exit(1); }
  const updated = upsert.legacy ? { ...ev.data, ...patch } : upsert.data;
  writeJsonAtomic(ev.path, updated);
  const extra = [deferralId && `deferral ${deferralId}`, ledgerId && `ledger ${ledgerId}`].filter(Boolean).join(', ');
  console.log(`OK waive — ${reason}${extra ? ` (${extra})` : ''}`);
}

// ── dispatch (só quando invocado como CLI — guardado para permitir `import { evaluateRedFirst }
// from './check-red-first.mjs'` sem disparar o dispatch com o argv de quem importa; mesmo padrão
// de lib/red-level.mjs) ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [, , cmd, changeDir, ...rest] = process.argv;
  if (!cmd || !changeDir) {
    console.log('FAIL (usage: check-red-first.mjs check|status|waive <change-dir> [...])');
    process.exit(1);
  }
  switch (cmd) {
    case 'check': cmdCheck(changeDir); break;
    case 'status': cmdStatus(changeDir); break;
    case 'waive': cmdWaive(changeDir, rest); break;
    default: console.log(`FAIL (unknown subcommand: ${cmd})`); process.exit(1);
  }
}
