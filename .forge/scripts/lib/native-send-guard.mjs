// lib/native-send-guard.mjs — leitor/avaliador ÚNICO do gancho de saída `guard-cross-session-send.sh`
// (design §2.5, REQ-04 a REQ-07). O `.sh` só localiza esta lib pelo próprio caminho e faz
// `exec node native-send-guard.mjs` com o stdin — toda a lógica mora aqui. Nenhuma conexão com
// socket, nenhuma invocação do CLI do Claude Code (NFR-02, w113 [10]).
//
// Etapas, na ordem do design (§2.5): 1 parse; 2 classificação do destino (REQ-05); 3 pedido só
// de aviso de ociosidade; 4 varredura de segredo (REQ-04); 5 contenção por workspace (REQ-07); 6
// destino declarado (REQ-06). A etapa 5 vem antes da 6 porque a 6 precisa do repositório do
// destino já resolvido e porque contenção é a recusa de maior consequência (design §2.5).
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findSecrets } from './secret-scan.mjs';
import { readRegistryFiles, isAlive, normalizeSocketPath } from './native-registry.mjs';
import { findNamedAgentInTranscript } from './native-transcript.mjs';
import { mainRepoRoot, workspaceRoot, workspaceIdentity } from './native-workspace.mjs';
import { readEffectiveAllowlist } from './native-allowlist.mjs';
import { resolvePointer } from './liaison-pointer.mjs';
import { readConfig, getPeerPath } from './liaison-config.mjs';
import { EPHEMERAL_CLASSES, POINTER_LINE_RE, EPHEMERAL_LINE_RE, NATIVE_EXTRA_TEXT_MAX_BYTES } from './native-classes.mjs';

const CANONICAL_NOTIFY_PREFIXES = ['thread_id:', 'content_sha:', 'subject:', 'to:'];

const REF_SUFFIX_RE = /\s\[[0-9a-f]+\]$/;
const BAD_TO_CHARS_RE = /[*,\n]/;
const AGENT_ID_RE = /^a[0-9a-f]{16}$/;

function isBlank(s) {
  return typeof s !== 'string' || s.trim() === '';
}

// ── cache por execução (design §2.5, "caches por execução") ──────────────────────────────────
// Dentro de UMA chamada a `evaluateSendGuard`, a classificação (etapa 2), a origem cruzada e a
// contenção (etapa 5, TASK-17) podem precisar consultar o registro de sessões mais de uma vez
// (por nome, por socket, pela própria sessão). `readRegistryFiles` é a leitura cara (varre o
// diretório inteiro); esta função cacheia o resultado uma vez por execução — o restante
// (`resolveSessionByNameCached` etc.) reaproveita `isAlive`/`normalizeSocketPath` de
// `native-registry.mjs` (nunca reimplementa a checagem de vivacidade), só a seleção sobre o
// snapshot já lido é feita localmente, porque os wrappers de conveniência de native-registry.mjs
// (`resolveByName`/`resolveBySocket`/`resolveBySessionId`) cada um faz a própria leitura do
// diretório — chamá-los diretamente reabriria o mesmo diretório 2 a 3 vezes por execução.
export function createExecutionCache(opts = {}) {
  const sessionsDir = opts.sessionsDir;
  let snapshot = null;
  return {
    registry() {
      if (!snapshot) snapshot = readRegistryFiles({ sessionsDir });
      return snapshot;
    },
  };
}

function registryFailClosedReason(errors) {
  if (!errors || errors.length === 0) return null;
  const first = errors[0];
  return `registro: ${first.file} ilegível ou incompleto (${first.reason})`;
}

