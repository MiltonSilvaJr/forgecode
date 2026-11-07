#!/usr/bin/env bash
# Forge PostToolUse (opt-in via forge.yaml liaison.auto + liaison.baton.auto_renew, ausente vale
# true) — renovação automática do bastão enquanto a sessão titular está ativa (REQ-12, design
# §2.8). Dispara em toda ferramenta (matcher '.*'). NUNCA bloqueia: sai sempre rc 0.
#
# Caminho rápido (NFR-02, ≤150 ms p95): sem bastão detido por esta sessão, ou sem nenhum ainda na
# hora de renovar, lê baton-local.json via jq/python3 (nunca `node`) e sai. Só cai no caminho
# frio (roda a dobra via node e regrava o cache) quando o cache está ausente ou o tamanho/mtime
# do log próprio mudou por fora (claim nova, renovação manual, reescrita) — ou quando de fato
# renova (chama `liaison-ops.sh baton renew`, que já é node).
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
LIAISON_ROOT="$ROOT"
case "$_common" in /*) LIAISON_ROOT="$(dirname "$_common")" ;; esac

FORGE_YAML="$ROOT/.forge/forge.yaml"
LIAISON_DIR="$LIAISON_ROOT/.forge/liaison"
LIAISON_YAML="$LIAISON_DIR/liaison.yaml"
OPS="$LIAISON_ROOT/.forge/scripts/liaison-ops.sh"

# liaison.auto — mesma leitura de on-session-start.sh (awk puro, sem node).
_yaml_auto() {
  [ -f "$FORGE_YAML" ] || { echo ""; return; }
  awk -v key="$1" '
    $0 ~ "^"key":" { inblk=1; next }
    inblk && /^[a-z_]+:/ { exit }
    inblk && /^[ ]+auto:[ ]*(true|false)/ { sub(/^[ ]+auto:[ ]*/, ""); print; exit }
  ' "$FORGE_YAML"
}
[ "$(_yaml_auto liaison)" = "true" ] || exit 0

# liaison.baton.auto_renew — ausência VALE true (design §2.6); só 'false' explícito desliga.
_baton_auto_renew_false() {
  [ -f "$FORGE_YAML" ] || { echo "no"; return; }
  awk '
    $0 ~ /^liaison:/ { f=1; next }
    f && $0 ~ /^[a-zA-Z]/ { f=0 }
    f && $0 ~ /^[ ]+baton:/ { b=1; next }
    f && b && $0 ~ /^[ ]{0,2}[a-zA-Z_]+:/ { b=0 }
    f && b && $0 ~ /^[ ]+auto_renew:[ ]*false/ { print "yes"; exit }
  ' "$FORGE_YAML"
}
[ "$(_baton_auto_renew_false)" = "yes" ] && exit 0

[ -f "$OPS" ] || exit 0
[ -f "$LIAISON_YAML" ] || exit 0

input="$(cat)"
session_id=""
if command -v jq >/dev/null 2>&1; then
  session_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)"
fi
if [ -z "$session_id" ] && command -v python3 >/dev/null 2>&1; then
  session_id="$(printf '%s' "$input" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("session_id") or "")
except Exception:
    print("")
' 2>/dev/null)"
fi
[ -n "$session_id" ] || exit 0

self="$(awk '/^self:/{f=1;next} f && /^[ ]+id:/{sub(/^[ ]+id:[ ]*/,"");print;exit}' "$LIAISON_YAML" 2>/dev/null)"
[ -n "$self" ] || exit 0

_stat_size() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1" 2>/dev/null || echo 0; }
_stat_mtime_ms() {
  local s
  s="$(stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0)"
  printf '%s000\n' "$s"
}

