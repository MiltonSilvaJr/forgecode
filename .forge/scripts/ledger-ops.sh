#!/usr/bin/env bash
# ledger-ops.sh — operações deterministas no ledger durável de projeto (.forge/ledger/ledger.json).
# Store NÃO-BLOQUEANTE de trabalho conhecido que sobrevive entre changes (roadmap, dívida técnica,
# bugs conhecidos, follow-ups, ideias). Toda mutação re-renderiza LEDGER.md. Ver schema em
# .forge/schemas/ledger.schema.json e rule ledger-consultation.md.
#
# Uso:
#   ledger-ops.sh add     --type <t> --title "<txt>" [--detail "<txt>"] [--severity S] [--priority P]
#                         [--status ST] [--origin O] [--change <id>] [--ref R] [--adr A] [--capability C]
#                         [--supersedes <LDG-NNNN>]   # a anterior vira superseded, na mesma escrita
#   ledger-ops.sh update  <LDG-NNNN> [--status ST] [--priority P] [--severity S] [--title "<txt>"]
#                         [--detail "<txt>"] [--replace-detail]
#   ledger-ops.sh note    <LDG-NNNN> --kind progress|measurement|correction|decision --text "<txt>"
#   ledger-ops.sh verify  <LDG-NNNN> --kind file|commit|test|command --ref "<r>" --observed "<txt>"
#                         --verdict confirmed|changed   # única porta que grava last_verified
#   ledger-ops.sh resolve <LDG-NNNN> --note "<txt>" [--status resolved|wont-fix]   # default: resolved
#   ledger-ops.sh promote <LDG-NNNN> --to <change-id>
#   ledger-ops.sh assign  <LDG-NNNN> --to <sessão>              # fila de priorização entre sessões
#   ledger-ops.sh pause   <LDG-NNNN> --by <LDG-NNNN-emergencial> --checkpoint "<txt>"
#                         # --by precisa ter priority EMERGENCIAL; não toca status
#   ledger-ops.sh resume  <LDG-NNNN>                             # limpa paused_by/paused_at/checkpoint
#   ledger-ops.sh harvest <change-id> --origin close|archive   # colhe deferrals/findings antes do mv
#   ledger-ops.sh render                                        # regenera LEDGER.md
#   ledger-ops.sh status                                        # one-line (para /forge:status)
#   ledger-ops.sh list    [--status S] [--type T] [--top N] [--by-priority] [--assigned]
#   ledger-ops.sh show    <LDG-NNNN>                    # entrada + evidência + cadeia de supersessão
#   ledger-ops.sh stale   [--days N] [--as-of <ISO>] [--strict]   # ativos sem reverificação há > N dias
#
# Determinístico: created_at = data do commit HEAD (não wall clock); harvest é idempotente (dedup_key)
# e best-effort (NUNCA falha o caller). Ver deferral-ops.sh / handoff-gen.sh para os idiomas.
#
# resolved_at (issue #78): 'add --status resolved' e 'update --status resolved' são RECUSADOS de
# propósito — são as duas portas que quem quer marcar estado natural digita primeiro ("quero mudar
# o status" -> update; "estou registrando algo que já acabou" -> add), e as duas deixavam
# resolved_at nulo em silêncio porque só o 'resolve' o carimbava. Medido: 45/143 entradas resolvidas
# sem resolved_at num consumidor, crescendo entre medições (39/135 -> 42/138 -> 45/143); 11/59 no
# próprio harness. A alternativa cogitada — carimbar resolved_at também em add/update — foi
# descartada porque manteria DUAS fontes de verdade para o mesmo carimbo (drift já provou não ser
# hipotético) e deixaria 'resolved' sem exigir motivo (o 'resolve' já exige --note; add/update não
# pedem justificativa nenhuma para encerrar algo). Recusar e apontar para 'resolve' fecha a porta
# errada em vez de tentar consertar as duas entradas por ela. 'wont-fix' tem o mesmo defeito na
# prática — hoje só nasce via 'update --status wont-fix', sem carimbo e sem nota — então entra na
# mesma recusa; 'resolve' passa a aceitar '--status wont-fix' como a porta certa para os dois
# desfechos terminais. 'promoted' NÃO tem esse problema: o item promovido ainda não foi resolvido,
# está sob rastreio de um change ativo (ver ledger-consultation.md) — carimbar resolved_at nele
# seria afirmar algo falso. Ele só ganha resolved_at de fato quando o change que o promoveu chega a
# archive/close-delivered-externally, e aí passa pelo 'resolve' como qualquer outro.
#
# detail ACUMULATIVO (onda w211): o `detail` deixou de ser campo que se substitui e passou a ser
# registro que acumula. A razão é medida na história deste próprio arquivo: das 92 mutações de
# `detail`, 24 não preservaram o texto anterior, e SEIS delas destruíram mais de 25% do campo —
# 3.497 bytes num único item, 86 de 86 frases longas do texto antigo ausentes do texto novo, todas
# com `rc 0` e `OK` na saída. A porta responsável era `if (de) e.detail = de;`: atribuição direta,
# sem aviso e sem backup. Duas peças, e as duas são necessárias:
#
#   (1) `note` — verbo novo que SÓ acrescenta, com `--kind` de enum fechado. Um verbo sozinho não
#       impediria a próxima perda (ninguém é obrigado a usá-lo: as seis perdas foram cometidas por
#       autores que aplicavam a convenção de append à mão em outros itens no mesmo dia).
#   (2) a guarda de PRESERVAÇÃO em `update --detail` — recusa a substituição destrutiva a menos
#       que ela seja pedida em letra com `--replace-detail`. Uma guarda sozinha, sem verbo, viraria
#       um beco: quem quisesse registrar progresso seria recusado sem ter para onde ir.
#
# 'Preserva' é CONTAINMENT NÃO-ESTRITO: o detail corrente é subcadeia do texto novo, incluindo o
# caso de igualdade. A escolha não é cosmética — sob containment estrito (exigir crescer), o texto
# idêntico passaria a ser recusado PELA GUARDA em vez de pela detecção de no-op, e a prova de
# mutação do `w194` deixaria de discriminar a detecção de no-op. Por isso a guarda entra DEPOIS da
# detecção de no-op, nunca antes, e `w211[12]` afirma essa ordem.
#
# O progresso NÃO é registrado pelo `status`, e a razão é medida: `--status in-progress` já é
# aceito e já existe no enum do schema, mas tira o item da contagem `open` que a definição de
# pronto usa — os quatro leitores do ledger discordam sobre o que é um item ativo (`status` e
# `render` tratam `in-progress` como ativo; `list --status open` e a contagem por `status == open`
# não o veem). Registrar pagamento parcial mudando o status seria fechar por reclassificação
# silenciosa. `note` nunca toca `status` nem `resolved_at`.
#
# `note` é PORTA DE ESCRITA como as outras cinco, e herda as duas obrigações transversais delas:
# chama `_render` (paridade `ledger.json` <-> `LEDGER.md`, que nenhum gate confere sozinho) e entra
# na lista de `forge_warn_root_divergence` (LDG-0068/LDG-0174 — porta invocada de dentro de um
# worktree grava no ledger do TRONCO e tem de anunciar). Coberto por `tests/w211-...[18]` e `[19]`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Disciplina de parsing (issue #103): flag desconhecida REPROVA e valor vazio REPROVA. Delegação
# em alvo ausente é erro, nunca silêncio — o mesmo idioma que os hooks já aplicam aos check-*.sh:
# se a lib sumiu, o script não segue rodando sem as guardas que ele afirma ter.
if [ -f "$SCRIPT_DIR/lib/arg-guards.sh" ]; then
  # shellcheck source=lib/arg-guards.sh
  . "$SCRIPT_DIR/lib/arg-guards.sh"
else
  echo "FAIL: ledger-ops: '$SCRIPT_DIR/lib/arg-guards.sh' ausente — as guardas de flag desconhecida e de valor vazio são parte do contrato deste script; rodar sem elas reinstala a escrita silenciosa que a issue #103 fechou." >&2
  exit 1
fi
_reject_unknown() { forge_reject_unknown "$@"; }
_require_value() { forge_require_value "$@"; }

# ROOT é o CHECKOUT PRINCIPAL, nunca o worktree de onde o script foi chamado. O ledger é artefato
# durável de PROJETO, não de branch: resolvido por `--show-toplevel`, um registro feito de dentro
# de um worktree nasce no ledger.json daquela branch, e toda branch que toca o ledger passa a
# colidir por construção no merge. Medido em axis-go-cloud (cinco reconciliações num único dia) e
# em axis-fare-validator (dez entradas presas numa branch de feature, duas delas normas de
# processo, invisíveis para o resto do repositório até o PR mergear).
#
# `--git-common-dir` devolve o `.git` compartilhado por TODOS os worktrees; o diretório que o
# contém é o tronco. `--path-format=absolute` é necessário porque, no próprio checkout principal,
# `--git-common-dir` devolveria `.git` relativo — e `dirname .git` daria `.`, que é justamente o
# worktree corrente que se quer evitar. O mesmo idioma já é usado em hooks/git/pre-commit.
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
LEDGER_DIR="$ROOT/.forge/ledger"
LF="$LEDGER_DIR/ledger.json"
SCHEMA="$SCRIPT_DIR/../schemas/ledger.schema.json"
TPL="$(cd "$SCRIPT_DIR/.." && pwd)/templates/ledger/LEDGER.md"
OUT="$LEDGER_DIR/LEDGER.md"

