// lib/native-registry.mjs — leitor ÚNICO do registro de sessões do Claude Code
// (`~/.claude/sessions/<pid>.json`, evidência c) para a mensageria nativa entre sessões (design
// §2.5 "Resolução no registro", REQ-02, REQ-07). Consumido pelo gancho de saída, por
// `send --via cross-session` e por `native check` — todos resolvem destino/origem pelo mesmo
// caminho, nunca por leitura solta de `~/.claude/sessions`.
//
// Um arquivo nunca lido: `*.key` (ao lado de cada `<pid>.json`). Um registro conta como vivo
// quando `process.kill(pid, 0)` não lança E `messagingSocketPath` existe como socket
// (`lstat().isSocket()`) — a checagem do socket cobre reuso de pid por processo que não é do
// Claude Code, sem precisar de `ps`. Resolução fail-closed: arquivo ilegível ou sem `name`/`cwd`/
// `messagingSocketPath` faz a resolução falhar nomeando o arquivo, quando a resolução DEPENDE
// dele (por nome — precisa enumerar todo o diretório; por socket, só quando nenhum registro
// válido deu match).
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// defaultSessionsDir() -> diretório do registro. Sobreponível por FORGE_CLAUDE_SESSIONS_DIR só
// para fixtures (design §2.5), nunca redirecionar HOME.
export function defaultSessionsDir() {
  return process.env.FORGE_CLAUDE_SESSIONS_DIR || join(homedir(), '.claude', 'sessions');
}

// normalizeSocketPath(p) -> caminho com o DIRETÓRIO pai resolvido por realpath, para que `/tmp` e
// `/private/tmp` (symlink no macOS) convirjam na comparação (design §2.5, item 4 do gate). Se o
// diretório pai não existe (socket já removido), devolve o caminho original sem normalizar — a
// comparação simplesmente não vai casar, o que é o comportamento correto para socket morto.
export function normalizeSocketPath(p) {
  if (!p) return p;
  try {
    const real = realpathSync(dirname(p));
    return join(real, basename(p));
  } catch {
    return p;
  }
}

// readRegistryFiles({ sessionsDir }) -> { entries, errors, dirError }.
// `entries`: registros legíveis e completos. `errors`: `{ file, reason }` por arquivo ilegível,
// com JSON inválido, ou sem `name`/`cwd`/`messagingSocketPath`. `dirError` só quando o próprio
// diretório não pôde ser listado.
export function readRegistryFiles({ sessionsDir } = {}) {
  const dir = sessionsDir || defaultSessionsDir();
  const entries = [];
  const errors = [];
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    return { entries, errors, dirError: `registro: diretório '${dir}' ilegível (${err.message})` };
  }
  for (const file of files) {
    const full = join(dir, file);
    let raw;
    try {
      raw = readFileSync(full, 'utf8');
    } catch (err) {
      errors.push({ file: full, reason: `arquivo ilegível (${err.message})` });
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      errors.push({ file: full, reason: `JSON inválido (${err.message})` });
      continue;
    }
    if (!obj || typeof obj.name !== 'string' || typeof obj.cwd !== 'string' || typeof obj.messagingSocketPath !== 'string') {
      errors.push({ file: full, reason: "campo obrigatório ausente ('name'/'cwd'/'messagingSocketPath')" });
      continue;
    }
    const pidFromName = Number(basename(file, '.json'));
    const pid = typeof obj.pid === 'number' ? obj.pid : pidFromName;
    entries.push({
      file: full,
      pid,
      name: obj.name,
      cwd: obj.cwd,
      messagingSocketPath: obj.messagingSocketPath,
      sessionId: obj.sessionId,
      raw: obj,
    });
  }
  return { entries, errors, dirError: null };
}

// isAlive(entry) -> bool. `process.kill(pid, 0)` sem lançar E socket existe como socket.
export function isAlive(entry) {
  if (!entry || typeof entry.pid !== 'number' || Number.isNaN(entry.pid)) return false;
  try {
    process.kill(entry.pid, 0);
  } catch {
    return false;
  }
  try {
    const real = normalizeSocketPath(entry.messagingSocketPath);
    return lstatSync(real).isSocket();
  } catch {
    return false;
  }
}

function failClosedReason(errors) {
  if (errors.length === 0) return null;
  const first = errors[0];
  return `registro: ${first.file} ilegível ou incompleto (${first.reason})`;
}

// resolveByName({ sessionsDir, name }) -> { ok, entry } | { ok: false, reason, ambiguous? }.
// Resolução por nome precisa enumerar TODO o diretório (não dá para saber de antemão qual
// arquivo teria o nome procurado) — por isso qualquer arquivo ilegível no diretório faz a
// resolução falhar fail-closed, mesmo que o nome procurado exista num arquivo válido.
export function resolveByName({ sessionsDir, name } = {}) {
  const { entries, errors, dirError } = readRegistryFiles({ sessionsDir });
  if (dirError) return { ok: false, reason: dirError };
  const fc = failClosedReason(errors);
  if (fc) return { ok: false, reason: fc };
  const alive = entries.filter((e) => e.name === name && isAlive(e));
  if (alive.length === 0) return { ok: false, reason: `registro: nenhuma sessão viva com nome '${name}'` };
  if (alive.length > 1) {
    return { ok: false, ambiguous: true, reason: `registro: mais de uma sessão viva com nome '${name}'` };
  }
  return { ok: true, entry: alive[0] };
}

// resolveBySocket({ sessionsDir, sockFile }) -> { ok, entry } | { ok: false, reason }.
// Fail-closed só se nenhum registro válido deu match E existe arquivo ilegível no diretório
// (a resolução pode ter perdido o match verdadeiro nesse arquivo).
export function resolveBySocket({ sessionsDir, sockFile } = {}) {
  const { entries, errors, dirError } = readRegistryFiles({ sessionsDir });
  if (dirError) return { ok: false, reason: dirError };
  const target = normalizeSocketPath(sockFile);
  const alive = entries.filter((e) => isAlive(e) && normalizeSocketPath(e.messagingSocketPath) === target);
  if (alive.length === 0) {
    const fc = failClosedReason(errors);
    if (fc) return { ok: false, reason: fc };
    return { ok: false, reason: `registro: nenhuma sessão viva com socket '${sockFile}'` };
  }
  return { ok: true, entry: alive[0] };
}

// resolveBySessionId({ sessionsDir, sessionId }) -> { ok, entry } | { ok: false, reason }.
// Usado para achar o registro da PRÓPRIA sessão (design §2.5 etapa 5, contenção): o `cwd` desse
// registro é cruzado com o `cwd` do payload. Não exige vivacidade — é a sessão que está rodando
// agora mesmo, mas a checagem de pid/socket é redundante nesse uso e não muda o resultado.
export function resolveBySessionId({ sessionsDir, sessionId } = {}) {
  const { entries, errors, dirError } = readRegistryFiles({ sessionsDir });
  if (dirError) return { ok: false, reason: dirError };
  const match = entries.find((e) => e.sessionId === sessionId);
  if (!match) {
    const fc = failClosedReason(errors);
    if (fc) return { ok: false, reason: fc };
    return { ok: false, reason: `registro: nenhum registro com sessionId '${sessionId}'` };
  }
  return { ok: true, entry: match };
}