now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# PLAT-205: TODA trava tomada pelo gancho (a do log próprio no `baton renew` e a local do canal em
# _rebuild_cold, _remove_holder_entry, _mark_warned_once e _consume_publish_results) espera no
# máximo 300 ms (liaison-protocol.md), nunca o default de 10 s do withLocalLock: o gancho roda em
# todo evento e não pode prender a sessão competindo com um `sync` em segundo plano.
HOOK_LOCK_WAIT_MS=300
# PLAT-202: teto do laço de conferência do push no processo DESTACADO (liaison-protocol.md: 25 s);
# sem ele vale o default de 300 s do `sync` manual, e o vigia de 30 s viraria o caminho normal.
HOOK_PUSH_DEADLINE_S=25

_extract_holders() { # _extract_holders <cachefile> <session_id> -> linhas TSV: baton_id\tleaseUntil\tnextRenewAt\townLogSize\townLogMtimeMs
  local cachefile="$1" sid="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg sid "$sid" '
      (.holders // {}) | to_entries[] | select(.value.session == $sid) |
      [.key, .value.leaseUntil, .value.nextRenewAt, (.value.ownLogSize|tostring), (.value.ownLogMtimeMs|tostring)] | @tsv
    ' "$cachefile" 2>/dev/null
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import sys, json
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
except Exception:
    sys.exit(0)
sid = sys.argv[2]
for k, v in (d.get("holders") or {}).items():
    if v.get("session") == sid:
        print("\t".join([k, str(v.get("leaseUntil","")), str(v.get("nextRenewAt","")), str(v.get("ownLogSize","")), str(v.get("ownLogMtimeMs",""))]))
' "$cachefile" "$sid" 2>/dev/null
  fi
}

_rebuild_cold() { # _rebuild_cold <channel> <chdir> -- roda a dobra via node e regrava holders
  local channel="$1" chdir="$2"
  local libdir="$LIAISON_ROOT/.forge/scripts/lib"
  FORGE_LIAISON_LOCK_WAIT_MS="$HOOK_LOCK_WAIT_MS" node - "$LIAISON_ROOT" "$channel" "$chdir" "$self" "$libdir" <<'NODEEOF' >/dev/null 2>&1
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , root, channel, chDir, self, lib] = process.argv;
  const { rebuildHolders } = await import(pathToFileURL(join(lib, 'liaison-baton-local.mjs')).href);
  try { await rebuildHolders({ root, channel, chDir, self }); } catch { /* best-effort — nunca bloqueia o gancho */ }
})();
NODEEOF
}

_remove_holder_entry() { # _remove_holder_entry <channel> <baton_id> -- design §2.8: toda recusa
  # de renew no modo IF_DUE (not-holder ou lease vencido) apaga SÓ a entrada deste bastão no
  # cache, nunca o canal inteiro. Diferente de _rebuild_cold: a dobra ainda pode dizer que este
  # repositório "detém" um bastão de lease vencido (REQ-06: titular com lease vencido continua
  # titular até liberar/concluir/perder para outra claim) — um `_rebuild_cold` reconstruiria a
  # MESMA entrada de volta. `removeHolder` tira a entrada do CACHE de qualquer forma, para o
  # gancho parar de tentar renovar uma lease perdida a cada evento.
  local channel="$1" baton_id="$2"
  local libdir="$LIAISON_ROOT/.forge/scripts/lib"
  FORGE_LIAISON_LOCK_WAIT_MS="$HOOK_LOCK_WAIT_MS" node - "$LIAISON_ROOT" "$channel" "$self" "$baton_id" "$libdir" <<'NODEEOF' >/dev/null 2>&1
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const [, , root, channel, self, batonId, lib] = process.argv;
  const { removeHolder } = await import(pathToFileURL(join(lib, 'liaison-baton-local.mjs')).href);
  try { await removeHolder({ root, channel, self, batonId }); } catch { /* best-effort */ }
})();
NODEEOF
}