cmd="${1:-}"; shift || true
case "$cmd" in
  -h|--help|help) echo "Usage: ledger-ops.sh add|update|note|verify|resolve|promote|assign|pause|resume|harvest|render|status|list|show|stale [args...]"; exit 0 ;;
esac
[ -n "$cmd" ] || { echo "Usage: ledger-ops.sh add|update|note|verify|resolve|promote|assign|pause|resume|harvest|render|status|list|show|stale [args...]" >&2; exit 1; }

_git_date() { git -C "$ROOT" log -1 --format=%cI 2>/dev/null || echo ""; }
# _require_git_date — busca a data e RECUSA no caller se vier vazia (fora de git, ou git sem
# nenhum commit ainda). NUNCA chamar `_git_date` diretamente dentro de `"$(...)"` aninhado num
# comando maior (ex.: argumento de `node - ... "$(_git_date)"`): um `exit` disparado ali dentro só
# mata o subshell da substituição, o valor vazio segue para o comando de fora, e a recusa nunca
# acontece — foi exatamente assim que 'resolve' (a porta que esta issue corrigiu) carimbava
# resolved_at="" com rc=0 sob FORGE_ROOT apontando para um diretório sem commit algum. Por isso
# esta função grava o resultado numa variável no shell PRINCIPAL antes de decidir. Fecha fechado
# em vez de cair para wall clock em silêncio, porque o cabeçalho promete "created_at = data do
# commit HEAD, não wall clock" — silenciosamente trocar a fonte quebraria essa promessa sem avisar
# ninguém, e diretório sem commit é raro e trivial de sair (um commit resolve).
_require_git_date() {
  local d
  d="$(_git_date)"
  if [ -z "$d" ]; then
    echo "FAIL: ledger-ops: sem data de commit HEAD em '$ROOT' — fora de um repositório git, ou repositório git sem nenhum commit ainda. O ledger não carimba por relógio de parede (contradiria 'created_at = data do commit HEAD, não wall clock'). Faça um commit no projeto (mesmo 'git commit --allow-empty -m init') e tente de novo." >&2
    exit 1
  fi
  GIT_DATE_NOW="$d"
}
# _validate_enum_field <schema> <caminho-no-item> <valor> <nome-da-flag> — LDG-0190: recusa ANTES
# de escrever quando `valor` não pertence ao enum que `ledger.schema.json` declara para o campo em
# `caminho-no-item` (ex.: "type", "source.origin"). Valor vazio passa (campo opcional não
# informado); campo sem enum no schema passa (nada a validar). Fonte única de verdade é o próprio
# schema — nunca uma lista de valores redigitada aqui, que divergiria da primeira vez que o schema
# mudasse.
_validate_enum_field() {
  local schema="$1" path="$2" value="$3" flag="$4"
  [ -n "$value" ] || return 0
  node -e '
    const fs = require("fs");
    const [, schemaPath, path, value, flag] = process.argv;
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    let node = schema.properties && schema.properties.entries && schema.properties.entries.items && schema.properties.entries.items.properties;
    const segs = path.split(".");
    segs.forEach((seg, i) => {
      node = node && node[seg];
      // Campo que é array de objetos (ex.: evidence): desce em items antes das properties.
      if (i < segs.length - 1) node = node && ((node.items && node.items.properties) || node.properties);
    });
    const enumVals = node && Array.isArray(node.enum) ? node.enum.filter((v) => v !== null) : null;
    if (!enumVals) process.exit(0);
    if (!enumVals.includes(value)) {
      console.error("FAIL: ledger-ops: --" + flag + " \x27" + value + "\x27 fora do enum do schema (" + enumVals.join("|") + ")");
      process.exit(1);
    }
  ' "$schema" "$path" "$value" "$flag"
}
_write_json() { local f="$1"; local tmp; tmp="$(mktemp "${f}.XXXXXX")"; printf '%s\n' "$2" > "$tmp"; mv "$tmp" "$f"; }
_init_ledger() { mkdir -p "$LEDGER_DIR"; [ -f "$LF" ] || _write_json "$LF" '{"entries":[]}'; }
_render() {
  [ -f "$TPL" ] || { echo "WARN: template ausente ($TPL) — LEDGER.md não regenerado" >&2; return 0; }
  LEDGER_ROOT="$ROOT" LEDGER_JSON="$LF" LEDGER_TPL="$TPL" LEDGER_OUT="$OUT" \
    node "$SCRIPT_DIR/lib/ledger-render.mjs"
}

# ── envelhecimento (change add-ledger-evidence-aging, REQ-05/REQ-06) ─────────────────────────────
# _resolve_stale_days <valor de --days ou vazio> — fixa STALE_DAYS e STALE_ORIGIN, ou devolve 2 com
# a mensagem em STALE_ERR. Precedência: --days > forge.yaml ledger.stale_days > 30. Valor presente
# e inválido em qualquer fonte é ERRO nomeando a fonte, nunca queda silenciosa no default — um
# limiar que o operador declarou e o script ignorou é a forma de o sinal de idade mentir sem
# ninguém ver. forge.yaml é lido com o mesmo idioma awk de bloco que doctor.sh usa para
# heavy_mutex (sem parser YAML: zero dependência de runtime).
AGING_LIB="$SCRIPT_DIR/lib/ledger-aging.mjs"
_resolve_stale_days() {
  local flag="${1:-}" cfg
  STALE_ERR=""
  if [ -n "$flag" ]; then
    if [[ "$flag" =~ ^[1-9][0-9]*$ ]]; then STALE_DAYS="$flag"; STALE_ORIGIN="--days"; return 0; fi
    STALE_ERR="FAIL: ledger-ops: --days '$flag' inválido — o limiar é um inteiro >= 1 (dias)."
    return 2
  fi
  # A forma em linha (`ledger: {stale_days: N}`) não é lida por este idioma de bloco; declarada,
  # ela é recusada nomeando a chave — ignorá-la seria aplicar o default a um limiar declarado.
  if grep -qE '^ledger:[[:space:]]*\{.*stale_days' "$ROOT/.forge/forge.yaml" 2>/dev/null; then
    STALE_ERR="FAIL: ledger-ops: forge.yaml declara ledger.stale_days na forma em linha ({...}) — use a forma em bloco (ledger:\n  stale_days: N) em $ROOT/.forge/forge.yaml."
    return 2
  fi
  # `PRESENTE:` distingue chave ausente (default) de chave presente e vazia (erro).
  cfg="$(awk '/^ledger:/{f=1;next} f&&/^[^[:space:]#]/{f=0} f&&/^[[:space:]]*stale_days:/{sub(/^[[:space:]]*stale_days:[[:space:]]*/,"");sub(/[[:space:]]*#.*$/,"");gsub(/["'"'"']/,"");print "PRESENTE:" $0;exit}' "$ROOT/.forge/forge.yaml" 2>/dev/null || true)"
  if [ -n "$cfg" ]; then
    cfg="${cfg#PRESENTE:}"
    cfg="${cfg%"${cfg##*[![:space:]]}"}"
    if [[ "$cfg" =~ ^[1-9][0-9]*$ ]]; then STALE_DAYS="$cfg"; STALE_ORIGIN="forge.yaml"; return 0; fi
    STALE_ERR="FAIL: ledger-ops: forge.yaml ledger.stale_days '$cfg' inválido — o limiar é um inteiro >= 1 (dias). Corrija em $ROOT/.forge/forge.yaml."
    return 2
  fi
  STALE_DAYS=30; STALE_ORIGIN="default"; return 0
}
# _asof_valid <texto> — data ISO-8601 sem ambiguidade de fuso: `AAAA-MM-DD` (lida como UTC) ou
# data e hora COM `Z`/`±hh:mm`. Hora sem fuso é recusada: o Date.parse a leria no fuso local do
# processo, e a mesma entrada daria idades diferentes em máquinas diferentes — relógio de ambiente
# entrando por outra porta. Data inexistente no calendário (2026-02-30) também é recusada, em vez
# de rolar em silêncio para o mês seguinte.
_asof_valid() {
  [[ "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ || "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$ ]] || return 1
  node -e '
    const s = process.argv[1];
    if (Number.isNaN(Date.parse(s))) process.exit(1);
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    const c = new Date(Date.UTC(y, m - 1, d));
    process.exit(c.getUTCFullYear() === y && c.getUTCMonth() === m - 1 && c.getUTCDate() === d ? 0 : 1);
  ' "$1"
}

# LDG-0068: as portas que ESCREVEM anunciam quando o ROOT resolvido difere do repositório de
# trabalho de quem invocou. Só `status` e `list` ficam de fora — aviso em porta de leitura é ruído
# que treina o operador a ignorar a linha quando ela importa.
#
# LDG-0174: `render` estava nessa lista de fora, por uma premissa falsa. Ele NÃO só lê: `_render()`
# grava `$OUT`, isto é, o `LEDGER.md`, que é arquivo rastreado. Invocado de uma árvore de trabalho
# sem `FORGE_ROOT`, `forge_resolve_root` cai em `forge_main_root` (o TRONCO, via `--git-common-dir`)
# e o comando reescrevia o `LEDGER.md` do checkout principal — que pode estar noutra branch, com
# outro `ledger.json` e outro renderizador — respondendo `OK <caminho do tronco>` e nenhuma linha de
# aviso. O operador lia `OK` e não tinha como saber que gravou fora da árvore em que trabalhava.
# Coberto por `tests/w207-ledger-render-write-port-gate.sh`.
case "$cmd" in
  add|update|note|verify|resolve|promote|assign|pause|resume|harvest|render)
    forge_warn_root_divergence "$ROOT" "ledger" "ledger-ops" ;;
