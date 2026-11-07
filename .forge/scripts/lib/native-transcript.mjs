// lib/native-transcript.mjs — leitor ÚNICO do transcript da sessão para a mensageria nativa
// entre sessões do Claude Code (design §2.6, REQ-02, REQ-07, REQ-08). Consumido por
// `send --via cross-session`, `native check` e o gancho `SessionEnd` — todos leem a mesma
// recepção pelo mesmo caminho, nunca por regex solta em cada chamador.
//
// Recepção (design §2.6, evidência b): linha `type: "user"`, sem `toolUseResult` nem bloco
// `tool_result`, cujo `message.content` (string, ou blocos `type: "text"` de um array) contém a
// tag de abertura `<cross-session-message from="..." from-name="..." from-mode="...">` com o
// corpo até `</cross-session-message>`, e cujo `from` começa com `uds:`. O objeto `origin` (quando
// presente, `kind: "peer"`) é só CONFERÊNCIA: cada campo presente nele (`from`, `name`,
// `fromMode`, `body`) precisa casar o valor da tag; campo ausente não é divergência; divergência
// marca a linha como inconsistente e o diagnóstico inteiro como "instrumento quebrado".
//
// Candidata: toda linha que PODERIA ser recepção (ver `isCandidateLine`) — usada só para decidir
// se um transcript com zero recepções extraídas é "nada pendente" (nenhuma candidata) ou
// "instrumento quebrado" (havia candidata e o parser não extraiu nada dela).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Tag completa (abertura + corpo + fechamento). `[\s\S]*?` é non-greedy: para numa linha com mais
// de uma tag (não medido, mas evita capturar até a ÚLTIMA ocorrência).
const TAG_RE =
  /<cross-session-message from="([^"]*)" from-name="([^"]*)" from-mode="([^"]*)">([\s\S]*?)<\/cross-session-message>/;
// Mesma tag com o corpo GULOSO (até o último fechamento) — só usado para conferir contra
// `origin.body` quando o corpo cita o próprio fechamento da tag (ver extractReception).
const TAG_RE_GREEDY =
  /<cross-session-message from="([^"]*)" from-name="([^"]*)" from-mode="([^"]*)">([\s\S]*)<\/cross-session-message>/;
// Só o prefixo da abertura — usado para a detecção de "candidata" sem precisar casar a tag inteira
// (uma tag malformada ainda é candidata; só não extrai).
const TAG_PROBE = '<cross-session-message from="';

