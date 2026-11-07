#!/usr/bin/env bash
# doctor.sh — verifica a tooling de diagnóstico (e LSP, informativo) por stack
# presente no repositório. Por padrão apenas REPORTA o que falta; com --install
# tenta instalar os faltantes via o gerenciador de cada stack (opt-in explícito).
#
# Por que existe: as rules de "análise de impacto / LSP" dependem de que o
# DIAGNÓSTICO da stack (compilador / typechecker / linter) esteja instalado —
# esse é o passo que de fato valida uma edição. O LSP server é desejável para
# navegação semântica, mas é secundário. Este script não instala nada sem a
# flag --install e nunca roda automaticamente no init-project.
#
# Uso:
#   bash .forge/scripts/doctor.sh            # só reporta (default)
#   bash .forge/scripts/doctor.sh --install  # reporta e instala faltantes (opt-in)
#
# Saída: código 0 se todos os diagnósticos das stacks detectadas estão OK
#        (no modo report); código 1 se houver diagnóstico faltando.

set -u

INSTALL=0
case "${1:-}" in
  --install) INSTALL=1 ;;
  ""|--report) INSTALL=0 ;;
  -h|--help)
    grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  *) echo "Argumento desconhecido: $1 (use --install ou --report)"; exit 2 ;;
esac

#
# ROOT honra FORGE_ROOT quando setado (convenção compartilhada com heavy-mutex.sh,
# forge-runtime.sh etc. — ver lib/forge-runtime.sh e o mecanismo de dogfood). Sem isso, rodar
# `template/.forge/scripts/doctor.sh` (única cópia existente no dogfood incompleto da raiz deste
# próprio repositório — vd. LDG-0040) sempre resolve ROOT para `template/`, o diretório-fonte do
# pacote — e então o guard de placeholders <PROJECT_*> se autoflagra: FORGE.md/context.md/
# constitution.md em template/.forge SÃO o scaffold ainda não preenchido, por design, o mesmo
# motivo pelo qual .forge/templates/ já é excluído da varredura. Nunca é o projeto que o autor
# pretendia checar. Com FORGE_ROOT setado, `FORGE_ROOT=<repo> bash template/.forge/scripts/
# doctor.sh --report` aponta para o projeto de verdade.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${FORGE_ROOT:-}" ]; then
  ROOT="$(cd "$FORGE_ROOT" && pwd)"
else
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi
cd "$ROOT"

# shellcheck disable=SC1091
. "$SCRIPT_DIR/lib/scan-exclude.sh"

# Resolução do checkout principal — UM sítio, lib/forge-root.sh (LDG-0014: duas implementações do
# mesmo contrato divergindo em silêncio). Usado só pela linha informativa do /forge:kb, abaixo; o
# doctor é diagnóstico (nunca load-bearing), então a ausência da lib não derruba o script — só faz
# a linha do kb cair no fallback (raiz de estado = ROOT) mais abaixo.
if [ -f "$SCRIPT_DIR/lib/forge-root.sh" ]; then
  # shellcheck source=lib/forge-root.sh
  . "$SCRIPT_DIR/lib/forge-root.sh"
fi

# ── helpers ────────────────────────────────────────────────────────────────
if [ -t 1 ]; then GREEN=$'\033[32m'; RED=$'\033[31m'; YEL=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
else GREEN=""; RED=""; YEL=""; DIM=""; RST=""; fi

MISSING_DIAG=0
have() { command -v "$1" >/dev/null 2>&1; }

ok()    { printf "  %s✓%s %s\n" "$GREEN" "$RST" "$1"; }
miss()  { printf "  %s✗%s %s\n" "$RED" "$RST" "$1"; }
info()  { printf "  %s·%s %s\n" "$YEL" "$RST" "$1"; }
warn()  { printf "  %s!%s %s\n" "$YEL" "$RST" "$1"; }
hint()  { printf "      %s↳ %s%s\n" "$DIM" "$1" "$RST"; }

# Detecta stacks por marcadores no repo. Poda a lista compartilhada de scan-exclude.sh (issue
# #149: a lib existia mas não tinha invocador) mais `bin/`, específico deste detector para evitar
# falso marcador dentro de artefato de build (ex.: bin/ do .NET) — `obj` já vem na lista
# compartilhada.
find_marker() {
  local prune=()
  forge_find_prune_args prune
  find . "${prune[@]}" -name bin -prune -o -name "$1" -print 2>/dev/null | head -1
}

# ── Forge harness (§19.1) — roda mesmo sem stack detectada ──────────────────
check_harness() {
  [ -d "$ROOT/.forge" ] || return 0
  echo "Forge harness"

  for f in FORGE.md forge.yaml; do
    if [ -f "$ROOT/.forge/$f" ]; then ok "harness: .forge/$f"
    else miss "harness: .forge/$f ausente"; MISSING_DIAG=1; fi
  done

  if [ -f "$ROOT/AGENTS.md" ]; then
    if head -1 "$ROOT/AGENTS.md" | grep -q 'Generated from .forge/FORGE.md'; then
      ok "harness: AGENTS.md é projeção gerada do FORGE.md"
    else
      info "harness: AGENTS.md sem header de arquivo gerado (rode .forge/scripts/sync-adapters.sh)"
    fi
  else
    miss "harness: AGENTS.md ausente (rode .forge/scripts/sync-adapters.sh)"; MISSING_DIAG=1
  fi

  # root instruction symlinks are owned by their adapter — checked only when the adapter is
  # active (CLAUDE.md↔claude, QWEN.md↔qwen, GEMINI.md↔gemini). An existing link whose adapter
  # is inactive is a stale prune leftover (drift).
  active_adapters="$(awk '/^  adapters:/{g=1;next} g&&/^    - /{print $2;next} g{exit}' "$ROOT/.forge/forge.yaml" 2>/dev/null)"
  adapter_active() { printf '%s\n' "$active_adapters" | grep -qx "$1"; }
  check_link() {  # $1=adapter $2=linkfile
    if adapter_active "$1"; then
      if [ -L "$ROOT/$2" ] && [ "$(readlink "$ROOT/$2")" = "AGENTS.md" ]; then
        ok "harness: $2 -> AGENTS.md (symlink)"
      elif [ -f "$ROOT/$2" ] && head -1 "$ROOT/$2" | grep -q 'Generated from .forge/FORGE.md'; then
        ok "harness: $2 (cópia materializada gerada)"
      else
        miss "harness: $2 não resolve para AGENTS.md"; MISSING_DIAG=1
      fi
    elif [ -e "$ROOT/$2" ] || [ -L "$ROOT/$2" ]; then
      miss "harness: $2 órfão (adapter $1 inativo — rode sync-adapters --adapter all)"; MISSING_DIAG=1
    fi
  }
  check_link claude CLAUDE.md
  check_link qwen QWEN.md
  check_link gemini GEMINI.md

  # As duas checagens abaixo varriam "$ROOT/.forge" inteiro com `grep -rl` e filtravam só a
  # SAÍDA (denylist) — em repositório com worktrees cada worktree é uma cópia completa da árvore
  # (issue #127: 458933 de 465115 arquivos, 98,7% do universo), então o CUSTO da varredura era
  # pago mesmo com o resultado correto, a ponto de o `grep` nunca terminar. Consertar só o custo
  # não bastava: o mesmo modelo de denylist deixava `.forge/liaison/` e `.forge/ledger/` (dado de
  # runtime onde agentes CONVERSAM SOBRE o diretório `.claude/`, não configuração) contarem como
  # vazamento, e cada diretório de dado novo repetiria a mesma classe de falso positivo.
  #
  # Desenho: universo por INCLUSÃO explícita da fonte canônica — as pastas `rules/`, `agents/`,
  # `skills/`, `commands/`, `templates/` e os arquivos que ficam diretamente no topo de
  # `.forge/` (FORGE.md, forge.yaml, constitution.md, context.md, ...). `worktrees/`, `liaison/`,
  # `ledger/`, `specs/`, `product/`, `evals/`, `custom/`, `cache/` e qualquer outro diretório de
  # dado nunca entram no universo, então o `grep` nunca desce lá — não é um filtro de saída mais
  # amplo, é a ausência do caminho na lista de entrada. Alternativa descartada (ampliar a
  # denylist com `liaison|ledger|worktrees`): continua pagando a descida quando o filtro é de
  # saída, e deixa entrar o próximo diretório de dados que alguém criar.
  CANON_SCAN_DIRS="rules agents skills commands templates"
  canon_scan_scope() {
    find "$ROOT/.forge" -maxdepth 1 -type f -print0 2>/dev/null
    for d in $CANON_SCAN_DIRS; do
      [ -d "$ROOT/.forge/$d" ] && find "$ROOT/.forge/$d" -type f -print0 2>/dev/null
    done
  }
  scan_n="$(canon_scan_scope | tr -cd '\0' | wc -c | tr -d ' ')"

  if [ "$scan_n" -eq 0 ]; then
    # Terceiro estado: universo vazio não é "sem refs" nem "N refs" — é a checagem não tendo
    # rodado (projeto sem rules/agents/skills/commands/templates nem arquivo de topo é anômalo).
    miss "harness: universo de varredura da fonte canônica vazio (rules/agents/skills/commands/templates e topo de .forge/ ausentes) — refs .claude/ e placeholders <PROJECT_*> não verificados"
    MISSING_DIAG=1
  else
    # /(adapters|scripts|hooks)/ em qualquer profundidade (inclusive scripts/ dentro de uma
    # skill, ex. skills/*/scripts/scan.sh) e commands/harness/ são os meta-comandos e os scripts
    # de tooling do próprio harness, que legitimamente nomeiam o diretório .claude/ gerado como
    # exemplo de caminho/documentação de mecanismo — não é migração pendente.
    leaks="$(canon_scan_scope | xargs -0 grep -l '\.claude/' 2>/dev/null | grep -vE '/(adapters|scripts|hooks)/|/commands/harness/' | grep -c . || true)"
    if [ "$leaks" -eq 0 ]; then ok "harness: fonte canônica sem refs .claude/ ($scan_n arquivo(s) examinado(s))"
    else miss "harness: $leaks arquivo(s) da fonte canônica com refs .claude/ ($scan_n arquivo(s) examinado(s))"; MISSING_DIAG=1; fi

    # templates/ é o scaffold que /forge:init copia — <PROJECT_*> ali é por desenho, não órfão.
    orphans="$(canon_scan_scope | xargs -0 grep -l '<PROJECT_[A-Z_]*>' 2>/dev/null | grep -vE '/templates/' | grep -c . || true)"
    if [ "$orphans" -eq 0 ]; then ok "harness: sem placeholders <PROJECT_*> órfãos"
    else miss "harness: $orphans arquivo(s) com placeholders <PROJECT_*> não preenchidos"; MISSING_DIAG=1; fi
  fi

  # Versão nova do template pendente de reconciliação (revisão da DH-1): o `update` preserva a maquinaria em deriva local e grava a versão do template em .forge/cache/template-pendente/<rel>. A linha nomeia o que ainda difere do arquivo local (contagem + primeiros caminhos) até alguém reconciliar: declarar a exceção, incorporar a versão à mão ou aceitar com --overwrite-drift. É aviso, não diagnóstico faltante: não muda o rc do doctor.
  # Caminho já declarado em .forge/machinery-exceptions.txt (qualquer sha: viva ou expirada, o update preserva por exceção e não grava mais pendente) sai da lista na hora — a decisão humana está registrada, e cobrar até o próximo update seria ruído. Mesma leitura do parser do update: corte no primeiro `#`, exatamente dois tokens, sha hexadecimal minúsculo com pelo menos 32 dígitos, prefixos `./` e `.forge/` normalizados.
  pend_dir="$ROOT/.forge/cache/template-pendente"
  if [ -d "$pend_dir" ]; then
    pend_n=0; pend_list=""; pend_decl=""
    if [ -f "$ROOT/.forge/machinery-exceptions.txt" ]; then
      while IFS= read -r exc_line || [ -n "$exc_line" ]; do
        exc_line="${exc_line%%#*}"; exc_line="${exc_line//$'\r'/}"
        read -r exc_sha exc_rel exc_resto <<<"$exc_line" || true
        [ -n "${exc_rel:-}" ] && [ -z "${exc_resto:-}" ] || continue
        [[ "$exc_sha" =~ ^[0-9a-f]{32,}$ ]] || continue
        while [ "${exc_rel#./}" != "$exc_rel" ]; do exc_rel="${exc_rel#./}"; done
        exc_rel="${exc_rel#.forge/}"
        pend_decl="$pend_decl"$'\n'"$exc_rel"
      done < "$ROOT/.forge/machinery-exceptions.txt"
    fi
    while IFS= read -r pend_f; do
      pend_rel="${pend_f#"$pend_dir"/}"
      cmp -s "$pend_f" "$ROOT/.forge/$pend_rel" && continue
      grep -qxF -- "$pend_rel" <<<"$pend_decl" && continue
      pend_n=$((pend_n + 1))
      [ "$pend_n" -le 5 ] && pend_list="${pend_list:+$pend_list, }$pend_rel"
    done < <(find "$pend_dir" -type f ! -name .DS_Store 2>/dev/null | LC_ALL=C sort)
    if [ "$pend_n" -gt 0 ]; then
      [ "$pend_n" -gt 5 ] && pend_list="$pend_list, … (+$((pend_n - 5)))"
      warn "harness: TEMPLATE-PENDENTE: $pend_n arquivo(s) com versão nova do template aguardando reconciliação em .forge/cache/template-pendente/: $pend_list — declare a divergência em .forge/machinery-exceptions.txt, incorpore a versão pendente à mão ou aceite com npx forge-harness update --overwrite-drift"
    fi
  fi

  # Cabeçalho "Generated from" na 1ª linha do artefato gerado.
#
# Era `head -1 "$f" | grep -q 'Generated from'` inline. Sob `pipefail`, `grep -q` sai no primeiro
# casamento e o `head` que ainda escreve leva SIGPIPE: o pipeline devolve 141, a falha é promovida,
# e o `|| drift=$((drift+1))` conta como DRIFT um arquivo que estava correto (issue #49, instância
# 3). Sem pipeline não há SIGPIPE a promover.
_generated_header() { # _generated_header <arquivo>
  [ -f "$1" ] || return 1
  case "$(head -1 "$1" 2>/dev/null)" in
    *"Generated from"*) return 0 ;;
  esac
  return 1
}

