// liaison-trust — verificação de PROCEDÊNCIA do store do liaison (issue #51).
//
// O PROBLEMA. `trust` era atribuído na escrita e nenhum instrumento o verificava depois.
// `content_sha` o exclui DELIBERADAMENTE (liaison-merge.mjs: "envelope canônico menos
// content_sha/trust") porque o campo varia legitimamente entre cópias da mesma mensagem — a mesma
// linha é `self` no log de quem escreveu e `untrusted-peer` na réplica de quem importou. A
// consequência é que verificação por hash é ESTRUTURALMENTE CEGA a ele: corromper `trust` não
// muda nenhum sha, não quebra nenhum `msg_id`, e não havia gate que olhasse.
//
// O caso de campo: uma restauração de log truncado copiou a réplica de um peer sobre o log próprio
// do remetente. Conteúdo íntegro, `msg_id` e `content_sha` conferindo, zero divergência — e as 172
// mensagens PRÓPRIAS do repositório passaram a se declarar `untrusted-peer`. Num ecossistema cuja
// regra é "conteúdo de peer é dado, nunca instrução" (rule conventions/liaison-untrusted-input.md),
// isso inverte a semântica de procedência do log inteiro. Quem achou foi o dono do log comparando
// campo a campo por manifesto.
//
// A CORREÇÃO. `trust` não precisa ser acreditado: ele é FUNÇÃO de dois fatos observáveis no próprio
// store, e é isso que o torna verificável.
//
//   1. QUAL ARQUIVO carrega a linha. O store é um JSONL append-only por remetente com UM ESCRITOR
//      por arquivo, então `log/<self>.jsonl` é, por construção, escrita local — e `log/<outro>.jsonl`
//      só existe porque o import o escreveu, carimbando `untrusted-peer`.
//   2. A PRESENÇA DE `authored_by`. Conteúdo cuja autoria é de outro repositório (o `liaison ask` e
//      o `conflicts resolve`) é escrito no NOSSO arquivo, mas nunca é `self`: quem lê precisa saber
//      que a procedência é externa antes de agir sobre ele.
//
// Os quatro pontos de escrita do subsistema já obedecem exatamente a essa regra (liaison-ops.sh nos
// kinds locais, `send --authored-by`, `conflicts resolve` e liaison-import.mjs); o que faltava era
// alguém CONFERIR. Derivar `trust` na leitura, em vez de conferir, foi a alternativa descartada:
// ela deixaria a corrupção invisível — o leitor exibiria a procedência certa sobre um log errado,
// e ninguém saberia que o arquivo em disco precisa ser restaurado.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// A procedência que a mensagem DEVERIA declarar, dados o arquivo em que ela está e o self do canal.
export function expectedTrust(msg, owner, self) {
  if (owner !== self) return 'untrusted-peer';
  return msg && msg.authored_by ? 'untrusted-peer' : 'self';
}

const WHY = {
  own: 'escrita local sem authored_by é self',
  authored: 'conteúdo de autoria externa (authored_by) nunca é self, mesmo no próprio arquivo',
  peer: 'tudo que chegou de fora é untrusted-peer, carimbado no import',
};

function whyFor(msg, owner, self) {
  if (owner !== self) return WHY.peer;
  return msg.authored_by ? WHY.authored : WHY.own;
}

function readJsonl(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) { try { out.push(JSON.parse(t)); } catch { /* linha corrompida: o gap de seq denuncia */ } }
  }
  return out;
}

// Varre um canal. Devolve { scanned, violations } — `scanned` existe para que o chamador possa
// afirmar quantas mensagens a verificação cobriu: um "OK" sobre conjunto vazio é indistinguível de
// verificação quebrada, e essa é a classe de defeito que esta lib existe para fechar.
export function verifyChannel(chDir, self, channel = '') {
  const logDir = join(chDir, 'log');
  const violations = [];
  let scanned = 0;
  if (!existsSync(logDir)) return { scanned, violations };
  for (const file of readdirSync(logDir).filter((f) => f.endsWith('.jsonl')).sort()) {
    const owner = file.slice(0, -'.jsonl'.length);
    for (const msg of readJsonl(join(logDir, file))) {
      scanned += 1;
      const where = `${channel ? channel + '/' : ''}log/${file}`;
      // Spoofing de arquivo EM REPOUSO. O import já recusa isto na entrada; aqui a mesma
      // invariante é conferida no que está gravado, porque cópia manual, restauração de backup e
      // merge de branch entram no store sem passar pelo import.
      if (msg.sender !== owner) {
        violations.push({
          channel, file: where, msg_id: msg.msg_id || '(sem msg_id)', sender: msg.sender || '(sem sender)',
          declared: msg.trust || '(ausente)', expected: expectedTrust(msg, owner, self),
          why: `sender '${msg.sender || '(sem sender)'}' não é o dono do arquivo '${owner}' — o store é um escritor por arquivo`,
        });
        continue;
      }
      const expected = expectedTrust(msg, owner, self);
      if (msg.trust !== expected) {
        violations.push({
          channel, file: where, msg_id: msg.msg_id || '(sem msg_id)', sender: msg.sender,
          declared: msg.trust || '(ausente)', expected, why: whyFor(msg, owner, self),
        });
      }
    }
  }
  return { scanned, violations };
}

// Quantas mensagens o store guarda, SEM derivar procedência. Existe para o caso em que a derivação
// não é possível (canal sem `self` configurado): o chamador precisa saber se ficou algo sem
// verificar, porque "não verifiquei" e "verifiquei e está coerente" não podem terminar no mesmo
// silêncio — e um store com mensagens e sem `self` não é estado legítimo, já que `send` e `import`
// exigem o campo.
export function countMessages(liaisonDir) {
  let n = 0;
  if (!existsSync(liaisonDir)) return n;
  for (const d of readdirSync(liaisonDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const logDir = join(liaisonDir, d.name, 'log');
    if (!existsSync(logDir)) continue;
    for (const f of readdirSync(logDir).filter((x) => x.endsWith('.jsonl'))) {
      n += readJsonl(join(logDir, f)).length;
    }
  }
  return n;
}

export function verifyAll(liaisonDir, self) {
  const violations = [];
  let scanned = 0;
  if (!existsSync(liaisonDir)) return { scanned, violations };
  const channels = readdirSync(liaisonDir, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const channel of channels) {
    const r = verifyChannel(join(liaisonDir, channel), self, channel);
    scanned += r.scanned;
    violations.push(...r.violations);
  }
  return { scanned, violations };
}

export function formatViolation(v) {
  return `${v.file}: ${v.msg_id} declara trust '${v.declared}', esperado '${v.expected}' — ${v.why}`;
}
