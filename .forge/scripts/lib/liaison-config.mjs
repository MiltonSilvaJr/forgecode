// liaison-config — leitura e escrita determinística de .forge/liaison/liaison.yaml.
//
// Existe como lib (e não inline em liaison-ops.sh) porque quatro subcomandos precisam do MESMO
// serializador — `open`, `transport set`, `sync` e `_read_self`. Duplicar a emissão em heredocs
// separados garantiria drift entre eles: bastaria um esquecer o bloco `transport` para o `open`
// apagar o transporte configurado antes.
//
// Forma emitida (subset aceito por yaml-lite.mjs — 2 espaços, sem mapas inline):
//   self:
//     id: axis-go-cloud
//   channels:
//     contracts-fare:
//       participants:
//         - axis-fare-validator
//         - axis-go-cloud
//       transport:
//         kind: "fs"
//         path: "/caminho/do/hub"
//
// Escalares de transporte saem entre aspas porque carregam paths e URLs — conteúdo que o
// stripTrailingComment do parser cortaria em " #" e que pode começar por caractere ambíguo.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { parseYamlSubset, yamlQuote } from './yaml-lite.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
export const CHANNEL_RE = /^[a-z0-9][a-z0-9-]*$/;
// `fs-union` (issue #123) é o hub de `fs` com o `_common.sh` resolvido no checkout principal e falha
// fechada quando ele falta (lib/transports/fs-union.sh). Opt-in: quem não declara o kind não muda
// nada. A proteção contra a worktree de branch antiga vem DESTA lista: uma árvore anterior ao kind
// não o conhece e recusa o `liaison.yaml` do tronco com `kind inválido`, antes de tocar o hub.
export const TRANSPORT_KINDS = ['manual', 'fs', 'fs-union', 'git', 'gh'];

// Campos de transporte reconhecidos, na ordem de emissão. `kind` sempre primeiro.
const TRANSPORT_FIELDS = ['kind', 'path', 'remote', 'branch'];

// Caminho local do repositório de cada participante, usado só pelo subcomando `liaison ask` (consulta
// síncrona). É informação de MÁQUINA, não do canal: o mesmo participante fica em diretórios
// diferentes em cada estação, e por isso nunca viaja numa mensagem — quem não tiver o peer
// clonado simplesmente não usa o atalho síncrono e segue pelo fluxo assíncrono.
export function getPeerPath(doc, channel, participant) {
  const ch = doc.channels && doc.channels[channel];
  if (!ch || !ch.peers) return null;
  return ch.peers[participant] || null;
}

export function readConfig(file) {
  if (!existsSync(file)) return { self: {}, channels: {} };
  const doc = parseYamlSubset(readFileSync(file, 'utf8'));
  if (!doc.self || typeof doc.self !== 'object') doc.self = {};
  if (!doc.channels || typeof doc.channels !== 'object') doc.channels = {};
  return doc;
}

export function writeConfig(file, doc) {
  const lines = ['self:', `  id: ${doc.self.id}`, 'channels:'];
  for (const name of Object.keys(doc.channels).sort()) {
    const ch = doc.channels[name] || {};
    lines.push(`  ${name}:`, '    participants:');
    for (const p of (ch.participants || []).slice().sort()) lines.push(`      - ${p}`);
    if (ch.transport && ch.transport.kind) {
      lines.push('    transport:');
      for (const f of TRANSPORT_FIELDS) {
        const v = ch.transport[f];
        if (v !== undefined && v !== null && v !== '') lines.push(`      ${f}: ${yamlQuote(v)}`);
      }
    }
    if (ch.peers && Object.keys(ch.peers).length) {
      lines.push('    peers:');
      for (const p of Object.keys(ch.peers).sort()) lines.push(`      ${p}: ${yamlQuote(ch.peers[p])}`);
    }
  }
  const text = lines.join('\n') + '\n';
  writeFileSync(file + '.tmp', text);
  renameSync(file + '.tmp', file);
}

// Transporte configurado do canal, ou null. Nunca inventa default: sync sem transporte precisa
// REPROVAR com mensagem explícita, não cair silenciosamente num `manual` que não existe.
export function getTransport(doc, channel) {
  const ch = doc.channels && doc.channels[channel];
  if (!ch || !ch.transport || !ch.transport.kind) return null;
  return ch.transport;
}

// Valida a forma do bloco de transporte (reimplementação à mão do schema — a convenção do repo é
// que schemas JSON não rodam em runtime). Retorna array de erros (vazio = válido).
export function validateTransport(t) {
  const errors = [];
  if (!t || typeof t !== 'object') return ['transporte não é um objeto'];
  if (!TRANSPORT_KINDS.includes(t.kind)) {
    errors.push(`kind inválido: ${t.kind} (use ${TRANSPORT_KINDS.join('|')})`);
    return errors;
  }
  if ((t.kind === 'fs' || t.kind === 'fs-union' || t.kind === 'manual') && !t.path) errors.push(`transporte ${t.kind} exige path`);
  if (t.kind === 'git' && !t.remote) errors.push('transporte git exige remote');
  if (t.kind === 'gh' && !t.remote) errors.push('transporte gh exige remote (owner/repo)');
  for (const k of Object.keys(t)) if (!TRANSPORT_FIELDS.includes(k)) errors.push(`campo desconhecido em transport: ${k}`);
  return errors;
}