# _settings_hooks_is_derived <root> — issue #160/LDG-0189. O lockfile guarda o sha256 do
# `.claude/settings.json` INTEIRO, então uma edição em QUALQUER chave de topo (`permissions`,
# `env`, `includeCoAuthoredBy`, ...) muda esse hash e acusa "drift" — mesmo sabendo, desde a
# #160, que o `sync` preserva essas chaves em vez de apagá-las. Recomendar
# "rode sync-adapters.sh" sem ressalva nesse caso sugere uma correção quando não há nada a
# corrigir. Aqui comparamos só a PROJEÇÃO de `hooks` que pertence ao gerador (achado de correção
# HIGH: `current.hooks` também carrega hooks de terceiro preservados pelo próprio `sync` desde a
# #160 — comparar a árvore INTEIRA nunca bate byte a byte quando existe um, e a supressão de aviso
# falharia justamente nos dois consumidores reais medidos no plano, vellus e axis-fare-validator,
# que têm hook de terceiro) contra o que `preToolUseWiring(root)` derivaria agora — a mesma leitura
# pura e já exportada que #125/#160 usam (issue #130); NUNCA um export novo, que quebraria o
# contrato de superfície travado pelo gate w216 [1] ("expõe SÓ preToolUseWiring"). Se a projeção
# bater byte a byte com o derivado, a fiação do gerador já está correta e o hash mudou só por causa
# de uma chave autoral (ou de um hook de terceiro, que a projeção também ignora). Imprime
# "yes"/"no"; qualquer erro (node ausente, settings.json ilegível, etc.) cai em "no" — modo
# conservador, mantém a recomendação de sync.
_settings_hooks_is_derived() { # _settings_hooks_is_derived <root>
  local root="$1" lib="$1/.forge/scripts/lib/sync-adapters.mjs" settings="$1/.claude/settings.json"
  command -v node >/dev/null 2>&1 && [ -f "$lib" ] && [ -f "$settings" ] || { echo "no"; return; }
  # Achado de correção (versão mista doctor×lib, MEDIUM): antes de IMPORTAR a lib para leitura de
  # diagnóstico, confirma por leitura ESTÁTICA (grep sobre o texto — nunca `import`) que ela já tem
  # a guarda de módulo principal da #130 (`isMainModule`) e a exportação estável da #160
  # (`preToolUseWiring`). Uma `sync-adapters.mjs` local mais antiga — preservada por exceção de
  # machinery declarada (#101/#131) enquanto o overlay já entrega o `doctor.sh` novo — sem essa
  # guarda RECONCILIA o consumidor como efeito colateral do próprio import (a mesma classe de dano
  # que a #130 fechou), apagando chaves de topo autorais nessa MESMA leitura de diagnóstico e
  # escondendo o drift real na execução seguinte. Sem as duas âncoras, cai em "no" sem importar.
  # Achado de correção LOW (revisão adversarial): as âncoras de `isMainModule`/`preToolUseWiring`
  # são da #130 — uma lib ENTRE a #130 e a #160 (ex.: f24b029) já as tem, mas AINDA emite
  # `{ hooks }` puro e apagaria `permissions`/`env` a cada sync. `function mergeSettingsJson` é a
  # âncora da PRÓPRIA #160 (a fusão que preserva chaves de topo autorais); sem ela, a projeção que
  # este helper compara não tem garantia nenhuma de que o `sync` real vá preservar o resto do
  # arquivo, então cai em "no" (recomendação normal), nunca "yes" (suprimir aviso).
  if ! grep -q 'function isMainModule' "$lib" || ! grep -q 'export function preToolUseWiring' "$lib" \
     || ! grep -q 'function mergeSettingsJson' "$lib"; then
    echo "no"; return
  fi
  # Variáveis de ambiente, NUNCA argv posicional (achado de correção): passar o caminho da lib
  # como argumento de `-e` grava esse MESMO caminho em `process.argv[1]` dentro do script — e
  # `isMainModule()` (dentro de sync-adapters.mjs) compara `process.argv[1]` contra a URL do
  # PRÓPRIO módulo. Os dois batendo faz o import ser tratado como invocação principal e reconciliar
  # o consumidor como efeito colateral desta leitura de diagnóstico (a mesma classe de dano que a
  # #130 fecha) — reproduzido durante o desenvolvimento desta issue.
  DOCTOR_SETTINGS_LIB="$lib" DOCTOR_SETTINGS_ROOT="$root" DOCTOR_SETTINGS_FILE="$settings" \
  node --input-type=module -e '
    import { pathToFileURL } from "node:url";
    import { readFileSync } from "node:fs";
    const { DOCTOR_SETTINGS_LIB: libPath, DOCTOR_SETTINGS_ROOT: root, DOCTOR_SETTINGS_FILE: settingsPath } = process.env;
    // OWNED — mesmo universo de TEMPLATE/.forge/scripts/lib/sync-adapters.mjs
    // (ownedHookCommandsFor, issue #125 — antes um Set fixo de três comandos,
    // OWNED_HOOK_COMMANDS), duplicado aqui porque a lib não o exporta (contrato travado pelo
    // w216 [1]: expõe SÓ preToolUseWiring). Duplicar é seguro no sentido CONSERVADOR desta função:
    // se um comando owned novo for esquecido nesta lista, o pior efeito é "no" (recomenda sync sem
    // necessidade), nunca "yes" escondendo perda real de hook de terceiro. Desde a #125 o universo
    // de PreToolUse não é mais fixo (deriva de `.forge/hooks/pre-tool-use/`), então esta lista
    // cobre hoje os cinco ganchos distribuídos pelo template (achado desta correção: TASK-19/#214
    // armou `guard-cross-session-send.sh` em `hooks.manifest.default` sem atualizar esta lista
    // duplicada, fazendo a projeção owned do doctor divergir de `preToolUseWiring(root)` mesmo sem
    // nenhum drift real — [1]/[6]/[6b] do w238 mediram o efeito), nas duas formas de comando que o
    // gerador pode emitir (direta e via `lib/argv-bridge.sh`) — um gancho de consumidor adicionado
    // depois cai no "no" conservador, nunca escondido. As formas COM ASPAS em `$CLAUDE_PROJECT_DIR`
    // e as formas *Legacy* SEM aspas convivem aqui (achado de correção MEDIUM, iteração 3 do modo
    // correção — mesma migração sem duplicar de `hookCommandDirect`/`hookCommandDirectLegacy` na
    // lib): um consumidor recém-migrado tem a forma nova fiada, um ainda não sincronizado tem a
    // legada, e as duas são igualmente owned para efeito deste diagnóstico.
    const HOOK_FILES = ["enforce-worktree-location.sh", "prevent-secrets-leak.sh", "prevent-aws-credentials-read.sh", "check-language-policy.sh", "validate-naming-conventions.sh", "guard-cross-session-send.sh"];
    const OWNED = new Set([
      "\"$CLAUDE_PROJECT_DIR\"/.forge/hooks/session/on-session-start.sh",
      "\"$CLAUDE_PROJECT_DIR\"/.forge/hooks/session/on-session-end.sh",
      "\"$CLAUDE_PROJECT_DIR\"/.forge/hooks/session/on-post-tool-use.sh",
      "$CLAUDE_PROJECT_DIR/.forge/hooks/session/on-session-start.sh",
      "$CLAUDE_PROJECT_DIR/.forge/hooks/session/on-session-end.sh",
      ...HOOK_FILES.map((h) => `"$CLAUDE_PROJECT_DIR"/.forge/hooks/pre-tool-use/${h}`),
      ...HOOK_FILES.map((h) => `$CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/${h}`),
      ...HOOK_FILES.map((h) => `"$CLAUDE_PROJECT_DIR"/.forge/hooks/pre-tool-use/lib/argv-bridge.sh "$CLAUDE_PROJECT_DIR"/.forge/hooks/pre-tool-use/${h}`),
      ...HOOK_FILES.map((h) => `$CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/lib/argv-bridge.sh $CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/${h}`),
    ]);
    function ownedProjection(hooksObj) {
      const out = {};
      for (const cat of Object.keys(hooksObj)) {
        const groups = Array.isArray(hooksObj[cat]) ? hooksObj[cat] : [];
        const kept = [];
        for (const g of groups) {
          if (!g || !Array.isArray(g.hooks)) continue;
          const keptHooks = g.hooks.filter((h) => h && OWNED.has(h.command));
          if (keptHooks.length) kept.push(keptHooks.length === g.hooks.length ? g : { ...g, hooks: keptHooks });
        }
        if (kept.length) out[cat] = kept;
      }
      return out;
    }
    try {
      const m = await import(pathToFileURL(libPath).href);
      const derived = m.preToolUseWiring(root);
      const current = JSON.parse(readFileSync(settingsPath, "utf8"));
      const currentHooks = (current && current.hooks && typeof current.hooks === "object" && !Array.isArray(current.hooks)) ? current.hooks : {};
      const projected = ownedProjection(currentHooks);
      console.log(JSON.stringify(projected) === JSON.stringify(derived) ? "yes" : "no");
    } catch { console.log("no"); }
  ' 2>/dev/null || echo "no"
}