esac

case "$cmd" in

add)
  type=""; title=""; detail=""; severity=""; priority=""; status="open"; origin="manual"; change=""; ref=""; adr=""; capability=""; supersedes=""
  ADD_FLAGS="--type --title --detail --severity --priority --status --origin --change --ref --adr --capability --supersedes"
  while [ $# -gt 0 ]; do case "$1" in
    --type) _require_value "add" --type "${2-}" "$ADD_FLAGS"; type="$2"; shift 2 ;;
    --title) _require_value "add" --title "${2-}" "$ADD_FLAGS"; title="$2"; shift 2 ;;
    --detail) _require_value "add" --detail "${2-}" "$ADD_FLAGS"; detail="$2"; shift 2 ;;
    --severity) _require_value "add" --severity "${2-}" "$ADD_FLAGS"; severity="$2"; shift 2 ;;
    --priority) _require_value "add" --priority "${2-}" "$ADD_FLAGS"; priority="$2"; shift 2 ;;
    --status) _require_value "add" --status "${2-}" "$ADD_FLAGS"; status="$2"; shift 2 ;;
    --origin) _require_value "add" --origin "${2-}" "$ADD_FLAGS"; origin="$2"; shift 2 ;;
    --change) _require_value "add" --change "${2-}" "$ADD_FLAGS"; change="$2"; shift 2 ;;
    --ref) _require_value "add" --ref "${2-}" "$ADD_FLAGS"; ref="$2"; shift 2 ;;
    --adr) _require_value "add" --adr "${2-}" "$ADD_FLAGS"; adr="$2"; shift 2 ;;
    --capability) _require_value "add" --capability "${2-}" "$ADD_FLAGS"; capability="$2"; shift 2 ;;
    --supersedes) _require_value "add" --supersedes "${2-}" "$ADD_FLAGS"; supersedes="$2"; shift 2 ;;
    *) _reject_unknown "add" "$ADD_FLAGS" "$1" ;;
  esac; done
  [ -n "$type" ] || { echo "FAIL: --type obrigatório (roadmap|tech-debt|known-bug|follow-up|feature-idea)" >&2; exit 1; }
  [ -n "$title" ] || { echo "FAIL: --title obrigatório" >&2; exit 1; }
  case "$status" in
    resolved|wont-fix)
      echo "FAIL: ledger-ops: 'add --status $status' não carimba resolved_at (issue #78) — registre com 'add' (nasce 'open') e feche com:" >&2
      echo "  ledger-ops.sh resolve <LDG-NNNN> --note \"<motivo>\"$([ "$status" = wont-fix ] && echo " --status wont-fix")" >&2
      exit 1
      ;;
    superseded)
      # Mesma lógica da issue #78: o status só nasce junto do elo e do carimbo, pela porta que os grava.
      echo "FAIL: ledger-ops: 'add --status superseded' gravaria um item encerrado sem sucessor, sem elo e sem resolved_at — o status 'superseded' só nasce por 'ledger-ops.sh add ... --supersedes <LDG-NNNN>', na entrada ANTERIOR, quando a nova a substitui." >&2
      exit 1
      ;;
  esac
  # --supersedes: padrão conferido aqui; existência e status do alvo, no bloco node (escrita única).
  if [ -n "$supersedes" ] && ! [[ "$supersedes" =~ ^LDG-[0-9]{4}$ ]]; then
    echo "FAIL: ledger-ops: --supersedes '$supersedes' não é um id de ledger (LDG-NNNN)." >&2
    exit 1
  fi
  _validate_enum_field "$SCHEMA" "type" "$type" "type"
  _validate_enum_field "$SCHEMA" "severity" "$severity" "severity"
  _validate_enum_field "$SCHEMA" "priority" "$priority" "priority"
  _validate_enum_field "$SCHEMA" "status" "$status" "status"
  _validate_enum_field "$SCHEMA" "source.origin" "$origin" "origin"
  _require_git_date
  _init_ledger
  result="$(node - "$LF" "$type" "$title" "$detail" "$severity" "$priority" "$status" "$origin" "$change" "$ref" "$adr" "$capability" "$GIT_DATE_NOW" "$supersedes" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, type, title, detail, severity, priority, status, origin, change, ref, adr, capability, now, supersedes] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
if (!Array.isArray(data.entries)) data.entries = [];
const max = data.entries.reduce((m, e) => { const n = parseInt((e.id || '').replace('LDG-', ''), 10); return Number.isFinite(n) && n > m ? n : m; }, 0);
const id = 'LDG-' + String(max + 1).padStart(4, '0');
// Supersessão (add-ledger-evidence-aging, REQ-04): o anterior só pode ser substituído enquanto está
// ATIVO. 'promoted' está sob rastreio de um change (a baixa é do archive/close); um encerrado não
// tem o que substituir; um 'superseded' já tem sucessor. As duas mutações vão na MESMA escrita.
let anterior = null;
if (supersedes) {
  anterior = data.entries.find((x) => x.id === supersedes);
  if (!anterior) { console.error("FAIL: ledger-ops: --supersedes " + supersedes + ' — entrada não encontrada.'); process.exit(1); }
  if (['open', 'planned', 'in-progress'].indexOf(anterior.status) === -1) {
    const extra = anterior.status === 'promoted' && anterior.links && anterior.links.promoted_to ? ' (rastreada pelo change ' + anterior.links.promoted_to + ')' : (anterior.status === 'superseded' && anterior.links && anterior.links.superseded_by ? ' (já substituída por ' + anterior.links.superseded_by + ')' : '');
    console.error('FAIL: ledger-ops: --supersedes ' + supersedes + " — a entrada está em '" + anterior.status + "'" + extra + '; só uma entrada ativa (open, planned, in-progress) pode ser substituída.');
    process.exit(1);
  }
}
const dedup = (change && ref) ? `${change}:${ref}` : `manual:${id}`;
data.entries.push({
  id, type, title,
  detail: detail || '',
  severity: severity || null,
  priority: priority || null,
  status,
  source: { change_id: change || null, origin, ref: ref || null },
  links: { adr: adr ? [adr] : [], capability: capability ? [capability] : [], change: change ? [change] : [], promoted_to: null },
  created_at: now, updated_at: null, resolved_at: null,
  dedup_key: dedup,
});
if (anterior) {
  data.entries[data.entries.length - 1].supersedes = supersedes;
  anterior.status = 'superseded';
  anterior.resolved_at = now;
  anterior.updated_at = now;
  if (!anterior.links) anterior.links = { adr: [], capability: [], change: [], promoted_to: null };
  anterior.links.superseded_by = id;
  const substV = 'SUBSTITUÍDO (' + now.slice(0, 10) + '): por ' + id;
  anterior.detail = anterior.detail ? anterior.detail + '\n\n' + substV : substV;
}
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$LF" "$result"
  _render
  new_id="$(node -e "const d=JSON.parse(require('fs').readFileSync('$LF','utf8'));console.log(d.entries[d.entries.length-1].id)")"
  echo "OK add — $new_id registrado ($type)$([ -n "$supersedes" ] && echo " — substitui $supersedes (agora superseded)")"
  # Entrada sem --detail nasce como título sem conteúdo, que é a forma de item que envelhece pior:
  # daqui a dois meses ninguém reconstrói o que ela queria dizer. AVISA, não reprova — reprovar
  # quebraria todo consumidor com script que já chama `add` sem `--detail`.
  [ -n "$detail" ] || echo "WARN: ledger-ops: $new_id nasceu SEM CONTEÚDO (nenhum --detail) — título sem detalhe é a forma de item que envelhece pior. Complete com: ledger-ops.sh update $new_id --detail \"<o que é, como medir, o que fecha>\"" >&2
  ;;

