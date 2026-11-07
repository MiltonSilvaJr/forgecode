#!/usr/bin/env node
// liaison-push-union — computa a UNIÃO do log do próprio remetente no hub com a réplica local,
// para que `_dir_push` publique sem NUNCA derrubar o que só o hub tem.
//
// POR QUE ESTE MÓDULO EXISTE. O `_dir_push` publicava com `cp` + `mv`, isto é, SUBSTITUÍA o log
// do hub pela cópia local sem ler o destino. Enquanto a réplica está em paridade, substituir e
// unir dão o mesmo resultado — e é por isso que o defeito ficou adormecido. Quando a réplica está
// ATRÁS, substituir apaga do hub, em silêncio e com rc 0, exatamente as mensagens que nenhum peer
// pode restaurar: `_dir_pull` não traz de volta o próprio log, por desenho, porque a réplica
// local é declarada fonte da verdade dele. A issue #101 fechou esse buraco RECUSANDO o push da
// réplica atrasada.
//
// POR QUE A UNIÃO SUBSTITUIU A RECUSA. A recusa também evita a perda, mas transforma toda réplica
// atrasada em push que reprova — e réplica atrasada é o estado NORMAL de uma máquina com
// worktrees. O campo mediu a recusa em produção e cobrou o desenho (`axis-go-cloud-0086`), com o
// argumento que decidiu a questão: "sincronizar primeiro" não é operação que o participante
// consiga executar sozinho para o log dele, justamente porque `_dir_pull` não o traz de volta.
// Gate que reprova o estado normal é desligado pela primeira pessoa com pressa. A união publica o
// que a réplica tem de novo sem derrubar o que só o hub tem; seu modo de falha é duplicação,
// nunca perda, e duplicação é detectável e reparável.
//
// A ÚNICA CONDIÇÃO DE RECUSA É BIFURCAÇÃO REAL: mesma (sender, seq) com `content_sha` divergente,
// isto é, duas versões da MESMA posição no log de um remetente. O predicado vem de `detectForks`
// de `liaison-merge.mjs`, que é a definição que o `import` já usa para decidir quarentena —
// reimplementá-la aqui criaria uma segunda noção de "divergência" que divergiria da primeira em
// silêncio, que é precisamente a classe de defeito que esta campanha persegue.
//
// FAIL-CLOSED: em qualquer recusa, nada é escrito na saída e o chamador não toca o hub. Os
// códigos de saída são distintos por causa, porque "recusou" sem dizer por quê obriga o operador
// a adivinhar: 2 uso, 3 JSON ilegível, 4 remetente alheio no log próprio, 5 bifurcação.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { detectForks } from './liaison-merge.mjs';

const [, , localPath, hubPath, outPath, self] = process.argv;
if (!localPath || !hubPath || !outPath || !self) {
  console.error('FAIL liaison-push-union (uso: <log_local> <log_no_hub> <saida_tmp> <self>)');
  process.exit(2);
}

function ler(caminho, rotulo) {
  if (!existsSync(caminho)) return [];
  const linhas = readFileSync(caminho, 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha.trim()) continue;
    let m;
    try {
      m = JSON.parse(linha);
    } catch {
      console.error(`FAIL liaison-push-union: ${rotulo} linha ${i + 1} não é JSON válido — nada foi publicado`);
      process.exit(3);
    }
    // O invariante do store é UM ESCRITOR POR ARQUIVO. Log próprio com mensagem de terceiro é
    // corrupção, e publicá-lo sobrescreveria no hub a versão do dono com uma cópia possivelmente
    // atrasada — o dano que o cabeçalho de `_common.sh` promete não causar.
    if (m.sender !== self) {
      console.error(`FAIL liaison-push-union: ${rotulo} linha ${i + 1} tem sender="${m.sender}", esperado "${self}" — o log próprio não pode conter mensagem de terceiro; nada foi publicado`);
      process.exit(4);
    }
    out.push({ msg: m, linha });
  }
  return out;
}

const doHub = ler(hubPath, 'log do hub');
const doLocal = ler(localPath, 'log local');

const forks = detectForks([...doHub, ...doLocal].map((e) => e.msg));
if (forks.length) {
  const f = forks[0];
  console.error(`FAIL liaison-push-union: ${forks.length} bifurcação(ões) entre o log do hub e o local — a primeira em sender=${f.sender} seq=${f.seq}, com content_sha ${f.content_shas.join(' vs ')}. Nada foi publicado (fail-closed).`);
  console.error('  RECUPERAÇÃO: a réplica local NÃO é autoritativa nesta situação, o hub é. Guarde a sua cópia');
  console.error(`  ('cp ${localPath} ${localPath}.divergente'), traga a do hub por cima`);
  console.error(`  ('cp ${hubPath} ${localPath}') e reenvie o que ficou de fora, que estará em .divergente.`);
  console.error('  Nunca resolva editando o hub à mão: ele é compartilhado por todos os participantes.');
  process.exit(5);
}

// Precedência do HUB quando a mesma mensagem chega dos dois lados com o mesmo content_sha: o hub
// é o que os outros participantes já leram, e reescrever a linha (ainda que equivalente) mudaria
// bytes que terceiros já podem ter em cópia.
const porId = new Map();
for (const e of doLocal) porId.set(e.msg.msg_id, e);
for (const e of doHub) porId.set(e.msg.msg_id, e);

const ordenado = [...porId.values()].sort((a, b) => {
  const s = (Number(a.msg.seq) || 0) - (Number(b.msg.seq) || 0);
  return s !== 0 ? s : String(a.msg.msg_id).localeCompare(String(b.msg.msg_id));
});

writeFileSync(outPath, ordenado.map((e) => e.linha).join('\n') + (ordenado.length ? '\n' : ''), 'utf8');
console.error(`OK liaison-push-union: hub=${doHub.length} local=${doLocal.length} união=${ordenado.length}`);