# _settings_lib_needs_160_upgrade_warning <root> — issue #160/LDG-0189, achado de correção LOW
# (âncora incompleta). Independente de `_settings_hooks_is_derived` (que só decide se SUPRIME o
# aviso de drift autoral): esta função decide se a RECOMENDAÇÃO de drift real precisa virar um
# AVISO de risco em vez do "rode sync-adapters.sh" de sempre. Responde "yes" só quando as DUAS
# condições valem — a lib local não tem `function mergeSettingsJson` (é anterior à #160, então o
# `sync` real ainda emitiria `{ hooks }` puro) E o `.claude/settings.json` atual tem alguma chave
# de topo além de `hooks` (só aí existe algo autoral para o sync apagar). Nunca importa a lib —
# só `grep` estático e leitura do `settings.json` — então não tem o risco de reconciliar como
# efeito colateral (a classe de dano da #130) em NENHUMA versão da lib. Qualquer erro cai em "no"
# — modo conservador: a ausência desta função só muda a MENSAGEM, nunca o rc nem o fato de o
# doctor continuar reportando drift.
_settings_lib_needs_160_upgrade_warning() {
  local root="$1" lib="$1/.forge/scripts/lib/sync-adapters.mjs" settings="$1/.claude/settings.json"
  [ -f "$lib" ] && [ -f "$settings" ] || { echo "no"; return; }
  grep -q 'function mergeSettingsJson' "$lib" && { echo "no"; return; }
  node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const extra = j && typeof j === "object" && !Array.isArray(j) && Object.keys(j).some((k) => k !== "hooks");
      console.log(extra ? "yes" : "no");
    } catch { console.log("no"); }
  ' "$settings" 2>/dev/null || echo "no"
}

locks_found=0
  for lock in "$ROOT"/.forge/adapters/*.lock.yaml; do
    [ -f "$lock" ] || continue
    locks_found=$((locks_found + 1))
    aname="$(basename "$lock" .lock.yaml)"
    drift=0
    authordrift=0
    settings_real_drift=0
    while read -r dest hash; do
      [ -n "$dest" ] || continue
      if [ "$hash" = "symlink" ]; then
        { [ -L "$ROOT/$dest" ] || _generated_header "$ROOT/$dest"; } || drift=$((drift + 1))
      elif [ -f "$ROOT/$dest" ]; then
        actual="sha256:$(shasum -a 256 "$ROOT/$dest" | cut -d' ' -f1)"
        if [ "$actual" = "$hash" ]; then
          :
        elif [ "$dest" = ".claude/settings.json" ] && [ "$(_settings_hooks_is_derived "$ROOT")" = "yes" ]; then
          # #160/LDG-0189: a fiação (`hooks`) já bate com o que o gerador derivaria agora — o
          # sha mudou só por causa de uma chave de topo autoral, que o sync preserva.
          authordrift=$((authordrift + 1))
        else
          drift=$((drift + 1))
          [ "$dest" = ".claude/settings.json" ] && settings_real_drift=1
        fi
      else
        drift=$((drift + 1))
        [ "$dest" = ".claude/settings.json" ] && settings_real_drift=1
      fi
    done <<EOF_LOCK
$(awk '/^  - dest: /{d=$3} /^    sha256: /{print d" "$2}' "$lock")
EOF_LOCK
    if [ "$drift" -eq 0 ] && [ "$authordrift" -eq 0 ]; then
      ok "harness: adapter $aname sem drift (lockfile íntegro)"
    elif [ "$drift" -eq 0 ]; then
      # Achado de correção LOW: o texto antigo dizia "$authordrift chave(s) autoral(is)", mas
      # $authordrift conta ALVOS do lockfile com drift só autoral (aqui, sempre 1 — só existe um
      # .claude/settings.json por adapter), nunca chaves de fato alteradas. A frase não afirma mais
      # uma contagem que não faz.
      info "harness: adapter $aname — .claude/settings.json alterado só fora da fiação do gerador (permissions/env/...); o sync preserva essas chaves, nenhuma ação necessária"
    elif [ "$settings_real_drift" -eq 1 ] && [ "$(_settings_lib_needs_160_upgrade_warning "$ROOT")" = "yes" ]; then
      # Achado de correção LOW (âncora incompleta, LDG-0189): a lib local não tem a fusão da #160 e
      # o settings.json tem chave de topo além de `hooks` — recomendar "rode sync-adapters.sh" sem
      # ressalva sugeriria uma correção seguindo o mesmo caminho que apagaria essas chaves.
      miss "harness: $drift alvo(s) do adapter $aname com drift — a lib local .forge/scripts/lib/sync-adapters.mjs é anterior à #160: o sync APAGARIA chave(s) autoral(is) (permissions/env/...) de .claude/settings.json; atualize a lib ou revise a exceção de machinery antes de rodar sync-adapters.sh"; MISSING_DIAG=1
    else
      # Achado de correção LOW: quando o alvo com drift real é o próprio .claude/settings.json (lib
      # já com a fusão da #160), a recomendação padrão ganha a ressalva de que rodar o sync não
      # apaga chave autoral nem hook de terceiro — só corrige a fiação do gerador.
      if [ "$settings_real_drift" -eq 1 ]; then
        miss "harness: $drift alvo(s) do adapter $aname com drift (rode .forge/scripts/sync-adapters.sh) (o sync preserva chaves autorais e hooks de terceiro)"; MISSING_DIAG=1
      else
        miss "harness: $drift alvo(s) do adapter $aname com drift (rode .forge/scripts/sync-adapters.sh)"; MISSING_DIAG=1
      fi
      if [ "$authordrift" -gt 0 ]; then
        info "harness: .claude/settings.json também tem alteração fora da fiação do gerador — preservada pelo sync, sem ação"
      fi
    fi
  done
  if [ "$locks_found" -eq 0 ]; then
    info "harness: nenhum lockfile de adapter (rode .forge/scripts/sync-adapters.sh)"
  fi

  # graph staleness (§25): if a graph exists and tracked graphed files changed
  # since the last build, warn (informational — never load-bearing).
  if [ -f "$ROOT/.forge/graph/graph.json" ]; then
    if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      changed="$(git -C "$ROOT" status --porcelain 2>/dev/null | sed 's/^...//' || true)"
      stale=0
      while read -r f; do
        [ -n "$f" ] || continue
        grep -q "\"id\": \"$f\"" "$ROOT/.forge/graph/graph.json" 2>/dev/null && stale=$((stale + 1))
      done <<EOF_CHG
$changed
EOF_CHG
      if [ "$stale" -gt 0 ]; then info "harness: grafo possivelmente desatualizado ($stale arquivo(s) grafado(s) mudaram — rode /forge:graph update)"
      else ok "harness: grafo de código atualizado"; fi
    fi
  fi

  # busca unificada (/forge:kb): informativo, NUNCA load-bearing. A camada semântica é opcional e a
  # ausência dela é o default — por isso esta linha é sempre `info`. Só testa presença de arquivo:
  # não executa node, não importa módulo da busca, não pode disparar instalação nem rede. O índice é
  # por branch (ROOT); a instalação semântica mora na raiz de estado (FORGE_ROOT, ou o checkout
  # principal pelo mesmo critério de lib/forge-root.sh).
  if [ -f "$ROOT/.forge/scripts/kb.sh" ]; then
    kb_state="$ROOT"
    if [ -z "${FORGE_ROOT:-}" ] && command -v forge_main_root >/dev/null 2>&1; then
      kb_main="$(forge_main_root 2>/dev/null || true)"
      case "$kb_main" in /*) kb_state="$kb_main" ;; esac
    fi
    if [ -f "$ROOT/.forge/kb/index.json" ]; then kb_idx="índice construído"; else kb_idx="índice ainda não construído (kb.sh build)"; fi
    if [ -f "$kb_state/.forge/kb/semantic/installed.json" ]; then kb_sem="camada semântica instalada (integridade: kb.sh semantic status)"
    else kb_sem="camada semântica não instalada (opcional: kb.sh semantic install)"; fi
    info "harness: busca unificada /forge:kb — $kb_idx; $kb_sem"
  fi

  # ledger advisory (§ ledger-consultation): informativo, NUNCA load-bearing. Resume o estado e
  # sinaliza itens 'promoted' cujo change de destino sumiu sem baixa (promovido-e-abandonado antes
  # do fechamento automático existir, ou elo quebrado) — candidatos a reabrir/resolver à mão.
  if [ -f "$ROOT/.forge/ledger/ledger.json" ]; then
    orphans="$(node -e '
      const fs=require("fs"), root=process.argv[1];
      const d=JSON.parse(fs.readFileSync(root+"/.forge/ledger/ledger.json","utf8"));
      const active=new Set(); const archived=new Set();
      try{ for(const n of fs.readdirSync(root+"/.forge/specs/active")) active.add(n);}catch{}
      try{ for(const n of fs.readdirSync(root+"/.forge/specs/archived")) archived.add(n.replace(/^\d{4}-\d{2}-\d{2}-/,""));}catch{}
      const orph=(d.entries||[]).filter(e=>e.status==="promoted" && e.links && e.links.promoted_to && !active.has(e.links.promoted_to) && !archived.has(e.links.promoted_to));
      process.stdout.write(orph.map(e=>e.id).join(", "));
    ' "$ROOT" 2>/dev/null || true)"
    if [ -n "$orphans" ]; then info "harness: ledger — item(ns) promoted com change de destino ausente: $orphans (reabra ou resolva via /forge:ledger)"
    else ok "harness: ledger sem itens promovidos órfãos"; fi
    # Envelhecimento (add-ledger-evidence-aging, REQ-06): DELEGA ao `ledger-ops.sh stale` — uma
    # fonte só do cálculo — e nunca herda o código de saída dele (advisory, como todo o bloco).
    # Fica dentro do guard de ledger.json: sem ledger, o `stale` criaria o arquivo pelo doctor.
    if [ -f "$ROOT/.forge/scripts/ledger-ops.sh" ]; then
      stale_rc=0
      stale_out="$(FORGE_ROOT="$ROOT" bash "$ROOT/.forge/scripts/ledger-ops.sh" stale 2>&1)" || stale_rc=$?
      stale_head="$(printf '%s\n' "$stale_out" | head -1)"
      st_j=0
      [[ "$stale_out" =~ inconsistente\(s\):\ ([0-9]+) ]] && st_j="${BASH_REMATCH[1]}"
      if [ "$stale_rc" -eq 0 ] && [[ "$stale_head" =~ ^LEDGER\ stale:\ ([0-9]+)\ de\ [0-9]+\ .*mais\ de\ ([0-9]+)\ dia ]]; then
        st_k="${BASH_REMATCH[1]}"; st_n="${BASH_REMATCH[2]}"
        if [ "$st_k" -gt 0 ]; then info "harness: ledger — $st_k item(ns) ativo(s) sem reverificação há mais de $st_n dia(s) (rode ledger-ops.sh stale)"
        elif [ "$st_j" -eq 0 ]; then ok "harness: ledger sem itens ativos envelhecidos (limiar $st_n dia(s))"; fi
        # Inconsistência (last_verified sem evidência, data ilegível ou futura) nunca passa por "em dia".
        if [ "$st_j" -gt 0 ]; then info "harness: ledger — $st_j item(ns) com registro de reverificação inconsistente (rode ledger-ops.sh stale)"; fi
      elif [ "$stale_rc" -eq 2 ]; then info "harness: ledger — idade não medida: $stale_head"
      else info "harness: ledger — idade não medida (stale rc=$stale_rc)"; fi
    fi
  fi

  # liaison advisory (§ liaison-protocol): informativo, NUNCA load-bearing. O estado do canal é
  # fluxo de conversa entre repositórios, não drift do harness — um peer que ainda não sincronizou,
  # uma mensagem em quarentena esperando o thread-open, um ack pendente: nada disso é defeito desta
  # instalação, e reprovar o doctor por isso faria o operador aprender a ignorar o doctor.
  # Divergência e conflito aparecem aqui porque exigem decisão humana, mas com marcador `·`.
  # Mutex de carga pesada (issue #52). Três coisas que só o doctor pode dizer: se o repositório
  # declara `enabled: true` mas o interruptor da MÁQUINA está desligado (o interruptor mora em
  # /tmp e some no reboot — é a mitigação declarada dessa incerteza), se há órfão, e se ainda há
  # lock vivo em caminho LEGADO derivado de TMPDIR, que não serializa com o ancorado.
  if [ -f "$ROOT/.forge/scripts/lib/heavy-mutex.sh" ]; then
    hm_line="$(FORGE_ROOT="$ROOT" bash "$ROOT/.forge/scripts/lib/heavy-mutex.sh" 2>/dev/null; \
               FORGE_ROOT="$ROOT" bash -c '. "$0"; forge_heavy_mutex_status 2>/dev/null | tr "\n" " "' \
               "$ROOT/.forge/scripts/lib/heavy-mutex.sh" 2>/dev/null || true)"
    [ -n "$hm_line" ] && echo "  · harness: HEAVY-MUTEX: $hm_line"
    hm_res="$(awk '/^heavy_mutex:/{f=1;next} f&&/^[a-z]/{f=0} f&&/^[[:space:]]*resource:/{sub(/^[[:space:]]*resource:[[:space:]]*/,"");gsub(/["'"'"']/,"");print;exit}' "$ROOT/.forge/forge.yaml" 2>/dev/null)"
    [ -n "$hm_res" ] || hm_res="forge-heavy-suite"
    if awk '/^heavy_mutex:/{f=1;next} f&&/^[a-z]/{f=0} f&&/^[[:space:]]*enabled:[[:space:]]*true/{print "y";exit}' "$ROOT/.forge/forge.yaml" 2>/dev/null | grep -q y; then
      [ -f "/tmp/$hm_res.q.enabled" ] \
        || echo "  · harness: heavy_mutex habilitado no repo, mas a FILA da máquina está desligada (ligue com: heavy-run.sh queue enable)"
    fi
    # A raiz legada é montada em duas partes porque a intenção aqui é o OPOSTO da regra 1 do
    # check-heavy-mutex: este bloco DETECTA o caminho legado para avisar que ele não serializa, não
    # o PRODUZ. Quebrar em duas linhas costumava desarmar a regra por acaso (LDG-0054: ela media
    # grafia — variável e 'lock' na mesma linha — e não intenção); agora a regra mede por janela e
    # pegaria este bloco também, então a válvula é DECLARADA em vez de acidental: o marcador abaixo
    # é o que o gate reconhece, e a intenção passa a viver no código, não num comentário adjacente.
    hm_legroot="${TMPDIR:-/tmp}"  # heavy-mutex: detecção
    hm_leg="$hm_legroot/$hm_res".lock
    if [ "$hm_leg" != "/tmp/$hm_res.lock" ] && [ -d "$hm_leg" ]; then
      echo "  ✗ harness: lock LEGADO vivo em $hm_leg — este caminho NÃO serializa com /tmp/$hm_res.lock (recolha com: heavy-run.sh sweep --legacy)"
    fi
  fi

  if [ -d "$ROOT/.forge/liaison" ] && [ -f "$ROOT/.forge/scripts/liaison-ops.sh" ]; then
    # issue #108: `2>/dev/null || true` engolia rc≠0 do `status` E o estado de erro — a seção de
    # liaison inteira sumia do doctor sem dizer que a leitura falhou, indistinguível de "nada a
    # reportar". Agora rc≠0 nomeia a falha com `✗` (sinaliza que o PRÓPRIO diagnóstico quebrou,
    # não o estado do canal — por isso não toca MISSING_DIAG, que continua reservado à maquinaria
    # do harness em si).
    liaison_out="$(FORGE_ROOT="$ROOT" bash "$ROOT/.forge/scripts/liaison-ops.sh" status 2>&1)"
    liaison_rc=$?
    if [ "$liaison_rc" -ne 0 ]; then
      liaison_first_err="$(printf '%s\n' "$liaison_out" | head -n1)"
      miss "harness: LIAISON: status falhou — ${liaison_first_err:-erro desconhecido (rc $liaison_rc)}"
    elif [ -n "$liaison_out" ] && [ "$liaison_out" != "LIAISON: não inicializado" ]; then
      info "harness: ${liaison_out}"
      conflicts="$(find "$ROOT/.forge/liaison" -mindepth 3 -maxdepth 3 -path '*/conflicts/*' -name '*.json' 2>/dev/null | wc -l | tr -d ' ')"
      if [ "${conflicts:-0}" -gt 0 ]; then
        info "harness: liaison — $conflicts conflito(s) registrado(s) em conflicts/ (decisão humana; ver /forge:liaison)"
      fi
    fi

    # Escritor de versão antiga (design §2.4, add-liaison-handoff-baton): worktree criada de
    # branch ANTERIOR a este change continua gravando no log próprio SEM a trava do log
    # (appendOwn/liaison-lock.mjs) — limite declarado, não bloqueante (MISSING_DIAG é reservado
    # à maquinaria do harness em si, nunca ao estado do canal). Detecção: a cópia de
    # `liaison-ops.sh` de cada worktree tem a sentinela literal `# forge-liaison: own-log-lock
    # v1`? `git worktree list --porcelain` é a fonte — nunca adivinha caminho.
    while IFS= read -r wt_path; do
      [ -n "$wt_path" ] || continue
      wt_ops="$wt_path/.forge/scripts/liaison-ops.sh"
      [ -f "$wt_ops" ] || continue
      grep -q '^# forge-liaison: own-log-lock v1$' "$wt_ops" 2>/dev/null \
        || info "harness: liaison — worktree sem a trava do log próprio (versão anterior a add-liaison-handoff-baton): $wt_path — atualize a branch antes de usar o liaison nela"
    done < <(git -C "$ROOT" worktree list --porcelain 2>/dev/null | awk -F' ' '/^worktree /{print substr($0, 10)}')
  fi

  # mudanças de contenção da mensageria nativa (REQ-12, design §2.7): mesma postura da seção
  # liaison acima — INFORMATIVO, nunca MISSING_DIAG. O detector único mora em
  # native-containment.mjs (consumido também por pre-push, prepare-pr e ship, nunca duplicado
  # aqui); este bloco só soma os avisos que o design reserva ao doctor (fora da lista fechada de
  # mudanças de contenção): cruzamento de participantes de canal e as notas de convergência
  # (gancho inativo, self_identity ausente, sobreposição de settings, edição não commitada,
  # cadastro do HEAD divergente do upstream). `FORGE_CLAUDE_USER_SETTINGS` sobrepõe
  # `~/.claude/settings.json` só para fixtures de gate (simétrico a FORGE_CLAUDE_SESSIONS_DIR/
  # FORGE_CLAUDE_PROJECTS_DIR dos leitores nativos) — nunca HOME redirecionado.
  if [ -f "$ROOT/.forge/scripts/lib/native-containment.mjs" ]; then
    containment_out="$(node - "$ROOT" <<'NODEEOF'
