#!/usr/bin/env node
// liaison-hub-io — E/S no HUB do liaison sem seguir link, sem parsing por linha e sem confiar no
// que terceiros escreveram (SEC-001). Zero dependência; roda SEMPRE com o cwd no diretório do hub
// já ancorado pelo chamador (`_dir_anchor` em lib/transports/_common.sh: `cd -P` conferido por
// `pwd -P`), e por isso só toca o hub por nome RELATIVO, preso ao inode conferido.
//
// POR QUE UM MÓDULO, E NÃO MAIS SHELL. O pull enumerava com `find … | while read` e copiava com
// `cp` por caminho. Dois defeitos que nenhuma guarda em shell fecha:
//   - SEC-201/SEC-202: um nome com `\n` vira DUAS linhas para o `read`; a segunda é um nome que
//     nunca passou pelos filtros do `find` (`-type f`, `-links 1`) — o atacante a aponta para um
//     symlink ou hardlink do segredo da vítima, e o `cp` o copia para a réplica;
//   - SEC-105: entre a enumeração e o `cp` há uma janela (medida em ~33% num laço de troca por
//     rename) em que a entrada regular vira symlink, e o `cp` segue o link.
// Aqui a enumeração é `readdirSync` (nomes como array, nenhum parsing por linha), o nome passa por
// regex estrita, e a leitura é `open(O_RDONLY|O_NOFOLLOW|O_NONBLOCK)` seguida de `fstat` NO
// DESCRITOR: o que se confere (arquivo regular, um vínculo, tamanho) é exatamente o que se lê,
// porque a cópia sai do mesmo fd. O_NONBLOCK impede que um FIFO plantado trave o sync.
//
// A PUBLICAÇÃO também é daqui (SEC-203, PLAT-202, PLAT-203, LOG-203, ARCH-205). O shell criava o
// temporário com `set -C` e nome `$$.$RANDOM$RANDOM`: o noclobber do bash NÃO é O_EXCL — só recusa
// nome existente que seja arquivo regular, e um symlink para FIFO ou dispositivo é aberto e escrito
// —, e o `$RANDOM` do bash 3.2 é quase linear, então o nome era adivinhável. Aqui o temporário tem
// nome de `crypto.randomBytes(16)` e é criado com `openSync(tmp, 'wx', 0o644)` = O_CREAT|O_EXCL,
// que recusa QUALQUER nome existente, link incluído, sem segui-lo. A GARANTIA é a exclusividade; a
// imprevisibilidade é só a primeira camada (o w321 [M2] fixa o nome e prova que a recusa continua).
// O modo sai 0644 por `fchmod` no descritor (nunca `chmod` por caminho, que segue link), qualquer
// que seja o umask de quem sincroniza; `fsync` antes do `rename(2)` relativo ao cwd ancorado, que
// substitui um link plantado no nome final sem segui-lo e recusa diretório no destino. Em LOTE: uma
// invocação de node publica um diretório inteiro de blobs (o custo por processo era ~80 ms por blob).
//
// ÓRFÃO DE SIGKILL, declarado: um processo morto entre o `open` exclusivo e o `rename` deixa um
// `.liaison-publica.<hex>.tmp` no hub. Ele NÃO é limpável com segurança por ninguém: no hub, o
// nome é indistinguível do temporário em voo de outro participante, e apagá-lo derrubaria a
// publicação dele. O efeito é só espaço — todo leitor (pull e push de blobs) o ignora por nome. No
// caminho de erro que o próprio processo observa (cópia, fsync ou rename falhando) o temporário é
// removido antes de sair.
//
// Subcomandos (rc 0 sucesso; rc 1 recusa/erro; rc 2 uso):
//   read <nome> <destino_abs> <rótulo>
//       lê o log próprio do hub uma vez, pelo leitor seguro, para o diretório privado do push.
//   pull <log|blobs> <destino_abs> <self> <rótulo>
//       copia as entradas aceitas do cwd para <destino_abs> (staging privado). Entrada recusada
//       vira aviso no stderr e o pull segue — mesmo comportamento que o `-links 1` já tinha.
//   publish <origem_abs> <nome> <rótulo>
//       publica <origem_abs> como <nome> no cwd, SUBSTITUINDO o que houver (log próprio, reparo).
//   publish-dir <origem_dir_abs> <log|blobs> <mantem|substitui> <rótulo>
//       publica as entradas de <origem_dir_abs> no cwd numa única invocação. `mantem` (blobs do
//       push) pula nome que já existe como arquivo regular e RECUSA nome que é link; `substitui`
//       (export) republica tudo.
import {
  openSync, closeSync, fstatSync, readSync, writeSync, fchmodSync, fsyncSync, readdirSync, unlinkSync,
  renameSync, lstatSync, constants,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BLOB_MAX_BYTES, BODY_REF_RE, ID_RE } from './liaison-merge.mjs';