update)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  n_status=""; n_priority=""; n_severity=""; n_title=""; n_detail=""; n_replace=""; n_flags=0
  # `--replace-detail` entra em UPDATE_FLAGS para que o teste de PERTENCIMENTO de
  # `forge_reject_flag_as_value` a reconheça como flag, e não como conteúdo legítimo.
  UPDATE_FLAGS="--status --priority --severity --title --detail --replace-detail"
  while [ $# -gt 0 ]; do case "$1" in
    --status) _require_value "update" --status "${2-}" "$UPDATE_FLAGS"; n_status="$2"; n_flags=$((n_flags + 1)); shift 2 ;;
    --priority) _require_value "update" --priority "${2-}" "$UPDATE_FLAGS"; n_priority="$2"; n_flags=$((n_flags + 1)); shift 2 ;;
    --severity) _require_value "update" --severity "${2-}" "$UPDATE_FLAGS"; n_severity="$2"; n_flags=$((n_flags + 1)); shift 2 ;;
    --title) _require_value "update" --title "${2-}" "$UPDATE_FLAGS"; n_title="$2"; n_flags=$((n_flags + 1)); shift 2 ;;
    --detail) _require_value "update" --detail "${2-}" "$UPDATE_FLAGS"; n_detail="$2"; n_flags=$((n_flags + 1)); shift 2 ;;
    # Booleana, sem valor, no idioma de `--by-priority` do `list`. NÃO conta em `n_flags`: ela diz
    # COMO gravar o `detail`, nunca O QUÊ — sozinha não tem o que gravar.
    --replace-detail) n_replace="1"; shift ;;
    *) _reject_unknown "update" "$UPDATE_FLAGS" "$1" ;;
  esac; done
  if [ "$n_replace" = "1" ] && [ -z "$n_detail" ]; then
    echo "FAIL: ledger-ops: '--replace-detail' sem '--detail' não tem o que substituir — a flag diz COMO gravar o detail, nunca o quê. Passe '--detail \"<texto>\"' junto dela, ou use 'ledger-ops.sh note $id --kind <k> --text \"<txt>\"' para acrescentar sem substituir." >&2
    exit 1
  fi
  [ "$n_flags" -gt 0 ] || { echo "FAIL: ledger-ops: 'update $id' sem flag alguma não tem o que gravar — o único efeito seria avançar 'updated_at', o que faz a entrada parecer recente sem carregar informação nova. Flags aceitas em 'update': $UPDATE_FLAGS" >&2; exit 1; }
  case "$n_status" in
    resolved|wont-fix)
      echo "FAIL: ledger-ops: 'update --status $n_status' não carimba resolved_at (issue #78) — use:" >&2
      echo "  ledger-ops.sh resolve $id --note \"<motivo>\"$([ "$n_status" = wont-fix ] && echo " --status wont-fix")" >&2
      exit 1
      ;;
    superseded)
      echo "FAIL: ledger-ops: 'update --status superseded' gravaria um item encerrado sem sucessor e sem elo — registre o sucessor com 'ledger-ops.sh add ... --supersedes $id', que encerra este na mesma escrita." >&2
      exit 1
      ;;
  esac
  _require_git_date
  _init_ledger
  set +e
  result="$(node - "$LF" "$id" "$n_status" "$n_priority" "$n_severity" "$n_title" "$n_detail" "$GIT_DATE_NOW" "$n_replace" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, id, st, pr, sv, ti, de, now, repl] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
const e = (data.entries || []).find((x) => x.id === id);
if (!e) { console.error('entrada ' + id + ' não encontrada'); process.exit(1); }
// 'superseded' não sai do status por porta nenhuma: o trabalho continua no sucessor.
if (e.status === 'superseded' && st) {
  console.error("FAIL: ledger-ops: 'update " + id + " --status " + st + "' — a entrada está em 'superseded' e não sai desse status; o trabalho continua em " + ((e.links && e.links.superseded_by) || '(sucessor ausente)') + '. Correção de título/prioridade/detail continua permitida.');
  process.exit(1);
}
// Assinatura de CONTEÚDO antes e depois: `updated_at` deliberadamente fora dela. Um update cujo
// único efeito é mexer no carimbo faz a entrada parecer recente sem carregar informação nova, e
// era indistinguível de um update que gravou de fato — os dois imprimiam `OK`.
const sig = () => JSON.stringify([e.title, e.detail, e.status, e.priority, e.severity]);
const before = sig();
const prev = e.detail || '';
if (st) e.status = st;
if (pr) e.priority = pr;
if (sv) e.severity = sv;
if (ti) e.title = ti;
if (de) e.detail = de;
if (sig() === before) { console.error('NOCHANGE'); process.exit(3); }
// Guarda de PRESERVAÇÃO, aplicada DEPOIS da detecção de no-op e nunca antes: 'preserva' é
// containment NÃO-ESTRITO (o texto corrente é subcadeia do novo, igualdade inclusa), de modo que
// o texto idêntico continua sendo recusado como NOCHANGE, pela guarda que já existia.
const destroi = de !== '' && prev !== '' && de.indexOf(prev) === -1;
if (destroi && repl !== '1') {
  console.error("FAIL: ledger-ops: 'update " + id + " --detail' descartaria " + Buffer.byteLength(prev, 'utf8') + " byte(s) de detail que o texto novo não preserva. Nada foi gravado. Seis perdas assim já aconteceram neste ledger, com rc 0 e OK na saída. Os dois caminhos legítimos:");
  console.error("  para ACRESCENTAR (pagamento parcial, medição nova, correção, decisão):");
  console.error("    ledger-ops.sh note " + id + " --kind progress|measurement|correction|decision --text \"<txt>\"");
  console.error("  para SUBSTITUIR de propósito, assumindo a perda:");
  console.error("    ledger-ops.sh update " + id + " --detail \"<txt>\" --replace-detail");
  process.exit(4);
}
if (destroi && repl === '1') {
  console.error('WARN: ledger-ops: ' + id + ' — ' + Buffer.byteLength(prev, 'utf8') + ' byte(s) do detail anterior foram DESCARTADOS por --replace-detail. A substituição continua possível; ela deixou de ser silenciosa.');
}
e.updated_at = now;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"; node_rc=$?
  set -e
  if [ "$node_rc" -eq 3 ]; then
    echo "FAIL: ledger-ops: 'update $id' não alterou nenhum campo — os valores passados já são os que a entrada carrega. Nada foi gravado (nem 'updated_at'): um update sem efeito devolvendo 'OK' é a forma pela qual um commit anuncia conteúdo que o ledger não tem." >&2
    exit 1
  fi
  [ "$node_rc" -eq 0 ] || exit "$node_rc"
  _write_json "$LF" "$result"
  _render
  echo "OK update — $id atualizado"
  ;;

# note — a porta que só ACRESCENTA. O enum de `--kind` é fechado, e cada valor é lastreado num
# marcador que os autores deste ledger já escreviam à mão (medido: cinco dos itens ativos carregam
# ao menos um bloco dessa família). Rótulo livre não é contrato, não é legível por gate e
# produziria em dois meses a mesma variedade que só um humano reconhece. A leitura do marcador é
# de PRESENÇA e ORDEM, nunca de contagem: um `--text` do usuário pode conter uma sequência
# idêntica à do marcador gerado, e contar marcadores contaria os dele junto.
note)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  kind=""; text=""
  NOTE_FLAGS="--kind --text"
  while [ $# -gt 0 ]; do case "$1" in
    --kind) _require_value "note" --kind "${2-}" "$NOTE_FLAGS"; kind="$2"; shift 2 ;;
    --text) _require_value "note" --text "${2-}" "$NOTE_FLAGS"; text="$2"; shift 2 ;;
    *) _reject_unknown "note" "$NOTE_FLAGS" "$1" ;;
  esac; done
  NOTE_KINDS="progress measurement correction decision"
  [ -n "$kind" ] || { echo "FAIL: ledger-ops: '--kind' é obrigatório em 'note' — o rótulo é enum fechado, um dos quatro: $NOTE_KINDS. Flags aceitas em 'note': $NOTE_FLAGS" >&2; exit 1; }
  [ -n "$text" ] || { echo "FAIL: ledger-ops: '--text' é obrigatório em 'note' — uma nota sem texto não acrescenta nada ao registro. Flags aceitas em 'note': $NOTE_FLAGS" >&2; exit 1; }
  case "$kind" in
    progress|measurement|correction|decision) : ;;
    *) echo "FAIL: ledger-ops: '--kind $kind' não é rótulo aceito em 'note' — o enum é fechado e tem quatro valores: $NOTE_KINDS" >&2; exit 1 ;;
  esac
  # `note --kind measurement` é o hábito antigo de "reconferi o item"; ele continua gravando, mas não
  # conta como reverificação: não carrega referência conferível nem carimba last_verified.
  if [ "$kind" = "measurement" ]; then
    echo "WARN: ledger-ops: 'note --kind measurement' acrescenta o texto ao detail mas NÃO conta como reverificação (não grava last_verified). Para registrar a reconferência com evidência: ledger-ops.sh verify $id --kind file|commit|test|command --ref \"<ref>\" --observed \"<o que viu>\" --verdict confirmed|changed" >&2
  fi
  _require_git_date
  _init_ledger
  set +e
  result="$(node - "$LF" "$id" "$kind" "$text" "$GIT_DATE_NOW" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, id, kind, text, now] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
const e = (data.entries || []).find((x) => x.id === id);
if (!e) { console.error("FAIL: ledger-ops: entrada '" + id + "' não encontrada — 'note' anota entrada que existe; para registrar algo novo use 'add'."); process.exit(1); }
const LABEL = { progress: 'PROGRESSO', measurement: 'MEDIÇÃO', correction: 'CORREÇÃO DE REGISTRO', decision: 'DECISÃO' };
// A data é a do commit HEAD, a mesma fonte de `created_at`, e nunca o relógio de parede: o
// cabeçalho deste arquivo promete uma noção de tempo só, e um verbo novo com outra fonte criaria
// duas dentro do mesmo registro.
const day = String(now).slice(0, 10);
const marker = LABEL[kind] + ' (' + day + '): ';
const prev = e.detail || '';
if (prev && prev.indexOf(text) !== -1) {
  console.error("WARN: ledger-ops: o texto de '--text' já aparece no detail de " + id + " — 'note' é acumulativo por desenho e vai acrescentar assim mesmo, deixando o bloco duplicado no registro durável. Confira se a nota já não foi registrada antes de repetir o comando.");
}
const CLOSED = ['resolved', 'wont-fix', 'promoted', 'superseded'];
if (CLOSED.indexOf(e.status) !== -1) {
  console.error('WARN: ledger-ops: ' + id + " está em '" + e.status + "' — a nota foi acrescentada e o status NÃO mudou. Anotar um item encerrado é legítimo (voltou a reproduzir, chegou medição nova); refechá-lo não seria, e 'note' nunca fecha nem reabre.");
}
// Append, separador de linha em branco, cabeçalho com data: é a convenção que os autores deste
// ledger já praticavam. Medido na história do arquivo: de todas as mutações em que o texto
// anterior sobreviveu literalmente, 68 são append, 0 são prepend e 0 põem o texto antigo no meio.
const SEP = '\n\n';
const bloco = marker + text;
e.detail = prev ? prev + SEP + bloco : bloco;
e.updated_at = now;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"; node_rc=$?
  set -e
  [ "$node_rc" -eq 0 ] || exit "$node_rc"
  _write_json "$LF" "$result"
  _render
  echo "OK note — $id anotado ($kind)"
  ;;

