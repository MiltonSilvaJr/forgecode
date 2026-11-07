// lib/native-allowlist.mjs — leitor e escritor ÚNICOS do cadastro de workspaces permitidos para
// a saída da mensageria nativa entre sessões (REQ-12, design §2.7, §4.3). Consumido pelo gancho
// de saída, pelos subcomandos `native allow|revoke|pin`, pelo detector de contenção e pelo
// doctor.
//
// Local: `.forge/liaison/allowed-workspaces.json` no repositório PRINCIPAL (versionado). Duas
// vistas do arquivo, deliberadamente distintas:
//
//   - `readEffectiveAllowlist` lê o CADASTRO EFETIVO: a versão COMMITADA no `HEAD` do tronco
//     (`git -C <tronco> show HEAD:.forge/liaison/allowed-workspaces.json`). É a única vista que o
//     gancho de saída e o detector de contenção consultam — edição não commitada nunca libera
//     destino (nota de convergência do design). Ausente no HEAD equivale a cadastro vazio;
//     presente e inválido pelo schema também é tratado como vazio (fail-closed), com o motivo
//     reportado em `error` para o doctor nomear.
//   - `allow`/`revoke`/`pin` operam sobre o ARQUIVO DA ÁRVORE DE TRABALHO (o que está no disco
//     agora, committed ou não) — para que chamadas sucessivas sem commit intermediário componham
//     corretamente. O arquivo escrito só passa a valer depois de commitado (lembrete impresso
//     pelo CLI em cada subcomando, design §2.7).
//
// Validação por schema é feita à MÃO (NFR-02: zero dependência nova de runtime) — mesmo idioma
// de `validateEnvelope` em lib/liaison-merge.mjs — e roda ANTES de qualquer escrita em disco.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { workspaceIdentityFor } from './native-workspace.mjs';

export const ALLOWED_WORKSPACES_REL_PATH = '.forge/liaison/allowed-workspaces.json';

// Identidade de workspace: `host/owner/repo` (com porta opcional), igual ao formato que
// `normalizeRemote` produz — ou um caminho absoluto, para o workspace sem remote.
export const IDENTITY_FORMAT_RE = /^[a-z0-9.-]+(:[0-9]+)?\/[^/\s]+(\/[^/\s]+)+$/;

export function isValidIdentityFormat(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (isAbsolute(id)) return true;
  return IDENTITY_FORMAT_RE.test(id);
}

function emptyDoc() {
  return { version: 1, allowed_workspaces: [] };
}

const TOP_LEVEL_KEYS = ['version', 'self_identity', 'allowed_workspaces'];
const ENTRY_KEYS = ['id', 'reason', 'granted_by', 'granted_at', 'revoked_at', 'revoked_by', 'revoke_reason'];
const ENTRY_REQUIRED = ['id', 'reason', 'granted_by', 'granted_at'];

// validateAllowlistDoc(doc) -> string[] de erros (vazio = válido). Espelha
// schemas/liaison-allowed-workspaces.schema.json campo a campo — NFR-02 proíbe trazer um
// validador de JSON Schema genérico só para este arquivo.
export function validateAllowlistDoc(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['documento não é um objeto'];
  for (const k of Object.keys(doc)) if (!TOP_LEVEL_KEYS.includes(k)) errors.push(`propriedade não declarada: ${k}`);
  if (doc.version !== 1) errors.push("'version' deve ser 1");
  if (!Array.isArray(doc.allowed_workspaces)) { errors.push("'allowed_workspaces' deve ser array"); return errors; }
  if (doc.self_identity !== undefined && (typeof doc.self_identity !== 'string' || doc.self_identity.length < 1)) {
    errors.push("'self_identity' deve ser string não vazia");
  }
  doc.allowed_workspaces.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`allowed_workspaces[${i}] não é um objeto`);
      return;
    }
    for (const k of Object.keys(entry)) if (!ENTRY_KEYS.includes(k)) errors.push(`allowed_workspaces[${i}] propriedade não declarada: ${k}`);
    for (const f of ENTRY_REQUIRED) {
      if (entry[f] === undefined || entry[f] === null || entry[f] === '') errors.push(`allowed_workspaces[${i}].${f} obrigatório ausente`);
    }
    if (entry.revoked_at !== undefined && (!entry.revoked_by || !entry.revoke_reason)) {
      errors.push(`allowed_workspaces[${i}].revoked_at exige revoked_by e revoke_reason`);
    }
  });
  return errors;
}

function allowlistFilePath(root) {
  return join(root, ALLOWED_WORKSPACES_REL_PATH);
}