// Teto do log de um remetente no hub. Não há teto equivalente no import (o log cresce para sempre),
// então este é só o freio contra um arquivo hostil gigante: ~centenas de milhares de mensagens.
const LOG_MAX_BYTES = 256 * 1024 * 1024;

// Temporários que NUNCA são conteúdo: o da recuperação de blob (liaison-import.mjs) e o desta
// publicação. Ignorados em silêncio na enumeração — são estado transitório de alguém, não dado.
const TEMP_RE = /^\.(recover-.*|liaison-publica\..*)\.tmp$/;

const RO_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

// Nome para mensagem: JSON escapa `\n` e controle, para que o aviso não injete linhas no terminal.
const q = (s) => JSON.stringify(s);

class Recusa extends Error {}

// abreSeguro <nome> <limite> — abre <nome> (relativo ao cwd) sem seguir link e confere NO fd que é
// arquivo regular, com um único vínculo e dentro do teto. Devolve { fd, size } ou lança Recusa com
// a causa por extenso. ENOENT propaga como erro com `code`, para o chamador decidir.
function abreSeguro(nome, limite) {
  let fd;
  try {
    fd = openSync(nome, RO_FLAGS);
  } catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new Recusa('é link simbólico no hub (SEC-001)');
    throw e;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Recusa('não é arquivo regular (FIFO, diretório ou dispositivo) — SEC-001');
    if (st.nlink !== 1) throw new Recusa('tem mais de um vínculo (hardlink) no hub e pode ser um arquivo de fora da árvore do canal (SEC-001)');
    if (st.size > limite) throw new Recusa(`excede o teto de ${limite} bytes (${st.size})`);
    return { fd, size: st.size };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}

// copiaDoFd <fd> <destFd> <limite> — copia do descritor já conferido, nunca do caminho. O teto é
// reconferido durante a cópia: o arquivo pode crescer depois do fstat.
function copiaDoFd(fd, destFd, limite) {
  const buf = Buffer.allocUnsafe(65536);
  let total = 0;
  for (;;) {
    const n = readSync(fd, buf, 0, buf.length, null);
    if (n === 0) break;
    total += n;
    if (total > limite) throw new Recusa(`cresceu além do teto de ${limite} bytes durante a leitura`);
    let off = 0;
    while (off < n) off += writeSync(destFd, buf, off, n - off);
  }
  return total;
}

function nomeAceito(tipo, nome, self) {
  if (tipo === 'log') {
    if (!nome.endsWith('.jsonl')) return 'ignora';          // `.keep` e afins: nunca foram lidos
    const sender = nome.slice(0, -'.jsonl'.length);
    if (!ID_RE.test(sender)) return 'recusa';
    if (sender === self) return 'ignora';                    // o próprio log nunca volta do hub
    return 'aceita';
  }
  return BODY_REF_RE.test(`blobs/${nome}`) ? 'aceita' : 'recusa';
}