# verify — a única porta que grava `last_verified` (change add-ledger-evidence-aging, REQ-02/03).
# Reverificação é ato explícito com evidência conferível contra o estado real do repositório,
# nunca carimbo automático: um `last_verified` sem registro que o justifique seria exatamente o
# campo de preenchimento vazio que o change existe para evitar. Toda recusa acontece ANTES de
# qualquer escrita. O `ref` de `--kind command` é texto e NUNCA é executado: executar comando
# vindo de flag numa porta de escrita seria superfície de execução sem ganho de prova — a saída
# observada já chega em `--observed`. `command` é, por isso, a evidência mais fraca dos quatro.
verify)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  v_kind=""; v_ref=""; v_obs=""; v_verdict=""
  VERIFY_FLAGS="--kind --ref --observed --verdict"
  while [ $# -gt 0 ]; do case "$1" in
    --kind) _require_value "verify" --kind "${2-}" "$VERIFY_FLAGS"; v_kind="$2"; shift 2 ;;
    --ref) _require_value "verify" --ref "${2-}" "$VERIFY_FLAGS"; v_ref="$2"; shift 2 ;;
    --observed) _require_value "verify" --observed "${2-}" "$VERIFY_FLAGS"; v_obs="$2"; shift 2 ;;
    --verdict) _require_value "verify" --verdict "${2-}" "$VERIFY_FLAGS"; v_verdict="$2"; shift 2 ;;
    *) _reject_unknown "verify" "$VERIFY_FLAGS" "$1" ;;
  esac; done
  for pair in "--kind:$v_kind" "--ref:$v_ref" "--observed:$v_obs" "--verdict:$v_verdict"; do
    [ -n "${pair#*:}" ] || { echo "FAIL: ledger-ops: '${pair%%:*}' é obrigatório em 'verify' — reverificação sem ela não é conferível. Flags de 'verify': $VERIFY_FLAGS" >&2; exit 1; }
  done
  _validate_enum_field "$SCHEMA" "evidence.kind" "$v_kind" "kind"
  _validate_enum_field "$SCHEMA" "evidence.verdict" "$v_verdict" "verdict"
  _require_git_date
  _init_ledger
  if [ "$v_kind" = "commit" ]; then
    sha="$(git -C "$ROOT" rev-parse --verify --quiet "${v_ref}^{commit}" 2>/dev/null || true)"
    [ -n "$sha" ] || { echo "FAIL: ledger-ops: verify $id --kind commit: '$v_ref' não resolve para um commit em $ROOT (git rev-parse --verify)." >&2; exit 1; }
    v_ref="$sha"
  fi
  set +e
  result="$(node - "$LF" "$id" "$v_kind" "$v_ref" "$v_obs" "$v_verdict" "$GIT_DATE_NOW" "$ROOT" <<'NODEEOF'
const fs = require('fs');
const path = require('path');
const [, , lf, id, kind, ref, observed, verdict, now, root] = process.argv;
const data = JSON.parse(fs.readFileSync(lf, 'utf8'));
const e = (data.entries || []).find((x) => x.id === id);
if (!e) { console.error("FAIL: ledger-ops: entrada '" + id + "' não encontrada — 'verify' reverifica entrada que existe."); process.exit(1); }
const ENCERRADOS = ['resolved', 'wont-fix', 'promoted', 'superseded'];
if (ENCERRADOS.indexOf(e.status) !== -1) {
  console.error('FAIL: ledger-ops: verify ' + id + " — a entrada está em '" + e.status + "', status encerrado: item encerrado não envelhece e não se reverifica" + (e.status === 'superseded' && e.links && e.links.superseded_by ? ' (o trabalho continua em ' + e.links.superseded_by + ')' : '') + '.');
  process.exit(1);
}
// checkEvidence — conteúdo mínimo por kind, conferido contra a árvore do ROOT. Devolve a mensagem
// da regra violada, ou null. A prova de mutação do gate desliga exatamente esta chamada.
function checkEvidence() {
  const obs = observed.trim();
  if (obs.length < 20) return '--observed precisa de ao menos 20 caracteres (o que foi visto, não um "ok")';
  if (obs === ref.trim()) return '--observed não pode repetir o --ref: diga o que foi observado, não onde';
  if (obs === String(e.title || '').trim()) return '--observed não pode repetir o título da entrada';
  const rootReal = fs.realpathSync(root);
  // inside(p) -> { real } ou { err }: caminho relativo, existente, arquivo regular e, depois de
  // resolvido por realpath (links simbólicos inclusos), contido na raiz do projeto.
  const inside = (p) => {
    if (!p || path.isAbsolute(p)) return { err: 'caminho precisa ser relativo à raiz do projeto (' + root + ')' };
    let real;
    try { real = fs.realpathSync(path.join(root, p)); } catch { return { err: "'" + p + "' não existe sob " + root }; }
    const rel = path.relative(rootReal, real);
    if (rel === '' || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return { err: "'" + p + "' resolve para fora da raiz do projeto" };
    // O repositório git e o próprio ledger não são evidência do estado do código: citar
    // .git/HEAD ou ledger.json reverificaria o item contra ele mesmo.
    const relPosix = rel.split(path.sep).join('/');
    if (relPosix === '.git' || relPosix.startsWith('.git/')) return { err: "'" + p + "' está dentro de .git/ — evidência é o código ou o estado do projeto, não os metadados do git" };
    if (relPosix.startsWith('.forge/ledger/')) return { err: "'" + p + "' é o próprio ledger — um item não se reverifica contra ele mesmo" };
    if (!fs.statSync(real).isFile()) return { err: "'" + p + "' não é arquivo regular" };
    return { real };
  };
  if (kind === 'file') {
    const m = /^(.+):([0-9]+)(?:-([0-9]+))?$/.exec(ref);
    if (!m) return "formato é '<caminho>:<linha>' ou '<caminho>:<linha>-<linha>'";
    const f = inside(m[1]); if (f.err) return f.err;
    const txt = fs.readFileSync(f.real, 'utf8');
    const n = txt === '' ? 0 : txt.split('\n').length - (txt.endsWith('\n') ? 1 : 0);
    const l1 = parseInt(m[2], 10), l2 = m[3] ? parseInt(m[3], 10) : l1;
    if (l1 < 1) return 'linha começa em 1';
    if (l2 < l1) return 'intervalo invertido (' + l1 + '-' + l2 + ')';
    if (l2 > n) return "linha " + l2 + " além do fim de '" + m[1] + "' (" + n + ' linha(s))';
    return null;
  }
  if (kind === 'test') {
    const i = ref.indexOf('::');
    const p = i === -1 ? ref : ref.slice(0, i);
    const name = i === -1 ? '' : ref.slice(i + 2);
    const f = inside(p); if (f.err) return f.err;
    if (i !== -1 && (!name || fs.readFileSync(f.real, 'utf8').indexOf(name) === -1)) return "o nome '" + name + "' não aparece em '" + p + "'";
    return null;
  }
  if (kind === 'command') {
    if (!ref.trim()) return 'a linha de comando não pode ser só espaços';
    return null;
  }
  return null; // commit: resolvido no shell antes daqui
}
const evErr = checkEvidence();
if (evErr) { console.error('FAIL: ledger-ops: verify ' + id + ' --kind ' + kind + ': ' + evErr + '. Nada foi gravado.'); process.exit(1); }
if (e.last_verified && Date.parse(now) < Date.parse(e.last_verified)) {
  console.error('WARN: ledger-ops: verify ' + id + ' — a data do commit HEAD (' + now + ') é anterior ao last_verified corrente (' + e.last_verified + '): o relógio do ROOT voltou no tempo. O registro é gravado assim mesmo, com a data do HEAD.');
}
if (!Array.isArray(e.evidence)) e.evidence = [];
e.evidence.push({ at: now, kind, ref, observed, verdict });
e.last_verified = now;
e.updated_at = now;
if (verdict === 'changed') {
  // Mesma convenção acumulativa do `note` (append, linha em branco, marcador datado), escrita com
  // nomes próprios: as linhas do `note` são alvo de mutação de primeira ocorrência do w211.
  const correcaoV = 'CORREÇÃO DE REGISTRO (' + now.slice(0, 10) + '): ' + observed + ' [evidência: ' + kind + ' ' + ref + ']';
  const anteriorV = e.detail || '';
  e.detail = anteriorV ? anteriorV + '\n\n' + correcaoV : correcaoV;
}
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"; node_rc=$?
  set -e
  [ "$node_rc" -eq 0 ] || exit "$node_rc"
  _write_json "$LF" "$result"
  _render
  echo "OK verify — $id reverificado ($v_verdict, $v_kind)"
  ;;

resolve)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  note=""; new_status="resolved"
  RESOLVE_FLAGS="--note --status"
  while [ $# -gt 0 ]; do case "$1" in
    --note) _require_value "resolve" --note "${2-}" "$RESOLVE_FLAGS"; note="$2"; shift 2 ;;
    --status) _require_value "resolve" --status "${2-}" "$RESOLVE_FLAGS"; new_status="$2"; shift 2 ;;
    *) _reject_unknown "resolve" "$RESOLVE_FLAGS" "$1" ;;
  esac; done
  [ -n "$note" ] || { echo "FAIL: --note obrigatório" >&2; exit 1; }
  case "$new_status" in
    resolved|wont-fix) : ;;
    *) echo "FAIL: --status inválido para 'resolve' ('$new_status') — use 'resolved' (padrão) ou 'wont-fix'" >&2; exit 1 ;;
  esac
  _require_git_date
  _init_ledger
  result="$(node - "$LF" "$id" "$note" "$new_status" "$GIT_DATE_NOW" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, id, note, newStatus, now] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