_mark_warned_once() { # _mark_warned_once <channel> <chave> -> rc 0 se é a PRIMEIRA vez (deve avisar)
  # Ler, decidir e gravar acontecem SOB a trava local do canal (withLocalLock, ARCH-001): com o
  # `grep` fora da trava e a gravação depois, dois eventos concorrentes liam "ainda não avisado" e
  # avisavam os dois. Falha da trava ou do node não avisa (rc 1): o aviso é melhor esforço, e um
  # aviso repetido é pior do que um adiado para o próximo evento.
  local channel="$1" chave="$2"
  local warnfile="$LIAISON_ROOT/.forge/cache/liaison-baton/$channel/warned.json"
  local libdir="$LIAISON_ROOT/.forge/scripts/lib"
  mkdir -p "$(dirname "$warnfile")" 2>/dev/null
  FORGE_LIAISON_LOCK_WAIT_MS="$HOOK_LOCK_WAIT_MS" node - "$LIAISON_ROOT" "$channel" "$self" "$warnfile" "$chave" "$libdir" <<'NODEEOF' >/dev/null 2>&1
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const fs = require('fs');
  const [, , root, channel, self, path, key, lib] = process.argv;
  const { withLocalLock } = await import(pathToFileURL(join(lib, 'liaison-lock.mjs')).href);
  const first = await withLocalLock({ root, channel, self }, () => {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(path, 'utf8')); } catch { /* ausente ou ilegível: recomeça */ }
    if (state[key]) return false;
    state[key] = true;
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, path);
    return true;
  });
  process.exit(first ? 0 : 1);
})().catch(() => process.exit(1));
NODEEOF
}

# PLAT-203: os avisos do evento são ACUMULADOS e emitidos uma única vez, no fim (`_flush_context`).
# Um objeto JSON por aviso dentro dos laços punha dois documentos no stdout quando dois avisos
# caíam no mesmo evento — e o Claude Code descarta o additionalContext de um stdout que não é UM
# documento JSON.
HOOK_CONTEXT=""
_emit_context() { # _emit_context <texto> — acumula; a emissão é de _flush_context
  if [ -n "$HOOK_CONTEXT" ]; then HOOK_CONTEXT="$HOOK_CONTEXT"$'\n'"$1"; else HOOK_CONTEXT="$1"; fi
}
_flush_context() { # um único objeto hookSpecificOutput, com os avisos concatenados
  [ -n "$HOOK_CONTEXT" ] || return 0
  node -e 'console.log(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:process.argv[1]}}))' "$HOOK_CONTEXT" 2>/dev/null
}

# _claim_msgid <cachefile> <baton_id> — msg_id da claim que deu a posse deste bastão
# (`claims[batonId].msgId` do baton-local.json); vazio se não houver. Lido ANTES de
# `_remove_holder_entry` para compor a chave do aviso de perda (LGC-202).
_claim_msgid() {
  node -e '
try {
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const c = (s.claims || {})[process.argv[2]];
  process.stdout.write(c && typeof c.msgId === "string" ? c.msgId : "");
} catch { /* ausente ou ilegível: chave sem claim */ }
' "$1" "$2" 2>/dev/null
}