function contentText(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

function hasToolResultBlock(message) {
  const content = message && message.content;
  if (!Array.isArray(content)) return false;
  return content.some((b) => b && b.type === 'tool_result');
}

// Remove só o `\n` estrutural que o Claude Code insere imediatamente depois de `>` e
// imediatamente antes de `</cross-session-message>` ao montar a tag — não um trim geral (o corpo
// pode ter múltiplas linhas internas, que precisam ser preservadas).
function unwrapBody(raw) {
  return raw.replace(/^\n/, '').replace(/\n$/, '');
}

export function fingerprint(from, fromName, body) {
  const json = JSON.stringify([from, fromName, body]);
  return createHash('sha256').update(Buffer.from(json, 'utf8')).digest('hex');
}

// isCandidateLine(line) -> bool. Linha que PODE ser recepção, mesmo que a extração falhe depois
// (design §2.6, medição b rodada 2). Dois ramos independentes:
//   1. `origin.kind: "peer"` com `origin.from` começando em `uds:` — cobre o formato derivado em
//      que a tag não está no texto (aí a extração falha e o diagnóstico é "instrumento quebrado").
//   2. texto contém o prefixo da tag E (`isMeta: true` OU `promptSource: "system"`) — os dois
//      marcadores medidos de recepção real; sem eles, uma menção à tag (documentação da
//      ferramenta, turno humano citando-a) não é candidata.
// `origin.kind` presente e diferente de "peer" (human, task-notification, coordinator) EXCLUI a
// linha de ambos os ramos, mesmo que o texto contenha a tag — controle negativo medido.
// `turnOrigin: "scheduled"` também exclui, pelo mesmo motivo.
export function isCandidateLine(line) {
  if (!line || line.type !== 'user') return false;
  if (line.toolUseResult) return false;
  if (hasToolResultBlock(line.message)) return false;
  if (line.turnOrigin === 'scheduled') return false;
  const origin = line.origin;
  if (origin && origin.kind && origin.kind !== 'peer') return false;
  if (origin && origin.kind === 'peer' && typeof origin.from === 'string' && origin.from.startsWith('uds:')) {
    return true;
  }
  const text = contentText(line.message);
  if (text.includes(TAG_PROBE) && (line.isMeta === true || line.promptSource === 'system')) return true;
  return false;
}

// extractReception(line) -> { from, fromName, fromMode, body, verifiedPeerPid, fingerprint,
// consistent, inconsistencyReason } | null. Independente dos MARCADORES de candidata
// (`isMeta`/`promptSource`): extrai sempre que a tag casa e `from` começa com `uds:`, para que
// formatos derivados (tag em bloco de array sem `origin`) também sejam extraídos. Os controles
// NEGATIVOS do design §2.6 (`origin.kind` presente e diferente de "peer"; `turnOrigin`
// "scheduled") valem também aqui, não só no diagnóstico de candidata: sem eles, a tag escrita
// por um subagente no próprio `<result>` (linha `task-notification`) ou num turno agendado virava
// "recepção" com `from`/`from-name` escolhidos por quem escreveu (code-evaluator PR #245,
// SEC-001).
export function extractReception(line) {
  if (!line || line.type !== 'user') return null;
  if (line.toolUseResult) return null;
  if (hasToolResultBlock(line.message)) return null;
  if (line.turnOrigin === 'scheduled') return null;
  if (line.origin && line.origin.kind && line.origin.kind !== 'peer') return null;
  const text = contentText(line.message);
  const m = TAG_RE.exec(text);
  if (!m) return null;
  const [, from, fromName, fromMode, bodyRawLazy] = m;
  if (!from.startsWith('uds:')) return null;
  let bodyRaw = bodyRawLazy;
  // Corpo que CITA o fechamento da tag (code-evaluator PR #245, LOGIC-003): o casamento não
  // guloso corta no primeiro fechamento. Quando o `origin.body` medido diverge do corte, tenta o
  // casamento guloso (até o ÚLTIMO fechamento) e fica com ele se, e só se, bater com
  // `origin.body` — sem `origin.body` não há com o que conferir, e vale o corte não guloso.
  const originBody = line.origin && line.origin.kind === 'peer' ? line.origin.body : undefined;
  if (typeof originBody === 'string' && unwrapBody(bodyRaw) !== originBody) {
    const g = TAG_RE_GREEDY.exec(text);
    if (g && g[1] === from && g[2] === fromName && g[3] === fromMode && unwrapBody(g[4]) === originBody) bodyRaw = g[4];
  }
  const body = unwrapBody(bodyRaw);

  let consistent = true;
  let inconsistencyReason = null;
  const origin = line.origin;
  if (origin && origin.kind === 'peer') {
    const checks = [
      ['from', origin.from, from],
      ['name', origin.name, fromName],
      ['fromMode', origin.fromMode, fromMode],
      ['body', origin.body, body],
    ];
    for (const [field, originVal, tagVal] of checks) {
      if (originVal === undefined) continue;
      if (originVal !== tagVal) {
        consistent = false;
        inconsistencyReason = `campo '${field}' diverge entre a tag ('${tagVal}') e origin ('${originVal}')`;
        break;
      }
    }
  }

  const verifiedPeerPid =
    origin && typeof origin.verifiedPeerPid === 'number' ? origin.verifiedPeerPid : null;

  return {
    from,
    fromName,
    fromMode,
    body,
    verifiedPeerPid,
    fingerprint: fingerprint(from, fromName, body),
    consistent,
    inconsistencyReason,
  };
}

// parseTranscriptText(text) -> { receptions, candidateCount, inconsistent, brokenInstrument }.
// `brokenInstrument` é true quando havia candidata e nenhuma recepção foi extraída, OU quando
// alguma recepção extraída diverge da conferência cruzada do `origin` — nos dois casos o
// diagnóstico não pode dizer "nada pendente" (design §2.6).
export function parseTranscriptText(text) {
  const receptions = [];
  const inconsistent = [];
  let candidateCount = 0;
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (isCandidateLine(obj)) candidateCount += 1;
    const rec = extractReception(obj);
    if (rec) {
      receptions.push(rec);
      if (!rec.consistent) inconsistent.push(rec);
    }
  }
  const brokenInstrument = (candidateCount > 0 && receptions.length === 0) || inconsistent.length > 0;
  return { receptions, candidateCount, inconsistent, brokenInstrument };
}