const e = (data.entries || []).find((x) => x.id === id);
if (!e) { console.error('entrada ' + id + ' não encontrada'); process.exit(1); }
if (e.status === 'superseded') {
  console.error('FAIL: ' + id + " já está encerrada como 'superseded' desde " + e.resolved_at + ' — o trabalho continua em ' + ((e.links && e.links.superseded_by) || '(sucessor ausente)') + '; resolva o sucessor.');
  process.exit(1);
}
if (e.status === 'resolved' || e.status === 'wont-fix') {
  console.error('FAIL: ' + id + " já está '" + e.status + "' desde " + e.resolved_at + ' — use update --detail para acrescentar nota');
  process.exit(1);
}
e.status = newStatus;
e.resolved_at = now;
e.updated_at = now;
const label = newStatus === 'wont-fix' ? 'Wont-fix' : 'Resolvido';
e.detail = (e.detail ? e.detail + ' — ' : '') + label + ': ' + note;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$LF" "$result"
  _render
  echo "OK resolve — $id marcado como $new_status"
  ;;

promote)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  to=""
  while [ $# -gt 0 ]; do case "$1" in
    --to) _require_value "promote" --to "${2-}" "--to"; to="$2"; shift 2 ;;
    *) _reject_unknown "promote" "--to" "$1" ;;
  esac; done
  [ -n "$to" ] || { echo "FAIL: --to <change-id> obrigatório" >&2; exit 1; }
  _require_git_date
  _init_ledger
  result="$(node - "$LF" "$id" "$to" "$GIT_DATE_NOW" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, id, to, now] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
const e = (data.entries || []).find((x) => x.id === id);
if (!e) { console.error('entrada ' + id + ' não encontrada'); process.exit(1); }
if (e.status === 'superseded') {
  console.error("FAIL: ledger-ops: promote " + id + " — a entrada está em 'superseded'; promova o sucessor: ledger-ops.sh promote " + ((e.links && e.links.superseded_by) || '<sucessor>') + ' --to ' + to);
  process.exit(1);
}
e.status = 'promoted';
e.updated_at = now;
if (!e.links) e.links = { adr: [], capability: [], change: [], promoted_to: null };
e.links.promoted_to = to;
if (!Array.isArray(e.links.change)) e.links.change = [];
if (!e.links.change.includes(to)) e.links.change.push(to);
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$LF" "$result"
  _render
  echo "OK promote — $id -> $to (status: promoted)"
  ;;

# assign/pause/resume — fila de priorização entre sessões do squad (pedido do Milton). Dimensão
# ORTOGONAL a `status`: nenhuma das três toca `status`/`resolved_at` (ledger-consultation.md já é
# estrito sobre status não virar veículo de progresso informal — a mesma disciplina vale aqui).
# `assigned_to`/`assigned_at`/`paused_by`/`paused_at`/`checkpoint` são metadados de quem está
# trabalhando em quê agora, não o ciclo de vida do item.

assign)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  to=""
  ASSIGN_FLAGS="--to"
  while [ $# -gt 0 ]; do case "$1" in
    --to) _require_value "assign" --to "${2-}" "$ASSIGN_FLAGS"; to="$2"; shift 2 ;;
    *) _reject_unknown "assign" "$ASSIGN_FLAGS" "$1" ;;
  esac; done
  [ -n "$to" ] || { echo "FAIL: ledger-ops: '--to <sessão>' obrigatório em 'assign' — sem destino não há o que gravar." >&2; exit 1; }
  _require_git_date
  _init_ledger
  result="$(node - "$LF" "$id" "$to" "$GIT_DATE_NOW" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, id, to, now] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
const e = (data.entries || []).find((x) => x.id === id);
if (!e) { console.error('entrada ' + id + ' não encontrada'); process.exit(1); }
e.assigned_to = to;
e.assigned_at = now;
e.updated_at = now;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$LF" "$result"
  _render
  echo "OK assign — $id -> $to"
  ;;

pause)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  by=""; checkpoint=""
  PAUSE_FLAGS="--by --checkpoint"
  while [ $# -gt 0 ]; do case "$1" in
    --by) _require_value "pause" --by "${2-}" "$PAUSE_FLAGS"; by="$2"; shift 2 ;;
    --checkpoint) _require_value "pause" --checkpoint "${2-}" "$PAUSE_FLAGS"; checkpoint="$2"; shift 2 ;;
    *) _reject_unknown "pause" "$PAUSE_FLAGS" "$1" ;;
  esac; done
  [ -n "$by" ] || { echo "FAIL: ledger-ops: '--by <LDG-ID>' obrigatório em 'pause' — sem saber QUAL emergência pausou o item, 'paused_by' não tem o que apontar. Declare o id da entrada EMERGENCIAL que está preemptando este trabalho." >&2; exit 1; }
  [ -n "$checkpoint" ] || { echo "FAIL: ledger-ops: '--checkpoint \"<texto>\"' obrigatório em 'pause' — sem checkpoint, quem retomar não sabe onde a sessão interrompida parou. Registre 1-2 linhas." >&2; exit 1; }
  _require_git_date
  _init_ledger
  set +e
  result="$(node - "$LF" "$id" "$by" "$checkpoint" "$GIT_DATE_NOW" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, id, by, checkpoint, now] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
const e = (data.entries || []).find((x) => x.id === id);
if (!e) { console.error('entrada ' + id + ' não encontrada'); process.exit(1); }
const emergencia = (data.entries || []).find((x) => x.id === by);
if (!emergencia) { console.error("FAIL: ledger-ops: pause --by '" + by + "' não encontrada — declare o id de uma entrada existente."); process.exit(1); }
if (emergencia.priority !== 'EMERGENCIAL') { console.error("FAIL: ledger-ops: pause --by '" + by + "' não tem priority EMERGENCIAL (tem '" + (emergencia.priority || '(nenhuma)') + "') — só uma entrada EMERGENCIAL pode preemptar outro trabalho em andamento."); process.exit(1); }
if (e.paused_by) { console.error("FAIL: ledger-ops: " + id + " já está pausada por " + e.paused_by + " desde " + e.paused_at + " — resume antes de pausar de novo."); process.exit(1); }
e.paused_by = by;
e.paused_at = now;
e.checkpoint = checkpoint;
e.updated_at = now;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"; node_rc=$?
  set -e
  [ "$node_rc" -eq 0 ] || exit "$node_rc"
  _write_json "$LF" "$result"
  _render
  echo "OK pause — $id pausada por $by"
  ;;

resume)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  [ $# -eq 0 ] || { echo "FAIL: ledger-ops: 'resume' não aceita flags — $*" >&2; exit 1; }
  _require_git_date
  _init_ledger
  set +e
  result="$(node - "$LF" "$id" "$GIT_DATE_NOW" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, id, now] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
const e = (data.entries || []).find((x) => x.id === id);
if (!e) { console.error('entrada ' + id + ' não encontrada'); process.exit(1); }
if (!e.paused_by) { console.error('FAIL: ledger-ops: ' + id + " não está pausada (sem 'paused_by') — nada para retomar."); process.exit(1); }
e.paused_by = null;
e.paused_at = null;
e.checkpoint = null;
e.updated_at = now;
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"; node_rc=$?
  set -e
  [ "$node_rc" -eq 0 ] || exit "$node_rc"
  _write_json "$LF" "$result"
  _render
  echo "OK resume — $id retomada"
  ;;

harvest)
  change_id="${1:-}"; shift || true
  [ -n "$change_id" ] || { echo "WARN: harvest sem change-id — nada colhido" >&2; exit 0; }
  origin="close"
  while [ $# -gt 0 ]; do case "$1" in
    --origin) _require_value "harvest" --origin "${2-}" "--origin"; origin="$2"; shift 2 ;;
    *) _reject_unknown "harvest" "--origin" "$1" "harvest é best-effort quanto ao CONTEÚDO (change ausente devolve 0 e rc 0), nunca quanto ao USO: flag desconhecida é erro de quem chama, e engoli-la publicaria a colheita sob a origem errada." ;;
  esac; done
  _validate_enum_field "$SCHEMA" "source.origin" "$origin" "origin"
  spec_dir="$ROOT/.forge/specs/active/$change_id"
  # best-effort: sem pasta do change, não há o que colher — nunca falha o caller (close/archive).
  [ -d "$spec_dir" ] || { echo "OK harvest $change_id — 0 nova(s) (change não encontrado)"; exit 0; }
  now="$(_git_date)"
  # harvest NUNCA falha o caller (close/archive dependem disso) — mas gravar created_at="" seria a
  # MESMA classe de falha que esta issue existe para eliminar. Sem data de commit HEAD, degrada
  # para "0 nova(s)" honesto sobre a causa, em vez de recusar (quebraria o contrato) ou carimbar em
  # branco (reintroduziria o defeito).
  [ -n "$now" ] || { echo "OK harvest $change_id — 0 nova(s) (sem data de commit HEAD em '$ROOT' — repositório git sem nenhum commit ainda)"; exit 0; }
  _init_ledger
  before="$(node -e "const d=JSON.parse(require('fs').readFileSync('$LF','utf8'));console.log((d.entries||[]).length)")"
  result="$(node - "$LF" "$change_id" "$origin" "$spec_dir" "$now" <<'NODEEOF'
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const [, , lf, changeId, origin, specDir, now] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
if (!Array.isArray(data.entries)) data.entries = [];
const seen = new Set(data.entries.map((e) => e.dedup_key).filter(Boolean));
let max = data.entries.reduce((m, e) => { const n = parseInt((e.id || '').replace('LDG-', ''), 10); return Number.isFinite(n) && n > m ? n : m; }, 0);

