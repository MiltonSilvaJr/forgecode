// lib/native-workspace.mjs — leitor ÚNICO de repositório principal, raiz de workspace e
// identidade de workspace para a mensageria nativa entre sessões (design §2.5 "Raiz de
// workspace", REQ-02, REQ-07). Consumido pelo gancho de saída, por `send --via cross-session`,
// por `native check`, pelo doctor e pelo detector de contenção.
//
// Repositório principal: resolvido pelo `git-common-dir`, seguindo `.git` em arquivo (`gitdir:`
// e `commondir`) SEM subprocesso — uma worktree, dentro ou fora da árvore principal, resolve para
// o repositório que a contém.
//
// Workspace: a raiz do repositório git mais externo que contém o repositório da sessão, subindo
// a partir da raiz do repositório e parando ANTES de chegar ao HOME ou a qualquer ancestral dele
// (home e seus ancestrais nunca são workspace, mesmo que sejam repositório git — requirements.md,
// termos). Fora de repositório, o workspace é o próprio `cwd`.
//
// Identidade: `git -C <raiz> remote get-url origin` (COM subprocesso — é o único jeito de
// aplicar `insteadOf`, que só o git resolve), normalizada para `host/owner/repo`; sem remote, o
// caminho absoluto (`realpath`) da raiz. Cacheada por raiz dentro da execução (design §2.5).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function readGitDirFile(gitFilePath) {
  const content = readFileSync(gitFilePath, 'utf8');
  const m = /^gitdir:\s*(.+)\s*$/m.exec(content);
  if (!m) return null;
  let p = m[1].trim();
  if (!isAbsolute(p)) p = resolve(dirname(gitFilePath), p);
  return p;
}

// resolveCommonDir(gitDir) -> git-common-dir REAL. Se `gitDir` é o git-dir privado de uma
// worktree (`.git/worktrees/<name>`), o arquivo `commondir` dentro dele aponta (relativo) para o
// git-dir do repositório PRINCIPAL.
function resolveCommonDir(gitDir) {
  const commondirFile = join(gitDir, 'commondir');
  if (existsSync(commondirFile)) {
    let p = readFileSync(commondirFile, 'utf8').trim();
    if (!isAbsolute(p)) p = resolve(gitDir, p);
    return realpathSync(p);
  }
  return realpathSync(gitDir);
}