// Fixture de controle embutida (evidência b, "Fixture sintética"): duas recepções sintéticas no
// formato medido, cujos fingerprints são fixos e conhecidos. Roda a CADA execução de
// `readTranscript` — se o módulo parar de extrair as duas, ou os fingerprints mudarem, o
// diagnóstico vira "instrumento quebrado" em vez de confiar silenciosamente num parser quebrado.
export const CONTROL_FIXTURE_LINES = [
  '{"type":"user","isMeta":true,"isSidechain":false,"turnOrigin":"peer","promptSource":"system","queueSkipSlashCommands":true,"queueSkipAttachments":true,"permissionMode":"default","uuid":"00000000-0000-0000-0000-000000000001","parentUuid":"00000000-0000-0000-0000-000000000000","sessionId":"CONTROL-FIXTURE-SESSION","timestamp":"2026-10-30T00:00:00.000Z","version":"2.1.314","message":{"role":"user","content":"Another Claude session sent a message:\\n<cross-session-message from=\\"uds:/tmp/cc-socks/11111.sock\\" from-name=\\"PEER-FIXTURE\\" from-mode=\\"default\\">\\ncorpo fict\u00edcio de controle \u2014 mensagem 1\\n</cross-session-message>\\n\\nThis came from another Claude session (par\u00e1grafo fixo omitido na fixture)."},"origin":{"kind":"peer","from":"uds:/tmp/cc-socks/11111.sock","verifiedPeerPid":11111,"msg_id":"00000000-0000-0000-0000-0000000000a1","name":"PEER-FIXTURE","fromMode":"default","body":"corpo fict\u00edcio de controle \u2014 mensagem 1"}}',
  '{"type":"user","isMeta":true,"isSidechain":false,"turnOrigin":"peer","promptSource":"system","queueSkipSlashCommands":true,"queueSkipAttachments":true,"permissionMode":"default","uuid":"00000000-0000-0000-0000-000000000002","parentUuid":"00000000-0000-0000-0000-000000000001","sessionId":"CONTROL-FIXTURE-SESSION","timestamp":"2026-10-30T00:00:01.000Z","version":"2.1.314","message":{"role":"user","content":"Another Claude session sent a message:\\n<cross-session-message from=\\"uds:/tmp/cc-socks/11111.sock\\" from-name=\\"PEER-FIXTURE\\" from-mode=\\"default\\">\\ncorpo fict\u00edcio de controle \u2014 mensagem 2\\n</cross-session-message>\\n\\nThis came from another Claude session (par\u00e1grafo fixo omitido na fixture)."},"origin":{"kind":"peer","from":"uds:/tmp/cc-socks/11111.sock","verifiedPeerPid":11111,"msg_id":"00000000-0000-0000-0000-0000000000a2","name":"PEER-FIXTURE","fromMode":"default","body":"corpo fict\u00edcio de controle \u2014 mensagem 2"}}',
];

export const CONTROL_FIXTURE_FINGERPRINTS = [
  'b843a088d77925ead49ceac0181d3108da745af004d6e8d123ed7bc4467b4654',
  '161d6df6c22d3f94b8c284be2ba6da60ed5cfbdac4d7636f2fef05d16eff4baf',
];

export function runControlFixture() {
  const { receptions, brokenInstrument } = parseTranscriptText(CONTROL_FIXTURE_LINES.join('\n'));
  if (brokenInstrument || receptions.length !== CONTROL_FIXTURE_FINGERPRINTS.length) {
    return {
      ok: false,
      reason: `esperava ${CONTROL_FIXTURE_FINGERPRINTS.length} recepções de controle consistentes, obteve ${receptions.length} (brokenInstrument=${brokenInstrument})`,
    };
  }
  const got = receptions.map((r) => r.fingerprint);
  for (const expected of CONTROL_FIXTURE_FINGERPRINTS) {
    if (!got.includes(expected)) {
      return { ok: false, reason: `fingerprint de controle ausente: ${expected} (obtidos: ${got.join(', ')})` };
    }
  }
  return { ok: true };
}

