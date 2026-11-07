// lib/red-replay.mjs — o motor do replay (Onda C, rule testing/regression-red-first.md,
// seção "Verificação"): converte a evidência DECLARADA (Onda B, honor-system) em evidência
// OBSERVADA de fato. Roda o teste declarado (nunca a suíte inteira) em worktrees git efêmeros,
// primeiro sobre HEAD (saúde do ambiente + Green real) e depois sobre a árvore PRÉ-correção
// (derivada, nunca perguntada ao autor).
//
// Ordem de execução (Furo 5, Onda C — decisão de design do orquestrador): o comando roda em
// HEAD PRIMEIRO. Se falhar ali por erro de build/ambiente (classify() != 'behavioral'), o
// problema é o worktree efêmero não ter as dependências materializadas (node_modules/.venv/...
// não são versionadas) — not-possible, rebaixável por waiver, NUNCA um FAIL inegociável. Só
// uma falha COMPORTAMENTAL em HEAD (a correção declarada não funciona) vira FAIL de verdade
// (ruleItem 'green'). Só depois de HEAD estar saudável é que a árvore base é derivada e testada
// — não adianta gastar esforço reconstruindo/revertendo se o ambiente nem roda o comando.
//
// Quatro estratégias para derivar a base pré-correção, nesta ordem — nunca trava mudo: quando
// nenhuma das três primeiras funciona, cai em NOT-POSSIBLE, um veredito válido que a rule
// resolve com waiver (não com a máquina inventando um teste ou um commit):
//
//   (a) ANCESTRY — localiza o commit que introduziu o CASO declarado (test_id) no arquivo de
//       teste — não o commit que criou o ARQUIVO (Furo 2: arquivo de teste preexistente é o
//       fluxo comuníssimo "acrescentar caso de regressão a um arquivo antigo"; ancorar na
//       criação do arquivo levava a base para uma era anterior ao caso existir). Base = pai do
//       primeiro commit que toca fix_files DEPOIS desse commit de introdução do caso. Só se
//       aplica quando o commit de introdução do caso NÃO toca fix_files (Furo 13): se o teste
//       veio junto da correção, qualquer commit posterior que toque os mesmos arquivos é ruído,
//       e a base derivada dele JÁ contém a correção — o replay então afirmava "teste já passa na
//       árvore base" sobre uma base que nunca teve o defeito.
//   (b) REVERT-SYNTHESIS — teste e correção no mesmo commit (squash): cria um worktree em HEAD e
//       reverte, só nos fix_files, o diff da CORREÇÃO — o commit que introduziu o caso, quando é
//       ele que toca o arquivo (Furo 13; antes revertia sempre o último commit que tocou o
//       arquivo, que pode ser ruído posterior) — mantendo o teste (que já está em HEAD) intacto.
//       A base deixa de ser um commit literal e passa a ser uma árvore sintética.
//   (c) TEST-GRAFT — quando (b) existe mas o patch reverso NÃO aplica (o HEAD evoluiu longe
//       demais das regiões que a correção tocou, caso comum meses depois): base = pai do commit
//       de introdução do caso — árvore pré-correção histórica REAL — com o test_path enxertado a
//       partir desse commit. É a única base que existe quando o teste nasceu junto da correção, e
//       é literalmente o que um auditor faz à mão. O enxerto não afrouxa nada: os vereditos de
//       recusa (teste passa na base, falha não-comportamental, padrão divergente, saída que não
//       menciona o caso) continuam valendo sobre a árvore enxertada. Registra graft_from para que
//       o auditor saiba que o arquivo de teste não existia em base_commit.
//   (d) NOT-POSSIBLE — nem test_id resolve a um commit de introdução, nem os fix_files têm
//       histórico git suficiente para sintetizar o revert ou enxertar o teste, nem o test_id
//       declarado existe na árvore base derivada. Retorna { strategy:'not-possible', reason }. O
//       caller (lib/red-evidence-ops.mjs) grava status:'not-possible' e devolve exit≠0 pedindo
//       waiver — nunca lança exceção, nunca deixa o processo pendurado.
//
// Veredito 'observed' exige, na ordem: (0) comando passa em HEAD (Green real, não presumido);
// (1) o test_id declarado (quando presente) existe no arquivo de teste na árvore base — senão a
// base está errada por construção (Furo 2); (2) o teste FALHA na base (exit≠0); (3) a falha
// classifica como 'behavioral' via red-classify.mjs (nunca 'build-error'/'unknown'), ou como
// 'setup-exception' com failure_pattern declarado que casa — countsAsRed, issue #191; (4) a saída
// casa com failure_pattern quando declarado; (5) a saída MENCIONA o test_id declarado — o caso
// que falhou precisa ser o caso declarado, não uma falha histórica adjacente que por acaso casa
// com o padrão (Furo 2). Qualquer ausência aborta com motivo nomeado — ver replay() abaixo.
//
// Issue #150 — uma âncora (failure_pattern) NULA ou VAZIA casava com QUALQUER falha na base
// (matchesPattern devolvia true sem padrão nenhum), então uma base que falhasse por um motivo
// adjacente ao defeito relatado — não o defeito em si — virava 'observed' sem prova nenhuma de
// que ela seria capaz de ficar verde. Dois reforços, nenhum deles mexe no schema (record já
// exige failure_pattern; um `null` só chega aqui por um artefato legado ou editado à mão):
//   (a) matchesPattern agora recusa (devolve false) padrão nulo/vazio — a ausência de âncora
//       nunca mais "casa com tudo"; o item (4) acima passa a distinguir "diverge do padrão
//       declarado" (fail, ruleItem '4') de "não há padrão declarado" (not-possible, item 3 do
//       corpo da issue: âncora que não amarra nada é defeito do TESTE).
//   (b) positive_control (opcional, DA-13): um comando que precisa PASSAR na mesma árvore base,
//       na mesma corrida — prova, por execução, que a base seria capaz de ficar verde antes de
//       aceitar a falha do comando declarado como o defeito relatado. Falhando, not-possible com
//       a saída do controle no excerpt, mesmo que o comando declarado também falhe na base.
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { classify, countsAsRed } from './red-classify.mjs';

const DEFAULT_TIMEOUT_S = 120;
const EXCERPT_MAX_CHARS = 6000;
const MAX_BUFFER_BYTES = 64 * 1024 * 1024; // Furo 4 — teto generoso, nunca ENOBUFS silencioso

function git(root, args, opts = {}) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', ...opts });
}

function currentHeadSha(root) {
  try { return git(root, ['rev-parse', 'HEAD']).trim(); } catch { return null; }
}

