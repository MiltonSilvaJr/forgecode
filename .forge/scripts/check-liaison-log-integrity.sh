#!/usr/bin/env bash
# check-liaison-log-integrity.sh — o GATE do único modo de falha do merge=union (issue #80).
#
# O `.forge/liaison/*/log/*.jsonl` ganhou `merge=union` (installer/gitattributes.patch) porque o
# invariante "um escritor por arquivo" só vale ENTRE repositórios: branch paralela do mesmo
# remetente e réplica que chega por `sync` fazem qualquer PR de longa duração contra um tronco
# ativo colidir no merge automático do git. `--theirs`/`--ours` destroem mensagens PUBLICADAS em
# silêncio (rc=0, sem marcador remanescente); `merge=union` publica a união das duas versões.
#
# O DRIVER SOZINHO É INSUFICIENTE. O modo de falha do union é SEMPRE duplicação — nunca perda —
# quando a ordem relativa de duas mensagens COMUNS aos dois lados se inverte E as reordenações se
# SOBREPÕEM: o union emite as duas variantes da região, e um log de N `msg_id` sai com N+k linhas,
# `rc=0`, sem marcador de conflito. Duplicação silenciosa corrompe contagem, ack e reconciliação
# de todo mundo que sincronizar com o log — este script é o que detecta isso.
#
# Predicado: em cada `.forge/liaison/*/log/*.jsonl`, linhas não vazias == `msg_id` distintos.
#
# CONTROLE POSITIVO PRÓPRIO: se `.forge/liaison/` existe mas nenhum `log/*.jsonl` foi encontrado,
# REPROVA — uma guarda que não acha nada para medir não é uma guarda verde, é uma guarda cega (o
# mesmo idioma de heredoc-hash-lint.mjs e shell-pipeline-lint.mjs neste repositório). Um
# repositório que genuinamente não usa liaison nem chega a esta checagem: o early-exit abaixo, por
# ausência do DIRETÓRIO `.forge/liaison/`, é a única saída legítima sem `log/*.jsonl` nenhum.
#
# Dois pontos de fiação, propositalmente diferentes (issue #80):
#   - post-merge é DETECTOR: dispara no instante em que a duplicata NASCE (merge automático roda
#     post-merge, nunca pre-commit) e precisa rodar em QUALQUER branch — um merge que duplica e
#     nunca é empurrado corrompe o canal do mesmo jeito, e o bloqueio no push jamais o veria.
#   - pre-push é o BLOQUEIO quando roda e acha duplicata; alvo ausente aqui avisa e segue,
#     nunca bloqueia — mesma classe de check-worktree-prereqs.sh (issue #81/#73): hooksPath é
#     compartilhado por todo worktree, .forge/scripts/ não é.
# Nenhum dos dois basta sozinho — ver installer/gitattributes.patch e os dois hooks git/*.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Mesmo ROOT de liaison-ops.sh/check-liaison-acks.sh: o canal é estado durável de PROJETO e mora
# no tronco (rule conventions/machinery-propagation.md), nunca no worktree corrente.
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
LIAISON_DIR="$ROOT/.forge/liaison"
CONFIG="$LIAISON_DIR/liaison.yaml"

# Sem canal CONFIGURADO, nada a medir — e nada a reprovar: um repositório que não adotou o
# liaison não pode ser penalizado por um subsistema que não usa. O template SHIPA
# `.forge/liaison/.gitkeep` em toda instalação (scaffold vazio) — checar só o DIRETÓRIO faria
# este gate reprovar em qualquer consumidor que nunca rodou `liaison-ops.sh open`, que é a maioria
# esmagadora. `liaison.yaml` só existe depois de um `open` real (mesmo checagem que
# check-liaison-acks.sh usa). Esta é a ÚNICA saída legítima sem log nenhum; a partir daqui, canal
# configurado e zero log é a guarda cega que a seção abaixo reprova.
[ -f "$CONFIG" ] || { echo "OK liaison-log-integrity — sem canal"; exit 0; }

report="$(node - "$LIAISON_DIR" <<'NODEEOF'
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join } = require('path');
const [, , base] = process.argv;

const files = [];
if (existsSync(base)) {
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const logDir = join(base, entry.name, 'log');
    if (!existsSync(logDir)) continue;
    for (const f of readdirSync(logDir)) {
      if (f.endsWith('.jsonl')) files.push(join(logDir, f));
    }
  }
}
files.sort();

if (files.length === 0) {
  process.stdout.write('NOLOGS');
  process.exit(0);
}

const bad = [];
let totalLines = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const ids = new Set();
  const dups = new Set();
  for (const line of lines) {
    let id;
    try { id = JSON.parse(line).msg_id; } catch { id = undefined; }
    if (id === undefined) { dups.add('linha ilegivel'); continue; }
    if (ids.has(id)) dups.add(id);
    ids.add(id);
  }
  totalLines += lines.length;
  if (lines.length !== ids.size) {
    bad.push(`${file}: ${lines.length} linha(s), ${ids.size} msg_id distinto(s) -- duplicata(s): ${[...dups].join(', ')}`);
  }
}

if (bad.length) {
  process.stdout.write(['BAD'].concat(bad).join('\n'));
} else {
  process.stdout.write(`OK ${files.length} ${totalLines}`);
}
NODEEOF
)"

case "$report" in
  NOLOGS)
    echo "FAIL liaison-log-integrity — '$LIAISON_DIR' existe mas nenhum log/*.jsonl foi encontrado — guarda que não acha nada para medir não é guarda verde, é guarda cega" >&2
    exit 1
    ;;
  BAD*)
    n_bad="$(printf '%s\n' "$report" | tail -n +2 | grep -c . || true)"
    echo "FAIL liaison-log-integrity — $n_bad arquivo(s) com msg_id duplicado — o único modo de falha do merge=union (issue #80):" >&2
    printf '%s\n' "$report" | tail -n +2 | sed 's/^/  /' >&2
    echo "  Isto é SEMPRE reordenação de mensagens comuns que se sobrepõe entre os dois lados de um merge — nunca perda." >&2
    echo "  Corrija reescrevendo o arquivo com uma linha por msg_id (mantendo a versão correta) e recomite." >&2
    exit 1
    ;;
  OK*)
    read -r _ok n_files n_lines <<<"$report"
    echo "OK liaison-log-integrity — $n_files arquivo(s), $n_lines mensagem(ns), msg_id distintos em todos"
    ;;
  *)
    echo "FAIL liaison-log-integrity — a verificação devolveu resposta que não sei ler: '$report'" >&2
    exit 1
    ;;
esac