// findNamedAgentInTranscript({ transcriptPath, name }) -> bool. Procura, no transcript da
// PRÓPRIA sessão, uma chamada de ferramenta `Agent` cujo `input.name` seja exatamente `name`
// (design §2.5 etapa 2, REQ-05 — formato de subagente nomeado não medido em 2.1.314, evidência
// a). Usada só pelo gancho de saída para provar destino interno quando o nome não resolve no
// registro de sessões. Sem relação com a recepção de mensagem entre sessões: percorre linhas
// `type: "assistant"` com blocos `tool_use`, decodificando cada linha JSONL isoladamente — uma
// linha malformada não derruba a busca nas demais. `transcriptPath` ausente ou ilegível -> false
// (fail-closed: quem chama trata "não achou" como "não é interno").
export function findNamedAgentInTranscript({ transcriptPath, name } = {}) {
  if (!transcriptPath || !name) return false;
  let text;
  try {
    text = readFileSync(transcriptPath, 'utf8');
  } catch {
    return false;
  }
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || obj.type !== 'assistant') continue;
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_use' && block.name === 'Agent' && block.input && block.input.name === name) {
        return true;
      }
    }
  }
  return false;
}

// defaultProjectsDir() -> diretório onde o Claude Code guarda `<slug>/<session-id>.jsonl`.
// Sobreponível por FORGE_CLAUDE_PROJECTS_DIR só para fixtures (design §2.4 passo 3) — nunca
// redirecionar HOME, o que mudaria a subida de workspace e o git config global.
export function defaultProjectsDir() {
  return process.env.FORGE_CLAUDE_PROJECTS_DIR || join(homedir(), '.claude', 'projects');
}

// locateTranscript({ sessionId, projectsDir }) -> { ok, path } | { ok: false, reason }.
// Glob `<projectsDir>/*/<sessionId>.jsonl`: zero ou mais de um resultado reprova nomeando o que
// faltou (design §2.4 passo 3).
export function locateTranscript({ sessionId, projectsDir } = {}) {
  if (!sessionId) return { ok: false, reason: 'transcript: sessionId ausente' };
  const dir = projectsDir || defaultProjectsDir();
  if (!existsSync(dir)) return { ok: false, reason: `transcript: diretório de projetos '${dir}' não existe` };
  const matches = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(dir, entry.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) matches.push(candidate);
  }
  if (matches.length === 0) {
    return { ok: false, reason: `transcript: nenhum transcript da sessão '${sessionId}' em '${dir}'` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: `transcript: mais de um transcript da sessão '${sessionId}' em '${dir}' (${matches.join(', ')})`,
    };
  }
  return { ok: true, path: matches[0] };
}

// readTranscript({ sessionId, transcriptPath, projectsDir }) -> leitura completa: roda a fixture
// de controle, localiza (se `transcriptPath` não foi dado), lê e faz o parse. Ponto de entrada
// único para `send --via cross-session`, `native check` e o `SessionEnd` (design §2.6).
export function readTranscript({ sessionId, transcriptPath, projectsDir } = {}) {
  const control = runControlFixture();
  if (!control.ok) {
    return {
      ok: false,
      brokenInstrument: true,
      reason: `transcript: instrumento quebrado — fixture de controle falhou (${control.reason})`,
    };
  }

  let path = transcriptPath;
  if (!path) {
    const located = locateTranscript({ sessionId, projectsDir });
    if (!located.ok) return { ok: false, brokenInstrument: false, reason: located.reason };
    path = located.path;
  }
  if (!existsSync(path)) {
    return { ok: false, brokenInstrument: false, reason: `transcript: arquivo '${path}' não existe` };
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, brokenInstrument: false, reason: `transcript: arquivo '${path}' ilegível (${err.message})` };
  }

  const parsed = parseTranscriptText(text);
  if (parsed.brokenInstrument) {
    return {
      ok: false,
      brokenInstrument: true,
      reason: 'transcript: instrumento quebrado — candidata sem extração ou divergência entre tag e origin',
      path,
      ...parsed,
    };
  }
  return { ok: true, brokenInstrument: false, path, ...parsed };
}