function isAncestorOrEqual(root, a, b) {
  if (a === b) return true;
  try { git(root, ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function parentOf(root, sha) {
  // stderr silenciado deliberadamente: um commit sem pai (raiz de verdade, ou fronteira de clone
  // raso — LDG-0038) é esperado aqui, não um erro de execução — o `git rev-parse` "ambiguous
  // argument" cru vazando para o terminal do autor por cima da mensagem já traduzida e acionável
  // (deriveBase/applyRevert) seria ruído contradizendo o próprio propósito deste item.
  try { return git(root, ['rev-parse', `${sha}^`], { stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

// isShallowClone: repositório é um clone RASO (fetch-depth < histórico completo)? Barato — um
// único `git rev-parse` — LDG-0038. O commit-fronteira de um clone raso tem o pai
// deliberadamente escondido: para `git log -- <path>`, ele se comporta como se fosse o commit
// RAIZ do projeto e aparece como autor de todo arquivo presente na sua árvore, mesmo quando o
// arquivo foi introduzido bem antes (fora da janela do fetch). `parentOf()` sobre esse commit
// falha do mesmo jeito que falharia sobre uma raiz de verdade — sem esta distinção, a mensagem
// de not-possible diz "é commit raiz (sem pai)" também quando NÃO é, e a ação sugerida (rodar de
// novo) nunca muda nada, porque o problema é do AMBIENTE (profundidade do fetch), não do comando.
function isShallowClone(root) {
  try { return git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true'; }
  catch { return false; }
}

// noParentReason: mensagem para quando um commit escolhido para revert-synthesis não tem pai
// resolvível. Em clone raso, nomeia a causa provável (commit-fronteira, não raiz de verdade) e a
// ação corretiva (`git fetch --unshallow`); fora de um clone raso, mantém a leitura literal (é
// mesmo um commit raiz — não há o que reverter). Compartilhada por deriveBase (decide a
// estratégia, nunca chega a tentar o revert) e applyRevert (defesa em profundidade, caso algum
// caminho futuro chegue lá com um commit sem pai por outro motivo).
function noParentReason(commit, file, isShallow) {
  return isShallow
    ? `revert-synthesis: ${commit} não tem pai resolvível em ${file} — repositório é um clone RASO (shallow): git só enxerga até o commit-fronteira do fetch, que se comporta como raiz do projeto mesmo sem ser. Rode 'git fetch --unshallow' (ou aumente fetch-depth no CI) e tente de novo — repetir /forge:red replay sem isso não muda nada, o problema é do ambiente`
    : `revert-synthesis: ${commit} é commit raiz (sem pai) — não há o que reverter em ${file}`;
}

function fileExistsAt(root, ref, relPath) {
  try { execFileSync('git', ['-C', root, 'cat-file', '-e', `${ref}:${relPath}`], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function readFileAt(root, ref, relPath) {
  try { return execFileSync('git', ['-C', root, 'show', `${ref}:${relPath}`], { encoding: 'utf8' }); }
  catch { return null; }
}

// qualifiedParts: issue #190 — `Classe.Metodo` (ou `Namespace.Classe.Metodo`), a forma com que
// xUnit/NUnit/`dotnet test --filter FullyQualifiedName~` e specs nomeiam um caso, nunca aparece
// como substring de um .cs: classe e método ficam em linhas diferentes. Só reconhece a forma
// qualificada quando TODO segmento é um identificador (nada de espaço, parêntese ou hífen) — um
// nome de caso em prosa ("soma 1.5 e 2") segue exigindo a substring literal. Devolve as duas
// últimas partes ({ cls, method }) ou null.
function qualifiedParts(testId) {
  if (typeof testId !== 'string' || !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(testId)) return null;
  const segs = testId.split('.');
  return { cls: segs[segs.length - 2], method: segs[segs.length - 1] };
}

function containsWord(text, word) {
  return new RegExp(`(?<![\\w])${word}(?![\\w])`).test(text);
}

// matchesTestId: o texto (arquivo de teste ou nome de caso na linha de falha) identifica o caso
// declarado? Literal primeiro (comportamento original, cobre runner que imprime o testId como
// foi declarado); na forma qualificada, exige a CLASSE e o MÉTODO como palavras inteiras — o
// método não casa como prefixo de outro (`Metodo` × `Metodo_Extra`), e a classe precisa estar lá:
// o namespace não é conferido (o .cs o declara num `namespace` que pode ser de arquivo ou bloco).
function matchesTestId(text, testId) {
  if (text.includes(testId)) return true;
  const q = qualifiedParts(testId);
  return Boolean(q && containsWord(text, q.cls) && containsWord(text, q.method));
}

// searchedDescription: o que exatamente foi procurado, para a mensagem de not-possible (#190,
// item 3) — sem isto, o operador não sabe se o problema é o caso ou a forma com que o nomeou.
function searchedDescription(testId) {
  const q = qualifiedParts(testId);
  const lit = `test_id ('${testId}') procurado literalmente`;
  if (!q) return `${lit} — se o runner identifica o caso como Classe.Metodo, declare nessa forma (classe e método são conferidos separadamente)`;
  return `${lit} e, na forma qualificada, como classe '${q.cls}' e método '${q.method}' (palavras inteiras)`;
}

// caseExistsInContent: testId ausente ⇒ true (nada declarado, nada a exigir — não é falso
// positivo, é "não avaliável"). testId presente ⇒ precisa aparecer literalmente no conteúdo, ou,
// na forma qualificada (issue #190), classe e método precisam aparecer como palavras inteiras.
function caseExistsInContent(content, testId) {
  if (!testId) return true;
  if (typeof content !== 'string') return false;
  return matchesTestId(content, testId);
}

// commits (mais antigo primeiro) que ADICIONARAM ou MODIFICARAM test_path — cobre tanto "arquivo
// novo" quanto "caso novo num arquivo antigo" (Furo 2).
function testTouchCommits(root, testPath) {
  let out;
  try { out = git(root, ['log', '--diff-filter=AM', '--format=%H', '--reverse', '--', testPath]); } catch { return []; }
  return out.trim().split('\n').filter(Boolean);
}

// findCaseIntroCommit: primeiro commit (cronologicamente) cujo conteúdo do arquivo JÁ contém
// o test_id declarado. Sem test_id declarado, melhor esforço = primeiro commit que tocou o
// arquivo (mantém compat com evidências antigas que nunca declararam test_id).
function findCaseIntroCommit(root, testPath, testId) {
  const commits = testTouchCommits(root, testPath);
  if (!commits.length) return null;
  if (!testId) return commits[0];
  for (const c of commits) {
    if (caseExistsInContent(readFileAt(root, c, testPath), testId)) return c;
  }
  return null; // test_id nunca apareceu no histórico do arquivo — sinal honesto de not-possible
}

// primeiro commit (cronologicamente) que toca algum fix_file E que vem DEPOIS de afterCommit
// (o commit que introduziu o caso). Exclui explicitamente afterCommit === candidato — esse é o
// caso "teste e correção no mesmo commit", tratado pela estratégia (b), não por esta.
function findFixCommitAfter(root, fixFiles, afterCommit) {
  let out;
  try { out = git(root, ['log', '--format=%H', '--reverse', '--', ...fixFiles]); } catch { return null; }
  const commits = out.trim().split('\n').filter(Boolean);
  for (const c of commits) {
    if (c === afterCommit) continue;
    if (isAncestorOrEqual(root, afterCommit, c)) return c;
  }
  return null;
}

// commit mais recente (até HEAD) que tocou um fix_file específico — usado pela estratégia (b)
// para saber qual diff reverter.
function findFixLastCommit(root, file) {
  let out;
  try { out = git(root, ['log', '-1', '--format=%H', '--', file]); } catch { return null; }
  out = out.trim();
  return out || null;
}

// commitTouches: o commit alterou este arquivo? (Furo 13 — o predicado que separa "teste antes
// da correção" de "teste junto da correção"; sem ele, ancestry era tentada nos dois mundos e no
// segundo derivava uma base que já contém o fix.)
function commitTouches(root, commit, file) {
  try {
    const out = git(root, ['show', '--name-only', '--format=', commit, '--', file]);
    return out.trim().length > 0;
  } catch { return false; }
}

// deriveBase: decide a estratégia SEM tocar em disco (nenhum worktree criado aqui) — só
// inspeção de histórico. Puro o suficiente para ser testado isoladamente.
export function deriveBase({ root, testPath, fixFiles, testId }) {
  if (!testPath || !Array.isArray(fixFiles) || !fixFiles.length) {
    return { strategy: 'not-possible', reason: 'test_path/fix_files ausentes — grave com /forge:red record antes de replay' };
  }

  const caseCommit = findCaseIntroCommit(root, testPath, testId);
  // Furo 13 — o commit que introduziu o caso também toca fix_files? Então a correção está NELE
  // (squash), e ancestry não se aplica: o "primeiro commit posterior que toca fix_files" é ruído,
  // e parent(ruído) já contém o fix.
  const caseCarriesFix = caseCommit ? fixFiles.some((f) => commitTouches(root, caseCommit, f)) : false;
  if (caseCommit && !caseCarriesFix) {
    const fixCommit = findFixCommitAfter(root, fixFiles, caseCommit);
    if (fixCommit) {
      const base = parentOf(root, fixCommit);
      if (base && fileExistsAt(root, base, testPath) && caseExistsInContent(readFileAt(root, base, testPath), testId)) {
        return { strategy: 'ancestry', ref: base, caseCommit, fixCommit };
      }
    }
  }

  // (b) revert-synthesis a partir de HEAD — exige o teste (com o caso declarado) presente em
  // HEAD e histórico git para cada fix_file (sem histórico, não há o que reverter).
  const headContent = readFileAt(root, 'HEAD', testPath);
  if (headContent === null) {
    return {
      strategy: 'not-possible',
      reason: `test_path (${testPath}) não resolve por ancestry nem existe em HEAD — declare corretamente com /forge:red record ou dispense com /forge:red waive`,
    };
  }
  if (!caseExistsInContent(headContent, testId)) {
    return {
      strategy: 'not-possible',
      reason: `test_id ('${testId}') declarado não aparece em ${testPath} nem em HEAD — a base não pode conter um caso que não existe (item 3, Verificação); ${searchedDescription(testId)}`,
    };
  }
  // (c) descritor do enxerto, quando aplicável — computado aqui (barato, só histórico) para
  // servir de fallback ao revert que não aplica, e de estratégia principal quando não há sequer
  // o que reverter.
  const graftBase = caseCarriesFix ? parentOf(root, caseCommit) : null;
  const graft = graftBase ? { strategy: 'test-graft', ref: graftBase, graftFrom: caseCommit, caseCommit } : null;

  const reverts = [];
  for (const f of fixFiles) {
    // Furo 13 — reverter a CORREÇÃO, não a última mexida no arquivo: quando o caso nasceu junto
    // do fix, o commit a reverter é o do próprio caso; commits posteriores no mesmo arquivo são
    // ruído e revertê-los deixaria a base ainda corrigida.
    const c = caseCarriesFix && commitTouches(root, caseCommit, f) ? caseCommit : findFixLastCommit(root, f);
    if (!c) {
      if (graft) return graft;
      return { strategy: 'not-possible', reason: `fix_files '${f}' sem histórico git — revert-synthesis inviável` };
    }
    // LDG-0038 — confere AQUI, ainda em fase de decisão (nenhum worktree criado, nenhum revert
    // tentado), se `c` tem pai resolvível. Num clone raso, `findFixLastCommit`/`commitTouches`
    // acima podem atribuir `c` ao commit-fronteira do fetch (ele se comporta como raiz de tudo
    // que está na sua árvore) — sem esta checagem, deriveBase devolvia 'revert-synthesis' como
    // se fosse uma estratégia válida, e só mais tarde, já dentro de applyRevert() no meio do
    // worktree efêmero, o revert falhava com uma mensagem genérica ("é commit raiz, sem pai").
    // Detectar aqui é estritamente melhor: nem chega a criar worktree para uma base inválida.
    if (!parentOf(root, c)) {
      if (graft) return graft;
      return { strategy: 'not-possible', reason: noParentReason(c, f, isShallowClone(root)) };
    }
    reverts.push({ file: f, commit: c });
  }
  let head;
  try { head = git(root, ['rev-parse', 'HEAD']).trim(); } catch { return { strategy: 'not-possible', reason: 'HEAD não resolve (repo sem commits?)' }; }
  return { strategy: 'revert-synthesis', ref: head, reverts, fallback: graft };
}

// ── worktrees efêmeros ──────────────────────────────────────────────────────────────────
// _liveWorktrees rastreia todo worktree criado por ESTE processo (root, dir) para dois fins:
// (a) handler de SIGINT/SIGTERM (Furo 6) — sem isso, Ctrl-C ou timeout externo mata o processo
//     sem passar pelo finally do replay(), vazando diretório em TMPDIR e entrada administrativa
//     em `git worktree list` do repo real. (b) nunca precisamos de `git worktree prune` — cada
//     entrada é removida explicitamente pelo próprio código que a criou.
const _liveWorktrees = new Map(); // dir -> root
let _signalHandlersInstalled = false;
// Furo 12 — o processo TESTE em si (não só os worktrees) também precisa morrer num sinal
// externo: sem isto, `bash -c 'sleep 300; node --test'` e o `sleep` sobrevivem ao Ctrl-C/timeout
// externo do orquestrador, órfãos, presos ao grupo de processo que o replay criou (detached:true
// em runTest) mas nunca matou fora do próprio timeout interno.
let _liveChildPid = null;

function removeWorktreeSync(root, dir) {
  if (!dir) return;
  // Furo 7 — remove APENAS a entrada deste worktree (`worktree remove`, não `prune`). Um
  // `prune` global apagaria da lista do git entradas legítimas de OUTROS worktrees (ex.: os
  // que /forge:coding-loop cria) que estejam temporariamente ausentes do disco por qualquer
  // outro motivo — o replay não tem autoridade para arrumar a casa alheia.
  try { execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', dir], { stdio: 'ignore' }); } catch { /* best-effort */ }
  try { if (existsSync(dir)) rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  _liveWorktrees.delete(dir);
}

function installSignalHandlers() {
  if (_signalHandlersInstalled) return;
  _signalHandlersInstalled = true;
  const cleanupAndExit = (code) => {
    if (_liveChildPid) {
      try { process.kill(-_liveChildPid, 'SIGKILL'); }
      catch { try { process.kill(_liveChildPid, 'SIGKILL'); } catch { /* best-effort */ } }
      _liveChildPid = null;
    }
    for (const [dir, r] of [..._liveWorktrees]) removeWorktreeSync(r, dir);
    process.exit(code);
  };
  process.on('SIGINT', () => cleanupAndExit(130));
  process.on('SIGTERM', () => cleanupAndExit(143));
}

function makeWorktreePath() {
  // NÃO usa mkdtempSync (que já CRIA o diretório) — `git worktree add` exige que o destino
  // não exista ainda.
  const rand = Math.random().toString(16).slice(2) + process.pid.toString(16);
  return join(tmpdir(), `forge-red-replay-${rand}`);
}

function addWorktree(root, ref) {
  installSignalHandlers();
  const dir = makeWorktreePath();
  execFileSync('git', ['-C', root, 'worktree', 'add', '--detach', dir, ref], { stdio: ['ignore', 'pipe', 'pipe'] });
  _liveWorktrees.set(dir, root);
  return dir;
}

function removeWorktree(root, dir) {
  removeWorktreeSync(root, dir);
}

// applyRevert: para cada fix_file, calcula o diff commit->pai (a reversão exata da correção
// introduzida por `commit`) e aplica no worktree. Ordem do `git diff` é DELIBERADA — diff(commit,
// pai) descreve "o que muda ao ir de commit para pai", ou seja, já é o patch reverso; aplicá-lo
// (sem -R) transforma o estado 'commit' (o que o worktree tem, checkado em HEAD) em 'pai'.
// Retorna o texto combinado dos patches aplicados (Furo 8 — para reprodução por um auditor).
function applyRevert(root, worktreeDir, reverts) {
  const applied = [];
  for (const { file, commit } of reverts) {
    const parent = parentOf(root, commit);
    // LDG-0038 — defesa em profundidade: deriveBase() já filtra este caso antes de chegar aqui
    // (não escolhe mais um `c` sem pai resolvível), mas o guard fica — barato e evita que um
    // caminho futuro reintroduza o mesmo "é commit raiz (sem pai)" genérico sem o diagnóstico
    // de clone raso.
    if (!parent) throw new Error(noParentReason(commit, file, isShallowClone(root)));
    let diff;
    try { diff = git(root, ['diff', commit, parent, '--', file]); }
    catch (e) { throw new Error(`revert-synthesis: git diff falhou para ${file} (${e.message})`); }
    if (!diff.trim()) continue; // arquivo sem mudança nesse commit — nada a reverter
    try {
      execFileSync('git', ['-C', worktreeDir, 'apply', '--whitespace=nowarn', '-'], { input: diff, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      applied.push(diff);
    } catch (e) {
      const detail = (e.stderr || e.message || '').toString().trim();
      throw new Error(`revert-synthesis: não foi possível aplicar o patch reverso em ${file} (${detail})`);
    }
  }
  return applied.join('\n');
}

// graftTest: materializa o arquivo de teste na árvore base a partir do commit que o introduziu
// (Furo 13, estratégia (c)). Preserva o bit de execução do blob original — teste declarado como
// `./tests/x.sh` não roda se o enxerto vier sem +x. Nunca toca nada além do test_path: a base
// continua sendo, byte a byte, a árvore pré-correção histórica em todo o resto.
function graftTest(root, worktreeDir, testPath, graftFrom) {
  const content = readFileAt(root, graftFrom, testPath);
  if (content === null) {
    throw new Error(`test-graft: ${testPath} não existe em ${String(graftFrom).slice(0, 7)} — não há teste a enxertar`);
  }
  let mode = '100644';
  try {
    const entry = git(root, ['ls-tree', graftFrom, '--', testPath]).trim();
    if (entry) mode = entry.split(/\s+/)[0] || mode;
  } catch { /* mode default */ }
  const dest = join(worktreeDir, testPath);
  try {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content, { encoding: 'utf8', mode: mode === '100755' ? 0o755 : 0o644 });
  } catch (e) {
    throw new Error(`test-graft: falha ao enxertar ${testPath} na árvore base (${e.message})`);
  }
}

// runTest: roda exatamente o comando declarado — nunca a suíte — via child_process.spawn com
// grupo de processo próprio (Furo 3/9). `detached:true` faz do processo filho o líder de um
// novo grupo; ao estourar o timeout, `process.kill(-child.pid, 'SIGKILL')` mata o GRUPO inteiro
// — inclusive filhos em background (`cmd & outro-cmd`) que herdam o mesmo grupo e, de outra
// forma, manteriam o pipe de stdout aberto para sempre (o bug medido: 91s com timeout de 3s).
// Sem dependência de `perl`/`timeout(1)` — zero-dep, portável (Furo 9).
function runTest({ cwd, command, timeoutS }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('bash', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ exitCode: null, output: `spawn falhou: ${e.message}`, timedOut: false, indeterminate: true });
      return;
    }
    _liveChildPid = child.pid;
    let out = '';
    let bytes = 0;
    let overflowed = false;
    let timedOut = false;
    let settled = false;

    const append = (chunk) => {
      if (overflowed) return;
      bytes += chunk.length;
      if (bytes > MAX_BUFFER_BYTES) {
        overflowed = true;
        out += `\n…(saída truncada — excedeu o teto de ${MAX_BUFFER_BYTES} bytes)…`;
        return;
      }
      out += chunk;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* best-effort */ } }
    }, Math.max(1, timeoutS) * 1000);
    // failsafe: garante que o timer não segure o processo Node vivo além do necessário
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.on('data', (d) => append(d.toString('utf8')));
    child.stderr.on('data', (d) => append(d.toString('utf8')));

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (_liveChildPid === child.pid) _liveChildPid = null;
      resolve(result);
    };

    child.on('error', (e) => {
      finish({ exitCode: null, output: `${out}\nerro ao executar: ${e.message}`, timedOut, indeterminate: true });
    });
    child.on('close', (code, signal) => {
      if (timedOut) {
        finish({ exitCode: 124, output: `${out}\n…(timeout de ${timeoutS}s excedido — processo e filhos do grupo encerrados)…`, timedOut: true, indeterminate: false });
        return;
      }
      if (code === null && signal) {
        // encerrado por sinal externo (não nosso timeout) — estado ambíguo, não é nem
        // "passou" nem uma falha comportamental confiável (Furo 4).
        finish({ exitCode: null, output: `${out}\n…(processo encerrado por sinal ${signal})…`, timedOut: false, indeterminate: true });
        return;
      }
      finish({ exitCode: typeof code === 'number' ? code : 1, output: out, timedOut: false, indeterminate: false });
    });
  });
}

// LDG-0020: só guardar a CAUDA perdia a asserção (Expected/Actual) em teste de integração
// verboso, quando o log de depuração do host enche o fim da saída e a asserção fica mais perto
// do começo — check-red-first.sh reclassificava o excerto armazenado como 'unknown' mesmo com
// Red observado de verdade pelo replay (a classificação do replay, acima, usa a saída INTEIRA;
// só o excerto truncado que sobrevive no artefato é que perdia a asserção). Com `pattern`
// (failure_pattern da evidência) em mãos, guarda uma janela em torno do primeiro match — a
// prova de que a asserção existe na saída, não qualquer trecho dela. Sem pattern, ou sem
// match (pattern mudou desde a última gravação, por exemplo), cai para cabeça+cauda: a
// asserção pode estar em qualquer um dos dois extremos de uma saída verbosa, nunca só no fim.
export function truncateExcerpt(s, pattern) {
  const text = String(s || '');
  if (text.length <= EXCERPT_MAX_CHARS) return text;
  const half = Math.floor(EXCERPT_MAX_CHARS / 2);
  if (pattern) {
    let match = null;
    try { match = new RegExp(pattern, 'm').exec(text); } catch { match = null; }
    if (match) {
      const start = Math.max(0, match.index - half);
      const end = Math.min(text.length, match.index + match[0].length + half);
      const prefix = start > 0 ? `…(truncado — ${text.length} chars)…\n` : '';
      const suffix = end < text.length ? `\n…(truncado)…` : '';
      return `${prefix}${text.slice(start, end)}${suffix}`;
    }
  }
  return `${text.slice(0, half)}\n…(truncado — ${text.length} chars)…\n${text.slice(-half)}`;
}

// normalizeExcerpt: torna o excerto REPRODUZÍVEL antes de hashear (Furo 11) — sem isso,
// excerpt_sha256 é decorativo (o texto embute o path aleatório do worktree, então o hash muda
// a cada execução e ninguém pode conferi-lo). Substitui os paths de worktree por um placeholder
// fixo, normaliza separadores e some com durações/timestamps variáveis.
function normalizeExcerpt(text, worktreeDirs = []) {
  let out = String(text || '');
  for (const dir of worktreeDirs) {
    if (!dir) continue;
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), '<WORKTREE>');
  }
  out = out.replace(/\\/g, '/');
  out = out.replace(/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/gi, '<DUR>');
  // Furo 11 (correção) — `node --test` (reporter TAP) emite `# duration_ms 258.955917` por caso:
  // o número NÃO fica colado a "ms"/"s" (fica colado ao NOME do campo, "duration_ms"), então a
  // regex acima nunca casava e o excerpt trazia um float de duração diferente a cada replay do
  // MESMO change — excerpt_sha256 instável (três replays, três hashes). Cobre qualquer chave que
  // termine literalmente em "_ms"/"_seconds" seguida de número (duration_ms, elapsed_ms,
  // wall_time_seconds, ...) — ancorado no SUFIXO exato da chave (não em substring solta tipo
  // "time"/"duration" no meio de uma palavra qualquer), para não corromper prosa legítima do
  // excerpt (uma AssertionError podendo conter as palavras "sometimes"/"lifetime" etc.).
  out = out.replace(/\b(\w*_(?:ms|seconds?))\b[:=]?\s*\d+(?:\.\d+)?/gi, '$1 <DUR>');
  out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<TS>');
  return out;
}

// matchesPattern: issue #150 — padrão nulo/vazio NUNCA casa (antes devolvia `true`, o que fazia
// qualquer falha na base — inclusive uma falha adjacente ao defeito relatado — parecer uma
// âncora satisfeita). O chamador (replay(), abaixo) distingue essa ausência de um mismatch
// genuíno para dar o veredito certo (not-possible vs fail item 4).
export function matchesPattern(output, pattern) {
  if (pattern === null || pattern === undefined || pattern === '') return false;
  try { return new RegExp(pattern).test(output); }
  catch { return output.includes(pattern); }
}

// FAILURE_LINE_PATTERNS: assinaturas de "este caso especificamente FALHOU", uma por formato de
// runner (Onda E, item 3b — auditoria: a versão anterior de outputMentionsCase casava testId em
// QUALQUER LUGAR da saída, e um reporter TAP como `node --test` imprime também os casos que
// PASSARAM — um excerto em que o caso declarado aparece com ✔ e quem falhou foi outro caso
// diferente passava como se fosse o defeito relatado). Cada padrão captura o NOME/identificador
// do caso na linha de falha; outputMentionsCase confere testId só contra essas capturas, nunca
// contra a saída inteira.
const FAILURE_LINE_PATTERNS = [
  // node --test / TAP genérico: "not ok 2 - <nome>"
  /^not ok\s+\d+\s*-\s*(.+)$/gm,
  // reporters "spec"-like com marcador de falha explícito: "✖ <nome>" / "✗ <nome>"
  /^\s*[✖✗]\s+(.+)$/gm,
  // pytest — resumo curto: "FAILED path/to/test.py::test_nome[params] - Motivo"
  /^FAILED\s+(\S+)/gm,
  // pytest — cabeçalho de falha detalhada: "____ test_nome ____"
  /^_{3,}\s*(.+?)\s*_{3,}\s*$/gm,
  // xUnit (.NET, `dotnet test`): "Failed TestNamespace.TestClass.TestMethod [12 ms]"
  /^\s*Failed\s+(\S+)/gm,
  // JUnit — maven surefire: "[ERROR] testFoo(com.example.FooTest)  Time elapsed: ..."
  /^\[ERROR\]\s+(\S+)/gm,
  // JUnit — gradle: "com.example.FooTest > testFoo FAILED"
  /^(\S+)\s*>\s*(\S+)\s+FAILED\s*$/gm,
  // Go: "--- FAIL: TestFoo (0.00s)"
  /^--- FAIL:\s*(\S+)/gm,
];

// outputMentionsCase: o CASO que falhou tem que ser o declarado (Furo 2, item C) — sem isso,
// uma falha histórica adjacente que por acaso casa com failure_pattern (ex.: "AssertionError"
// genérico) passaria como se fosse o defeito relatado. Casa testId contra as LINHAS DE FALHA
// reconhecidas (ver FAILURE_LINE_PATTERNS), não contra a saída inteira — sem isso, um caso que
// PASSOU (✔/ok) mas cujo nome contém testId como substring bastava para aprovar, mesmo quando o
// caso que de fato falhou é outro completamente diferente. Formato não reconhecido (nenhuma
// linha de falha identificada por assinatura conhecida) cai no fallback de substring na saída
// inteira — degradação deliberada para não cegar runners fora da lista coberta.
function outputMentionsCase(output, testId) {
  if (!testId) return true;
  const text = String(output || '');
  const failingNames = [];
  for (const re of FAILURE_LINE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      for (let i = 1; i < m.length; i++) if (m[i]) failingNames.push(m[i]);
      if (!re.global) break;
    }
  }
  // issue #190 — mesma regra de identificação do caso que vale para o arquivo de teste: literal,
  // ou classe e método como palavras inteiras na MESMA linha de falha (nunca espalhados pela saída
  // quando há linhas de falha reconhecidas — senão um caso vizinho da mesma classe passaria).
  if (failingNames.length) return failingNames.some((n) => matchesTestId(n, testId));
  return matchesTestId(text, testId);
}

async function runSetup({ cwd, setupCommand, timeoutS }) {
  if (!setupCommand) return { ok: true };
  const res = await runTest({ cwd, command: setupCommand, timeoutS });
  if (res.indeterminate) return { ok: false, reason: 'setup_command com resultado indeterminado', run: res };
  if (res.exitCode !== 0) return { ok: false, reason: 'setup_command falhou', run: res };
  return { ok: true };
}

// replay: orquestra HEAD(saúde) → derive → worktree(s) → run(s) → veredito. SEMPRE limpa os
// worktrees que criou, mesmo em erro (try/finally) — nunca deixa lixo em `git worktree list`.
export async function replay({ root, evidence, timeoutS = DEFAULT_TIMEOUT_S }) {
  const testPath = evidence && evidence.test_path;
  const testId = (evidence && evidence.test_id) || null;
  const command = evidence && evidence.command;
  const fixFiles = (evidence && evidence.fix_files) || [];
  const failurePattern = evidence && evidence.failure_pattern;
  const setupCommand = (evidence && evidence.setup_command) || null;
  const positiveControl = (evidence && evidence.positive_control) || null;

  const replayHead = currentHeadSha(root);
  const finish = (obj) => ({ replay_head: replayHead, ...obj });

  if (!testPath || !command) {
    return finish({ verdict: 'not-possible', reason: 'test_path/command ausentes — grave com /forge:red record antes de replay' });
  }

  const descriptor = deriveBase({ root, testPath, fixFiles, testId });
  if (descriptor.strategy === 'not-possible') {
    return finish({ verdict: 'not-possible', reason: descriptor.reason, strategy: 'not-possible' });
  }

  let headDir = null;
  let baseDir = null;
  try {
    // ── passo 0 (Furo 5): HEAD primeiro. Distingue "ambiente do worktree incompleto" (não
    // culpa do Red-first, rebaixável) de "a correção declarada realmente não funciona"
    // (FAIL de verdade, ruleItem 'green').
    try {
      headDir = addWorktree(root, 'HEAD');
    } catch (e) {
      return finish({ verdict: 'not-possible', reason: `worktree HEAD falhou: ${(e.stderr || e.message || '').toString().trim()}` });
    }
    const headSetup = await runSetup({ cwd: headDir, setupCommand, timeoutS });
    if (!headSetup.ok) {
      return finish({ verdict: 'not-possible', reason: `ambiente do worktree incompleto — ${headSetup.reason} em HEAD (declare setup_command correto ou dispense com /forge:red waive)`, strategy: descriptor.strategy });
    }
    const headRun = await runTest({ cwd: headDir, command, timeoutS });
    if (headRun.indeterminate) {
      return finish({ verdict: 'not-possible', reason: 'ambiente do worktree incompleto — execução indeterminada em HEAD (sinal externo/erro de spawn)', strategy: descriptor.strategy });
    }
    if (headRun.exitCode !== 0) {
      const headClassification = classify(headRun.output);
      if (headClassification !== 'behavioral') {
        return finish({
          verdict: 'not-possible',
          reason: `ambiente do worktree incompleto — comando falha em HEAD com sinal de erro de build/ambiente ('${headClassification}'), não comportamental (dependências não versionadas? declare setup_command)`,
          strategy: descriptor.strategy,
          diagnostic: { classification: headClassification, excerpt: truncateExcerpt(normalizeExcerpt(headRun.output, [headDir])) },
        });
      }
      return finish({
        verdict: 'fail', ruleItem: 'green',
        reason: 'teste falha em HEAD — a correção declarada não torna o teste verde',
        strategy: descriptor.strategy,
        diagnostic: { classification: headClassification, excerpt: truncateExcerpt(normalizeExcerpt(headRun.output, [headDir])) },
      });
    }

    // ── árvore base derivada ────────────────────────────────────────────────────────────
    // `effective` pode divergir de `descriptor`: um revert-synthesis cujo patch não aplica cai
    // para o test-graft anunciado em descriptor.fallback (Furo 13). Todo o resto do fluxo — e o
    // que vai para o artefato — lê `effective`, nunca o descritor original.
    let effective = descriptor;
    try {
      baseDir = addWorktree(root, effective.strategy === 'revert-synthesis' ? 'HEAD' : effective.ref);
    } catch (e) {
      return finish({ verdict: 'not-possible', reason: `worktree base falhou: ${(e.stderr || e.message || '').toString().trim()}`, strategy: effective.strategy });
    }
    let revertPatch = null;
    if (effective.strategy === 'revert-synthesis') {
      try { revertPatch = applyRevert(root, baseDir, effective.reverts); }
      catch (e) {
        if (!descriptor.fallback) {
          return finish({ verdict: 'not-possible', reason: e.message, strategy: effective.strategy });
        }
        // o revert não aplica sobre este HEAD — troca de worktree e segue pelo enxerto, que usa
        // uma árvore histórica real em vez de uma sintética.
        removeWorktree(root, baseDir);
        baseDir = null;
        effective = descriptor.fallback;
        try { baseDir = addWorktree(root, effective.ref); }
        catch (e2) { return finish({ verdict: 'not-possible', reason: `worktree base falhou: ${(e2.stderr || e2.message || '').toString().trim()}`, strategy: effective.strategy }); }
      }
    }
    if (effective.strategy === 'test-graft') {
      try { graftTest(root, baseDir, testPath, effective.graftFrom); }
      catch (e) { return finish({ verdict: 'not-possible', reason: e.message, strategy: effective.strategy }); }
    }
    if (!existsSync(join(baseDir, testPath))) {
      return finish({ verdict: 'not-possible', reason: `test_path (${testPath}) ausente na árvore base derivada`, strategy: effective.strategy });
    }
    // Furo 2, defesa em profundidade: confere de novo no worktree materializado (não só no
    // blob via `git show`, cujo resultado deriveBase já validou) — protege contra fix_files
    // que colidam acidentalmente com test_path durante o revert.
    let baseTestContent = null;
    try { baseTestContent = readFileSync(join(baseDir, testPath), 'utf8'); } catch { baseTestContent = null; }
    if (!caseExistsInContent(baseTestContent, testId)) {
      return finish({ verdict: 'not-possible', reason: `test_id ('${testId}') declarado não aparece na árvore base derivada — a base está errada; ${searchedDescription(testId)}`, strategy: effective.strategy });
    }

    const baseSetup = await runSetup({ cwd: baseDir, setupCommand, timeoutS });
    if (!baseSetup.ok) {
      return finish({ verdict: 'not-possible', reason: `ambiente do worktree incompleto — ${baseSetup.reason} na base (declare setup_command correto ou dispense com /forge:red waive)`, strategy: effective.strategy });
    }

    // ── positive_control (issue #150, opcional — DA-13) ─────────────────────────────────
    // Roda ANTES do comando declarado, na MESMA árvore base e na mesma corrida: prova, por
    // execução real, que a base é capaz de passar em ALGO antes de aceitar a falha do comando
    // declarado como o defeito relatado. Falhando (ou indeterminado), not-possible — nunca deixa
    // o comando declarado decidir sozinho quando não há prova de que a base seria capaz de ficar
    // verde (item 3 do corpo da issue: a âncora que não amarra nada é defeito do teste).
    if (positiveControl) {
      const pcRun = await runTest({ cwd: baseDir, command: positiveControl, timeoutS });
      if (pcRun.indeterminate) {
        return finish({ verdict: 'not-possible', reason: 'positive_control com resultado indeterminado na base (sinal externo/erro de spawn)', strategy: effective.strategy });
      }
      if (pcRun.exitCode !== 0) {
        const pcExcerpt = truncateExcerpt(normalizeExcerpt(pcRun.output, [baseDir, headDir]));
        return finish({
          verdict: 'not-possible',
          reason: 'positive_control declarado falha na base — sem prova de que a base seria capaz de ficar verde, a falha do comando declarado não comprova o defeito relatado (item 3 do corpo da issue #150)',
          strategy: effective.strategy,
          // classification fica null (não 'behavioral'/'build-error'/'unknown' — nenhum descreve
          // a falha de um positive_control, que não é o teste declarado) — só o excerpt do
          // controle importa aqui, para o auditor ver por que a base foi recusada.
          diagnostic: { classification: null, excerpt: pcExcerpt },
        });
      }
    }

    const baseRun = await runTest({ cwd: baseDir, command, timeoutS });
    if (baseRun.indeterminate) {
      return finish({ verdict: 'not-possible', reason: 'ambiente do worktree incompleto — execução indeterminada na base (sinal externo/erro de spawn)', strategy: effective.strategy });
    }
    const classification = classify(baseRun.output);
    const excerpt = truncateExcerpt(normalizeExcerpt(baseRun.output, [baseDir, headDir]), failurePattern);
    const baseInfo = { strategy: effective.strategy, ref: effective.ref, exitCode: baseRun.exitCode, classification, excerpt };

    if (baseRun.exitCode === 0) {
      return finish({ verdict: 'fail', ruleItem: '2', reason: 'teste já passa na árvore base — não reproduz o defeito relatado (item 2)', strategy: effective.strategy, base: baseInfo, base_result: 'passed', diagnostic: { classification, excerpt } });
    }
    if (!countsAsRed(classification, baseRun.output, failurePattern)) {
      return finish({
        verdict: 'fail', ruleItem: '3',
        reason: classification === 'setup-exception'
          ? `falha na base classificada como 'setup-exception' — exceção de setup só conta como Red com failure_pattern declarado que case com a saída; sem isso, exceção de ambiente (Docker parado, porta ocupada) passaria por defeito (item 3, issue #191)`
          : `falha na base classificada como '${classification}' — erro de build/compilação, não comportamento (item 3)`,
        strategy: effective.strategy, base: baseInfo, base_result: 'failed', diagnostic: { classification, excerpt },
      });
    }
    if (!matchesPattern(baseRun.output, failurePattern)) {
      // issue #150 — failure_pattern ausente/vazio é distinto de um mismatch genuíno: uma âncora
      // que não amarra nada nunca comprova o defeito relatado, então o veredito é not-possible
      // (defeito do TESTE — precisa de /forge:red record com failure_pattern declarado), não um
      // fail de item 4 (que pressupõe um padrão declarado que a saída real não corresponde).
      if (!failurePattern) {
        return finish({
          verdict: 'not-possible',
          reason: 'failure_pattern ausente ou vazio na evidência — uma âncora vazia aceitaria qualquer falha na base como se fosse o defeito relatado (item 3 do corpo da issue #150: a âncora que não amarra nada é defeito do TESTE, que afirma o CAMINHO da falha, não só o resultado). Declare failure_pattern com /forge:red record antes de replay',
          strategy: effective.strategy, base: baseInfo, base_result: 'failed', diagnostic: { classification, excerpt },
        });
      }
      return finish({
        verdict: 'fail', ruleItem: '4',
        reason: `saída da falha diverge do failure_pattern declarado ('${failurePattern}') (item 4)`,
        strategy: effective.strategy, base: baseInfo, base_result: 'failed', diagnostic: { classification, excerpt },
      });
    }
    if (!outputMentionsCase(baseRun.output, testId)) {
      return finish({
        verdict: 'fail', ruleItem: 'test-id',
        reason: `saída da falha não menciona o caso declarado (test_id: '${testId}') — o caso que falhou pode não ser o declarado`,
        strategy: effective.strategy, base: baseInfo, base_result: 'failed', diagnostic: { classification, excerpt },
      });
    }

    return finish({
      verdict: 'observed',
      strategy: effective.strategy,
      base_strategy: effective.strategy,
      // 'ancestry': effective.ref é o commit pré-correção real. 'revert-synthesis': effective.ref
      // é o HEAD a partir do qual o revert foi sintetizado (não existe um commit literal
      // pré-correção — a árvore é sintética) — registrado assim mesmo por ser a referência mais
      // honesta disponível (rastreável, resolve no histórico real). 'test-graft': effective.ref é
      // o pai do commit que trouxe teste+correção — commit real e pré-correção —, mas o arquivo
      // de teste NÃO existe lá; graft_from diz de onde ele foi enxertado, sem o que a evidência
      // pareceria contraditória para quem tentasse reproduzi-la.
      base_commit: effective.ref,
      graft_from: effective.strategy === 'test-graft' ? effective.graftFrom : null,
      classification,
      excerpt,
      base_result: 'failed',
      revert_patch: revertPatch,
      head: { exitCode: 0 },
    });
  } finally {
    removeWorktree(root, baseDir);
    removeWorktree(root, headDir);
  }
}

// ── replayTask (issue #156) ─────────────────────────────────────────────────────────────────────
// O vermelho do TDD de uma TASK delegada, provado por execução. Mesmo motor do replay acima
// (worktree git efêmero, um comando, timeout explícito, classificador de falha), sem derivar base:
// o chamador aponta os dois commits — o de vermelho e o de implementação (verde).
//
// Invariante: o TESTE DO VERDE falha sobre a árvore do vermelho por asserção (rc ≠ 0, saída
// classificada como 'behavioral' — nunca 'build-error' nem 'unknown' — e casando failure_pattern)
// e passa sobre a árvore do verde. Cinco regras sustentam isso:
//
//   (1) ENXERTO — os arquivos de teste (convenção de isTestPath) que diferem entre vermelho e verde
//       são materializados na árvore do vermelho na versão do verde (apagados, se o verde os
//       apagou), como o graftTest do replay de bugfix. O teste fica fixo; o vermelho só pode
//       diferir do verde na implementação. Fecha o vermelho que traz a implementação completa com
//       um teste forjado (expectativa errada, assert.fail() incondicional, fixture ou snapshot
//       adulterado) que o verde só corrige.
//   (2) INFRAESTRUTURA — o commit de vermelho não pode tocar arquivo de infraestrutura
//       (isInfraPath: manifesto, lockfile, config de build/teste, scripts/, CI, dotfiles, e todo
//       arquivo citado pelo comando do teste ou do setup). Arquivo de teste é enxertado; arquivo
//       de produção (stub) é permitido; infraestrutura reprova com [vermelho-infra]. Fecha o
//       vermelho que sabota setup, package.json ou config de teste para falhar e o verde reverte.
//   (3) TOPOLOGIA — com --green: o verde tem exatamente um pai, e ele é o vermelho (nada entre os
//       dois, nada depois do verde se o chamador passa o HEAD da TASK); com --task-base: o pai do
//       vermelho é o início da TASK (nada da TASK antes do vermelho); com --task-id: o assunto do
//       vermelho contém "<TASK> — vermelho" e o do verde contém "<TASK> — " sem "vermelho".
//   (4) VERDE VAZIO — depois do enxerto e antes de rodar o teste no vermelho: se vermelho e verde
//       não diferem em nenhum arquivo fora da convenção de teste (git diff --name-only entre os dois
//       commits, filtrado por isTestPath), as duas árvores são iguais e o verde não implementa nada.
//       Reprova com [vermelho-vazio], sem gastar execução: qualquer falha do vermelho viria do
//       ambiente, não do código (teste que lê o assunto do commit, que grava um arquivo fora da
//       worktree na primeira execução e passa na segunda). A checagem prova que o verde muda algum
//       arquivo de produção, não que a mudança é a causa do verde.
//   (5) CLASSIFICAÇÃO — a mesma política do replay de bugfix: só 'behavioral' com padrão casado é
//       vermelho. 'build-error' reprova com [vermelho-compilacao]; 'unknown' (nenhuma assinatura de
//       framework de asserção) reprova com [vermelho-padrao].
//
// Limites declarados — o que isto NÃO detecta, de propósito (execução não distingue; fica para a
// revisão do diff e para o gate humano do plano):
//   - stub que imprime 'AssertionError' e chama process.exit(1): a saída casa a assinatura e o
//     padrão sem asserção nenhuma ter rodado;
//   - comando do plano que roda outro teste (ou nenhum, ex.: `grep -q ... || exit 1`): o comando
//     vem do plano, que passa por gate humano;
//   - lógica num arquivo de produção que o teste declarado não exercita: o vermelho pode trazê-la
//     inteira sem que o teste perceba;
//   - sabotagem em src/ que o verde remove: lógica quebrada de propósito num arquivo de produção do
//     vermelho é indistinguível de um stub por execução — não há classificação "stub vs lógica".
//
// Sem --green, roda só o vermelho com o teste do PRÓPRIO vermelho — pré-checagem, sem enxerto nem
// topologia, que não prova o TDD; o OK diz isso. A prova é sempre com --green.
//
// Devolve { ok, stage, code, reason, excerpt? }. `code` é o token estável que o gate w242 confere:
// entrada | topologia | vermelho-infra | vermelho-vazio | vermelho-ambiente | vermelho-indeterminado |
// vermelho-timeout | vermelho-passa | vermelho-compilacao | vermelho-padrao | verde-ambiente |
// verde-indeterminado | verde-timeout | verde-falha.

// Convenção de arquivo de teste — a mesma serve para o enxerto e para a regra de infraestrutura.
// Diretório: qualquer segmento do caminho é um nome de pasta de teste ou de material de teste
// (test/, tests/, __tests__/, spec/, e2e/, testdata/, fixtures/, test-utils/, testutil(s)/, testing/,
// support/, golden/, snapshots/...) ou um projeto de teste .NET/Java (Money.Tests/, foo-tests/,
// Bar.UnitTests/). Nome: *.test.*, *.spec.*, *_test.*, *_spec.*, test_*.py, conftest.py, *.snap,
// FooTest(s).cs/.java/.kt..., FooSpec.scala, FooIT.java. A convenção é larga de propósito: tudo o
// que ela reconhece é enxertado do verde, então ampliá-la só torna o enxerto mais rigoroso.
const TEST_DIR_SEGMENTS = new Set([
  'test', 'tests', '__tests__', '__mocks__', '__snapshots__', '__fixtures__', 'spec', 'testdata', 'e2e',
  'fixtures', 'test-utils', 'testutil', 'testutils', 'testing', 'support', 'golden', 'snapshots',
]);
const TEST_PROJECT_DIR_RE = /[.\-_](?:unit|integration|functional|e2e)?tests?$/i;
const TEST_BASENAME_RES = [
  /\.(?:test|spec)\.[^/]+$/i,
  /_(?:test|spec)\.[^./]+$/i,
  /^test_[^/]*\.py$/i,
  /^conftest\.py$/,
  /\.snap$/i,
  /(?:Tests?|Spec|IT)\.(?:java|kt|kts|cs|fs|vb|scala|groovy|swift|php)$/,
];
export function isTestPath(p) {
  const segs = String(p).split('/');
  const base = segs.pop();
  if (segs.some((s) => TEST_DIR_SEGMENTS.has(s.toLowerCase()) || TEST_PROJECT_DIR_RE.test(s))) return true;
  return TEST_BASENAME_RES.some((re) => re.test(base));
}

// Convenção de infraestrutura — o que o vermelho não pode tocar (nunca avaliada para arquivo de
// teste, que é enxertado do verde). Inclui todo arquivo citado literalmente pelo comando do teste
// ou do setup (ex.: `bash run-tests.sh`).
const INFRA_DIR_SEGMENTS = new Set(['scripts', 'ci']);
const INFRA_BASENAMES = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lockb',
  'Makefile', 'makefile', 'GNUmakefile', 'Dockerfile', 'Containerfile', 'Justfile', 'justfile', 'Taskfile.yml',
  'go.mod', 'go.sum', 'go.work', 'Cargo.toml', 'Cargo.lock',
  'pyproject.toml', 'setup.py', 'setup.cfg', 'tox.ini', 'pytest.ini', 'noxfile.py', 'Pipfile', 'Pipfile.lock', 'poetry.lock', 'uv.lock',
  'pom.xml', 'gradle.properties', 'gradlew', 'gradlew.bat', 'build.xml', 'build.sbt',
  'global.json', 'nuget.config', 'NuGet.Config', 'Gemfile', 'Gemfile.lock', 'Rakefile', 'composer.json', 'composer.lock', 'CMakeLists.txt',
]);
const INFRA_BASENAME_RES = [
  /\.config\.[cm]?[jt]sx?$/i,               // jest/vitest/vite/babel/webpack/playwright.config.*
  /^tsconfig.*\.json$/i, /^jsconfig.*\.json$/i,
  /^requirements.*\.txt$/i,
  /^(?:jest|vitest|karma|mocha|babel)[.\-_]/i,  // jest.setup.js, karma.conf.js, babel.config...
  /^(?:setup|test)[-_]?(?:tests?|setup)\.[^/]+$/i, // setupTests.ts, test-setup.js
  /\.(?:csproj|fsproj|vbproj|sln|props|targets|runsettings|cmake|gradle|gradle\.kts|mk)$/i,
  /^docker-compose.*\.ya?ml$/i, /^compose\.ya?ml$/i,
];
function commandPaths(...commands) {
  const out = new Set();
  for (const c of commands) {
    if (!c) continue;
    for (const tok of String(c).split(/[\s'"`;&|()<>=]+/)) {
      const t = tok.replace(/^\.\//, '');
      if (t) out.add(t);
    }
  }
  return out;
}
export function isInfraPath(p, cmdPaths = new Set()) {
  const s = String(p);
  if (cmdPaths.has(s)) return true;
  const segs = s.split('/');
  const base = segs[segs.length - 1];
  if (segs.some((seg) => seg.startsWith('.') || INFRA_DIR_SEGMENTS.has(seg.toLowerCase()))) return true;
  return INFRA_BASENAMES.has(base) || INFRA_BASENAME_RES.some((re) => re.test(base));
}

function splitZ(out) { return String(out || '').split('\0').filter(Boolean); }

// graftTaskTests: materializa na árvore do vermelho os arquivos de teste do verde — só os que
// diferem entre os dois commits; os iguais já estão lá. Arquivo de teste que o verde apagou some
// da árvore do vermelho. Preserva o bit de execução. Devolve a lista de caminhos enxertados.
function graftTaskTests(root, dir, redSha, graftFrom) {
  const changed = splitZ(git(root, ['diff', '--name-only', '--no-renames', '-z', redSha, graftFrom])).filter(isTestPath);
  for (const p of changed) {
    const dest = join(dir, p);
    let entry = '';
    try { entry = git(root, ['ls-tree', '-z', graftFrom, '--', p]).replace(/\0$/, '').trim(); } catch { entry = ''; }
    if (!entry) { rmSync(dest, { force: true }); continue; }
    const mode = entry.split(/\s+/)[0];
    const content = execFileSync('git', ['-C', root, 'show', `${graftFrom}:${p}`], { maxBuffer: MAX_BUFFER_BYTES });
    mkdirSync(dirname(dest), { recursive: true });
    rmSync(dest, { force: true });
    writeFileSync(dest, content, { mode: mode === '100755' ? 0o755 : 0o644 });
  }
  return changed;
}

export async function replayTask({ root, red, green = null, taskBase = null, taskId = null, command, failurePattern, setupCommand = null, timeoutS = DEFAULT_TIMEOUT_S }) {
  const bad = (code, reason) => ({ ok: false, stage: 'entrada', code, reason });
  if (!command) return bad('entrada', '--command ausente — declare o comando do teste na TASK do plano');
  if (!failurePattern) return bad('entrada', '--failure-pattern ausente ou vazio — sem a assinatura da asserção, qualquer falha passaria por vermelho');
  const resolveRef = (ref) => { try { return git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim(); } catch { return null; } };
  const parentsOf = (sha) => git(root, ['rev-list', '--parents', '-n', '1', sha]).trim().split(/\s+/).slice(1);
  const subjectOf = (sha) => git(root, ['log', '-1', '--format=%s', sha]).trim();
  const topo = (reason) => ({ ok: false, stage: 'topologia', code: 'topologia', reason });

  const redSha = red ? resolveRef(red) : null;
  if (!redSha) return bad('entrada', `--red '${red || ''}' não resolve a um commit`);
  let greenSha = null;
  if (green) {
    greenSha = resolveRef(green);
    if (!greenSha) return bad('entrada', `--green '${green}' não resolve a um commit`);
    if (greenSha === redSha) return bad('entrada', 'verde e vermelho são o mesmo commit — falta o commit de implementação');
    const parents = parentsOf(greenSha);
    if (parents.length !== 1 || parents[0] !== redSha) {
      const between = isAncestorOrEqual(root, redSha, greenSha) ? git(root, ['rev-list', '--count', `${redSha}..${greenSha}`]).trim() : null;
      return topo(between === null
        ? 'o commit de vermelho não é ancestral do verde'
        : `o vermelho tem de ser o pai direto do verde (o HEAD da TASK) — há ${Number(between) - 1} commit(s) entre eles ou depois do commit de implementação`);
    }
  }
  if (taskBase) {
    const baseSha = resolveRef(taskBase);
    if (!baseSha) return bad('entrada', `--task-base '${taskBase}' não resolve a um commit`);
    const rp = parentsOf(redSha);
    if (rp.length !== 1 || rp[0] !== baseSha) return topo('o pai do vermelho não é o início da TASK (--task-base) — há commit(s) da TASK antes do vermelho');
  }
  if (taskId) {
    const escapedTask = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskPrefix = `^(?:feat|fix|refactor|test|chore|docs|style|perf|build|ci|revert)\\([a-z-]+\\): ${escapedTask} (?:—|-) `;
    const redSubject = new RegExp(`${taskPrefix}vermelho(?: |$)`);
    const taskSubject = new RegExp(`${taskPrefix}\\S`);
    if (!redSubject.test(subjectOf(redSha))) return topo(`o assunto do commit de vermelho não contém '${taskId} - vermelho'`);
    if (greenSha) {
      const gs = subjectOf(greenSha);
      if (!taskSubject.test(gs) || redSubject.test(gs)) return topo(`o commit de implementação não é da ${taskId} (assunto: '${gs}')`);
    }
  }

  const touched = splitZ(git(root, ['diff-tree', '--root', '--no-commit-id', '-r', '--name-only', '--no-renames', '-z', redSha]));
  const cmdPaths = commandPaths(command, setupCommand);
  const infraTouched = touched.filter((p) => !isTestPath(p) && isInfraPath(p, cmdPaths));
  if (infraTouched.length) {
    return { ok: false, stage: 'vermelho', code: 'vermelho-infra', reason: `o commit de vermelho toca infraestrutura (${infraTouched.join(', ')}) — o vermelho só pode trazer testes e stubs de produção; mudança de setup, manifesto ou config de teste vai numa TASK própria` };
  }

  const runAt = async (sha, graftFrom) => {
    let dir = null;
    try {
      try { dir = addWorktree(root, sha); }
      catch (e) { return { setupFail: `worktree falhou: ${(e.stderr || e.message || '').toString().trim()}` }; }
      if (graftFrom) {
        try { graftTaskTests(root, dir, redSha, graftFrom); }
        catch (e) { return { setupFail: `enxerto dos testes do verde falhou (${e.message})` }; }
        // Regra (4): depois do enxerto, a árvore do vermelho só difere da do verde nos arquivos de
        // produção que o verde muda. Nenhum ⇒ árvores iguais ⇒ não roda o teste.
        const implChanged = splitZ(git(root, ['diff', '--name-only', '--no-renames', '-z', redSha, graftFrom])).filter((p) => !isTestPath(p));
        if (!implChanged.length) return { emptyGreen: true };
      }
      const setup = await runSetup({ cwd: dir, setupCommand, timeoutS });
      if (!setup.ok) return { setupFail: setup.reason };
      const run = await runTest({ cwd: dir, command, timeoutS });
      return { ...run, excerpt: truncateExcerpt(normalizeExcerpt(run.output, [dir]), failurePattern) };
    } finally {
      removeWorktree(root, dir);
    }
  };

  const redRun = await runAt(redSha, greenSha);
  const redFail = (code, reason) => ({ ok: false, stage: 'vermelho', code, reason, excerpt: redRun.excerpt });
  if (redRun.emptyGreen) return redFail('vermelho-vazio', 'vermelho e verde são idênticos fora dos arquivos de teste — o verde não implementa nada; a falha do vermelho pode vir do ambiente (assunto do commit, arquivo fora da worktree), não do código');
  if (redRun.setupFail) return redFail('vermelho-ambiente', `ambiente do worktree no vermelho — ${redRun.setupFail}`);
  if (redRun.indeterminate) return redFail('vermelho-indeterminado', 'execução indeterminada no vermelho (sinal externo/erro de spawn)');
  if (redRun.timedOut) return redFail('vermelho-timeout', `o teste estourou o timeout de ${timeoutS}s no vermelho — timeout não é falha por asserção`);
  if (redRun.exitCode === 0) return redFail('vermelho-passa', `o teste${greenSha ? ' do verde' : ''} PASSA sobre a implementação do vermelho — o vermelho já traz a lógica que o satisfaz, ou o teste não testa nada`);
  const redClass = classify(redRun.output);
  if (redClass === 'build-error') return redFail('vermelho-compilacao', 'o teste falha por compilação/import/símbolo ausente no vermelho, não por asserção — use stub ou tipo vazio para o teste compilar');
  if (redClass !== 'behavioral') return redFail('vermelho-padrao', `a falha no vermelho não tem assinatura de asserção reconhecida (classificação: ${redClass}) — exceção ou erro de execução não é vermelho`);
  if (!matchesPattern(redRun.output, failurePattern)) return redFail('vermelho-padrao', `a falha no vermelho não casa o failure-pattern declarado ('${failurePattern}') — não é a asserção esperada`);

  if (!greenSha) return { ok: true, stage: 'vermelho', code: 'ok', reason: `pré-checagem: vermelho ${redSha.slice(0, 12)} falha por asserção com o próprio teste (sem --green: sem enxerto nem topologia — não prova o TDD)`, excerpt: redRun.excerpt };

  const greenRun = await runAt(greenSha, null);
  const greenFail = (code, reason) => ({ ok: false, stage: 'verde', code, reason, excerpt: greenRun.excerpt });
  if (greenRun.setupFail) return greenFail('verde-ambiente', `ambiente do worktree no verde — ${greenRun.setupFail}`);
  if (greenRun.indeterminate) return greenFail('verde-indeterminado', 'execução indeterminada no verde (sinal externo/erro de spawn)');
  if (greenRun.timedOut) return greenFail('verde-timeout', `o teste estourou o timeout de ${timeoutS}s no verde`);
  if (greenRun.exitCode !== 0) return greenFail('verde-falha', 'o teste NÃO passa no commit de implementação');
  return { ok: true, stage: 'verde', code: 'ok', reason: `teste do verde falha por asserção sobre o vermelho ${redSha.slice(0, 12)} (classificação: ${redClass}) e passa no verde ${greenSha.slice(0, 12)}` };
}