function pull(tipo, destino, self, rotulo) {
  if (tipo !== 'log' && tipo !== 'blobs') { console.error(`FAIL liaison-hub-io pull: tipo inválido ${q(tipo)}`); return 2; }
  const limite = tipo === 'log' ? LOG_MAX_BYTES : BLOB_MAX_BYTES;
  const avisa = (nome, causa) => console.error(`WARN: ${q(`${rotulo}/${nome}`)} ignorado no pull — ${causa}. Investigue quem o publicou.`);
  const nomes = readdirSync('.').sort();
  for (const nome of nomes) {
    if (TEMP_RE.test(nome)) continue;
    const decisao = nomeAceito(tipo, nome, self);
    if (decisao === 'ignora') continue;
    if (decisao === 'recusa') { avisa(nome, 'nome fora do padrão aceito pelo liaison (SEC-001)'); continue; }
    let origem;
    try {
      origem = abreSeguro(nome, limite);
    } catch (e) {
      avisa(nome, e instanceof Recusa ? e.message : `erro de leitura (${e.code || e.message})`);
      continue;
    }
    const alvo = join(destino, nome);
    let destFd = null;
    try {
      // 'wx' = O_CREAT|O_EXCL: o staging é privado e recém-criado, então um nome já existente é
      // anomalia — recusa em vez de sobrescrever (e nunca segue link).
      destFd = openSync(alvo, 'wx', 0o644);
      copiaDoFd(origem.fd, destFd, limite);
      fchmodSync(destFd, 0o644);
    } catch (e) {
      if (destFd !== null) { try { closeSync(destFd); } catch { /* já fechado */ } destFd = null; try { unlinkSync(alvo); } catch { /* melhor esforço */ } }
      avisa(nome, e instanceof Recusa ? e.message : `não foi possível copiar (${e.code || e.message})`);
    } finally {
      if (destFd !== null) closeSync(destFd);
      closeSync(origem.fd);
    }
  }
  return 0;
}

// Nome publicável: um único componente, no alfabeto de `body_ref` (que contém o de id + `.jsonl`).
const NOME_PUBLICAVEL_RE = /^[A-Za-z0-9._-]+$/;

class Falha extends Error {}

// publicaUm <origem_abs> <nome> <rótulo> — publica no cwd por temporário exclusivo + rename.
// A origem é da réplica local ou do diretório privado de trabalho, nunca do hub; mesmo assim é
// aberta sem seguir link e tem de ser arquivo regular.
function publicaUm(origem, nome, rotulo) {
  const alvo = `${rotulo}/${nome}`;
  if (!NOME_PUBLICAVEL_RE.test(nome) || nome === '.' || nome === '..') throw new Falha(`nome de publicação inválido ${q(alvo)}`);
  let srcFd;
  try {
    srcFd = openSync(origem, RO_FLAGS);
  } catch (e) {
    throw new Falha(`não foi possível ler a origem ${q(origem)} (${e.code || e.message})`);
  }
  let tmp = null;
  let fd = null;
  try {
    if (!fstatSync(srcFd).isFile()) throw new Falha(`a origem ${q(origem)} não é arquivo regular`);
    const candidato = `.liaison-publica.${randomBytes(16).toString('hex')}.tmp`;
    try {
      fd = openSync(candidato, 'wx', 0o644);
    } catch (e) {
      if (e.code === 'EEXIST') throw new Falha(`o temporário de publicação ${q(`${rotulo}/${candidato}`)} já existe (link ou arquivo plantado?) — recusado sem escrever nada (SEC-001)`);
      throw new Falha(`não foi possível criar o temporário de publicação em ${q(rotulo)} (${e.code || e.message})`);
    }
    tmp = candidato;
    copiaDoFd(srcFd, fd, Number.MAX_SAFE_INTEGER);
    fchmodSync(fd, 0o644);
    fsyncSync(fd);
    closeSync(fd); fd = null;
    try {
      renameSync(tmp, nome);
    } catch (e) {
      throw new Falha(`não foi possível instalar ${q(alvo)} (${e.code || e.message}; nome final ocupado por diretório?) — nada publicado (SEC-001)`);
    }
    tmp = null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* já fechado */ } }
    if (tmp !== null) { try { unlinkSync(tmp); } catch { /* melhor esforço: o erro original é o que importa */ } }
    closeSync(srcFd);
  }
}

