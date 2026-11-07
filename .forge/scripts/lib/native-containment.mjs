// lib/native-containment.mjs — detector ÚNICO de mudanças de contenção da mensageria nativa entre
// sessões (REQ-12, design §2.7). Consumido por `native containment` (CLI), por `pre-push`, pelo
// `doctor` e por `/forge:prepare-pr`/`/forge:ship`.
//
// `detectContainment({ root, range })` mede os QUATRO tipos da lista fechada do REQ-12 e devolve
// `{ ok: true, findings }` quando conseguiu medir (findings pode ser vazio: "nada mudou" é um
// resultado, não uma falha) ou `{ ok: false, reason }` quando NÃO conseguiu medir (git
// indisponível, intervalo inválido, `hooks.manifest` do consumidor corrompido) — para o chamador
// nunca confundir "nada mudou" com "não medi".
//
// `hook-unwired` reusa, SEM exportar nada novo em `sync-adapters.mjs`, o wrapper já exportado
// `preToolUseWiring(root)` (que chama `derivePreToolUseHooks` internamente) e `derivarFiacao` de
// `hooks-manifest.mjs` (já exportada) — é a MESMA função e a MESMA precedência que `sync-adapters`
// usa para decidir a fiação real, nunca um segundo ponto de entrada (achado A-07 do
// `/forge:analyze`). Antes de confiar nesse resultado, este módulo verifica, de forma
// independente (pela MESMA leitura que `derivePreToolUseHooks` faz por dentro, mas repetida aqui
// porque `preToolUseWiring` não expõe `unresolved`), se o `hooks.manifest` do consumidor foi
// resolvido pelo leitor canônico — um manifesto corrompido faz `preToolUseWiring` devolver
// `PreToolUse` vazio, o que pareceria "gancho não armado em lugar nenhum" (falso negativo) se não
// fosse detectado à parte.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESFECHO, derivarFiacao, lerHooksManifest } from './hooks-manifest.mjs';
import { preToolUseWiring } from './sync-adapters.mjs';
import { workspaceIdentityFor } from './native-workspace.mjs';
import { ALLOWED_WORKSPACES_REL_PATH, readEffectiveAllowlist } from './native-allowlist.mjs';

export const GUARD_HOOK = 'guard-cross-session-send.sh';
export const MANIFEST_REL_PATH = '.forge/hooks/pre-tool-use/hooks.manifest';
export const MANIFEST_DEFAULT_REL_PATH = '.forge/hooks/pre-tool-use/hooks.manifest.default';
export const SETTINGS_REL_PATH = '.claude/settings.json';

// Lista FECHADA do REQ-12 — qualquer tipo novo entra aqui primeiro, nunca só no detector.
export const CONTAINMENT_TYPES = ['allowlist-changed', 'hook-line-changed', 'hook-unwired', 'remote-identity-mismatch'];

