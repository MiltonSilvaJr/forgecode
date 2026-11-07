// lib/liaison-pointer.mjs — ponteiro canônico `liaison:<channel>/<msg_id>` (REQ-01, design §2.2,
// §2.3).
//
// `resolvePointer` é o ÚNICO leitor que decide se um ponteiro é válido — consumido pelo
// subcomando `notify` (CLI) e, quando o destino não é o repositório de origem, pelo gancho de
// saída `guard-cross-session-send.sh` (design §2.5 etapa 6). O ponteiro que `notify` imprime é
// exatamente o que o gancho aceita porque os dois chamam esta mesma função.
//
// Quatro condições, na ordem em que são checadas (REQ-01): o canal existe; a mensagem existe no
// canal; é mensagem PRÓPRIA (sender === self.id configurado); está PUBLICADA por um `sync` com
// push bem-sucedido (mesma regra de `unpublishedCount`, via `isPublished`).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './liaison-config.mjs';
import { isPublished } from './liaison-publish.mjs';

function readSelfId(root) {
  const cfg = join(root, '.forge', 'liaison', 'liaison.yaml');
  const doc = readConfig(cfg);
  return (doc.self && doc.self.id) || '';
}

// Procura msgId em QUALQUER arquivo log/<sender>.jsonl do canal — a mensagem pode ter chegado por
// import/sync de um peer, não só do próprio remetente.
function findMessage(logDir, msgId) {
  const files = existsSync(logDir) ? readdirSync(logDir).filter((f) => f.endsWith('.jsonl')) : [];
  for (const f of files) {
    const text = readFileSync(join(logDir, f), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let rec;
      try { rec = JSON.parse(t); } catch { continue; }
      if (rec && rec.msg_id === msgId) return rec;
    }
  }
  return null;
}

// resolvePointer({ root, channel, msgId }) -> { ok, reason, thread_id, content_sha, subject }.
// `root` é sempre o checkout PRINCIPAL (tronco) — o mesmo que `liaison-ops.sh` resolve por
// `--git-common-dir` (forge-root.sh), para que uma sessão rodando numa worktree valide o mesmo
// ponteiro que a sessão do checkout principal (REQ-06, critério de posição).
export function resolvePointer({ root, channel, msgId }) {
  const chDir = join(root, '.forge', 'liaison', channel);
  const logDir = join(chDir, 'log');
  if (!existsSync(logDir)) return { ok: false, reason: `canal '${channel}' não existe` };

  const self = readSelfId(root);
  const msg = findMessage(logDir, msgId);
  if (!msg) return { ok: false, reason: `mensagem '${msgId}' não existe no canal '${channel}'` };
  if (!self || msg.sender !== self) {
    return { ok: false, reason: `mensagem '${msgId}' não é mensagem própria (sender='${msg.sender}')` };
  }
  if (!isPublished({ chDir, self, msgId })) {
    return { ok: false, reason: `mensagem '${msgId}' não publicada — rode: liaison-ops.sh sync ${channel}` };
  }
  return { ok: true, thread_id: msg.thread_id, content_sha: msg.content_sha, subject: msg.subject };
}
