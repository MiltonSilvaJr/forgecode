#!/usr/bin/env bash
# check-liaison-acks.sh — cobra os acks que ESTE repositório deve, e só eles.
#
# Um `contract-change` que chega com `requires_ack` é um fato sobre contrato que alguém precisa
# reconhecer. Sem cobrança, a mensagem vira exatamente o handoff manual que o liaison existe para
# substituir: chega, ninguém lê, e o contrato deriva. Com cobrança, o drift trava o push.
#
# TRÊS REGRAS QUE DEFINEM O ESCOPO DA COBRANÇA, e o porquê de cada uma:
#
#   1. Cada participante responde pelo PRÓPRIO ack, nunca pelo dos outros. Com N repositórios,
#      exigir o ack de todos faria o participante mais lento travar o trabalho de todo mundo — e o
#      ack de terceiro não é informação que este repositório possa produzir, então seria uma trava
#      que o bloqueado não tem como abrir.
#   2. Só cobra quem PARTICIPA da thread. A lista de participantes roteia; um contract-change numa
#      thread da qual não faço parte é contexto, não obrigação.
#   3. Nunca cobra o que este repositório mesmo enviou. Ackar a própria mensagem não informa nada
#      a ninguém.
#
# Modo `warn` (default) avisa e devolve 0; `block` devolve 1 citando os msg_id pendentes. A leitura
# do modo vem do forge.yaml — e um `enforce` ausente é tratado como `warn`, porque a ausência de
# configuração não pode ser mais severa que a configuração explícita mais branda.
#
# ── canal de leitura (issue #84) ─────────────────────────────────────────────────────────────────
# O universo de "requer ack" NÃO vem mais da réplica local: vem do TRANSPORTE declarado no
# liaison.yaml, canal por canal — a réplica só contém o que o último `sync` trouxe, e um repositório
# que nunca sincroniza tem, por construção, zero acks pendentes segundo a réplica, mesmo com o hub
# acumulando cobranças. Medido em campo: dois repositórios do ecossistema Axis fecharam a rodada
# com "acks a zero" enquanto o hub tinha 15 e 19 mensagens deles pendentes.
#
# O que continua vindo da réplica local é só o que ESTE repositório mesmo escreveu — o log
# `log/<self>.jsonl` é a única escrita que este processo pode fazer, e ela é sempre mais fresca que
# qualquer cópia já publicada no hub (ler a cópia do hub para o próprio log reintroduziria a mesma
# janela de staleness: um ack recém-emitido e ainda não sincronizado contado como pendente).
#
# Hub inacessível REPROVA, nunca aprova — ausência de prova não vira permissão (a réplica vazia
# de um repositório que nunca sincronizou é exatamente esse caso, e é ele que mais importa pegar).
#
# Escopo desta leitura direta: transportes `fs` e `manual`, ambos diretório local sem rede — é o
# escopo medido na issue #84. `git`/`gh` continuam pela réplica local (fallback de antes, não uma
# regressão: buscar a branch remota a cada push é uma decisão de custo/rede separada, registrada no
# ledger para quem quiser estendê-la depois). Canal sem transporte configurado também cai no
# fallback — não há hub nenhum a consultar nesse caso.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Mesmo ROOT de liaison-ops.sh: o canal do liaison é estado durável de PROJETO e mora no tronco
# (rule conventions/machinery-propagation.md). Um leitor que resolvesse pelo `--show-toplevel`
# ficaria cego justamente para quem trabalha numa branch — leria a cópia congelada do worktree e
# devolveria "nenhum ack pendente" para uma dívida que existe.
# Resolução do checkout principal e o aviso de divergência vivem em lib/forge-root.sh — UM sítio,
# consumido pelos quatro scripts que antes carregavam este corpo copiado (LDG-0068). Delegação em
# alvo ausente é erro: sem a lib, o script não segue resolvendo ROOT por conta própria.
if [ -f "$SCRIPT_DIR/lib/forge-root.sh" ]; then
  # shellcheck source=lib/forge-root.sh
  . "$SCRIPT_DIR/lib/forge-root.sh"
else
  echo "FAIL: $SCRIPT_DIR/lib/forge-root.sh ausente — é a resolução única do checkout principal; sem ela o script gravaria estado durável num lugar que ninguém declarou." >&2
  exit 1
fi
ROOT="$(forge_resolve_root)"
LIBDIR="$SCRIPT_DIR/lib"
LIAISON_DIR="$ROOT/.forge/liaison"
CONFIG="$LIAISON_DIR/liaison.yaml"
FORGE_YAML="$ROOT/.forge/forge.yaml"

