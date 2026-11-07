// lib/liaison-cursor.mjs — avanço do cursor de leitura de uma thread do liaison (issue #102).
//
// `ack)` lia `cursors[id]` para EXIBIR e não escrevia cursor nenhum: o ato mais forte de leitura
// que o protocolo tem — reconhecer formalmente uma mensagem — não marcava a thread como lida.
// Medido no template: havia UMA escrita de cursor em todo o `liaison-ops.sh`, dentro de `read)`,
// e assim é nos nove commits do histórico do arquivo. Ou seja, `read --upto` era o ÚNICO caminho
// pelo qual um cursor avançava, e toda mensagem ackada permanecia não lida a menos que alguém
// rodasse um segundo comando. A distinção entre "participação" e "leitura de terceiro" que a
// issue descreve como preservada é de um fork divergente; upstream ela nunca existiu, o que
// torna o defeito PIOR aqui, não mais brando.
//
// Este arquivo existe para que a regra de não-regressão tenha UM dono. Duplicá-la seria criar a
// segunda implementação de "avançar cursor sem regredir" dentro do mesmo arquivo em que se está
// corrigindo um defeito de leitura — a classe de LDG-0014, no change que existe para fechá-la.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { withStateLock } from './liaison-lock.mjs';

// advanceCursor({ root, channel, chDir, threads, threadId, upto, nowWall, strict })
//
// strict: true  → regressão é ERRO (o contrato de `read --upto`, onde o operador PEDIU um alvo
//                 e precisa saber que o pedido é inválido).
// strict: false → regressão é NO-OP silencioso (o contrato de `ack`, onde ackar algo já lido é
//                 legítimo e falhar seria transformar um ato de protocolo em erro de uso).
//
// `root`/`channel` (design §2.4): leitura+escrita de `state.json` sob `withStateLock`
// (`<channel>@state.lock`), para que dois escritores concorrentes de cursor (dois `ack`, ou um
// `ack` e um `read --upto`) nunca percam a atualização um do outro nem truncam o arquivo.
//
// Devolve { threadId, from, to, moved } — `to` é o msg_id do cursor DEPOIS da operação, sempre,
// inclusive quando não houve movimento. Quem chama precisa poder AFIRMAR onde o cursor ficou, não
// só que "não regrediu": um cursor que nunca se move satisfaz "não regrediu" e não prova nada.
export async function advanceCursor({ root, channel, chDir, threads, threadId, upto, nowWall, strict = false }) {
  const order = (threads[threadId] && threads[threadId].order) || [];
  const idx = order.indexOf(upto);
  if (idx < 0) {
    const err = new Error(`mensagem '${upto}' não pertence à thread '${threadId}'`);
    err.code = 'NOT_IN_THREAD';
    throw err;
  }
  return withStateLock({ root, channel }, () => {
    const stateFile = join(chDir, 'state.json');
    const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { cursors: {} };
    if (!state.cursors) state.cursors = {};
    const prev = state.cursors[threadId];
    const from = prev && prev.msg_id ? prev.msg_id : null;
    if (from && order.includes(from)) {
      const prevIdx = order.indexOf(from);
      if (idx < prevIdx) {
        if (strict) {
          const err = new Error(`cursor não pode regredir (atual: ${from}, pedido: ${upto})`);
          err.code = 'REGRESSION';
          throw err;
        }
        return { threadId, from, to: from, moved: false };
      }
      if (idx === prevIdx) return { threadId, from, to: from, moved: false };
    }
    state.cursors[threadId] = { msg_id: upto, read_at: nowWall };
    const tmp = `${stateFile}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, stateFile);
    return { threadId, from, to: upto, moved: true };
  });
}