const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const candidates = [];

// (1) Deferrals — JSON estruturado, o caminho mais confiável.
try {
  const dj = JSON.parse(readText(join(specDir, 'deferrals.json')) || '{}');
  for (const d of (dj.deferrals || [])) {
    if (d.status === 'open') candidates.push({ type: 'follow-up', title: d.description || d.reason || d.id, detail: d.reason || '', severity: null, ref: d.id });
    else if (d.status === 'wont-fix') candidates.push({ type: 'tech-debt', title: d.description || d.reason || d.id, detail: d.reason || '', severity: null, ref: d.id });
    // resolved/tested: tratados dentro do change — não colhe.
  }
} catch { /* best-effort */ }

// (2) analysis.md — findings MEDIUM/LOW da tabela pipe (BLOCKER/HIGH são gate-resolvidos antes).
const analysis = readText(join(specDir, 'analysis.md'));
if (analysis) {
  for (const line of analysis.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const sevIdx = cells.findIndex((c) => /^(MEDIUM|LOW)$/.test(c));
    if (sevIdx < 0) continue;
    const severity = cells[sevIdx];
    const idCell = cells.slice(1, sevIdx).find((c) => c && !/^-+$/.test(c)) || '';
    const rest = cells.slice(sevIdx + 1).filter((c) => c && !/^-+$/.test(c));
    const title = (rest.join(' — ') || idCell || 'finding').slice(0, 200);
    const ref = idCell || `analysis-L${analysis.split('\n').indexOf(line) + 1}`;
    candidates.push({ type: 'tech-debt', title, detail: '', severity, ref });
  }
}

// (3) verification.md — follow-up EXPLICITAMENTE marcado. Antes (LDG-0140), qualquer bullet sob
// um heading que casasse /desvios|ressalvas|observa/i virava entrada, sem distinguir uma ressalva
// ABERTA de uma linha que apenas NARRA algo já concluído: foi assim que LDG-0111..LDG-0114
// nasceram 100% duplicadas de itens já resolvidos, para o operador do `close` desfazer à mão —
// o oposto do "não-bloqueante" que o harvest promete. É a mesma classe de LDG-0062 (heurística
// de texto sem entender semântica), e a saída é a mesma daquele item: pedir que o autor MARQUE,
// em vez de adivinhar. Duas portas de marcação, nenhuma inferida:
//   - bullet prefixado por `PENDENTE:` sob qualquer heading de ressalva; ou
//   - qualquer bullet sob um heading dedicado `Follow-ups abertos`.
// Mais um dedupe barato: bullet que cita um `LDG-00NN` entre crases já tem registro próprio.
const verification = readText(join(specDir, 'verification.md'));
if (verification) {
  const lines = verification.split('\n');
  let mode = 'none', n = 0;
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (/follow-?ups?\s+abertos/i.test(line)) mode = 'dedicated';
      else if (/desvios|ressalvas|observa/i.test(line)) mode = 'loose';
      else mode = 'none';
      continue;
    }
    if (mode === 'none' || !/^\s*[-*]\s+/.test(line)) continue;
    let title = line.replace(/^\s*[-*]\s+/, '').trim();
    const marked = /^(\*\*|__)?PENDENTE(\*\*|__)?\s*:/i.test(title);
    if (mode === 'loose' && !marked) continue;
    if (/`LDG-\d{4}`/.test(title)) continue;
    title = title.replace(/^(\*\*|__)?PENDENTE(\*\*|__)?\s*:\s*/i, '').trim().slice(0, 200);
    if (title) candidates.push({ type: 'follow-up', title, detail: '', severity: null, ref: `verify-${++n}` });
  }
}

for (const c of candidates) {
  const dedup = `${changeId}:${c.ref}`;
  if (seen.has(dedup)) continue;
  seen.add(dedup);
  max += 1;
  const id = 'LDG-' + String(max).padStart(4, '0');
  data.entries.push({
    id, type: c.type, title: c.title, detail: c.detail || '',
    severity: c.severity || null, priority: null, status: 'open',
    source: { change_id: changeId, origin, ref: c.ref },
    links: { adr: [], capability: [], change: [changeId], promoted_to: null },
    created_at: now, updated_at: null, resolved_at: null, dedup_key: dedup,
  });
}
console.log(JSON.stringify(data, null, 2));
NODEEOF
)"
  _write_json "$LF" "$result"
  _render
  after="$(node -e "const d=JSON.parse(require('fs').readFileSync('$LF','utf8'));console.log((d.entries||[]).length)")"
  echo "OK harvest $change_id ($origin) — $((after - before)) nova(s) entrada(s) no ledger"
  ;;

# stale — sinal determinístico de idade (change add-ledger-evidence-aging, REQ-05). Porta de
# LEITURA: lista as entradas ativas sem reverificação há mais de N dias. NÃO-BLOQUEANTE por padrão
# (rc 0 com ou sem itens envelhecidos, como manda ledger-consultation.md); só `--strict`, pedido em
# letra, devolve rc 1 — é a porta para quem quiser travar em CI. rc 2 = uso inválido (limiar ou
# --as-of ilegível, ou sem commit HEAD e sem --as-of). O cálculo vive em lib/ledger-aging.mjs, a
# fonte única também do sufixo do `status`, da marca do `list` e (por delegação) do doctor.
stale)
  s_days=""; s_asof=""; s_strict=""
  STALE_FLAGS="--days --as-of --strict"
  while [ $# -gt 0 ]; do case "$1" in
    --days) _require_value "stale" --days "${2-}" "$STALE_FLAGS"; s_days="$2"; shift 2 ;;
    --as-of) _require_value "stale" --as-of "${2-}" "$STALE_FLAGS"; s_asof="$2"; shift 2 ;;
    --strict) s_strict="1"; shift ;;
    *) _reject_unknown "stale" "$STALE_FLAGS" "$1" ;;
  esac; done
  _resolve_stale_days "$s_days" || { echo "$STALE_ERR" >&2; exit 2; }
  if [ -n "$s_asof" ]; then
    _asof_valid "$s_asof" || { echo "FAIL: ledger-ops: --as-of '$s_asof' não é data ISO-8601 interpretável (ex.: 2026-10-30 ou 2026-10-30T10:00:00-03:00)." >&2; exit 2; }
  else
    # `_git_date` direto, no shell principal: `_require_git_date` sairia com rc 1 e não apontaria a
    # saída que existe aqui (--as-of).
    s_asof="$(_git_date)"
    [ -n "$s_asof" ] || { echo "FAIL: ledger-ops: stale sem data de commit HEAD em '$ROOT' — fora de git ou sem nenhum commit. Passe --as-of <data ISO> para medir contra uma data declarada." >&2; exit 2; }
  fi
  _init_ledger
  set +e
  node "$AGING_LIB" report "$LF" "$s_asof" "$STALE_DAYS" "$STALE_ORIGIN"; s_rc=$?
  set -e
  case "$s_rc" in
    0) exit 0 ;;
    10) [ -n "$s_strict" ] && exit 1; exit 0 ;;
    *) exit "$s_rc" ;;
  esac
  ;;

# show — leitura de uma entrada com a evidência e a cadeia de supersessão (REQ-04). A cadeia anda
# para trás por `supersedes` e para frente por `links.superseded_by`, com conjunto de visitados:
# `supersedes` só nasce no `add`, então a porta não forma ciclo, mas um ledger editado à mão pode
# — e um laço infinito numa porta de leitura travaria /forge:ledger inteiro.
show)
  id="${1:-}"; shift || true
  [ -n "$id" ] || { echo "FAIL: LDG-id obrigatório" >&2; exit 1; }
  while [ $# -gt 0 ]; do _reject_unknown "show" "(nenhuma)" "$1"; done
  _init_ledger
  node - "$LF" "$id" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, id] = process.argv;