# Sem canal, nada a cobrar — e nada a reprovar: um repositório que não usa liaison não pode ser
# penalizado por um subsistema que não adotou.
[ -d "$LIAISON_DIR" ] || { echo "OK liaison-acks — sem canal"; exit 0; }
[ -f "$CONFIG" ] || { echo "OK liaison-acks — sem canal"; exit 0; }

# enforce: warn|block (awk portável, mesmo idioma do _yaml_auto do hook de sessão)
mode="warn"
if [ -f "$FORGE_YAML" ]; then
  found="$(awk '
    $0 ~ /^liaison:/ { inblk=1; next }
    inblk && /^[a-z_]+:/ { exit }
    inblk && /^[ ]+enforce:[ ]*(warn|block)/ { sub(/^[ ]+enforce:[ ]*/, ""); print; exit }
  ' "$FORGE_YAML")"
  [ -n "$found" ] && mode="$found"
fi

# ── procedência (issue #51) ──────────────────────────────────────────────────────────────────────
# `trust` era o único campo do envelope que nenhum instrumento verificava. content_sha o exclui por
# desenho (varia legitimamente entre cópias da mesma mensagem), então verificação por hash é
# estruturalmente cega a ele — e uma restauração de log truncado que copiou a réplica de um peer
# sobre o log próprio fez 172 mensagens PRÓPRIAS se declararem `untrusted-peer` sem que nada
# reprovasse. A invariante é derivável de fato observável, não declarada: em `log/<self>.jsonl` toda
# mensagem é `self` (salvo as de autoria externa, que carregam `authored_by`), e em `log/<outro>.jsonl`
# nenhuma é. Ver lib/liaison-trust.mjs.
#
# Reprova SEMPRE, independente de `enforce: warn|block`: aquele modo gradua uma dívida social (o ack
# que este repositório deve a alguém), e esta é outra classe — o log em disco está afirmando uma
# procedência que os próprios arquivos desmentem, e publicar isso propaga a inversão para os peers.
trust_report="$(node - "$LIBDIR" "$LIAISON_DIR" "$CONFIG" <<'NODEEOF'
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, liaisonDir, cfg] = process.argv;
  const T = await import(pathToFileURL(join(lib, 'liaison-trust.mjs')).href);
  const C = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const self = (C.readConfig(cfg).self || {}).id;
  // Sem self não há de onde derivar procedência. Quantas mensagens ficaram sem verificação é o que
  // decide o veredito do chamador: sair calado aqui empataria "não verifiquei" com "está coerente".
  if (!self) { process.stdout.write(`SKIP ${T.countMessages(liaisonDir)}`); return; }
  const { scanned, violations } = T.verifyAll(liaisonDir, self);
  if (!violations.length) { process.stdout.write(`OK ${scanned}`); return; }
  process.stdout.write([`BAD ${scanned}`, ...violations.map(T.formatViolation)].join('\n'));
})();
NODEEOF
)" || { echo "FAIL liaison-trust — a verificação de procedência não pôde ser executada" >&2; exit 1; }

TRUST_OK=""
case "$trust_report" in
  BAD*)
    n_bad="$(printf '%s\n' "$trust_report" | tail -n +2 | grep -c . || true)"
    echo "FAIL liaison-trust — $n_bad mensagem(ns) declaram procedência que os próprios arquivos do canal desmentem:" >&2
    printf '%s\n' "$trust_report" | tail -n +2 | sed 's/^/  /' >&2
    echo "  Nenhum content_sha detecta isto: o campo é excluído do hash por desenho, porque varia entre cópias." >&2
    echo "  Causa típica: cópia manual, restauração de backup ou merge que trouxe o log de um peer para cima do próprio." >&2
    echo "  Restaure o arquivo apontado a partir do histórico do repositório — corrigir o campo à mão esconde a cópia errada." >&2
    exit 1
    ;;
  OK*) TRUST_OK="OK liaison-trust — ${trust_report#OK } mensagem(ns) com procedência coerente" ;;
  SKIP*)
    # Store com mensagens e sem `self` não é estado legítimo — `send` e `import` exigem o campo, então
    # ele só chegou ali por edição, restauração ou merge do liaison.yaml. Deixar passar entregaria um
    # push cujo store inteiro ficou sem verificação, e o sinal disso seria a AUSÊNCIA de uma linha.
    n_skip="${trust_report#SKIP }"
    if [ "${n_skip:-0}" -gt 0 ]; then
      echo "FAIL liaison-trust — ${n_skip} mensagem(ns) no store e nenhuma verificada: '$CONFIG' não declara self.id," >&2
      echo "  e a procedência é derivada dele. Restaure o bloco 'self:' do liaison.yaml a partir do histórico." >&2
      exit 1
    fi
    TRUST_OK="OK liaison-trust — store vazio, nada a verificar"
    ;;
  *)
    # Nem OK, nem BAD, nem SKIP: a verificação devolveu algo que este script não sabe ler. Aceitar em
    # silêncio seria o mesmo defeito, uma camada acima.
    echo "FAIL liaison-trust — a verificação devolveu resposta que não sei ler: '$trust_report'" >&2
    exit 1
    ;;