// readEffectiveAllowlist({ root }) -> { doc, error } — o cadastro EFETIVO (committado no HEAD do
// `root`, que é o repositório principal/tronco). Ausente no HEAD -> doc vazio, error null.
// Presente e malformado (JSON inválido ou reprovado pelo schema) -> doc vazio, error nomeando o
// motivo (fail-closed: inválido nunca libera destino).
export function readEffectiveAllowlist({ root }) {
  let text = null;
  try {
    text = execFileSync('git', ['-C', root, 'show', `HEAD:${ALLOWED_WORKSPACES_REL_PATH}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    text = null;
  }
  if (text == null) return { doc: emptyDoc(), error: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { doc: emptyDoc(), error: `${ALLOWED_WORKSPACES_REL_PATH} inválido no HEAD (JSON malformado): ${err.message}` };
  }
  const errors = validateAllowlistDoc(parsed);
  if (errors.length) {
    return { doc: emptyDoc(), error: `${ALLOWED_WORKSPACES_REL_PATH} inválido pelo schema no HEAD: ${errors.join('; ')}` };
  }
  return { doc: parsed, error: null };
}

// readWorkingAllowlist({ root }) -> { doc, error } — o arquivo como está na árvore de trabalho
// AGORA (committado ou não). Usado só pelos escritores, para compor chamadas sucessivas sem
// commit intermediário.
export function readWorkingAllowlist({ root }) {
  const file = allowlistFilePath(root);
  if (!existsSync(file)) return { doc: emptyDoc(), error: null };
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { doc: null, error: `não foi possível ler ${ALLOWED_WORKSPACES_REL_PATH}: ${err.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { doc: null, error: `${ALLOWED_WORKSPACES_REL_PATH} inválido na árvore de trabalho (JSON malformado): ${err.message}` };
  }
  return { doc: parsed, error: null };
}

function writeAllowlist({ root, doc }) {
  const errors = validateAllowlistDoc(doc);
  if (errors.length) return { ok: false, error: `documento final reprovado pelo schema: ${errors.join('; ')}` };
  const file = allowlistFilePath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return { ok: true, doc };
}

const COMMIT_REMINDER = 'o cadastro só vale depois de commitado no tronco';

// allow({ root, id, reason, grantedBy, now }) -> { ok, doc?, error?, reminder? }
//   - grava self_identity (identidade atual do workspace) se ainda ausente.
//   - identidade ATIVA repetida é idempotente (nenhuma entrada nova).
//   - identidade REVOGADA recebe entrada ativa NOVA; a entrada revogada permanece intacta.
export function allow({ root, id, reason, grantedBy, now }) {
  if (!isValidIdentityFormat(id)) {
    return { ok: false, error: `identidade fora do formato esperado (^[a-z0-9.-]+(:[0-9]+)?/[^/\\s]+(/[^/\\s]+)+$ ou caminho absoluto): '${id}'` };
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    return { ok: false, error: "'--reason' obrigatório e não vazio" };
  }
  if (typeof grantedBy !== 'string' || grantedBy.trim() === '') {
    return { ok: false, error: "'granted_by' obrigatório (git config user.email)" };
  }
  const read = readWorkingAllowlist({ root });
  if (read.error) return { ok: false, error: read.error };
  const doc = read.doc;
  if (!doc.self_identity) doc.self_identity = workspaceIdentityFor(root);
  const hasActive = doc.allowed_workspaces.some((e) => e.id === id && !e.revoked_at);
  if (!hasActive) {
    doc.allowed_workspaces.push({ id, reason, granted_by: grantedBy, granted_at: now });
  }
  const written = writeAllowlist({ root, doc });
  if (!written.ok) return written;
  return { ok: true, doc: written.doc, reminder: COMMIT_REMINDER };
}

// revoke({ root, id, reason, revokedBy, now }) -> { ok, doc?, error?, reminder? }
//   - exige uma entrada ATIVA com esse id; inexistente ou já revogada -> ok:false.
//   - marca revoked_at/revoked_by/revoke_reason; NUNCA apaga a entrada.
export function revoke({ root, id, reason, revokedBy, now }) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    return { ok: false, error: "'--reason' obrigatório e não vazio" };
  }
  if (typeof revokedBy !== 'string' || revokedBy.trim() === '') {
    return { ok: false, error: "'revoked_by' obrigatório (git config user.email)" };
  }
  const read = readWorkingAllowlist({ root });
  if (read.error) return { ok: false, error: read.error };
  const doc = read.doc;
  const entry = doc.allowed_workspaces.find((e) => e.id === id && !e.revoked_at);
  if (!entry) return { ok: false, error: `identidade '${id}' inexistente ou já revogada` };
  entry.revoked_at = now;
  entry.revoked_by = revokedBy;
  entry.revoke_reason = reason;
  const written = writeAllowlist({ root, doc });
  if (!written.ok) return written;
  return { ok: true, doc: written.doc, reminder: COMMIT_REMINDER };
}

// pin({ root }) -> { ok, doc?, error?, reminder? } — grava (sobrescrevendo, se já existir) o
// self_identity com a identidade ATUAL do workspace. Não libera nenhum destino; fecha o contorno
// de "trocar o remote para o do destino faz origem e destino 'iguais'" sem exigir subcomando
// próprio de detecção de troca de remote.
export function pin({ root }) {
  const read = readWorkingAllowlist({ root });
  if (read.error) return { ok: false, error: read.error };
  const doc = read.doc;
  doc.self_identity = workspaceIdentityFor(root);
  const written = writeAllowlist({ root, doc });
  if (!written.ok) return written;
  return { ok: true, doc: written.doc, reminder: COMMIT_REMINDER };
}