function gitRepoReachable(root) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function gitShowOrNull(root, ref, relPath) {
  try {
    return execFileSync('git', ['-C', root, 'show', `${ref}:${relPath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function refExists(root, ref) {
  try {
    execFileSync('git', ['-C', root, 'rev-parse', '--verify', `${ref}^{commit}`], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function parseRange(range) {
  const m = /^(.+)\.\.(.+)$/.exec(String(range));
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  if (!a || !b) return null;
  return { a, b };
}

function readCurrentPreToolUseGroups(root) {
  const p = join(root, '.claude', 'settings.json');
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && parsed.hooks && Array.isArray(parsed.hooks.PreToolUse) ? parsed.hooks.PreToolUse : [];
  } catch {
    return null;
  }
}

// detectUnresolvedManifest(root) -> { unresolved, reason? }. Replica a MESMA condição de
// `derivePreToolUseHooks` (sync-adapters.mjs) que decide `unresolved: true`: manifesto do
// consumidor presente, não resolvido pelo leitor canônico (RECUSA ou NAO_VERIFICADO) e já existe
// `.claude/settings.json` anterior para preservar (sem ele, cai no caminho de instalação nova, que
// não é "unresolved").
function detectUnresolvedManifest(root) {
  const consumerPath = join(root, MANIFEST_REL_PATH);
  if (!existsSync(consumerPath)) return { unresolved: false };
  let consumerText;
  try {
    consumerText = readFileSync(consumerPath, 'utf8');
  } catch {
    return { unresolved: false };
  }
  const existingGroups = readCurrentPreToolUseGroups(root);
  if (existingGroups == null) return { unresolved: false };
  const lido = lerHooksManifest(consumerText, { fiacao: existingGroups, origem: MANIFEST_REL_PATH });
  if (lido.desfecho === DESFECHO.RECUSA || lido.desfecho === DESFECHO.NAO_VERIFICADO) {
    return { unresolved: true, reason: lido.mensagem };
  }
  return { unresolved: false };
}

function detectAllowlistChanged(root, range) {
  if (range) {
    let out;
    try {
      out = execFileSync('git', ['-C', root, 'diff', '--name-only', `${range.a}..${range.b}`, '--', ALLOWED_WORKSPACES_REL_PATH], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (err) {
      return { error: `git diff do cadastro falhou: ${err.message}` };
    }
    return { changed: out.trim().length > 0 };
  }
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', ALLOWED_WORKSPACES_REL_PATH], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    return { error: `git status do cadastro falhou: ${err.message}` };
  }
  return { changed: out.trim().length > 0 };
}

// manifestDeclAt(root, ref, hookName) -> { found, matcher?, armed? } | { error }. Procura a
// declaração do gancho em QUALQUER UM dos dois manifestos (consumidor, depois default — a mesma
// precedência que decide a fiação), na ponta `ref`. `armed` vem de `lido.ativos` (fonte de
// verdade nos dois modos do leitor, canônico e projeção), não do texto literal do campo `estado`
// — que é `null` em modo de projeção.
function manifestDeclAt(root, ref, hookName) {
  for (const relPath of [MANIFEST_REL_PATH, MANIFEST_DEFAULT_REL_PATH]) {
    const text = gitShowOrNull(root, ref, relPath);
    if (text == null) continue;
    const lido = lerHooksManifest(text, { fiacao: null, origem: relPath });
    if (lido.desfecho === DESFECHO.RECUSA || lido.desfecho === DESFECHO.NAO_VERIFICADO) {
      return { error: `${relPath}@${ref} não resolvido pelo leitor canônico: ${lido.mensagem}` };
    }
    const decl = (lido.declaracoes || []).find((d) => d.hook === hookName);
    if (decl) return { found: true, matcher: decl.matcher, armed: (lido.ativos || []).includes(hookName) };
    // Manifesto do consumidor presente e resolvido decide SOZINHO os ganchos do diretório (mesma
    // regra de `sync-adapters.mjs`, ramo `consumerDecls`): gancho não declarado nele fica fora da
    // fiação, mesmo que o default o declare armado. Não cair no default aqui.
    if (relPath === MANIFEST_REL_PATH) return { found: false };
  }
  return { found: false };
}

// hook-line-changed só se mede COM intervalo (precisa de duas pontas para comparar) — sem
// intervalo este tipo não se aplica (design §2.7, tabela).
function detectHookLineChanged(root, range) {
  if (!range) return { changed: false };
  const atA = manifestDeclAt(root, range.a, GUARD_HOOK);
  if (atA.error) return { error: atA.error };
  const atB = manifestDeclAt(root, range.b, GUARD_HOOK);
  if (atB.error) return { error: atB.error };
  if (!atA.found) return { changed: false };
  if (!atB.found) return { changed: true, detail: 'linha de guard-cross-session-send.sh removida entre as pontas do intervalo' };
  if (atA.matcher !== atB.matcher || atA.armed !== atB.armed) {
    return {
      changed: true,
      detail: `matcher/estado de guard-cross-session-send.sh alterados (matcher='${atA.matcher}' armado=${atA.armed} -> matcher='${atB.matcher}' armado=${atB.armed})`,
    };
  }
  return { changed: false };
}

function settingsHasGuardAt(root, ref) {
  const text = gitShowOrNull(root, ref, SETTINGS_REL_PATH);
  if (text == null) return { wired: false };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: `${SETTINGS_REL_PATH}@${ref} inválido: ${err.message}` };
  }
  const groups = parsed && parsed.hooks && Array.isArray(parsed.hooks.PreToolUse) ? parsed.hooks.PreToolUse : [];
  const fiacao = derivarFiacao(groups);
  return { wired: fiacao.legivel && fiacao.ganchos.includes(GUARD_HOOK) };
}

// hook-unwired:
//   - COM intervalo: fiação presente em .claude/settings.json na ponta inicial e ausente na final.
//   - SEM intervalo: a derivação EFETIVA (preToolUseWiring) arma o gancho e o .claude/settings.json
//     atual não o contém. Gancho que a derivação deixa inativo por semeadura (consumidor existente
//     ainda não armou) NÃO é achado — é aviso do doctor, fora da lista fechada.
function detectHookUnwired(root, range) {
  if (range) {
    const atA = settingsHasGuardAt(root, range.a);
    if (atA.error) return { error: atA.error };
    const atB = settingsHasGuardAt(root, range.b);
    if (atB.error) return { error: atB.error };
    if (atA.wired && !atB.wired) {
      return { changed: true, detail: 'fiação de guard-cross-session-send.sh presente na ponta inicial e ausente na final' };
    }
    return { changed: false };
  }
  const derived = preToolUseWiring(root);
  const derivedFiacao = derivarFiacao(derived.PreToolUse || []);
  const derivedHasGuard = derivedFiacao.legivel && derivedFiacao.ganchos.includes(GUARD_HOOK);
  if (!derivedHasGuard) return { changed: false };
  const actualGroups = readCurrentPreToolUseGroups(root) || [];
  const actualFiacao = derivarFiacao(actualGroups);
  const actualHasGuard = actualFiacao.legivel && actualFiacao.ganchos.includes(GUARD_HOOK);
  if (!actualHasGuard) {
    return { changed: true, detail: 'a derivação efetiva arma guard-cross-session-send.sh e o .claude/settings.json atual não o contém' };
  }
  return { changed: false };
}

function detectRemoteIdentityMismatch(root) {
  const { doc, error } = readEffectiveAllowlist({ root });
  if (error) return { error };
  if (!doc.self_identity) return { changed: false };
  const current = workspaceIdentityFor(root);
  if (current !== doc.self_identity) {
    return { changed: true, detail: `identidade atual do origin '${current}' diverge de self_identity cadastrado '${doc.self_identity}'` };
  }
  return { changed: false };
}

// detectContainment({ root, range }) -> { ok: true, findings } | { ok: false, reason }.
// `range` no formato "<a>..<b>"; omitido mede o estado ATUAL (edição não commitada do cadastro,
// derivação efetiva da fiação, identidade atual do origin).
export function detectContainment({ root, range } = {}) {
  if (!root) return { ok: false, reason: "'root' obrigatório" };
  if (!gitRepoReachable(root)) return { ok: false, reason: `git indisponível ou '${root}' não é um repositório git` };

  let parsedRange = null;
  if (range) {
    parsedRange = parseRange(range);
    if (!parsedRange) return { ok: false, reason: `intervalo inválido: '${range}' (use <a>..<b>)` };
    if (!refExists(root, parsedRange.a) || !refExists(root, parsedRange.b)) {
      return { ok: false, reason: `intervalo inválido: referência(s) não resolvem em '${root}': '${range}'` };
    }
  }

  const unresolved = detectUnresolvedManifest(root);
  if (unresolved.unresolved) {
    return { ok: false, reason: `hooks.manifest do consumidor não foi resolvido pelo leitor canônico: ${unresolved.reason}` };
  }

  const findings = [];

  const allowlist = detectAllowlistChanged(root, parsedRange);
  if (allowlist.error) return { ok: false, reason: allowlist.error };
  if (allowlist.changed) findings.push({ type: 'allowlist-changed', detail: `${ALLOWED_WORKSPACES_REL_PATH} mudou` });

  const hookLine = detectHookLineChanged(root, parsedRange);
  if (hookLine.error) return { ok: false, reason: hookLine.error };
  if (hookLine.changed) findings.push({ type: 'hook-line-changed', detail: hookLine.detail });

  const unwired = detectHookUnwired(root, parsedRange);
  if (unwired.error) return { ok: false, reason: unwired.error };
  if (unwired.changed) findings.push({ type: 'hook-unwired', detail: unwired.detail });

  const remote = detectRemoteIdentityMismatch(root);
  if (remote.error) return { ok: false, reason: remote.error };
  if (remote.changed) findings.push({ type: 'remote-identity-mismatch', detail: remote.detail });

  return { ok: true, findings };
}

export function renderContainment(findings, format) {
  const fmt = format || 'text';
  if (!findings || findings.length === 0) {
    return fmt === 'markdown' ? '_nenhuma mudança de contenção detectada_' : 'nenhuma mudança de contenção detectada';
  }
  if (fmt === 'markdown') return findings.map((f) => `- **${f.type}**: ${f.detail}`).join('\n');
  return findings.map((f) => `${f.type}: ${f.detail}`).join('\n');
}