esac

pending="$(node - "$LIBDIR" "$LIAISON_DIR" "$CONFIG" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , lib, liaisonDir, cfg] = process.argv;
  const M = await import(pathToFileURL(join(lib, 'liaison-merge.mjs')).href);
  const C = await import(pathToFileURL(join(lib, 'liaison-config.mjs')).href);
  const doc = C.readConfig(cfg);
  const self = (doc.self || {}).id;
  if (!self) return;

  const out = [];
  const hubFail = [];
  // Contador de controle da issue 49, instância 1: quantas threads DESTE repositório a cobrança
  // examinou. Sem ele, "não participo de thread nenhuma" e "participo de nove e nenhuma me deve
  // ack" terminam na mesma linha, e cobertura fica indistinguível de ausência de cobertura.
  // ATENÇÃO ao editar: este bloco vive dentro de $( ) do shell, e ali o bash trata um sustenido
  // como início de comentário — ele engole o resto da linha, inclusive um parêntese de
  // fechamento ou uma crase, e o script morre com "bad substitution". Sem sustenido aqui.
  let scanned = 0;

  // Canais DECLARADOS no liaison.yaml — issue #84 —, não os que a réplica local já materializou:
  // um canal que o hub já conhece mas este repositório nunca sincronizou não pode se esconder
  // atrás de "não tenho pasta local para esse canal".
  const channels = Object.keys(doc.channels || {}).sort();

  for (const channel of channels) {
    const localLogDir = join(liaisonDir, channel, 'log');
    const transport = C.getTransport(doc, channel);

    // Hub diretamente legível (sem rede): fs e fs-union multi-canal em <path>/<canal>/log, manual já
    // apontando para o canal em <path>/log. git/gh e canal sem transporte caem no fallback da
    // réplica local logo abaixo — ver nota de escopo no topo do arquivo.
    let hubLogDir = null;
    if (transport && (transport.kind === 'fs' || transport.kind === 'fs-union' || transport.kind === 'manual')) {
      if (!transport.path) {
        hubFail.push(`${channel}: transporte ${transport.kind} sem 'path' no liaison.yaml`);
        continue;
      }
      hubLogDir = (transport.kind === 'fs' || transport.kind === 'fs-union') ? join(transport.path, channel, 'log') : join(transport.path, 'log');
      if (!existsSync(hubLogDir)) {
        hubFail.push(`${channel}: hub inacessível em '${hubLogDir}' (transporte ${transport.kind}) — probe: liaison-ops.sh transport probe ${channel}`);
        continue;
      }
    }
    const sourceLogDir = hubLogDir || localLogDir;

    const all = [];
    const senderFiles = existsSync(sourceLogDir) ? readdirSync(sourceLogDir).filter((n) => n.endsWith('.jsonl')) : [];
    for (const f of senderFiles) {
      if (f === `${self}.jsonl`) continue;   // o próprio arquivo vem sempre da réplica local, abaixo
      for (const line of readFileSync(join(sourceLogDir, f), 'utf8').split('\n')) {
        const ln = line.trim();
        if (ln) { try { all.push(JSON.parse(ln)); } catch { /* linha corrompida: o doctor sinaliza */ } }
      }
    }
    // O PRÓPRIO log é a única escrita que este processo pode fazer, e é sempre mais fresco do que
    // qualquer cópia já publicada no hub — ler a cópia do hub aqui reabriria a mesma janela que a
    // issue #84 mede: um ack recém-emitido, ainda não sincronizado, contado como pendente.
    const ownFile = join(localLogDir, `${self}.jsonl`);
    if (existsSync(ownFile)) {
      for (const line of readFileSync(ownFile, 'utf8').split('\n')) {
        const ln = line.trim();
        if (ln) { try { all.push(JSON.parse(ln)); } catch { /* linha corrompida: o doctor sinaliza */ } }
      }
    }

    const { threads } = M.mergeLogs(all);

    for (const [threadId, th] of Object.entries(threads)) {
      // regra 2: só cobra thread da qual este repositório participa
      if (!th.participants.includes(self)) continue;
      scanned += 1;
      // acks que ESTE repositório emitiu, por mensagem alvo (regra 1)
      const ackedByMe = new Set(
        th.messages.filter((m) => m.kind === 'ack' && m.sender === self && m.in_reply_to).map((m) => m.in_reply_to),
      );
      for (const m of th.messages) {
        if (!m.requires_ack) continue;            // nada a cobrar
        if (m.sender === self) continue;          // regra 3: nunca a própria mensagem
        if (ackedByMe.has(m.msg_id)) continue;    // já reconhecido por mim
        out.push(`${channel}/${threadId}: ${m.msg_id} [${m.kind}] de ${m.sender} — ${m.subject || '(sem assunto)'}`);
      }
    }
  }

  // Hub inacessível REPROVA, nunca aprova: sai por um marcador PRÓPRIO, nunca misturado com SCOPE,
  // para o bash reprovar incondicionalmente (independente de enforce: warn|block).
  if (hubFail.length) {
    process.stdout.write(['HUBFAIL'].concat(hubFail).join('\n'));
    return;
  }
  // Primeira linha SEMPRE, mesmo sem pendência: é ela que separa "examinei N threads e nenhuma me
  // deve ack" de "não examinei thread nenhuma".
  // Marcador sem sustenido e sem template literal, pelo mesmo motivo descrito acima.
  process.stdout.write(['SCOPE ' + scanned].concat(out).join('\n'));
})();
NODEEOF
)"