// resolveSessionByNameCached(cache, name) -> { entry? , ambiguous?, error? } — mesma semântica
// de `resolveByName` (native-registry.mjs), sobre o snapshot cacheado.
function resolveSessionByNameCached(cache, name) {
  const { entries, errors, dirError } = cache.registry();
  if (dirError) return { error: dirError };
  const fc = registryFailClosedReason(errors);
  if (fc) return { error: fc };
  const alive = entries.filter((e) => e.name === name && isAlive(e));
  if (alive.length === 0) return {};
  if (alive.length > 1) return { ambiguous: true };
  return { entry: alive[0] };
}

// resolveSessionBySocketCached(cache, sockFile) -> { entry? , error? } — mesma semântica de
// `resolveBySocket` (native-registry.mjs), sobre o snapshot cacheado: fail-closed só quando
// NENHUM registro válido deu match E existe arquivo ilegível no diretório (a resolução pode ter
// perdido o match verdadeiro nesse arquivo); achado o destino certo, um OUTRO arquivo ilegível
// no diretório não impede a resolução.
export function resolveSessionBySocketCached(cache, sockFile) {
  const { entries, errors, dirError } = cache.registry();
  if (dirError) return { error: dirError };
  const target = normalizeSocketPath(sockFile);
  const alive = entries.filter((e) => isAlive(e) && normalizeSocketPath(e.messagingSocketPath) === target);
  if (alive.length === 0) {
    const fc = registryFailClosedReason(errors);
    if (fc) return { error: fc };
    return {};
  }
  return { entry: alive[0] };
}

// resolveOwnSessionCached(cache, sessionId) -> { entry?, error? } — acha o registro da PRÓPRIA
// sessão pelo `sessionId` (design §2.5 etapa 5, "origem cruzada"). Diferente da resolução de
// DESTINO (por nome ou por socket), que é fail-closed quando um arquivo alheio ilegível pode ter
// escondido o match verdadeiro: aqui "não encontrei" é um estado normal e esperado (sessão
// encerrada, Remote Control, nuvem — nenhum desses tem registro local), e o design resolve esse
// caso explicitamente ("quando não existe, vale o cwd do payload"), sem terceiro estado de
// fail-closed. Um arquivo ilegível de OUTRA sessão nunca bloqueia esta checagem; só o próprio
// diretório do registro inacessível (`dirError`) é fail-closed.
export function resolveOwnSessionCached(cache, sessionId) {
  const { entries, dirError } = cache.registry();
  if (dirError) return { error: dirError };
  const match = entries.find((e) => e.sessionId === sessionId);
  return match ? { entry: match } : {};
}

// classifyRecipient(payload, opts) -> { kind: 'internal'|'session'|'blocked', reason?, entry?,
// address? } (design §2.5 etapa 2, REQ-05). Independente das etapas 5 e 6 — não faz contenção
// nem valida destino declarado; só decide se o destino é interno (passa sem checagem), é uma
// sessão (sujeito às demais etapas) ou é um destino que o gancho recusa já aqui.
export function classifyRecipient(payload, opts = {}) {
  const input = (payload && payload.tool_input) || {};
  const kind = input.recipient_kind;
  const to = typeof input.to === 'string' ? input.to : '';
  const cache = opts.cache || createExecutionCache(opts);

  if (kind === 'main') {
    if (to === 'main') return { kind: 'internal', reason: 'main' };
    return { kind: 'blocked', reason: `destino não resolvido: recipient_kind 'main' com 'to' diferente de 'main' ('${to}')` };
  }
  if (kind === 'agent') {
    if (AGENT_ID_RE.test(to)) return { kind: 'internal', reason: 'agentId' };
    return { kind: 'blocked', reason: `destino não resolvido: recipient_kind 'agent' com 'to' fora do formato de agentId ('${to}')` };
  }
  if (kind === 'session') {
    if (!to.startsWith('uds:')) {
      return { kind: 'blocked', reason: `destino não resolvido: recipient_kind 'session' com 'to' fora do formato 'uds:' ('${to}')` };
    }
    return { kind: 'session', address: to.slice(4) };
  }
  if (kind === 'name') {
    if (REF_SUFFIX_RE.test(to)) {
      return {
        kind: 'blocked',
        reason: `destino não resolvido: '${to}' traz sufixo de referência ([hex]), que não é mapeável ao registro local — use o nome puro (se único) ou o endereço 'uds:'`,
      };
    }
    const resolved = resolveSessionByNameCached(cache, to);
    if (resolved.error) return { kind: 'blocked', reason: resolved.error };
    if (resolved.ambiguous) {
      return { kind: 'blocked', reason: `destino ambíguo: mais de uma sessão viva com nome '${to}' — use o endereço 'uds:'` };
    }
    if (resolved.entry) return { kind: 'session', entry: resolved.entry };
    const foundAgent = findNamedAgentInTranscript({ transcriptPath: payload.transcript_path, name: to });
    if (foundAgent) return { kind: 'internal', reason: 'agente nomeado no transcript' };
    return {
      kind: 'blocked',
      reason: `destino não resolve localmente: '${to}' não é sessão viva nem agente nomeado no transcript da sessão — subagente deve ser endereçado pelo agentId`,
    };
  }
  if (BAD_TO_CHARS_RE.test(to)) {
    return { kind: 'blocked', reason: `destino não resolvido: 'to' contém caractere não suportado ('${JSON.stringify(to)}')` };
  }
  return { kind: 'blocked', reason: `destino não resolvido: recipient_kind desconhecido ('${kind}')` };
}