function publishDir(origemDir, tipo, modo, rotulo) {
  if (tipo !== 'log' && tipo !== 'blobs') { console.error(`FAIL liaison-hub-io publish-dir: tipo inválido ${q(tipo)}`); return 2; }
  if (modo !== 'mantem' && modo !== 'substitui') { console.error(`FAIL liaison-hub-io publish-dir: modo inválido ${q(modo)}`); return 2; }
  const nomes = readdirSync(origemDir).sort();
  for (const nome of nomes) {
    if (TEMP_RE.test(nome)) continue;
    if (tipo === 'log' ? !(nome.endsWith('.jsonl') && ID_RE.test(nome.slice(0, -'.jsonl'.length))) : !BODY_REF_RE.test(`blobs/${nome}`)) continue;
    if (modo === 'mantem') {
      let st = null;
      try { st = lstatSync(nome); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (st && st.isSymbolicLink()) {
        console.error(`FAIL: ${q(`${rotulo}/${nome}`)} é um link simbólico — recusado (SEC-001). Um arquivo dentro do hub nunca pode`);
        console.error('      ser symlink: segui-lo escreveria fora da árvore do canal. O canal pode estar comprometido —');
        console.error('      não sincronize até investigar quem publicou isto.');
        return 1;
      }
      if (st && st.isFile()) continue;                     // blob é imutável: o hub já tem
      if (st) throw new Falha(`${q(`${rotulo}/${nome}`)} existe e não é arquivo regular — recusado (SEC-001)`);
    }
    publicaUm(join(origemDir, nome), nome, rotulo);
  }
  return 0;
}

// read <nome> <destino_abs> <rótulo> — lê UMA entrada do cwd (o log próprio no hub) pelo mesmo
// leitor seguro do pull, para o diretório privado do push (NODE-201, SEC-204). Ausente = rc 0 sem
// destino (o hub ainda não tem o log); link, FIFO, hardlink ou acima do teto = RECUSA, nunca aviso:
// é o arquivo que o push vai unir e republicar.
function read(nome, destino, rotulo) {
  let origem;
  try {
    origem = abreSeguro(nome, LOG_MAX_BYTES);
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    const causa = e instanceof Recusa ? e.message : `erro de leitura (${e.code || e.message})`;
    console.error(`FAIL: push RECUSADO — ${q(`${rotulo}/${nome}`)} ${causa}. O log próprio no hub só é lido`);
    console.error('      como arquivo regular de um vínculo; nada foi unido nem publicado (SEC-001). Investigue quem o');
    console.error('      publicou antes de sincronizar de novo.');
    return 1;
  }
  let destFd = null;
  try {
    destFd = openSync(destino, 'wx', 0o600);
    copiaDoFd(origem.fd, destFd, LOG_MAX_BYTES);
  } catch (e) {
    if (destFd !== null) { try { closeSync(destFd); } catch { /* já fechado */ } destFd = null; try { unlinkSync(destino); } catch { /* melhor esforço */ } }
    console.error(`FAIL: push RECUSADO — não foi possível ler ${q(`${rotulo}/${nome}`)} (${e instanceof Recusa ? e.message : e.code || e.message}).`);
    return 1;
  } finally {
    if (destFd !== null) closeSync(destFd);
    closeSync(origem.fd);
  }
  return 0;
}

function main(argv) {
  const [sub, ...args] = argv;
  switch (sub) {
    case 'read': {
      if (args.length !== 3) { console.error('FAIL liaison-hub-io (uso: read <nome> <destino_abs> <rótulo>)'); return 2; }
      return read(...args);
    }
    case 'pull': {
      if (args.length !== 4) { console.error('FAIL liaison-hub-io (uso: pull <log|blobs> <destino_abs> <self> <rótulo>)'); return 2; }
      return pull(...args);
    }
    case 'publish': {
      if (args.length !== 3) { console.error('FAIL liaison-hub-io (uso: publish <origem_abs> <nome> <rótulo>)'); return 2; }
      publicaUm(...args);
      return 0;
    }
    case 'publish-dir': {
      if (args.length !== 4) { console.error('FAIL liaison-hub-io (uso: publish-dir <origem_dir_abs> <log|blobs> <mantem|substitui> <rótulo>)'); return 2; }
      return publishDir(...args);
    }
    default:
      console.error(`FAIL liaison-hub-io: subcomando desconhecido ${q(sub || '')}`);
      return 2;
  }
}

// Erro inesperado sai como uma linha curta com o código, nunca como stack trace: a saída do sync é
// lida por gente e por agentes, e um stack não diz o que fazer.
try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  console.error(e instanceof Falha ? `FAIL: ${e.message}` : `FAIL liaison-hub-io: ${e.code || e.message}`);
  process.exitCode = 1;
}