const { existsSync, readFileSync } = require('fs');
const { pathToFileURL } = require('url');
const { join } = require('path');
const { homedir } = require('os');
const { execFileSync } = require('child_process');

const root = process.argv[2];
const libDir = join(root, '.forge', 'scripts', 'lib');

function emit(kind, a, b) {
  if (b === undefined) console.log(`${kind}\t${a}`);
  else console.log(`${kind}\t${a}\t${b}`);
}

(async () => {
  let C, AL, CFG, WS, HM, SA;
  try {
    C = await import(pathToFileURL(join(libDir, 'native-containment.mjs')).href);
    AL = await import(pathToFileURL(join(libDir, 'native-allowlist.mjs')).href);
    CFG = await import(pathToFileURL(join(libDir, 'liaison-config.mjs')).href);
    WS = await import(pathToFileURL(join(libDir, 'native-workspace.mjs')).href);
    HM = await import(pathToFileURL(join(libDir, 'hooks-manifest.mjs')).href);
    SA = await import(pathToFileURL(join(libDir, 'sync-adapters.mjs')).href);
  } catch (err) {
    emit('ERROR', err.message);
    return;
  }

  const result = C.detectContainment({ root });
  if (!result.ok) {
    emit('ERROR', result.reason);
  } else {
    for (const f of result.findings) emit('FINDING', f.type, f.detail);
  }

  const { doc: effective } = AL.readEffectiveAllowlist({ root });

  if (!effective.self_identity) {
    emit('EXTRAWARN', "self_identity não cadastrado (rode 'liaison-ops.sh native pin') — troca de remote fica indetectável até então");
  }

  try {
    const derived = SA.preToolUseWiring(root);
    const derivedFiacao = HM.derivarFiacao(derived.PreToolUse || []);
    const armedByDefault = derivedFiacao.legivel && derivedFiacao.ganchos.includes('guard-cross-session-send.sh');
    const settingsPath = join(root, '.claude', 'settings.json');
    let actuallyArmed = false;
    if (existsSync(settingsPath)) {
      const j = JSON.parse(readFileSync(settingsPath, 'utf8'));
      const groups = j && j.hooks && Array.isArray(j.hooks.PreToolUse) ? j.hooks.PreToolUse : [];
      const f = HM.derivarFiacao(groups);
      actuallyArmed = f.legivel && f.ganchos.includes('guard-cross-session-send.sh');
    }
    if (!actuallyArmed) {
      emit('EXTRAWARN', `gancho de saída guard-cross-session-send.sh inativo (${armedByDefault ? 'semeado inativo, aguardando o passo de armar do consumidor' : 'retido no manifesto do consumidor'}) — mensageria nativa sai sem guarda (design §5)`);
    }
  } catch (err) {
    emit('EXTRAWARN', `não foi possível verificar o estado do gancho de saída: ${err.message}`);
  }

  const userSettingsPath = process.env.FORGE_CLAUDE_USER_SETTINGS || join(homedir(), '.claude', 'settings.json');
  const overlays = [join(root, '.claude', 'settings.local.json'), userSettingsPath];
  for (const p of overlays) {
    if (!existsSync(p)) continue;
    let j;
    try { j = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    if (j && j.disableAllHooks === true) {
      emit('EXTRAWARN', `disableAllHooks=true em ${p} desativa todos os ganchos, inclusive a guarda de saída nativa`);
      continue;
    }
    const groups = j && j.hooks && Array.isArray(j.hooks.PreToolUse) ? j.hooks.PreToolUse : [];
    if (groups.length > 0) {
      const f = HM.derivarFiacao(groups);
      if (!(f.legivel && f.ganchos.includes('guard-cross-session-send.sh'))) {
        emit('EXTRAWARN', `${p} sobrepõe PreToolUse sem incluir guard-cross-session-send.sh`);
      }
    }
  }

  const work = AL.readWorkingAllowlist({ root });
  if (!work.error && JSON.stringify(work.doc) !== JSON.stringify(effective)) {
    emit('EXTRAWARN', 'allowed-workspaces.json tem edição não commitada — só a versão no HEAD do tronco vale');
  }

  try {
    const upstream = execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (upstream) {
      let headText = null, upstreamText = null;
      try { headText = execFileSync('git', ['-C', root, 'show', 'HEAD:.forge/liaison/allowed-workspaces.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* ausente */ }
      try { upstreamText = execFileSync('git', ['-C', root, 'show', `${upstream}:.forge/liaison/allowed-workspaces.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* ausente */ }
      if (headText !== upstreamText) {
        emit('EXTRAWARN', `allowed-workspaces.json no HEAD do tronco difere de ${upstream} — cadastro commitado e ainda não publicado`);
      }
    }
  } catch { /* sem upstream configurado — nada a comparar */ }

  try {
    const cfgPath = join(root, '.forge', 'liaison', 'liaison.yaml');
    if (existsSync(cfgPath)) {
      const cfgDoc = CFG.readConfig(cfgPath);
      const selfIdentity = WS.workspaceIdentity(root);
      const activeIds = new Set((effective.allowed_workspaces || []).filter((e) => !e.revoked_at).map((e) => e.id));
      const matchedIds = new Set();
      for (const channel of Object.keys(cfgDoc.channels || {})) {
        const ch = cfgDoc.channels[channel];
        for (const participant of (ch.participants || [])) {
          const peerPath = CFG.getPeerPath(cfgDoc, channel, participant);
          if (!peerPath) {
            emit('PARTWARN', `canal '${channel}': participante '${participant}' sem peer-path configurado — não verificável`);
            continue;
          }
          let peerIdentity = null;
          try { peerIdentity = WS.workspaceIdentity(peerPath); } catch { peerIdentity = null; }
          if (!peerIdentity) {
            emit('PARTWARN', `canal '${channel}': participante '${participant}' com peer-path '${peerPath}' não resolveu identidade — não verificável`);
            continue;
          }
          if (peerIdentity === selfIdentity) continue;
          matchedIds.add(peerIdentity);
          if (!activeIds.has(peerIdentity)) {
            emit('PARTWARN', `canal '${channel}': participante '${participant}' resolve para '${peerIdentity}', não cadastrado em allowed-workspaces.json`);
          }
        }
      }
      for (const id of activeIds) {
        if (!matchedIds.has(id)) {
          emit('PARTWARN', `workspace cadastrado ativo '${id}' não corresponde a nenhum participante de canal`);
        }
      }
    }
  } catch (err) {
    emit('PARTWARN', `cruzamento de participantes indisponível: ${err.message}`);
  }
})();
NODEEOF
)"
    while IFS=$'\t' read -r _nc_kind _nc_a _nc_b; do
      [ -n "$_nc_kind" ] || continue
      case "$_nc_kind" in
        FINDING) info "harness: CONTENÇÃO: $_nc_a — $_nc_b" ;;
        EXTRAWARN) info "harness: CONTENÇÃO: $_nc_a" ;;
        PARTWARN) info "harness: CONTENÇÃO (participante): $_nc_a" ;;
        ERROR) miss "harness: CONTENÇÃO: detector indisponível — $_nc_a" ;;
      esac
    done <<< "$containment_out"
  fi

  # changes órfãos (§ lifecycle-reconcile): change implementado/mergeado cujo manifest nunca
  # acompanhou — verified parado sem /forge:archive, ou TASKs 100% com status ainda
  # tasks-ready/implementing. Detector determinista (zero-LLM). Informativo, NUNCA load-bearing
  # (marcador `·`, jamais `✗`/exit 1) — é estado de fluxo do operador, não drift do harness.
  if [ -d "$ROOT/.forge/specs/active" ] && command -v node >/dev/null 2>&1 \
     && [ -f "$ROOT/.forge/scripts/lib/orphan-changes.mjs" ]; then
    orphan_lines="$(node "$ROOT/.forge/scripts/lib/orphan-changes.mjs" "$ROOT" --lines 2>/dev/null || true)"
    if [ -n "$orphan_lines" ]; then
      while IFS="$(printf '\t')" read -r bucket oid ostatus; do
        [ -n "$oid" ] || continue
        if [ "$bucket" = "merged_unarchived" ]; then
          info "harness: change '$oid' ($ostatus) mergeado/verificado sem baixa — /forge:archive (ou /forge:verify)"
        else
          info "harness: change '$oid' com TASKs 100% mas status '$ostatus' — avance (spec-transition.sh $oid implementing/implemented) e /forge:verify"
        fi
      done <<EOF_ORPHAN
$orphan_lines
EOF_ORPHAN
    else
      ok "harness: sem changes órfãos (lifecycle SDD reconciliado)"
    fi
  fi

  # drift de pipeline (§10.4): change verified SEM spec-delta.yaml autorado (ausente ou ainda
  # com placeholders de scaffold/template). A fase verify passou a gerar o esqueleto e autorar
  # os payloads — verified sem delta é retrabalho garantido na sessão de archive. Informativo
  # (`·`) como os demais checks de estado de fluxo do operador — o enforcement duro fica no
  # pré-flight do archive (validate-archive recusa placeholders).
  if [ -d "$ROOT/.forge/specs/active" ]; then
    for chdir in "$ROOT"/.forge/specs/active/*/; do
      [ -f "$chdir/manifest.yaml" ] || continue
      chstatus="$(awk -F': ' '$1=="status"{print $2; exit}' "$chdir/manifest.yaml")"
      [ "$chstatus" = "verified" ] || continue
      chid="$(basename "$chdir")"
      if [ ! -f "$chdir/spec-delta.yaml" ]; then
        info "harness: drift — change '$chid' verified sem spec-delta.yaml (gere na fase verify: /forge:verify §2.5, ou autore à mão antes do /forge:archive)"
      # cópia bash de SCAFFOLD_MARKERS_RE (canônico: lib/scaffold-markers.mjs) — manter em sincronia
      elif grep -qE '<scaffold:|<capability-kebab>|REQ-XXX-' "$chdir/spec-delta.yaml"; then
        info "harness: drift — change '$chid' verified com spec-delta.yaml ainda em placeholder (preencha os payloads — /forge:verify §2.5; o archive recusa scaffold)"
      fi
    done
  fi

  # red-first (rule testing/regression-red-first.md): change type:bugfix ativo cuja evidência
  # de Red ainda não está observed/waived. Advisory puro, igual ao bloco do ledger acima —
  # NUNCA seta MISSING_DIAG (o enforcement real e bloqueante é o validate-spec.mjs na
  # transição para verified, e o check-red-first.sh no pré-flight do archive).
  if [ -d "$ROOT/.forge/specs/active" ] && command -v node >/dev/null 2>&1 \
     && [ -f "$ROOT/.forge/scripts/lib/check-red-first.mjs" ]; then
    red_pending=""
    for chdir in "$ROOT"/.forge/specs/active/*/; do
      [ -f "$chdir/manifest.yaml" ] || continue
      chtype="$(awk -F': ' '$1=="type"{print $2; exit}' "$chdir/manifest.yaml")"
      [ "$chtype" = "bugfix" ] || continue
      chid="$(basename "$chdir")"
      st="$(FORGE_ROOT="$ROOT" node "$ROOT/.forge/scripts/lib/check-red-first.mjs" status "$chdir" 2>/dev/null || echo "")"
      case "$st" in
        OK*) ;;
        "") ;;
        *) red_pending="${red_pending:+$red_pending, }$chid ($st)" ;;
      esac
    done
    if [ -n "$red_pending" ]; then
      info "harness: red-first — evidência pendente: $red_pending"
      hint "grave a observação (/forge:red record) ou dispense (check-red-first.sh waive <id> --reason <r>)"
    else
      ok "harness: red-first sem evidência pendente"
    fi
  fi

  # core.hooksPath — config LOCAL e não versionada: some num clone novo, some num runner de CI, e
  # some numa máquina nova. Um valor errado desativa TODOS os hooks do Forge em silêncio, e a única
  # evidência disso é o commit proibido passando. Precisa ser ABSOLUTO e apontar para os hooks do
  # CHECKOUT PRINCIPAL: um valor relativo é resolvido por cada worktree contra a PRÓPRIA árvore,
  # que carrega a cópia antiga dos hooks daquela branch — hook novo, mergeado, não bloqueia nada
  # onde o trabalho acontece.
  if git rev-parse --git-dir >/dev/null 2>&1; then
    hp_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
    case "$hp_common" in
      /*) hp_main="$(dirname "$hp_common")" ;;
      *)  hp_main="$(git rev-parse --show-toplevel 2>/dev/null || echo "$ROOT")" ;;
    esac
    hp_want="$hp_main/.forge/hooks/git"
    hp_cur="$(git config --get core.hooksPath 2>/dev/null || true)"
    if [ "$hp_cur" = "$hp_want" ]; then
      ok "harness: core.hooksPath -> hooks do tronco (absoluto)"
    elif [ -z "$hp_cur" ]; then
      # Sem hooks instalados não há o que apontar; com hooks instalados e ninguém apontando, o
      # harness está inerte e isso é defeito.
      if [ -d "$hp_want" ]; then
        miss "harness: core.hooksPath não configurado — os hooks em $hp_want existem e nenhum deles roda"
        hint "corrija com: npx forge-harness update   (ou git config core.hooksPath '$hp_want')"
        MISSING_DIAG=1
      else
        info "harness: core.hooksPath não configurado (nenhum hook do Forge instalado neste checkout)"
      fi
    elif [ ! -d "$hp_cur" ]; then
      miss "harness: core.hooksPath aponta para '$hp_cur', que não existe — nenhum hook roda"
      hint "corrija com: npx forge-harness update   (ou git config core.hooksPath '$hp_want')"
      MISSING_DIAG=1
    elif [ "$hp_cur" = ".forge/hooks/git" ]; then
      miss "harness: core.hooksPath relativo ('.forge/hooks/git') — cada worktree resolve na própria árvore e roda a cópia antiga dos hooks"
      hint "corrija com: npx forge-harness update   (grava o caminho absoluto do tronco)"
      MISSING_DIAG=1
    else
      # VERIFICA o encadeamento em vez de confiar (issue #74). `info` era a severidade certa para
      # quem encadeou e a errada para quem não encadeou, e o doctor não distinguia os dois porque
      # não olhava — então "instalei o harness, ele está inerte, e o doctor diz que está tudo bem"
      # ficava indistinguível de "instalei e encadeei tudo". A régua já existe: a issue #41 fez o
      # hooksPath relativo virar defeito exatamente porque hook que não executa é indistinguível de
      # hook ausente, e uma árvore customizada sem encadeamento produz o MESMO estado.
      #
      # O caso mais valioso é o parcial, e é o mais provável: quem tem hooks próprios encadeia o
      # que precisava no dia em que precisou, e cada upgrade acrescenta gates que ninguém liga.
      # Sem esta linha, todo `update` amplia em silêncio a distância entre o que o harness entrega
      # e o que o repositório executa.
      hp_ref=0; hp_orfaos=""
      if [ -d "$hp_cur" ]; then
        grep -rqE '\.forge/hooks/git|check-[a-z-]+\.sh' "$hp_cur" 2>/dev/null && hp_ref=1
        for hp_g in "$ROOT"/.forge/scripts/check-*.sh "$ROOT/.forge/scripts/tests/run-all.sh"; do
          [ -f "$hp_g" ] || continue
          hp_n="$(basename "$hp_g")"
          grep -rq "$hp_n" "$hp_cur" 2>/dev/null || hp_orfaos="$hp_orfaos $hp_n"
        done
      fi
      if [ "$hp_ref" -eq 0 ]; then
        miss "harness: core.hooksPath customizado ('$hp_cur') e NENHUMA referência aos gates do Forge — a árvore .forge/hooks/git/ está inerte"
        hint "encadeie .forge/hooks/git/* nos seus hooks, ou rode: npx forge-harness update"
        MISSING_DIAG=1
      elif [ -n "$hp_orfaos" ]; then
        warn "harness: core.hooksPath customizado com encadeamento PARCIAL — gates que ninguém invoca:$hp_orfaos"
        hint "encadeie os acima em '$hp_cur' — cada upgrade acrescenta gates novos, e os que ninguém liga não rodam"
      else
        ok "harness: core.hooksPath customizado ('$hp_cur') com os gates do Forge encadeados"
      fi
    fi

    # Divergência de maquinaria por worktree. Maquinaria versionada dentro da árvore não se
    # propaga sozinha: um script, uma rule ou um schema corrigidos no tronco continuam sendo a
    # versão antiga em todo worktree ativo, e quem trabalha ali recebe verde de um gate que não
    # está rodando. Medido em axis-go-cloud: cinco de oito worktrees com 86 a 103 arquivos
    # divergentes. Informativo, nunca reprova — sincronizar é decisão de quem tem o contexto da
    # branch, e um worktree legitimamente à frente do tronco também aparece aqui.
    wt_head="$(git -C "$hp_main" rev-parse HEAD 2>/dev/null || true)"
    if [ -n "$wt_head" ]; then
      git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10)}' | while IFS= read -r wt; do
        [ -n "$wt" ] || continue
        [ "$wt" = "$hp_main" ] && continue
        wt_sha="$(git -C "$wt" rev-parse HEAD 2>/dev/null || true)"
        [ -n "$wt_sha" ] || continue
        n="$(git -C "$hp_main" diff --name-only "$wt_sha" "$wt_head" -- \
               .forge/scripts .forge/rules .forge/schemas .forge/templates .forge/hooks .forge/agents 2>/dev/null | wc -l | tr -d ' ')"
        [ "${n:-0}" -gt 0 ] || continue
        ahead="$(git -C "$hp_main" rev-list --count "$wt_head..$wt_sha" 2>/dev/null || echo '?')"
        printf "  %s·%s %s\n" "$YEL" "$RST" "harness: worktree $(basename "$wt") com $n arquivo(s) de maquinaria divergentes do tronco ($ahead commit(s) à frente)"
      done
    fi

    # Triagem BARATA de worktrees (fiação da onda "worktree nasce com branch"). Sem esta chamada a
    # triagem seria mais uma superfície que ninguém invoca — o defeito puro de LDG-0160 —, porque o
    # `post-merge` só fala no instante de um merge no tronco e ninguém que acumulou 29 worktrees
    # estava olhando naquele instante.
    #
    # BARATA por medição, e com ORÇAMENTO por medição. O predicado de arquivo ignorado
    # (`git clean -ndX`) fica de fora: sobre 145 worktrees ele não terminou em 590 segundos. E mesmo
    # o predicado barato não é grátis a frio: medido em `axis-go-cloud`, cujo `.git` tem 2,3 GB,
    # `status --porcelain` mais `symbolic-ref` em 10 worktrees levou 57,9 s na primeira passada e
    # 87 ms na segunda — ou seja, quem medir a quente vai concluir que é grátis e quem rodar a frio
    # vai esperar minutos. Por isso a varredura tem teto de tempo e DIZ quantas ficaram de fora, em
    # vez de fingir que examinou tudo.
    WTC_LIB="$ROOT/.forge/scripts/lib/worktree-classify.sh"
    [ -f "$WTC_LIB" ] || WTC_LIB="$(dirname "$0")/lib/worktree-classify.sh"
    if [ -f "$WTC_LIB" ]; then
      # shellcheck source=/dev/null
      . "$WTC_LIB"
      wt_budget="${FORGE_WT_TRIAGE_BUDGET_S:-5}"
      case "$wt_budget" in ''|*[!0-9]*) wt_budget=5 ;; esac
      wt_deadline=$(( $(date +%s) + wt_budget ))
      wt_refs="$(forge_wt_default_refs "$hp_main")"
      wt_ref_local="${wt_refs%% *}"; wt_ref_remota="${wt_refs##* }"
      wt_n=0; wt_destacada=0; wt_suja=0; wt_viva=0; wt_naoverif=0; wt_fora=0
      while IFS= read -r wtp; do
        [ -n "$wtp" ] || continue
        [ "$wtp" = "$hp_main" ] && continue
        wt_n=$((wt_n + 1))
        if [ "$(date +%s)" -ge "$wt_deadline" ]; then wt_fora=$((wt_fora + 1)); continue; fi
        case "$(forge_wt_classify "$hp_main" "$wtp" "$wt_ref_local" "$wt_ref_remota" barato)" in
          destacada) wt_destacada=$((wt_destacada + 1)) ;;
          mergeada-suja) wt_suja=$((wt_suja + 1)) ;;
          viva) wt_viva=$((wt_viva + 1)) ;;
          *) wt_naoverif=$((wt_naoverif + 1)) ;;
        esac
      done <<EOF_WT_TRIAGE
$(git -C "$hp_main" worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10)}')
EOF_WT_TRIAGE
      if [ "$wt_n" -eq 0 ]; then
        info "harness: triagem de worktrees — 0 worktree linkada neste repositório (nada a classificar)"
      else
        wt_examinadas=$((wt_n - wt_fora))
        info "harness: triagem de worktrees — $wt_examinadas de $wt_n examinada(s): destacada=$wt_destacada mergeada-suja=$wt_suja viva=$wt_viva nao-verificado=$wt_naoverif"
        [ "$wt_fora" -gt 0 ] && hint "$wt_fora worktree(s) NÃO examinada(s): o orçamento de ${wt_budget}s acabou (FORGE_WT_TRIAGE_BUDGET_S ajusta)"
        [ "$wt_destacada" -gt 0 ] && hint "worktree destacada não tem branch para empurrar: o veredito e o comando de conserto saem em 'bash .forge/scripts/worktree-reconcile.sh --triage'"
        hint "veredito completo, com o predicado de arquivo ignorado que este resumo omite por custo: bash .forge/scripts/worktree-reconcile.sh --triage"
      fi
    fi
  fi

  # ── gate órfão: check-*.sh que ninguém invoca (LDG-0110 + peça executável da issue #82) ─────
  # Um `check-*.sh` presente em `.forge/scripts/`, não invocado por hook nenhum e não declarado em
  # `runtime.gates` de FASE ALGUMA, é um gate que ninguém roda — e conta como cobertura em todo
  # relatório. O único check que existia (`hp_orfaos`, acima) só roda no ramo `else` da cascata de
  # `core.hooksPath`: APENAS com hooksPath customizado e diferente do canônico. No caso comum — o
  # hooksPath default instalado pelo próprio harness — nunca executava.
  #
  # INFORMATIVO POR CONSTRUÇÃO: usa `info`/`warn` e NUNCA toca `MISSING_DIAG`. Gate declarado e
  # não invocado é decisão legítima em muitos projetos (um `check-authz` só faz sentido onde há
  # autorização), e `LDG-0013` foi encerrado como `wont-fix` justamente por retrocompatibilidade.
  # O que não é legítimo é o harness não DIZER.
  #
  # Três fontes cruzadas, e a terceira é a que exige o leitor único:
  #   1. o universo `$ROOT/.forge/scripts/check-*.sh`;
  #   2. as referências por nome-base em `.forge/hooks/**` (inclusive `hooks/git/lib/`, porque
  #      `check-red-first.sh` é invocado por wrapper) e no `hooksPath` resolvido, seja ele qual for;
  #   3. `runtime.gates` de TODAS as fases, por `forge_runtime_gate_entries` — sem filtro de fase,
  #      e pelo leitor canônico, nunca por um `awk` novo. Um `awk` local aqui seria o TERCEIRO
  #      leitor do mesmo contrato, que é literalmente o defeito que `LDG-0150` acabou de fechar.
  og_lib="$ROOT/.forge/scripts/lib/forge-runtime.sh"
  if [ ! -f "$og_lib" ] && [ -d "$ROOT/.forge/scripts/lib" ]; then
    info "harness: gates: leitor de runtime.gates (lib/forge-runtime.sh) ausente — cruzamento de gate órfão não executado"
  elif [ -d "$ROOT/.forge/scripts" ]; then
    # shellcheck disable=SC1090
    [ -f "$og_lib" ] && . "$og_lib"
    og_declarados=""
    if [ -f "$og_lib" ]; then
      og_declarados="$(FORGE_ROOT="$ROOT" forge_runtime_gate_entries "$ROOT" 2>/dev/null | awk -F'\t' '$1!=""{print $1}' || true)"
    fi
    og_hookdirs="$ROOT/.forge/hooks"
    og_hp="$(git config --get core.hooksPath 2>/dev/null || true)"
    [ -n "$og_hp" ] && [ -d "$og_hp" ] && og_hookdirs="$og_hookdirs $og_hp"
    og_total=0; og_orfaos=""; og_so_declarados=""
    for og_f in "$ROOT"/.forge/scripts/check-*.sh; do
      [ -f "$og_f" ] || continue
      og_total=$((og_total + 1))
      og_base="$(basename "$og_f")"
      og_name="${og_base%.sh}"
      og_in_hook=0
      for og_d in $og_hookdirs; do
        [ -d "$og_d" ] || continue
        if grep -rq "$og_base" "$og_d" 2>/dev/null; then og_in_hook=1; break; fi
      done
      [ "$og_in_hook" -eq 1 ] && continue
      # Declarado em runtime.gates (qualquer fase) não é órfão: é gate de contrato do projeto.
      case "
$og_declarados
" in
        *"
$og_name
"*) og_so_declarados="$og_so_declarados $og_name"; continue ;;
      esac
      # Órfão legítimo por condição, justificado em código e não em allowlist textual nova:
      # `check-heavy-mutex.sh` só faz sentido com `heavy_mutex.enabled: true`, e o harness já tem
      # uma allowlist (`empty-universe-allowlist.txt`) que resolve OUTRO problema — reusá-la aqui
      # confundiria dois contratos. Com catorze `check-*.sh` no template, a exceção cabe numa
      # condição legível; se o universo crescer além disso, a allowlist volta a ser a resposta.
      if [ "$og_name" = "check-heavy-mutex" ]; then continue; fi
      og_orfaos="$og_orfaos $og_name"
    done
    og_n_orf=0
    for og_x in $og_orfaos; do og_n_orf=$((og_n_orf + 1)); done
    # Contador de controle SEMPRE, inclusive (e principalmente) quando não há órfão: sem esta
    # linha, "examinei e estava limpo" e "não examinei nada" terminam no mesmo silêncio.
    if [ "$og_total" -eq 0 ]; then
      info "harness: gates: 0 check-*.sh examinado(s) em .forge/scripts/ — nenhum gate instalado"
    elif [ "$og_n_orf" -eq 0 ]; then
      ok "harness: gates: $og_total check-*.sh examinado(s), 0 órfão(s)"
    else
      warn "harness: gates: $og_total check-*.sh examinado(s), $og_n_orf gate(s) órfão(s) — nenhum hook os invoca e runtime.gates não os declara:$og_orfaos"
      hint "declare em runtime.gates (com phase:, se for de deploy) ou remova — gate que ninguém roda conta como cobertura e não cobre nada"
    fi
    [ -z "$og_so_declarados" ] \
      || info "harness: gates: rodam SÓ por runtime.gates (nenhum hook os invoca):$og_so_declarados"
    if [ -z "$og_declarados" ]; then
      info "harness: runtime.gates vazio em todas as fases — nenhum gate declarado (informativo; não reprova, LDG-0013)"
    fi
  fi

  # ── lib órfã: scripts/lib/*.{sh,mjs} que nenhum script, hook ou outra lib menciona (issue #153) ──
  # Copiar `.forge` de outro consumidor é upgrade parcial disfarçado: o alvo herda libs que o
  # ORIGEM usava — e cujo script/hook invocador nunca veio junto. O check de check-*.sh órfão
  # (acima) não cobre isso: cobre gate de NOME FIXO, não biblioteca de propósito geral.
  #
  # INFORMATIVO POR CONSTRUÇÃO: usa `warn` e NUNCA toca MISSING_DIAG — uma lib sem invocador hoje
  # pode ser deliberada (API que o projeto ainda vai usar), e reprovar o doctor por isso ensinaria
  # o operador a ignorá-lo, exatamente o motivo pelo qual `check-*.sh` órfão acima também é `!`.
  #
  # Invocador = menção LITERAL (grep -F, texto puro, NUNCA regex — "git.sh" como regex casa
  # "git show" por acidente, medido) do nome-base do arquivo em qualquer outro arquivo de
  # `scripts/**` ou `hooks/**`. Hooks são extensionless (`hooks/git/post-merge`), por isso a busca
  # não filtra por extensão. Fonte única: é a mesma prova textual que `check-*.sh` órfão já usa
  # contra hooks — um segundo critério (import estático, AST) inventaria um segundo contrato para
  # a mesma pergunta.
  #
  # Duas isenções DECLARADAS — nunca uma allowlist textual nova, e nunca um achado silenciado:
  #   - `lib/transports/*.sh` (exceto `_common.sh`, que os outros transportes sourceiam por nome
  #     literal): dispachados por NOME DINÂMICO em `liaison-ops.sh` ($LIBDIR/transports/
  #     $LIAISON_T_KIND.sh) — nenhuma menção literal do basename existe por desenho. Este script
  #     não decide o transporte ativo nem toca `liaison-ops.sh` (issue #108 trata do liaison).
  #   - `api-surface.mjs` e `pbt.mjs`: API zero-dependência que o harness expõe para os PRÓPRIOS
  #     gates de desenvolvimento (`tests/*.sh`, que não são copiados para o consumidor) e para
  #     gates customizados que o projeto adotante venha a escrever. Investigado, não ignorado:
  #     nenhum script de produção em `template/.forge/scripts` os importa hoje; a issue #153
  #     decidiu declarar a isenção em vez de forjar um invocador artificial.
  if [ -d "$ROOT/.forge/scripts/lib" ]; then
    ol_total=0; ol_orfaos=""
    while IFS= read -r ol_f; do
      [ -n "$ol_f" ] || continue
      ol_total=$((ol_total + 1))
      ol_base="$(basename "$ol_f")"
      case "$ol_f" in
        */lib/transports/*.sh) [ "$ol_base" = "_common.sh" ] || continue ;;
      esac
      case "$ol_base" in
        api-surface.mjs|pbt.mjs) continue ;;
      esac
      if grep -rlF -- "$ol_base" "$ROOT/.forge/scripts" "$ROOT/.forge/hooks" 2>/dev/null \
           | grep -vxF "$ol_f" | grep -q .; then
        continue
      fi
      ol_orfaos="$ol_orfaos $ol_base"
    done <<EOF_OL
$(find "$ROOT/.forge/scripts/lib" -type f \( -name '*.sh' -o -name '*.mjs' \) 2>/dev/null | sort)
EOF_OL
    ol_n=0
    for ol_x in $ol_orfaos; do ol_n=$((ol_n + 1)); done
    # Contador de controle SEMPRE, pelo mesmo motivo do bloco de check-*.sh órfão acima: sem ele,
    # "examinei e estava limpo" e "não examinei nada" terminam no mesmo silêncio.
    if [ "$ol_total" -eq 0 ]; then
      info "harness: libs: 0 arquivo(s) em scripts/lib/ examinado(s) — nenhuma lib instalada"
    elif [ "$ol_n" -eq 0 ]; then
      ok "harness: libs: $ol_total arquivo(s) em scripts/lib/ examinado(s), 0 órfã(s)"
    else
      warn "harness: libs: $ol_total arquivo(s) em scripts/lib/ examinado(s), $ol_n órfã(s) — nenhum script, hook ou outra lib menciona:$ol_orfaos"
      hint "cópia de .forge de outro consumidor traz lib sem o script que a usava lá — decida um invocador ou remova (ver /forge:upgrade)"
    fi
  fi

  # ── divergência de versão: forge.yaml template_version × machinery.lock (issue #153) ──────────
  # Copiar `.forge` de outro consumidor troca o `forge.yaml` (com o `template_version` de quem
  # gerou a cópia) mas deixa o `machinery.lock` velho do destino — ou vice-versa. Nenhum dos dois
  # sozinho denuncia: `forge.yaml` não sabe qual versão aplicou por último, e `machinery.lock` não
  # sabe o que o `forge.yaml` declara. O doctor é o único ponto que lê os dois.
  #
  # INFORMATIVO POR CONSTRUÇÃO: `warn`, nunca `MISSING_DIAG` — o lock só é reescrito por um
  # `update` bem-sucedido, então um consumidor recém-clonado ou que ainda não rodou `update` desde
  # o último bump manual de `forge.yaml` tem divergência LEGÍTIMA, não corrompida.
  tv_yaml="$ROOT/.forge/forge.yaml"
  tv_lock="$ROOT/.forge/cache/machinery.lock"
  if [ -f "$tv_yaml" ]; then
    tv_declared="$(grep -m1 -E '^[[:space:]]*template_version:' "$tv_yaml" 2>/dev/null \
      | sed -E 's/^[^:]*:[[:space:]]*"?([^"[:space:]]*)"?[[:space:]]*$/\1/')"
    if [ -z "$tv_declared" ]; then
      info "harness: versão: forge.yaml sem template_version — nada a comparar contra machinery.lock"
    elif [ ! -f "$tv_lock" ]; then
      info "harness: versão: sem machinery.lock (consumidor nunca rodou update, ou cache foi limpo) — forge.yaml declara $tv_declared, não comparado"
    else
      tv_locked="$(head -1 "$tv_lock" 2>/dev/null | sed -E 's/.*template v([^[:space:]]*).*/\1/')"
      if [ -z "$tv_locked" ] || [ "$tv_locked" = "$(head -1 "$tv_lock" 2>/dev/null)" ]; then
        info "harness: versão: machinery.lock com cabeçalho ilegível — não comparado contra forge.yaml ($tv_declared)"
      elif [ "$tv_declared" = "$tv_locked" ]; then
        ok "harness: versão: forge.yaml template_version ($tv_declared) confere com machinery.lock"
      else
        warn "harness: versão: forge.yaml declara template_version $tv_declared, machinery.lock registra $tv_locked da última aplicação"
        hint "cópia parcial de .forge de outro consumidor, ou forge.yaml editado à mão sem rodar update — confira com: npx forge-harness update"
      fi
    fi
  fi

  # ── divergência de _common.sh (e demais transportes) contra machinery.lock (LDG-0153) ──────────
  # `.forge/cache/machinery.lock` já grava o sha256 de todo arquivo de maquinaria na versão
  # aplicada por último (bin/forge.mjs:361, `writeMachineryLock`), e `bin/forge.mjs:617-643` já usa
  # essa mesma comparação para o WARN de drift do `update`. O doctor nunca fazia a leitura
  # equivalente para `scripts/lib/transports/_common.sh` e os demais transportes — o consumidor só
  # descobria o `_common.sh` divergente quando um push já tinha destruído o hub de liaison, porque
  # ninguém tinha rodado `update` para reconciliar (ou a deriva local nunca foi declarada).
  #
  # INFORMATIVO POR CONSTRUÇÃO: `warn` nomeando o arquivo, nunca `MISSING_DIAG` — o mesmo padrão
  # dos dois checks acima (libs órfã, versão), pelo mesmo motivo: a divergência pode ser legítima
  # (consumidor que ainda não rodou `update`, ou correção local deliberada sem exceção declarada
  # ainda). Sem `machinery.lock` não há como provar nada, e a linha diz exatamente isso — nunca um
  # `✓`, porque "não medido" e "medido e igual" são estados diferentes (mesmo motivo do contador de
  # controle acima: colapsar os dois ensinaria o operador a confiar num silêncio que não mediu
  # nada). Arquivo idêntico ao lock não emite linha nenhuma (contrafactual: medir e concluir
  # igualdade não é notícia neste check, ao contrário do check de "versão" acima, que tem ✓
  # próprio — a diferença é intencional, ver seção LDG-0153 do plano).
  #
  # Exceção viva declarada em `.forge/machinery-exceptions.txt` (mecanismo da #101/#131) troca a
  # linha de divergência pelo nome do arquivo e a razão registrada — decisão humana já feita, cobrar
  # de novo a cada `doctor` seria ruído. Mesma leitura de formato do bloco de TEMPLATE-PENDENTE
  # acima: corte no primeiro `#`, exatamente dois tokens antes dele, sha hex minúsculo com pelo
  # menos 32 dígitos, prefixos `./` e `.forge/` normalizados — só a razão (texto após o `#`) é nova
  # aqui, porque os outros consumidores desse arquivo descartam o comentário.
  tp_dir="$ROOT/.forge/scripts/lib/transports"
  if [ -d "$tp_dir" ]; then
    tp_lock="$ROOT/.forge/cache/machinery.lock"
    if [ ! -f "$tp_lock" ]; then
      info "harness: transports: não medido: sem machinery.lock"
    else
      tp_sha() {
        if have shasum; then shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
        elif have sha256sum; then sha256sum "$1" 2>/dev/null | awk '{print $1}'
        else echo ""
        fi
      }
      while IFS= read -r tp_f; do
        [ -n "$tp_f" ] || continue
        tp_rel="scripts/lib/transports/$(basename "$tp_f")"
        tp_lock_sha="$(grep -E "^[0-9a-f]{64}  ${tp_rel}\$" "$tp_lock" 2>/dev/null | awk '{print $1}' | tail -1)"
        [ -n "$tp_lock_sha" ] || continue  # sem entrada no lock para este caminho: nada a comparar
        tp_local_sha="$(tp_sha "$tp_f")"
        [ -n "$tp_local_sha" ] || continue
        [ "$tp_local_sha" = "$tp_lock_sha" ] && continue  # idêntico: sem linha (contrafactual)
        tp_reason=""
        if [ -f "$ROOT/.forge/machinery-exceptions.txt" ]; then
          while IFS= read -r exc_line || [ -n "$exc_line" ]; do
            exc_reason="${exc_line#*#}"
            [ "$exc_reason" = "$exc_line" ] && exc_reason=""
            exc_body="${exc_line%%#*}"
            exc_body="${exc_body//$'\r'/}"
            read -r exc_sha exc_rel exc_resto <<<"$exc_body" || true
            [ -n "${exc_rel:-}" ] && [ -z "${exc_resto:-}" ] || continue
            [[ "$exc_sha" =~ ^[0-9a-f]{32,}$ ]] || continue
            while [ "${exc_rel#./}" != "$exc_rel" ]; do exc_rel="${exc_rel#./}"; done
            exc_rel="${exc_rel#.forge/}"
            if [ "$exc_rel" = "$tp_rel" ]; then
              tp_reason="$(printf '%s' "$exc_reason" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
              break
            fi
          done < "$ROOT/.forge/machinery-exceptions.txt"
        fi
        if [ -n "$tp_reason" ]; then
          info "harness: transports: $tp_rel diverge do machinery.lock — exceção declarada: $tp_reason"
        else
          warn "harness: transports: $tp_rel diverge do machinery.lock (local $tp_local_sha, lock $tp_lock_sha)"
          hint "declare em .forge/machinery-exceptions.txt se a deriva é deliberada, ou rode npx forge-harness update"
        fi
      done < <(find "$tp_dir" -maxdepth 1 -type f -name '*.sh' 2>/dev/null | sort)
    fi
  fi

  # plugin /forge:* instalado no Claude Code (best-effort; puramente informativo — NUNCA
  # contribui para MISSING_DIAG/exit 1). Sintoma real que motivou o check: usuário colando o
  # CORPO dos comandos como texto porque /forge:* silenciosamente não existia (plugin nunca
  # instalado, ou desabilitado) — e isso é estado GLOBAL do Claude Code do operador, não do
  # projeto, então não pode reprovar doctor/CI (a mesma máquina roda doctor contra fixtures de
  # teste que nada têm a ver com o plugin global instalado).
  if have claude; then
    plugin_ok=0
    if claude plugin list 2>/dev/null | grep -qi 'forge'; then
      plugin_ok=1
    elif [ -d "$HOME/.claude/plugins" ] && grep -rlq '"forge@' "$HOME/.claude/plugins" 2>/dev/null; then
      plugin_ok=1
    elif [ -f "$HOME/.claude/settings.json" ] && grep -q '"forge@' "$HOME/.claude/settings.json" 2>/dev/null; then
      plugin_ok=1
    fi
    if [ "$plugin_ok" -eq 1 ]; then
      ok "harness: plugin /forge:* instalado no Claude Code"
    else
      info "harness: plugin /forge:* não detectado no Claude Code (verificação global, best-effort)"
      hint "instale/repare com: npx forge-harness install-plugin"
    fi
  else
    info "harness: CLI 'claude' não encontrada — check de plugin /forge:* pulado (best-effort)"
  fi
  echo
}
check_harness

DETECTED=""

[ -n "$(find_marker '*.sln')$(find_marker '*.csproj')" ] && DETECTED="$DETECTED dotnet"
{ [ -f package.json ] || [ -f tsconfig.json ] || [ -n "$(find_marker tsconfig.json)" ]; } && DETECTED="$DETECTED node"
{ [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; } && DETECTED="$DETECTED python"
[ -n "$(find_marker 'pom.xml')$(find_marker '*.java')" ] && DETECTED="$DETECTED java"
[ -n "$(find_marker 'build.gradle')$(find_marker 'build.gradle.kts')" ] && DETECTED="$DETECTED kotlin"

if [ -z "$DETECTED" ]; then
  echo "Nenhuma stack reconhecida no repositório (.NET / Node-TS / Python / Kotlin)."
  if [ "$MISSING_DIAG" -eq 1 ]; then
    echo "${RED}Problemas no harness Forge detectados (ver acima).${RST}"
    exit 1
  fi
  echo "Nada a verificar."
  exit 0
fi

echo "Stacks detectadas:${DETECTED}"
echo "Modo: $( [ "$INSTALL" -eq 1 ] && echo 'reportar + instalar (--install)' || echo 'somente reportar' )"
echo

# Capability packs são sugestão explícita, nunca ativação automática. A ativação é uma decisão
# de arquitetura registrada no forge.yaml e os packs só orientam a área onde são aplicáveis.
suggest_pack() {
  local pack="$1"
  if grep -Eq "^[[:space:]]*active:.*${pack}" "$ROOT/.forge/forge.yaml" 2>/dev/null; then
    ok "capability pack ativo: $pack"
  elif [ -f "$ROOT/.forge/capabilities/$pack/PROFILE.md" ]; then
    info "capability pack sugerido: $pack (opt-in)"
    hint "registre em .forge/forge.yaml: capabilities.active: [$pack]"
  fi
}
for stack in $DETECTED; do
  case "$stack" in
    dotnet) suggest_pack backend-dotnet-relational ;;
    node) suggest_pack backend-node-postgres ;;
    java) suggest_pack backend-java-relational ;;
    python) suggest_pack backend-python-relational ;;
  esac
done
echo

# try_install <descrição> <comando-de-instalação...>
try_install() {
  local desc="$1"; shift
  if [ "$INSTALL" -eq 0 ]; then
    hint "instalar: $*"
    return 1
  fi
  echo "      ${DIM}instalando ($desc): $*${RST}"
  if "$@"; then ok "instalado: $desc"; return 0; else miss "falha ao instalar: $desc"; return 1; fi
}

# ── .NET ─────────────────────────────────────────────────────────────────────
check_dotnet() {
  echo ".NET"
  if have dotnet; then
    ok "diagnóstico: dotnet build / dotnet format ($(dotnet --version 2>/dev/null))"
  else
    miss "diagnóstico: dotnet SDK ausente (load-bearing — compilação/format)"
    MISSING_DIAG=1
    hint "instale o .NET SDK: https://dotnet.microsoft.com/download (ou: brew install --cask dotnet-sdk)"
  fi
  # LSP (opcional, informativo)
  if have csharp-ls || have omnisharp; then ok "lsp: csharp-ls/omnisharp presente"
  else info "lsp: csharp-ls/OmniSharp ausente (opcional — VS Code C# Dev Kit já provê)"
       try_install "csharp-ls" dotnet tool install -g csharp-ls || true
  fi
  # Baseline de enforcement de build: o que faz convenção virar erro de compilação.
  # Informativo por decisão — materializar arquivo na raiz do projeto é ato do humano
  # (ou de `--apply`), nunca efeito colateral de um diagnóstico.
  if [ -x "$ROOT/.forge/scripts/dotnet-baseline.sh" ]; then
    if bash "$ROOT/.forge/scripts/dotnet-baseline.sh" --root "$ROOT" --check >/dev/null 2>&1; then
      ok "baseline de build: Directory.Build.props + .editorconfig + CPM no lugar"
    else
      info "baseline de build incompleto (regra em prosa não vira erro de compilação)"
      hint "audite com: bash .forge/scripts/dotnet-baseline.sh --check · materialize com --apply"
    fi
  fi
}

# ── Node / TypeScript ─────────────────────────────────────────────────────────
check_node() {
  echo "Node / TypeScript"
  # tsc: preferir o local do projeto; aceitar global
  if npx --no-install tsc --version >/dev/null 2>&1 || have tsc; then
    ok "diagnóstico: tsc (typescript) disponível"
  else
    miss "diagnóstico: tsc (typescript) ausente (load-bearing — typecheck)"
    MISSING_DIAG=1
    try_install "typescript" npm install -g typescript || true
  fi
  if npx --no-install eslint --version >/dev/null 2>&1 || have eslint; then
    ok "diagnóstico: eslint disponível"
  else
    info "diagnóstico: eslint ausente (recomendado)"
    try_install "eslint" npm install -g eslint || true
  fi
  if have typescript-language-server; then ok "lsp: typescript-language-server presente"
  else info "lsp: typescript-language-server ausente (opcional)"
       try_install "typescript-language-server" npm install -g typescript-language-server || true
  fi
  # Baseline de qualidade de lint: o que faz console.log/import direto de banco/tamanho de
  # arquivo virarem sinal verificável em ESLint em vez de regra em prosa. Informativo por
  # decisão — materializar eslint.config.mjs na raiz do projeto é ato do humano (ou de
  # --apply), nunca efeito colateral de um diagnóstico.
  if [ -x "$ROOT/.forge/scripts/node-baseline.sh" ]; then
    if bash "$ROOT/.forge/scripts/node-baseline.sh" --root "$ROOT" --check >/dev/null 2>&1; then
      ok "baseline de qualidade: eslint.config + forge-quality/* no lugar"
    else
      info "baseline de qualidade incompleto (regra em prosa não vira aviso de lint)"
      hint "audite com: bash .forge/scripts/node-baseline.sh --check · materialize com --apply"
    fi
  fi
}

# ── Python ────────────────────────────────────────────────────────────────────
check_python() {
  echo "Python"
  if have pyright || have mypy; then
    ok "diagnóstico: $(have pyright && echo pyright || echo mypy) disponível"
  else
    miss "diagnóstico: pyright/mypy ausente (load-bearing — typecheck)"
    MISSING_DIAG=1
    if have pipx; then try_install "pyright" pipx install pyright || true
    else hint "instale pipx e: pipx install pyright (ou npm install -g pyright)"; fi
  fi
  if have ruff; then ok "diagnóstico: ruff disponível"
  else info "diagnóstico: ruff ausente (recomendado)"
       if have pipx; then try_install "ruff" pipx install ruff || true; else hint "pipx install ruff"; fi
  fi
  # pyright já serve como LSP; python-lsp-server é alternativa
  if have pyright || have pylsp; then ok "lsp: pyright/pylsp presente"
  else info "lsp: pyright/python-lsp-server ausente (opcional)"; fi
}

# ── Java ──────────────────────────────────────────────────────────────────────
check_java() {
  echo "Java"
  if have java && { have mvn || [ -x ./mvnw ] || have gradle || [ -x ./gradlew ]; }; then
    ok "diagnóstico: Java + build tool disponíveis"
  else
    miss "diagnóstico: Java ou Maven/Gradle ausente (load-bearing — build/test)"
    MISSING_DIAG=1
    hint "instale JDK LTS e use mvnw/gradlew do projeto quando disponíveis"
  fi
  if have java-language-server || have jdtls; then ok "lsp: java-language-server/jdtls presente"
  else info "lsp: java-language-server/jdtls ausente (opcional)"; fi
}

# ── Kotlin / JVM ───────────────────────────────────────────────────────────────
check_kotlin() {
  echo "Kotlin / JVM"
  if [ -x ./gradlew ] || have gradle; then
    ok "diagnóstico: gradle ($( [ -x ./gradlew ] && echo './gradlew' || echo 'gradle' ) compileKotlin)"
  else
    miss "diagnóstico: gradle/gradlew ausente (load-bearing — compileKotlin)"
    MISSING_DIAG=1
    hint "use o wrapper ./gradlew do projeto, ou: brew install gradle"
  fi
  if have ktlint || have detekt; then ok "diagnóstico: ktlint/detekt presente"
  else info "diagnóstico: ktlint/detekt ausente (recomendado)"
       if command -v brew >/dev/null 2>&1; then try_install "ktlint" brew install ktlint || true
       else hint "brew install ktlint (ou via gradle plugin)"; fi
  fi
  if have kotlin-language-server; then ok "lsp: kotlin-language-server presente"
  else info "lsp: kotlin-language-server ausente (opcional)"
       if command -v brew >/dev/null 2>&1; then try_install "kotlin-language-server" brew install kotlin-language-server || true
       else hint "brew install kotlin-language-server"; fi
  fi
}

for stack in $DETECTED; do
  case "$stack" in
    dotnet) check_dotnet ;;
    node)   check_node ;;
    python) check_python ;;
    java)   check_java ;;
    kotlin) check_kotlin ;;
  esac
  echo
done

if [ "$MISSING_DIAG" -eq 1 ] && [ "$INSTALL" -eq 0 ]; then
  echo "${RED}Diagnóstico(s) load-bearing ausente(s).${RST} Rode com --install ou instale manualmente (ver dicas acima)."
  exit 1
fi

echo "${GREEN}OK${RST} — diagnósticos das stacks detectadas disponíveis."
exit 0