// gitCommonDir(startDir) -> caminho absoluto do git-common-dir do repositório que CONTÉM
// `startDir`, ou `null` se `startDir` não está dentro de nenhum repositório git. Sem subprocesso.
export function gitCommonDir(startDir) {
  let dir;
  try {
    dir = realpathSync(startDir);
  } catch {
    return null;
  }
  for (;;) {
    const gitPath = join(dir, '.git');
    if (existsSync(gitPath)) {
      const st = statSync(gitPath);
      if (st.isDirectory()) return resolveCommonDir(gitPath);
      if (st.isFile()) {
        const gd = readGitDirFile(gitPath);
        return gd ? resolveCommonDir(gd) : null;
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// coreWorktree(gitDir) -> valor de `core.worktree` do `config` de `gitDir` (absoluto), ou null.
// Leitura mínima do formato INI do git, sem subprocesso: só a chave `worktree` da seção `[core]`.
function coreWorktree(gitDir) {
  const cfg = join(gitDir, 'config');
  if (!existsSync(cfg)) return null;
  let section = '';
  for (const raw of readFileSync(cfg, 'utf8').split('\n')) {
    const line = raw.trim();
    const sec = /^\[([^\]\s]+)[^\]]*\]$/.exec(line);
    if (sec) {
      section = sec[1].toLowerCase();
      continue;
    }
    if (section !== 'core') continue;
    const kv = /^worktree\s*=\s*(.+)$/i.exec(line);
    if (kv) {
      const p = kv[1].trim().replace(/^"(.*)"$/, '$1');
      return isAbsolute(p) ? p : resolve(gitDir, p);
    }
  }
  return null;
}

// mainRepoRoot(startDir) -> diretório de trabalho do repositório PRINCIPAL, ou `null` fora de
// repositório. Três casos (code-evaluator PR #245, LOGIC-001 — "pai do git-common-dir" só vale
// para `.git` em diretório):
//   - `.git` diretório: o próprio diretório que o contém;
//   - `.git` arquivo SEM `commondir` no git-dir apontado (submódulo, `--separate-git-dir`): o
//     diretório que contém o arquivo `.git` — o pai de `<super>/.git/modules/<nome>` seria
//     `<super>/.git/modules`, o MESMO para todo submódulo;
//   - `.git` arquivo COM `commondir` (worktree): o checkout principal do git-common-dir — o pai
//     dele quando é um `.git` comum, senão o `core.worktree` do config (worktree de submódulo).
export function mainRepoRoot(startDir) {
  let dir;
  try {
    dir = realpathSync(startDir);
  } catch {
    return null;
  }
  for (;;) {
    const gitPath = join(dir, '.git');
    if (existsSync(gitPath)) {
      const st = statSync(gitPath);
      if (st.isDirectory()) return dir;
      if (!st.isFile()) return null;
      const gd = readGitDirFile(gitPath);
      if (!gd) return null;
      if (!existsSync(join(gd, 'commondir'))) return dir;
      const commonDir = resolveCommonDir(gd);
      const wt = coreWorktree(commonDir);
      if (wt) {
        try {
          return realpathSync(wt);
        } catch {
          return wt;
        }
      }
      return dirname(commonDir);
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveHomeReal(home) {
  const h = home || homedir();
  try {
    return realpathSync(h);
  } catch {
    return h;
  }
}

// `dir` é HOME ou ancestral de HOME (HOME está em `dir` ou abaixo dele).
function isHomeOrAncestorOfHome(dir, homeReal) {
  if (dir === homeReal) return true;
  const rel = relative(dir, homeReal);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  return true;
}

// workspaceRoot(startDir, { home }) -> raiz de workspace (string, caminho absoluto resolvido).
// `home` é SEMPRE passado explicitamente pelo chamador em fixture (nunca redirecionando o HOME
// real do processo) — produção usa `os.homedir()` por omissão.
export function workspaceRoot(startDir, { home } = {}) {
  const homeReal = resolveHomeReal(home);
  const repoRoot = mainRepoRoot(startDir);
  // Fora de repositório, OU o próprio repositório coincide com HOME (ou um ancestral dele) —
  // "home e seus ancestrais nunca são workspace, mesmo que sejam repositório git": cai para o
  // próprio cwd, igual ao caso fora de repositório.
  if (!repoRoot || isHomeOrAncestorOfHome(repoRoot, homeReal)) {
    try {
      return realpathSync(resolve(startDir));
    } catch {
      return resolve(startDir);
    }
  }
  let outermost = repoRoot;
  let dir = dirname(repoRoot);
  for (;;) {
    if (isHomeOrAncestorOfHome(dir, homeReal)) break;
    if (existsSync(join(dir, '.git'))) outermost = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return outermost;
}

function gitRemoteUrl(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

// normalizeRemote(url) -> `host/owner/repo` em minúsculas no host, sem esquema, credencial,
// porta nem sufixo `.git`. Forma scp (`user@host:owner/repo`, inclusive alias de ssh config)
// também vira `host/owner/repo` com o alias como host.
export function normalizeRemote(url) {
  if (!url) return null;
  let u = url.trim().replace(/\.git$/i, '');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u);
  if (!hasScheme) {
    const scpMatch = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(u);
    if (scpMatch) {
      const host = scpMatch[1].toLowerCase();
      const path = scpMatch[2].replace(/^\/+/, '');
      return `${host}/${path}`;
    }
  }
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/^\/+/, '');
    return `${host}/${path}`;
  } catch {
    return u;
  }
}

const identityCache = new Map();

// workspaceIdentity(root) -> identidade normalizada do workspace cuja raiz é `root`. Cacheada por
// raiz dentro da execução (design §2.5) — `clearWorkspaceCaches()` limpa entre execuções de teste.
export function workspaceIdentity(root) {
  if (identityCache.has(root)) return identityCache.get(root);
  const url = gitRemoteUrl(root);
  let identity;
  if (url) {
    identity = normalizeRemote(url);
  } else {
    try {
      identity = realpathSync(root);
    } catch {
      identity = root;
    }
  }
  identityCache.set(root, identity);
  return identity;
}

// workspaceIdentityFor(startDir, { home }) -> identidade do WORKSPACE que contém `startDir`
// (raiz de workspace + identidade). É a MESMA base que o gancho de saída usa para origem e
// destino; `self_identity` (gravado por `pin`/`allow` e conferido pelo detector) precisa usá-la
// também — gravar a identidade do repositório aninhado e comparar com a do workspace bloqueava
// todo envio cadastrado a partir de um repositório aninhado (code-evaluator PR #245, LOGIC-002).
export function workspaceIdentityFor(startDir, { home } = {}) {
  return workspaceIdentity(workspaceRoot(startDir, { home }));
}

export function clearWorkspaceCaches() {
  identityCache.clear();
}