_consume_publish_results() { # _consume_publish_results <channel> -- design S2.4/S2.8: o
  # publish-result-<pid>.json do processo destacado (e de qualquer sync manual) é consolidado
  # SOB A TRAVA LOCAL pelo primeiro leitor que passar por aqui — mantém só o mais recente, apaga
  # os demais, e avisa (uma vez por falha) quando o resultado consolidado tem rc != 0.
  local channel="$1"
  local resultdir="$LIAISON_ROOT/.forge/cache/liaison-baton/$channel"
  ls "$resultdir"/publish-result-*.json >/dev/null 2>&1 || return 0
  local libdir="$LIAISON_ROOT/.forge/scripts/lib"
  FORGE_LIAISON_LOCK_WAIT_MS="$HOOK_LOCK_WAIT_MS" node - "$LIAISON_ROOT" "$channel" "$resultdir" "$libdir" <<'NODEEOF' 2>/dev/null
const { join } = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const fs = require('fs');
  const [, , root, channel, resultDir, lib] = process.argv;
  const { withLocalLock } = await import(pathToFileURL(join(lib, 'liaison-lock.mjs')).href);
  const self = process.env.FORGE_BATON_SELF || '';
  await withLocalLock({ root, channel, self }, () => {
    const files = fs.readdirSync(resultDir).filter((f) => /^publish-result-\d+\.json$/.test(f));
    if (!files.length) return;
    let latest = null, latestMtime = -1;
    for (const f of files) {
      const p = join(resultDir, f);
      const st = fs.statSync(p);
      if (st.mtimeMs > latestMtime) { latestMtime = st.mtimeMs; latest = p; }
    }
    let result = null;
    try { result = JSON.parse(fs.readFileSync(latest, 'utf8')); } catch { /* ignora, só limpa */ }
    for (const f of files) { try { fs.unlinkSync(join(resultDir, f)); } catch { /* best-effort */ } }
    if (result && Number(result.rc) !== 0) {
      process.stdout.write(JSON.stringify({ failed: true, at: result.at }));
    }
  });
})();
NODEEOF
}