function collectStringFields(value, pathPrefix, out) {
  if (typeof value === 'string') {
    out.push({ path: pathPrefix || '(raiz)', value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectStringFields(v, `${pathPrefix}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) collectStringFields(value[k], pathPrefix ? `${pathPrefix}.${k}` : k, out);
  }
}

// scanToolInputForSecrets(toolInput) -> { found, pattern?, field? } (design §2.5 etapa 4,
// REQ-04). Percorre recursivamente TODOS os valores string de `toolInput` (inclusive aninhados e
// arrays) com a MESMA `findSecrets` de `secret-scan.mjs` usada pelo `send` — um único leitor de
// padrões, nunca duas listas.
export function scanToolInputForSecrets(toolInput) {
  const fields = [];
  collectStringFields(toolInput, '', fields);
  for (const f of fields) {
    const found = findSecrets(f.value);
    if (found.length > 0) return { found: true, pattern: found[0], field: f.path };
  }
  return { found: false };
}

// resolveOwnOrigin(payload, cache) -> { ok, originCwd } | { ok: false, reason } (design §2.5
// etapa 5, "origem cruzada"). Origem é o `cwd` do payload, cruzado com o registro da PRÓPRIA
// sessão (achado pelo `session_id` do payload): quando esse registro existe e a identidade de
// workspace do `cwd` dele difere da do `cwd` do payload, a origem é ambígua (o `cwd` do payload
// segue o `cd` do Bash e pode estar num diretório adicional de outro workspace) — exit 2. Sem
// registro próprio, vale o `cwd` do payload (limite declarado no design/rule).
function resolveOwnOrigin(payload, cache, opts) {
  const payloadCwd = payload.cwd;
  const sessionId = payload.session_id;
  if (!sessionId) return { ok: true, originCwd: payloadCwd };
  const own = resolveOwnSessionCached(cache, sessionId);
  if (own.error) return { ok: false, reason: own.error };
  if (!own.entry) return { ok: true, originCwd: payloadCwd };
  const ownIdentity = workspaceIdentity(workspaceRoot(own.entry.cwd, { home: opts.home }));
  const payloadIdentity = workspaceIdentity(workspaceRoot(payloadCwd, { home: opts.home }));
  if (ownIdentity !== payloadIdentity) {
    return {
      ok: false,
      reason: `origem ambígua: o 'cwd' do payload ('${payloadCwd}') e o 'cwd' do registro da própria sessão ('${own.entry.cwd}') resolvem para workspaces diferentes`,
    };
  }
  return { ok: true, originCwd: payloadCwd };
}

// checkContainment({ payload, classification, cache, opts }) -> { ok, originCwd?, destCwd? } |
// { ok: false, reason } (design §2.5 etapa 5, REQ-07). Resolve a origem cruzada, resolve o
// destino no registro (se a classificação ainda não trouxe a entrada, caso `uds:`), compara
// identidade de workspace e, se diferente, consulta o cadastro efetivo do repositório principal
// da ORIGEM.
function checkContainment({ payload, classification, cache, opts }) {
  const origin = resolveOwnOrigin(payload, cache, opts);
  if (!origin.ok) return origin;
  const originCwd = origin.originCwd;

  let destEntry = classification.entry || null;
  if (!destEntry && classification.address) {
    const resolved = resolveSessionBySocketCached(cache, classification.address);
    if (resolved.error) return { ok: false, reason: resolved.error };
    if (!resolved.entry) {
      return { ok: false, reason: `destino sem registro local (sessão remota, na nuvem, ou encerrada) para 'uds:${classification.address}'` };
    }
    destEntry = resolved.entry;
  }
  if (!destEntry) return { ok: false, reason: 'destino sem registro local' };
  const destCwd = destEntry.cwd;

  const originWorkspaceRoot = workspaceRoot(originCwd, { home: opts.home });
  const destWorkspaceRoot = workspaceRoot(destCwd, { home: opts.home });
  const originIdentity = workspaceIdentity(originWorkspaceRoot);
  const destIdentity = workspaceIdentity(destWorkspaceRoot);

  // Mesma raiz FÍSICA de workspace: não há para onde vazar, e a troca de remote que o
  // self_identity fecha só importa entre workspaces físicos diferentes. Passa sem ler o cadastro —
  // a identidade depende da máquina (alias de ssh config, insteadOf) e o cadastro é compartilhado
  // pelo time; conferir aqui bloqueava o tráfego interno do colega com outra forma de remote
  // (code-evaluator PR #245, round 2, R2-002), e poupa o `git show` do caso mais comum.
  if (originWorkspaceRoot === destWorkspaceRoot) {
    return { ok: true, originCwd, destCwd };
  }

  const originMainRepo = mainRepoRoot(originCwd) || originWorkspaceRoot;
  const { doc, error: allowlistError } = readEffectiveAllowlist({ root: originMainRepo });
  // Cadastro commitado ilegível ou inválido: nunca vira "documento vazio" aqui — o self_identity
  // sumiria e a troca de remote voltaria a liberar (code-evaluator PR #245, round 2, R2-001).
  if (allowlistError) {
    return { ok: false, reason: `cadastro de workspaces inválido no HEAD (${allowlistError}); contenção suspensa até decisão humana` };
  }

  // self_identity ANTES da comparação de igualdade (design §2.5 etapa 5): é exatamente a troca do
  // remote para o do destino — que torna origem e destino "iguais" — que o `native pin` fecha.
  // Com o atalho de igualdade primeiro, essa troca liberava o envio com cadastro vazio.
  if (doc.self_identity && doc.self_identity !== originIdentity) {
    return {
      ok: false,
      reason: `remote do repositório diverge da identidade fixada ('${doc.self_identity}' vs '${originIdentity}'); contenção suspensa até decisão humana`,
    };
  }

  if (originIdentity === destIdentity) {
    return { ok: true, originCwd, destCwd };
  }

  const active = (doc.allowed_workspaces || []).some((e) => e.id === destIdentity && !e.revoked_at);
  if (!active) {
    return {
      ok: false,
      reason: `destino em outro workspace sem cadastro: origem '${originIdentity}', destino '${destIdentity}'; liberar esse workspace é decisão do operador humano, feita fora de qualquer sessão do Claude Code`,
    };
  }
  return { ok: true, originCwd, destCwd };
}

// firstNonEmptyLineIndex(lines) -> índice da primeira linha não vazia, ou -1.
function firstNonEmptyLineIndex(lines) {
  return lines.findIndex((l) => l.trim() !== '');
}

// freeTextBytesExcludingCanonical(message, pointerLineIdx) -> bytes do texto livre que
// acompanha um ponteiro, excluindo a linha do próprio ponteiro e as linhas canônicas que
// `notify` imprime (design §2.5 etapa 6, item do teto).
function freeTextBytesExcludingCanonical(message, pointerLineIdx) {
  const lines = message.split('\n');
  const kept = lines.filter((l, i) => {
    if (i === pointerLineIdx) return false;
    const t = l.trim();
    return !CANONICAL_NOTIFY_PREFIXES.some((p) => t.startsWith(p));
  });
  return Buffer.byteLength(kept.join('\n'), 'utf8');
}

// checkChannelParticipation({ root, channel, destMainRepo }) -> true | false | 'inconclusive'
// (design §2.5 etapa 6, item do ponteiro): participante sem `peer-path` torna a checagem
// inconclusiva (o doctor já avisa participante sem `peer-path`); com todos os `peer-path`
// resolvidos, o destino precisa coincidir com ao menos um.
function checkChannelParticipation({ root, channel, destMainRepo }) {
  const cfg = readConfig(join(root, '.forge', 'liaison', 'liaison.yaml'));
  const selfId = cfg.self && cfg.self.id;
  // O próprio remetente nunca precisa de `peer-path` (é a origem, não um peer remoto) — contá-lo
  // na lista tornaria toda checagem "inconclusiva" por construção, mesmo com os DEMAIS
  // participantes totalmente resolvidos.
  const participants = ((cfg.channels && cfg.channels[channel] && cfg.channels[channel].participants) || []).filter((p) => p !== selfId);
  if (participants.length === 0) return 'inconclusive';
  const destIdentity = destMainRepo ? workspaceIdentity(destMainRepo) : null;
  let anyWithoutPeerPath = false;
  for (const p of participants) {
    const peerPath = getPeerPath(cfg, channel, p);
    if (!peerPath) {
      anyWithoutPeerPath = true;
      continue;
    }
    const peerMainRepo = mainRepoRoot(peerPath) || peerPath;
    const peerIdentity = workspaceIdentity(peerMainRepo);
    if (destIdentity && peerIdentity === destIdentity) return true;
  }
  return anyWithoutPeerPath ? 'inconclusive' : false;
}

// checkDeclaredDestination({ payload, originCwd, destCwd, opts }) -> { ok } | { ok: false,
// reason } (design §2.5 etapa 6, REQ-06). A primeira linha não vazia de `message` precisa ser
// um ponteiro `liaison:<channel>/<msg_id>` válido ou uma declaração `ephemeral: <class>`.
function checkDeclaredDestination({ payload, originCwd, destCwd, opts }) {
  const input = payload.tool_input || {};
  const message = typeof input.message === 'string' ? input.message : '';
  const lines = message.split('\n');
  const idx = firstNonEmptyLineIndex(lines);
  const NO_DECLARATION_REASON = "mensagem sem ponteiro nem declaração: use 'liaison:<channel>/<msg_id>' ou, na primeira linha, 'ephemeral: <class>'";
  if (idx === -1) return { ok: false, reason: NO_DECLARATION_REASON };
  const firstLine = lines[idx].trim();

  const originMainRepo = mainRepoRoot(originCwd);
  const destMainRepo = mainRepoRoot(destCwd);
  const sameRepo = Boolean(originMainRepo && destMainRepo && originMainRepo === destMainRepo);

  const pointerMatch = POINTER_LINE_RE.exec(firstLine);
  if (pointerMatch) {
    const [, channel, msgId] = pointerMatch;
    const rootForPointer = originMainRepo || workspaceRoot(originCwd, { home: opts.home });
    const resolved = resolvePointer({ root: rootForPointer, channel, msgId });
    if (!resolved.ok) return { ok: false, reason: `ponteiro inválido: ${resolved.reason}` };
    if (!sameRepo) {
      const participation = checkChannelParticipation({ root: rootForPointer, channel, destMainRepo });
      if (participation === false) {
        return { ok: false, reason: `o destino não participa do canal '${channel}' do ponteiro` };
      }
    }
    const freeBytes = freeTextBytesExcludingCanonical(message, idx);
    if (freeBytes > NATIVE_EXTRA_TEXT_MAX_BYTES) {
      return { ok: false, reason: `texto livre do ponteiro excede ${NATIVE_EXTRA_TEXT_MAX_BYTES} bytes (${freeBytes} bytes)` };
    }
    return { ok: true };
  }

  const ephemeralMatch = EPHEMERAL_LINE_RE.exec(firstLine);
  if (ephemeralMatch) {
    const cls = ephemeralMatch[1];
    if (!EPHEMERAL_CLASSES.includes(cls)) {
      return { ok: false, reason: `classe efêmera desconhecida '${cls}' — classes aceitas: ${EPHEMERAL_CLASSES.join(', ')}` };
    }
    if (cls === 'internal-coordination') {
      if (!sameRepo) {
        return {
          ok: false,
          reason: "ephemeral: internal-coordination só vale dentro do mesmo repositório — conteúdo substantivo entre repositórios é material de liaison",
        };
      }
      return { ok: true };
    }
    const bodyBytes = Buffer.byteLength(message, 'utf8');
    if (bodyBytes > NATIVE_EXTRA_TEXT_MAX_BYTES) {
      return { ok: false, reason: `corpo da declaração efêmera excede ${NATIVE_EXTRA_TEXT_MAX_BYTES} bytes (${bodyBytes} bytes)` };
    }
    return { ok: true };
  }

  const laterHasDeclaration = lines.some(
    (l, i) => i !== idx && (POINTER_LINE_RE.test(l.trim()) || EPHEMERAL_LINE_RE.test(l.trim())),
  );
  if (laterHasDeclaration) {
    return { ok: false, reason: 'declaração de ponteiro ou efêmero encontrada fora da primeira linha não vazia — mova para a primeira linha' };
  }
  return { ok: false, reason: NO_DECLARATION_REASON };
}

// parsePayload(rawStdin) -> { ok, payload } | { ok: false, reason } (design §2.5 etapa 1).
export function parsePayload(rawStdin) {
  if (!rawStdin || !rawStdin.trim()) {
    return { ok: false, reason: 'gancho: não consegui ler o payload (stdin vazio)' };
  }
  let obj;
  try {
    obj = JSON.parse(rawStdin);
  } catch (err) {
    return { ok: false, reason: `gancho: não consegui ler o payload (JSON malformado: ${err.message})` };
  }
  if (!obj || typeof obj !== 'object') {
    return { ok: false, reason: 'gancho: não consegui ler o payload (não é um objeto)' };
  }
  return { ok: true, payload: obj };
}

// evaluateSendGuard(payload, opts) -> { exitCode: 0 } | { exitCode: 2, message }. Orquestra as
// etapas do design §2.5 sobre um payload já parseado. `opts` aceita `sessionsDir`/`projectsDir`
// (fixtures) e `cache` (reaproveitado por quem já chamou `classifyRecipient` separadamente).
export function evaluateSendGuard(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') {
    return { exitCode: 2, message: 'gancho: payload inválido (não é objeto)' };
  }
  if (payload.tool_name !== undefined && payload.tool_name !== 'SendMessage') {
    return { exitCode: 0 }; // defesa: o matcher do gancho já filtra por SendMessage
  }
  const input = payload.tool_input || {};
  const cache = opts.cache || createExecutionCache(opts);
  const guardOpts = { ...opts, cache };

  const classification = classifyRecipient(payload, guardOpts);
  if (classification.kind === 'internal') return { exitCode: 0 };
  if (classification.kind === 'blocked') {
    return { exitCode: 2, message: classification.reason };
  }

  const notifyOnly = input.notify_when_idle === true && isBlank(input.message) && isBlank(input.content);

  if (!notifyOnly) {
    const body = typeof input.message === 'string' ? input.message : typeof input.content === 'string' ? input.content : undefined;
    if (isBlank(body)) {
      return {
        exitCode: 2,
        message: 'gancho: não consegui extrair o corpo da mensagem (campo ausente ou vazio, e não é pedido só de aviso de ociosidade)',
      };
    }
  }
  // Varredura de segredo em TODO campo string do tool_input (REQ-04), inclusive no pedido só de
  // aviso de ociosidade: message/content vazios não tornam vazio um `summary` preenchido
  // (code-evaluator PR #245, LOGIC-005/SEC-007).
  const secretCheck = scanToolInputForSecrets(input);
  if (secretCheck.found) {
    return {
      exitCode: 2,
      message: `gancho: segredo detectado (${secretCheck.pattern}) no campo '${secretCheck.field}' — valor nunca ecoado`,
    };
  }

  // Etapa 5 — contenção por workspace (REQ-07).
  const containment = checkContainment({ payload, classification, cache, opts });
  if (!containment.ok) return { exitCode: 2, message: containment.reason };

  if (!notifyOnly) {
    // Etapa 6 — destino declarado (REQ-06).
    const declared = checkDeclaredDestination({ payload, originCwd: containment.originCwd, destCwd: containment.destCwd, opts });
    if (!declared.ok) return { exitCode: 2, message: declared.reason };
  }

  return { exitCode: 0 };
}

// runGuard(rawStdin, opts) -> { exitCode, message? } — parse + avaliação, ponto de entrada único
// usado pelo `main()` do processo e pelos testes que exercitam o stdin cru.
export function runGuard(rawStdin, opts = {}) {
  const parsed = parsePayload(rawStdin);
  if (!parsed.ok) return { exitCode: 2, message: parsed.reason };
  return evaluateSendGuard(parsed.payload, opts);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Fail-closed contra exceção: o Claude Code trata exit 1 de PreToolUse como erro que NÃO bloqueia,
// então qualquer erro não tratado (cwd com `.git` quebrado, payload sem `cwd`, registro em formato
// inesperado) precisa virar exit 2 com a razão, nunca o exit 1 padrão do node.
function failClosed(err) {
  const detalhe = err && err.message ? err.message : String(err);
  try {
    process.stderr.write(`gancho: erro interno ao avaliar o envio (${detalhe}); bloqueado por segurança (fail-closed)\n`);
  } finally {
    process.exit(2);
  }
}

async function main() {
  process.on('uncaughtException', failClosed);
  process.on('unhandledRejection', failClosed);
  try {
    const raw = await readStdin();
    const result = runGuard(raw, {});
    if (result.exitCode !== 0 && result.message) {
      process.stderr.write(`${result.message}\n`);
    }
    process.exit(result.exitCode === 0 ? 0 : 2);
  } catch (err) {
    failClosed(err);
  }
}

// Só roda main() quando invocado como processo (o `.sh` faz `exec node native-send-guard.mjs`);
// quando importado por um módulo de teste, nenhum stdin é consumido. `realpathSync` em
// `process.argv[1]` é necessário: `import.meta.url` já vem resolvido por symlink (no macOS,
// `/tmp` é symlink para `/private/tmp`, e o mesmo vale para `/var/folders/...` usado por
// `os.tmpdir()`), e sem a mesma resolução dos dois lados a comparação nunca casa — `main()`
// nunca rodaria e o processo sairia 0 em silêncio, sem tocar o stdin.
function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main();
}
