#!/usr/bin/env node
// orphan-changes.mjs — detector determinístico (zero-LLM) de changes SDD "órfãos":
// implementados/mergeados mas que o manifest.yaml nunca acompanhou. Fecha a lacuna
// em que um change fica em specs/active/ com status defasado (verified sem archive,
// ou tasks 100% sem avanço de status) e ninguém percebe até uma reconciliação manual.
//
// Classifica cada .forge/specs/active/<id>/ em, no máximo, um bucket:
//
//   merged_unarchived — pronto para ser incorporado ao baseline mas ainda ativo:
//     • status == verified  (sinal 'verified'; próximo passo /forge:archive), OU
//     • status == implemented E uma branch mapeável ao change já é ancestral de —
//       ou patch-equivalente (git cherry) a — a branch de integração
//       (sinal 'branch-merged'; falta /forge:verify antes de arquivar).
//
//   done_not_advanced — 100% das TASKs concluídas ([X]) mas o status parou antes
//     de refletir isso (tasks-ready ou implementing). É o sintoma do caminho
//     module-based (/forge:coding-loop), que fecha ondas sem tocar o manifest.
//
// Precedência: verified → merged_unarchived (não precisa de git). Caso contrário, se
// as TASKs estão 100% e o status é tasks-ready/implementing → done_not_advanced
// (diagnóstico mais preciso e próximo passo correto: avançar/verificar, NÃO arquivar,
// já que /forge:archive exige verified). Só então, para status implemented, o sinal
// branch-merged promove a merged_unarchived. Um change em fluxo normal (implemented
// aguardando verify, sem branch mergeada) NÃO é órfão.
//
// Garantias: determinístico (sem datas/random), no-op se não houver git ou specs,
// tolerante a worktree/branch removidos (todo git é best-effort → ausência de sinal,
// nunca erro). Nunca lança em uso normal — falhas viram "sem órfão".
//
// Uso:
//   node orphan-changes.mjs <repo-root> [--integration <branch>] [--json|--lines]
//     --json   (default) objeto JSON completo em stdout
//     --lines  uma linha "bucket<TAB>id<TAB>status" por órfão (para consumo em bash)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const argv = process.argv.slice(2);
const integrationArg = argv.includes('--integration') ? argv[argv.indexOf('--integration') + 1] : null;
const asLines = argv.includes('--lines');

const git = (args) => {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
};
const gitOk = (args) => {
  try { execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' }); return true; }
  catch { return false; }
};

const hasGit = gitOk(['rev-parse', '--is-inside-work-tree']);

function integrationBranch() {
  if (!hasGit) return null;
  if (integrationArg) return integrationArg;
  for (const cand of ['dev', 'develop', 'main', 'master']) {
    if (gitOk(['rev-parse', '--verify', '--quiet', `refs/heads/${cand}`])) return cand;
  }
  const cur = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return cur && cur !== 'HEAD' ? cur : null;
}

// Todas as branches (locais + remotas) cujo nome mapeia ao change-id. Sem convenção
// rígida change-id→branch no harness (branches são <tipo>/<escopo>/<kebab>), então
// casamos o id como TOKEN delimitado por fronteira (`/`, `_`, `-` ou extremos) — nunca
// substring cru, que classificaria `auth` como mergeado ao ver `feature/oauth2-support`.
function branchesFor(id) {
  if (!hasGit) return [];
  const refs = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);
  if (!refs) return [];
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[/_-])${esc}([/_-]|$)`);
  return refs.split('\n').map((s) => s.trim()).filter(Boolean).filter((r) => r === id || re.test(r));
}

// Uma branch conta como "mergeada" na integração se for ancestral direta OU se todos
// os seus commits já têm equivalente na integração (squash/rebase) via `git cherry`.
function branchMerged(id, integration) {
  if (!hasGit || !integration) return null;
  for (const b of branchesFor(id)) {
    if (b === integration || b === `origin/${integration}`) continue;
    if (gitOk(['merge-base', '--is-ancestor', b, integration])) return b;
    const cherry = git(['cherry', integration, b]);
    if (cherry) {
      const lines = cherry.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0 && lines.every((l) => l.startsWith('- '))) return b;
    }
  }
  return null;
}

function manifestStatus(dir) {
  const man = join(dir, 'manifest.yaml');
  if (!existsSync(man)) return null;
  const m = readFileSync(man, 'utf8').match(/^status:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

// Conta marcadores de TASK no tasks.md. Só linhas que começam (após espaços) com um
// item de lista `- [x]` / `* [ ]` etc. — a legenda em prosa (`> ... `[ ]` todo`) não
// casa. Incompleto = { ' ', '-', '!' }; concluído = { 'x', 'X' }.
function taskCounts(dir) {
  const f = join(dir, 'tasks.md');
  if (!existsSync(f)) return { total: 0, done: 0, incomplete: 0 };
  let done = 0, incomplete = 0;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*[-*]\s*\[([ xX!-])\]/);
    if (!m) continue;
    if (m[1] === 'x' || m[1] === 'X') done += 1;
    else incomplete += 1;
  }
  return { total: done + incomplete, done, incomplete };
}

function detect() {
  const activeDir = join(root, '.forge', 'specs', 'active');
  const out = { integration_branch: integrationBranch(), merged_unarchived: [], done_not_advanced: [] };
  let ids = [];
  try { ids = readdirSync(activeDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { return out; }

  for (const id of ids.sort()) {
    const dir = join(activeDir, id);
    const status = manifestStatus(dir);
    if (!status) continue;
    const tasks = taskCounts(dir);
    const tasksComplete = tasks.total > 0 && tasks.incomplete === 0;

    if (status === 'verified') {
      out.merged_unarchived.push({ id, status, signal: 'verified', branch: null });
    } else if (tasksComplete && (status === 'tasks-ready' || status === 'implementing')) {
      out.done_not_advanced.push({ id, status, tasks_total: tasks.total, tasks_done: tasks.done });
    } else if (status === 'implemented') {
      const b = branchMerged(id, out.integration_branch);
      if (b) out.merged_unarchived.push({ id, status, signal: 'branch-merged', branch: b });
    }
  }
  return out;
}

let result;
try { result = detect(); }
catch { result = { integration_branch: null, merged_unarchived: [], done_not_advanced: [] }; }

if (asLines) {
  const lines = [];
  for (const e of result.merged_unarchived) lines.push(`merged_unarchived\t${e.id}\t${e.status}`);
  for (const e of result.done_not_advanced) lines.push(`done_not_advanced\t${e.id}\t${e.status}`);
  process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
} else {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