# Hub inacessível (issue #84) REPROVA incondicionalmente — independente de enforce: warn|block,
# mesmo raciocínio do trust-check acima: ausência de prova não vira aprovação, e um repositório que
# nunca sincronizou é exatamente o caso que mais precisa reprovar, não o que mais precisa passar.
case "$pending" in
  HUBFAIL*)
    echo "FAIL liaison-acks — hub inacessível para pelo menos um canal; a réplica local não é fonte confiável de acks pendentes:" >&2
    printf '%s\n' "$pending" | tail -n +2 | sed 's/^/  /' >&2
    [ -z "$TRUST_OK" ] || echo "$TRUST_OK" >&2
    exit 1
    ;;
esac

# Separa o contador de controle (primeira linha) da lista de pendências. `self` ausente faz o node
# devolver saída vazia — e aí não há escopo a declarar, porque não há de onde saber o que é "meu".
# `head`/`tail` e não `${var%%$'\n'*}`: o bash 3.2 do macOS não expande `$'...'` dentro de
# expansão de parâmetro, e o script inteiro morre com "bad substitution" (rule shell-portability).
scanned_threads=""
case "$pending" in
  'SCOPE '*)
    scanned_threads="$(printf '%s\n' "$pending" | head -1)"
    scanned_threads="${scanned_threads#SCOPE }"
    pending="$(printf '%s\n' "$pending" | tail -n +2)"
    ;;
esac

if [ -z "$pending" ]; then
  if [ -n "$scanned_threads" ]; then
    echo "OK liaison-acks — $scanned_threads thread(s) deste repositório examinada(s), nenhum ack pendente"
  else
    echo "OK liaison-acks — nenhum ack pendente deste repositório"
  fi
  [ -z "$TRUST_OK" ] || echo "$TRUST_OK"
  exit 0
fi

n="$(printf '%s\n' "$pending" | grep -c . || true)"
if [ "$mode" = "block" ]; then
  echo "FAIL liaison-acks — $scanned_threads thread(s) examinada(s), $n mensagem(ns) exigem ack deste repositório (enforce: block):" >&2
  printf '%s\n' "$pending" | sed 's/^/  /' >&2
  echo "  Reconheça com: liaison-ops.sh ack <canal> <msg_id>" >&2
  echo "  Se a decisão é NÃO adotar, use --reason wont-adopt: acka e registra a dívida no ledger," >&2
  echo "  porque recusa registrada é informação e recusa silenciosa é o drift que o canal combate." >&2
  [ -z "$TRUST_OK" ] || echo "$TRUST_OK"
  exit 1
fi

echo "WARN liaison-acks — $scanned_threads thread(s) examinada(s), $n mensagem(ns) exigem ack deste repositório (enforce: warn, não bloqueia):"
printf '%s\n' "$pending" | sed 's/^/  /'
[ -z "$TRUST_OK" ] || echo "$TRUST_OK"
exit 0