const data = JSON.parse(readFileSync(lf, 'utf8'));
const byId = new Map((data.entries || []).map((x) => [x.id, x]));
const e = byId.get(id);
if (!e) { console.error("FAIL: ledger-ops: entrada '" + id + "' não encontrada."); process.exit(1); }
const day = (s) => (s ? String(s).slice(0, 10) : '');
const tag = [e.priority, e.severity].filter(Boolean).join('/');
const out = [];
out.push(`${e.id} [${e.type}/${e.status}]${tag ? ' (' + tag + ')' : ''} — ${e.title}`);
out.push(`  registrado: ${day(e.created_at)} · ${e.last_verified ? 'reverificado: ' + day(e.last_verified) : 'nunca reverificado'}`);
const ev = Array.isArray(e.evidence) ? e.evidence : [];
if (ev.length) {
  out.push('  evidência:');
  ev.forEach((x, i) => out.push(`    ${i + 1}. ${day(x.at)} ${x.verdict} ${x.kind} ${x.ref} — ${x.observed}`));
}
// Cadeia: para trás até a raiz, para frente até a ponta.
const back = []; const seen = new Set([id]); let defect = ''; const naoReciproco = [];
for (let cur = e; cur && cur.supersedes; ) {
  const prev = cur.supersedes;
  if (seen.has(prev)) { defect = `(ciclo em ${prev})`; break; }
  seen.add(prev);
  const p = byId.get(prev);
  if (!p) { defect = `(elo quebrado: ${prev} não existe)`; back.unshift(prev); break; }
  // Elo recíproco: quem é substituído aponta de volta para quem o substitui.
  const volta = p.links && p.links.superseded_by;
  // Não interrompe a caminhada: um ciclo adiante continua sendo nomeado.
  if (volta !== cur.id) naoReciproco.push(`(elo não recíproco: ${cur.id} substitui ${prev}, que aponta ${volta || 'nenhum sucessor'})`);
  back.unshift(prev); cur = p;
}
const fwd = []; let fdefect = '';
for (let cur = e; cur && cur.links && cur.links.superseded_by; ) {
  const next = cur.links.superseded_by;
  if (seen.has(next)) { fdefect = `(ciclo em ${next})`; break; }
  seen.add(next);
  const n = byId.get(next);
  if (!n) { fdefect = `(elo quebrado: ${next} não existe)`; fwd.push(next); break; }
  fwd.push(next); cur = n;
}
const chain = [...back, `[${id}]`, ...fwd];
// Um mesmo ciclo é visto pelas duas direções; nomeá-lo duas vezes seria ruído.
const doisCiclos = defect.startsWith('(ciclo') && fdefect.startsWith('(ciclo');
const defects = [...naoReciproco, doisCiclos ? defect : [defect, fdefect].filter(Boolean).join(' ')].filter(Boolean).join(' ');
out.push('  cadeia de supersessão: ' + (chain.length > 1 || defects ? chain.join(' → ') + (defects ? ' ' + defects : '') : '—'));
out.push('  detail:');
for (const l of String(e.detail || '').split('\n')) out.push('    ' + l);
console.log(out.join('\n'));
NODEEOF
  ;;

render)
  _init_ledger; _render; echo "OK $OUT"
  ;;

status)
  _init_ledger
  # Sufixo de envelhecimento (add-ledger-evidence-aging, REQ-06): mesmo módulo, limiar e relógio
  # (commit HEAD) do `stale`. Nunca derruba o /forge:status: sem HEAD ou com limiar inválido, a
  # linha diz por que a idade não foi medida em vez de falhar.
  st_suffix=""
  st_head="$(_git_date)"
  if [ -z "$st_head" ]; then
    st_suffix=" · idade não medida (sem commit HEAD)"
  elif ! _resolve_stale_days ""; then
    st_suffix=" · limiar ledger.stale_days inválido"
  else
    st_sum="$(node "$AGING_LIB" summary "$LF" "$st_head" "$STALE_DAYS")"
    st_k="$(awk '{print $1}' <<<"$st_sum")"; st_j="$(awk '{print $3}' <<<"$st_sum")"
    if [ -n "$st_k" ] && [ "$st_k" -gt 0 ]; then st_suffix=" · $st_k sem reverificação há mais de ${STALE_DAYS}d"; fi
    if [ -n "$st_j" ] && [ "$st_j" -gt 0 ]; then st_suffix="$st_suffix · $st_j inconsistente(s) (ledger-ops.sh stale)"; fi
  fi
  node - "$LF" "$st_suffix" <<'NODEEOF'
const { readFileSync } = require('fs');
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const agingSuffix = process.argv[3] || '';
const CLOSED = new Set(['resolved', 'wont-fix', 'promoted', 'superseded']);
const active = (data.entries || []).filter((e) => !CLOSED.has(e.status));
if (!active.length) { console.log('LEDGER: vazio'); process.exit(0); }
const by = {};
for (const e of active) by[e.type] = (by[e.type] || 0) + 1;
const hi = active.filter((e) => e.severity === 'BLOCKER' || e.severity === 'HIGH' || e.priority === 'P0' || e.priority === 'P1').length;
const parts = Object.keys(by).sort().map((t) => `${t} ${by[t]}`).join(' · ');
console.log(`LEDGER: ${active.length} ativo(s)${hi ? ` (${hi} alta prioridade)` : ''} · ${parts}${agingSuffix}`);
NODEEOF
  ;;

list)
  f_status=""; f_type=""; top=""; by_priority=""; f_assigned=""
  LIST_FLAGS="--status --type --top --by-priority --assigned"
  while [ $# -gt 0 ]; do case "$1" in
    --status) _require_value "list" --status "${2-}" "$LIST_FLAGS"; f_status="$2"; shift 2 ;;
    --type) _require_value "list" --type "${2-}" "$LIST_FLAGS"; f_type="$2"; shift 2 ;;
    --top) _require_value "list" --top "${2-}" "$LIST_FLAGS"; top="$2"; shift 2 ;;
    --by-priority) by_priority="1"; shift ;;
    # Booleana, sem valor — mesmo idioma de --by-priority. Mostra só entradas com assigned_to
    # preenchido: "quem está em quê e com que peso agora", para comparar contra um pedido novo
    # antes de decidir preempção (fila de priorização entre sessões do squad).
    --assigned) f_assigned="1"; shift ;;
    *) _reject_unknown "list" "$LIST_FLAGS" "$1" ;;
  esac; done
  _init_ledger
  # Marca de envelhecimento (add-ledger-evidence-aging, REQ-06): é por aqui que /forge:resume e o
  # hook SessionStart (ambos chamam `list --status open --by-priority --top 5`) recebem o item
  # envelhecido marcado, sem depender de alguém lembrar do `stale`. Degrada sem mudar o rc.
  l_ages=""
  l_head="$(_git_date)"
  if [ -z "$l_head" ]; then
    echo "WARN: ledger-ops: list sem marca de envelhecimento — sem data de commit HEAD em '$ROOT'." >&2
  elif ! _resolve_stale_days ""; then
    echo "WARN: ledger-ops: list sem marca de envelhecimento — $STALE_ERR" >&2
  else
    l_ages="$(node "$AGING_LIB" ages "$LF" "$l_head" "$STALE_DAYS")"
  fi
  node - "$LF" "$f_status" "$f_type" "$top" "$by_priority" "$l_ages" "$f_assigned" <<'NODEEOF'
const { readFileSync } = require('fs');
const [, , lf, fStatus, fType, topRaw, byPriority, agesRaw, fAssigned] = process.argv;
const ages = new Map(String(agesRaw || '').split('\n').filter(Boolean).map((l) => l.split(' ')));
const data = JSON.parse(readFileSync(lf, 'utf8'));
let items = data.entries || [];
if (fStatus) items = items.filter((e) => e.status === fStatus);
if (fType) items = items.filter((e) => e.type === fType);
if (fAssigned) items = items.filter((e) => e.assigned_to);
const PR = { EMERGENCIAL: -1, P0: 0, P1: 1, P2: 2, P3: 3 };
const SV = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const rank = (m, v) => (v != null && m[v] != null ? m[v] : 99);
if (byPriority) items = items.slice().sort((a, b) => (rank(PR, a.priority) - rank(PR, b.priority)) || (rank(SV, a.severity) - rank(SV, b.severity)) || a.id.localeCompare(b.id));
const top = parseInt(topRaw, 10);
if (Number.isFinite(top) && top > 0) items = items.slice(0, top);
if (!items.length) { console.log('(nenhuma entrada)'); process.exit(0); }
for (const e of items) {
  const tag = [e.priority, e.severity].filter(Boolean).join('/');
  // Ordem canônica dos sufixos (design §8): substitui, reverificado, sem reverificação.
  const sup = e.supersedes ? ` (substitui ${e.supersedes})` : '';
  const ver = e.last_verified ? ` · reverificado em ${String(e.last_verified).slice(0, 10)}` : '';
  const ag = ages.get(e.id);
  const old = ag === '!' ? ' · inconsistente (motivo em ledger-ops.sh stale)' : (ag ? ` · sem reverificação há ${ag}d` : '');
  // Fila de priorização: assigned_to/paused_by só aparecem quando preenchidos — item sem nenhum
  // dos dois (a maioria, hoje) imprime exatamente como antes, sem sufixo novo.
  const asg = e.assigned_to ? ` · atribuído a ${e.assigned_to}` : '';
  const pau = e.paused_by ? ` · PAUSADA por ${e.paused_by} (checkpoint: ${e.checkpoint || '(vazio)'})` : '';
  console.log(`${e.id} [${e.type}/${e.status}]${tag ? ' (' + tag + ')' : ''} — ${e.title}${sup}${ver}${old}${asg}${pau}`);
}
NODEEOF
  ;;

*)
  echo "FAIL: comando desconhecido '$cmd'" >&2; exit 1
  ;;
esac