for chdir in "$LIAISON_DIR"/*/; do
  [ -d "$chdir/log" ] || continue
  channel="$(basename "$chdir")"
  cachefile="$LIAISON_ROOT/.forge/cache/liaison-baton/$channel/baton-local.json"

  pr_out="$(FORGE_BATON_SELF="$self" _consume_publish_results "$channel")"
  if [ -n "$pr_out" ] && echo "$pr_out" | grep -q '"failed":true'; then
    # Chave inclui o instante ('at') da falha consolidada -- uma falha NOVA (instante diferente)
    # precisa de aviso novo; sem isso, a primeira falha calaria o aviso de qualquer falha futura
    # no mesmo canal para sempre.
    pr_at="$(printf '%s' "$pr_out" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{process.stdout.write(JSON.parse(d).at||"");}catch{process.stdout.write("");}})' 2>/dev/null)"
    pr_key="pubfail:$channel:$pr_at"
    if _mark_warned_once "$channel" "$pr_key"; then
      _emit_context "LIAISON baton: a última publicação em '$channel' falhou (processo destacado da renovação ou sync manual) — rode 'sync $channel' para tentar de novo."
    fi
  fi

  if [ ! -f "$cachefile" ]; then
    _rebuild_cold "$channel" "$chdir"
  fi
  [ -f "$cachefile" ] || continue

  while IFS=$'\t' read -r baton_id lease_until next_renew_at own_size own_mtime; do
    [ -n "$baton_id" ] || continue
    own_log="$chdir/log/$self.jsonl"
    cur_size="$(_stat_size "$own_log")"
    cur_mtime="$(_stat_mtime_ms "$own_log")"
    if [ "$cur_size" != "$own_size" ] || [ "$cur_mtime" != "$own_mtime" ]; then
      _rebuild_cold "$channel" "$chdir"
      continue 2 # cache mudou -- próxima passada deste canal (loop externo não reitera; aceitável: próximo evento revalida)
    fi
    if [[ "$now_iso" < "$next_renew_at" ]]; then
      continue
    fi
    # Configuração só é lida (e validada) AQUI — no caminho que de fato vai renovar (design
    # §2.8: "lida só quando o gancho vai chamar node"). renew em si NUNCA lê liaison.baton
    # (REQ-06: só offer/claim leem) — é o GANCHO quem recusa renovar com configuração inválida,
    # sem tocar o cache, para não mascarar o erro regravando next_renew_at como se nada tivesse
    # acontecido.
    cfg_errors="$(node -e '
const { join } = require("path");
const { pathToFileURL } = require("url");
(async () => {
  const { readBatonConfig } = await import(pathToFileURL(join(process.argv[2], "liaison-baton.mjs")).href);
  const cfg = readBatonConfig(process.argv[1]);
  process.stdout.write(cfg.errors.join("; "));
})();
' "$FORGE_YAML" "$LIAISON_ROOT/.forge/scripts/lib" 2>/dev/null)"
    if [ -n "$cfg_errors" ]; then
      echo "[HOOK] on-post-tool-use: liaison.baton inválido ($cfg_errors) — não renova '$baton_id' em '$channel'" >&2
      continue
    fi
    renew_out="$(FORGE_BATON_RENEW_IF_DUE=1 FORGE_LIAISON_LOCK_WAIT_MS="$HOOK_LOCK_WAIT_MS" FORGE_ROOT="$LIAISON_ROOT" bash "$OPS" baton renew "$channel" "$baton_id" --session "$session_id" 2>&1)"
    renew_rc=$?
    if [ "$renew_rc" -eq 0 ]; then
      sync_line="$(printf '%s\n' "$renew_out" | grep -E '^liaison-ops\.sh sync .* --push-only$' || true)"
      if [ -n "$sync_line" ]; then
        # Processo destacado (design §2.8): `set -m` DENTRO do bash -c desacoplado dá ao `sync`
        # que ele lança um grupo de processos próprio (job control), para que `kill -TERM -$pgid`
        # alcance o grupo inteiro (node, git, qualquer descendente) — sem timeout(1)/setsid(1),
        # que não existem no macOS por padrão (NFR-01). `disown` tira o job desta shell depois de
        # lançado, para que o fim do gancho nunca espere nem mate o destacado.
        resultfile="$LIAISON_ROOT/.forge/cache/liaison-baton/$channel/publish-result-$$"
        nohup bash -c '
          set -m
          FORGE_LIAISON_PUSH_DEADLINE_S="$5" FORGE_ROOT="$1" bash "$2" sync "$3" --push-only > "$4.out" 2>&1 &
          child=$!
          ( sleep 30; kill -TERM -"$child" 2>/dev/null; sleep 5; kill -KILL -"$child" 2>/dev/null ) &
          wait "$child"
        ' _ "$LIAISON_ROOT" "$OPS" "$channel" "$resultfile" "$HOOK_PUSH_DEADLINE_S" >/dev/null 2>&1 &
        disown 2>/dev/null || true
      fi
    elif [ "$renew_rc" -eq 4 ]; then
      # PERDA REAL (rc 4 do renew: não é a titular corrente, ou o lease venceu) -- apaga a entrada
      # do cache e avisa uma vez por ocorrência (design §2.8). Só este rc: os demais têm remédio
      # oposto (ARCH-001), e tratá-los como perda parava a renovação automática da titular.
      # LGC-202: a chave inclui a claim que deu a posse (lida ANTES de tirar a entrada). Só com o
      # bastão, a segunda perda (perde, reivindica de novo, perde) caía na chave já gravada e calava.
      claim_msg="$(_claim_msgid "$cachefile" "$baton_id")"
      _remove_holder_entry "$channel" "$baton_id"
      key="lost:$channel:$baton_id:${claim_msg:-?}"
      if _mark_warned_once "$channel" "$key"; then
        _emit_context "LIAISON baton: perdeu a titularidade de '$baton_id' no canal '$channel' (rode 'baton status $channel $baton_id' para ver quem detém agora)."
      fi
    elif [ "$renew_rc" -eq 5 ]; then
      # Ainda não é hora (rc 5): o cache achava que era (outro evento acabou de renovar, ou o
      # next_renew_at estava defasado). Regrava a entrada a partir da dobra, sem aviso.
      _rebuild_cold "$channel" "$chdir"
    else
      # Erro ou transitório (rc 1: trava ocupada, trava perdida, exceção). Não é perda: não toca o
      # cache nem avisa -- o próximo evento tenta de novo. Só um registro em stderr.
      echo "[HOOK] on-post-tool-use: renovação de '$baton_id' em '$channel' não aconteceu agora (rc $renew_rc) — tenta de novo no próximo evento" >&2
    fi
  done < <(_extract_holders "$cachefile" "$session_id")
done

_flush_context
exit 0
