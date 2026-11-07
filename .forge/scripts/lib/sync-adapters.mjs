#!/usr/bin/env node
// sync-adapters — projects .forge/** into tool-specific adapters (§15), installing ONLY the
// adapters a project actually uses (chosen at /forge:init, recorded in forge.yaml). Switching
// the active set reconciles the workspace: missing adapters are generated, removed ones pruned.
//
// Why adapters are materialized (not symlinked to .forge/): each tool discovers commands/
// agents/skills by its OWN folder convention — Claude reads .claude/, Cursor .cursor/, Kiro
// .kiro/ — and none read from .forge/. AGENTS.md (root) is the canonical interface (industry
// standard); CLAUDE/QWEN/GEMINI.md are cheap symlinks to it, generated only for active tools.
//
// Modes:
//   --set <a,b,...>   rewrite the active adapter list in forge.yaml, then reconcile (generate
//                     active + prune deactivated). Used by /forge:init.
//   --adapter all     reconcile against the active list already in forge.yaml (generate + prune).
//   --adapter <name>  regenerate just one adapter (no prune, does not change the active list).
//   --copy-links      materialize CLAUDE/QWEN/GEMINI.md as copies instead of symlinks.
//
// Dependency-free (runs in target projects without node_modules). FORGE.md frontmatter is read
// via targeted extraction for a structure the Forge owns and schema-validates — not generic YAML.
// Deterministic: no timestamps; lockfile entries sorted; running twice is byte-identical.
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, chmodSync,
  existsSync, symlinkSync, lstatSync, unlinkSync, readlinkSync, rmdirSync, realpathSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { lerHooksManifest, DESFECHO } from './hooks-manifest.mjs';

// CliError — marca as validações INTENCIONAIS (FORGE.md ausente, --set vazio, adapter
// desconhecido) que o galho principal converte em `FAIL (mensagem)` de uma linha. Um erro
// inesperado (bug interno, EACCES, ENOTDIR de um `.forge/` corrompido) NÃO é um `CliError` — o
// galho principal imprime o `stack` completo antes do `FAIL (...)`, exatamente como o Node fazia
// por padrão antes de existir este `try/catch` (#130: o catch-all
// original engolia a stack de QUALQUER exceção, não só das validações esperadas).
class CliError extends Error {}

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const SET = opt('set', null);            // comma list → rewrite active set + reconcile
const ADAPTER = opt('adapter', null);    // 'all' | single name
const ROOT = opt('root', process.cwd());
const COPY_LINKS = argv.includes('--copy-links');
const FORGE = join(ROOT, '.forge');
const ADAPTERS_DIR = join(FORGE, 'adapters');

// A checagem de `.forge/FORGE.md` NÃO roda aqui (nível de módulo): rodar `existsSync` é
// inofensivo, mas o `process.exit(1)` que a acompanhava matava qualquer processo que apenas
// importasse o módulo para ler uma exportação, mesmo a partir de um cwd sem projeto Forge — o
// mesmo dano que a #130 fecha para o bloco de entrada, só que por um caminho de módulo diferente
// (issue #130, achado de correção). A checagem amigável ("run /forge:init first") roda como
// `throw` (nunca `process.exit`) na PRIMEIRA linha do galho principal — antes de qualquer leitura
// ou escrita de `forge.yaml` (#130); a checagem repetida no topo de `reconcile()` (interna ao CLI,
// não exportada) é só defesa em profundidade. Só o galho principal,
// ao final do arquivo, converte a exceção em `FAIL (...)` + `exit(1)`.

// ── fs helpers ───────────────────────────────────────────────────────────────
const sha256 = (buf) => 'sha256:' + createHash('sha256').update(buf).digest('hex');
const ensure = (dir) => mkdirSync(dir, { recursive: true });
const writeIfChanged = (path, content) => {
  if (existsSync(path) && readFileSync(path, 'utf8') === content) return;
  ensure(dirname(path));
  writeFileSync(path, content);
};
const exists = (p) => { try { lstatSync(p); return true; } catch { return false; } };

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (entry === '.DS_Store') continue;
    const p = join(dir, entry);
    statSync(p).isDirectory() ? out.push(...walk(p)) : out.push(p);
  }
  return out;
}

function removeEmptyDirs(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return;
  for (const e of readdirSync(dir)) removeEmptyDirs(join(dir, e));
  try { if (readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* not empty */ }
}

// ── FORGE.md frontmatter (targeted extraction) ──────────────────────────────
function fmExtract(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  let section = null;
  for (const line of m[1].split('\n')) {
    const top = line.match(/^([a-z_]+):\s*(.*)$/);
    const sub = line.match(/^ {2}([a-z_]+):\s*(.*)$/);
    if (top) { section = top[1]; if (top[2]) out[section] = top[2]; }
    else if (sub && section) out[`${section}.${sub[1]}`] = sub[2];
  }
  return out;
}
// Lida sob demanda (não no import): ler `FORGE.md` na avaliação do módulo mataria o import de
// quem só quer uma exportação a partir de um cwd sem projeto Forge (mesma classe da #130).
let _fm = null;
function fm() {
  if (_fm === null) _fm = fmExtract(readFileSync(join(FORGE, 'FORGE.md'), 'utf8'));
  return _fm;
}
const val = (k) => fm()[k] ?? '';

// AGENTS.md operational projection (§7.2, header §7.4) — generated by the always-on core step.
let _projected = null;
function projectAgentsMd() {
  if (_projected) return _projected;
  const tpl = readFileSync(join(FORGE, 'templates', 'AGENTS.md'), 'utf8');
  _projected = tpl
    .replaceAll('{{PROJECT_NAME}}', val('project.name'))
    .replaceAll('{{PROJECT_DISPLAY}}', val('project.display'))
    .replaceAll('{{PROJECT_DESCRIPTION}}', val('project.description'))
    .replaceAll('{{REPO_SLUG}}', val('project.repo_slug'))
    .replaceAll('{{DEFAULT_BRANCH}}', val('project.default_branch'))
    .replaceAll('{{JIRA_KEY}}', '')
    .replaceAll('{{JIRA_SITE}}', '')
    .replaceAll('{{ISSUER}}', '')
    .replaceAll('{{RUN_CMD}}', val('runtime.run'))
    .replaceAll('{{TEST_CMD}}', val('runtime.test'))
    .replaceAll('{{TYPECHECK_CMD}}', val('runtime.typecheck'))
    .replaceAll('{{LINT_CMD}}', val('runtime.lint'));
  return _projected;
}

// ── active adapter list in forge.yaml ────────────────────────────────────────
const FORGE_YAML = join(FORGE, 'forge.yaml');
function readActive() {
  const y = readFileSync(FORGE_YAML, 'utf8');
  const m = y.match(/^  adapters:\n((?:    - .*\n)+)/m);
  if (!m) return ['claude'];
  return m[1].split('\n').map((l) => l.replace(/^ {4}- /, '').trim()).filter(Boolean);
}
// readYamlAutoFlag — leitura pura de um `<key>.auto` em um forge.yaml explícito (nunca o global
// FORGE_YAML implícito): usada por preToolUseWiring(root) para que a leitura dependa só do
// argumento, nunca do cwd/argv de quem importou o módulo (#130).
function readYamlAutoFlag(yamlPath, key) {
  try {
    const y = readFileSync(yamlPath, 'utf8');
    const m = y.match(new RegExp(`^${key}:\\n(?:[ ].*\\n)*?[ ]+auto:[ ]*(true|false)`, 'm'));
    return m ? m[1] === 'true' : false;
  } catch { return false; }
}

// readYamlNestedFlag(yamlPath, ['liaison', 'baton', 'auto_renew']) — leitura pura de uma chave
// booleana ANINHADA em qualquer profundidade (TASK-27, design §2.8/§4.4: liaison.baton.auto_renew
// decide a fiação de PostToolUse). `readYamlAutoFlag` não serve aqui — ele só lê `<key>.auto` de
// UM nível e devolve `false` para "ausente", enquanto aqui ausência tem de ser distinguível de
// `false` explícito (design §2.6: auto_renew ausente VALE true; só `auto_renew: false` desliga).
// Por isso devolve `true | false | undefined`, nunca colapsa ausência em `false`.
//
// Rastreia o caminho por indentação, como `readBatonConfig` faz para `liaison.baton.*`, mas para
// profundidade arbitrária: casa o segmento N do caminho só numa linha cuja indentação é MAIOR que
// a do segmento N-1 já casado (filho direto por indentação, não qualquer linha mais abaixo); um
// dedent até a indentação do último segmento casado (ou menor) reinicia a busca do zero, porque
// saiu do bloco daquele pai.
function readYamlNestedFlag(yamlPath, path) {
  let text;
  try { text = readFileSync(yamlPath, 'utf8'); } catch { return undefined; }
  let matchedDepth = 0;
  let matchIndent = -1;
  for (const line of text.split('\n')) {
    const m = line.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];
    const val = m[3].replace(/\s*#.*$/, '').trim();
    if (matchedDepth > 0 && indent <= matchIndent) {
      matchedDepth = 0;
      matchIndent = -1;
    }
    if (key === path[matchedDepth] && indent > matchIndent) {
      matchedDepth += 1;
      matchIndent = indent;
      if (matchedDepth === path.length) {
        if (val === 'true') return true;
        if (val === 'false') return false;
        return undefined;
      }
    }
  }
  return undefined;
}

// preToolUseWiring(root) — exportação nomeada e estável (#130): a
// função que MONTA a fiação PreToolUse/SessionStart/SessionEnd, como um objeto puro, sem
// escrever nada em disco e sem depender do ROOT/cwd de quem importou o módulo — só do `root`
// explícito recebido. É esta função, e não `reconcile` (que escreve), que a #125 e a #160 leem
// para comparar contra o `.claude/settings.json` já materializado (issue #130: `const wiring =
// mod.preToolUseWiring(root)`). `GENERATORS.claude` chama esta mesma função para gerar o
// settings.json real, então as duas leituras nunca divergem.
//
// DESDE A #125, o bloco `PreToolUse` deriva do CONTEÚDO de `.forge/hooks/pre-tool-use/`
// (profundidade 1) mais `hooks.manifest.default` (produtor) e `hooks.manifest` do consumidor,
// quando existir — lidos pelo mesmo leitor canônico de `.forge/scripts/lib/hooks-manifest.mjs`
// (LDG-0178/w208). Antes, o literal abaixo era o ÚNICO gancho emitido, então nenhum outro hook do
// diretório era fiado por padrão e um consumidor que tivesse armado `prevent-secrets-leak.sh` à
// mão perdia essa fiação no primeiro `sync`/`update` que reconciliasse o `settings.json` do zero.
// Ver `derivePreToolUseHooks` para o desenho completo.
// ASPAS EM `$CLAUDE_PROJECT_DIR` — achado de correção LOW (mesmo raciocínio que motivou as aspas em
// PreToolUse, achado MEDIUM acima): sem elas, um caminho de projeto com espaço expande a variável
// em duas palavras e o comando emitido sai `rc=127` (comando não encontrado) em vez de `rc=0` — com
// `handoff.auto` ligado, o handoff falha em silêncio nesses caminhos. As formas EMITIDAS por este
// gerador passam a citar `"$CLAUDE_PROJECT_DIR"` entre aspas; as formas *Legacy* (sem aspas)
// continuam reconhecidas no universo OWNED, só para migrar um consumidor já fiado (a nova forma
// substitui a legada no próximo sync) sem duplicar entrada — mesma técnica de `hookCommandDirect`/
// `hookCommandDirectLegacy`.
const CMD_SESSION_START = '"$CLAUDE_PROJECT_DIR"/.forge/hooks/session/on-session-start.sh';
const CMD_SESSION_START_LEGACY = '$CLAUDE_PROJECT_DIR/.forge/hooks/session/on-session-start.sh';
const CMD_SESSION_END = '"$CLAUDE_PROJECT_DIR"/.forge/hooks/session/on-session-end.sh';
const CMD_SESSION_END_LEGACY = '$CLAUDE_PROJECT_DIR/.forge/hooks/session/on-session-end.sh';
// CMD_POST_TOOL_USE — renovação automática do bastão (TASK-26/27, design §2.8/§4.4). Mesma
// família de ganchos de sessão (hooks/session/), fora do hooks.manifest do PreToolUse: não é um
// gancho de arquivo (bash/edit/write), dispara em TODA ferramenta (matcher '.*'). Sem forma
// *Legacy*: é gancho novo, nunca existiu sem aspas em `$CLAUDE_PROJECT_DIR` para migrar.
const CMD_POST_TOOL_USE = '"$CLAUDE_PROJECT_DIR"/.forge/hooks/session/on-post-tool-use.sh';

// hookCommandDirect/hookCommandBridge — as DUAS únicas formas de comando que este gerador pode
// emitir para um gancho de `pre-tool-use/`: direta (contrato `stdin-json`, o próprio gancho lê o
// payload) ou através da ponte `lib/argv-bridge.sh` (contrato `argv`, o gancho só sabe ler `$1`,
// e o Claude Code nunca entrega por argv). `ownedHookCommandsFor` usa as duas formas, para TODO
// `.sh` presente no diretório, como o universo COMPLETO de comandos que este gerador pode ter
// emitido em qualquer versão sua — é por IGUALDADE DE STRING contra esse universo, nunca pela
// simples menção a `.forge/hooks/`, que `mergeHooksObject` decide se uma entrada já existente em
// `.claude/settings.json` é dona do gerador (substituível) ou de terceiro (preservada). Um
// consumidor real (axis-fare-validator, medido) tem um wrapper próprio
// (`dispatch-file-hook.sh $CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/<gancho>.sh`) que também
// cita `.forge/hooks/` sem SER nenhuma das duas formas exatas — perdê-lo seria o mesmo dano que
// esta issue fecha.
//
// ASPAS EM `$CLAUDE_PROJECT_DIR` — achado de correção MEDIUM (revisão adversarial, iteração 3 do
// modo correção): a forma sem aspas quebra em qualquer caminho de projeto com espaço — o shell
// expande `$CLAUDE_PROJECT_DIR` em duas palavras, o token final vira um diretório (não um `.sh`),
// e a invocação sai `rc=126` ("is a directory") em vez de `rc=2`. O Claude Code trata qualquer rc
// diferente de 2 como não bloqueante, então um detector "fail-closed" fica fail-open em silêncio
// exatamente no tipo de caminho mais comum em estações de trabalho (`~/Library/CloudStorage/...`,
// "Meu Drive", diretórios com nome de projeto com espaço). As formas EMITIDAS por este gerador
// passam a citar `"$CLAUDE_PROJECT_DIR"` entre aspas; as formas *Legacy* (sem aspas) continuam no
// universo OWNED e em `findWiredForms`, nunca removidas do vocabulário reconhecido, só para que um
// consumidor que já tinha a forma antiga fiada seja migrado (matcher preservado, comando trocado
// para a forma com aspas) em vez de perder a fiação por não bater a igualdade de string.
const hookCommandDirect = (hook) => `"$CLAUDE_PROJECT_DIR"/.forge/hooks/pre-tool-use/${hook}`;
const hookCommandDirectLegacy = (hook) => `$CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/${hook}`;
const hookCommandBridge = (hook) =>
  `"$CLAUDE_PROJECT_DIR"/.forge/hooks/pre-tool-use/lib/argv-bridge.sh "$CLAUDE_PROJECT_DIR"/.forge/hooks/pre-tool-use/${hook}`;
const hookCommandBridgeLegacy = (hook) =>
  `$CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/lib/argv-bridge.sh $CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/${hook}`;
const hookCommand = (hook, contrato) => (contrato === 'argv' ? hookCommandBridge(hook) : hookCommandDirect(hook));

function listHookFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.sh')).sort();
}

// declaredHookNames(hooksDir) — achado de correção HIGH (revisão adversarial, 2ª iteração): o
// universo OWNED não pode ser "todo `.sh` presente no diretório", porque `.forge/hooks/pre-tool-use/`
// abriga também ganchos AUTORAIS de um consumidor (medido: `guard-machinery-drift.sh` e
// `enforce-docs-on-publish.sh` do axis-fare-validator moram ali, ao lado dos quatro do template).
// Um consumidor sem `hooks.manifest` que tenha fiado à mão um `.sh` seu, de nome não conhecido do
// produtor, via a mesma forma de comando (`$CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/<hook>`)
// que este gerador usa para os PRÓPRIOS ganchos — teria essa fiação classificada como "do gerador"
// e removida no primeiro `sync`, sem que a derivação soubesse recriá-la (não está em nenhum dos
// dois manifestos), a MESMA classe de desarme silencioso que esta issue existe para fechar, só que
// pela ponta do consumidor. O universo owned é só quem está DECLARADO — em `hooks.manifest.default`
// (o produtor) e/ou em `hooks.manifest` do consumidor (que, ao declarar um `.sh` seu ali, assume a
// responsabilidade por ele perante este gerador). Um `.sh` presente e não declarado em nenhum dos
// dois nunca entra no universo owned, e por isso nunca é removido pelo `mergeHooksObject` — fica
// como terceiro, preservado byte a byte, exatamente como um wrapper de dispatch.
function declaredHookNames(hooksDir) {
  const names = new Set();
  const defaultText = readManifestFile(join(hooksDir, 'hooks.manifest.default'));
  if (defaultText) {
    const lido = lerHooksManifest(defaultText, { fiacao: null, origem: 'hooks.manifest.default' });
    for (const d of lido.declaracoes || []) names.add(d.hook);
  }
  const consumerText = readManifestFile(join(hooksDir, 'hooks.manifest'));
  if (consumerText != null) {
    // `fiacao: null` aqui é DELIBERADO: este helper só quer os NOMES declarados (colunas 1 a 3),
    // nunca a ativação — que depende da fiação real e é recalculada à parte, com a fiação
    // verdadeira, por `derivePreToolUseHooks`. Em modo de projeção sem fiação o desfecho é
    // NAO_VERIFICADO, mas `declaracoes` já vem populado (ver `hooks-manifest.mjs:projetar`), que é
    // tudo que este helper lê. Em modo canônico malformado (RECUSA), `declaracoes` pode vir parcial
    // ou vazio — inofensivo aqui: quando o manifesto do consumidor recusa, `derivePreToolUseHooks`
    // marca `unresolved` e devolve `.claude/settings.json` byte-idêntico sem consultar este `ownedSet`.
    const lido = lerHooksManifest(consumerText, { fiacao: null, origem: '.forge/hooks/pre-tool-use/hooks.manifest' });
    for (const d of lido.declaracoes || []) names.add(d.hook);
  }
  return names;
}

function ownedHookCommandsFor(root) {
  const set = new Set([CMD_SESSION_START, CMD_SESSION_END, CMD_SESSION_START_LEGACY, CMD_SESSION_END_LEGACY, CMD_POST_TOOL_USE]);
  const hooksDir = join(root, '.forge', 'hooks', 'pre-tool-use');
  for (const hook of declaredHookNames(hooksDir)) {
    set.add(hookCommandDirect(hook));
    set.add(hookCommandBridge(hook));
    set.add(hookCommandDirectLegacy(hook));
    set.add(hookCommandBridgeLegacy(hook));
  }
  return set;
}

function readManifestFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// readExistingPreToolUseGroups(root) — `null` quando `.claude/settings.json` não existe OU é
// ilegível (consumidor NOVO: não há "já fiado" de onde semear); `[]` quando existe, é legível e
// não tem `hooks.PreToolUse` (consumidor existente sem nenhum gancho de arquivo fiado ainda).
function readExistingPreToolUseGroups(root) {
  const settingsPath = join(root, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const groups = parsed?.hooks?.PreToolUse;
    return Array.isArray(groups) ? groups : [];
  } catch { return null; }
}

// dispatchedHookNames(groups, ownedSet) — os basenames de gancho alcançáveis por uma cadeia de
// TERCEIRO que passa pelo NOSSO diretório canônico (`.forge/hooks/pre-tool-use/`) — o caso medido
// do axis-fare-validator, cujo `dispatch-file-hook.sh` despacha para
// `$CLAUDE_PROJECT_DIR/.forge/hooks/pre-tool-use/<gancho>.sh`. Reimplementa localmente a mesma
// leitura estrutural de `derivarFiacao` (comandos simples, alvo = último token `.sh`) em vez de
// delegar a ela, porque `derivarFiacao` (LDG-0178/w208, compartilhada com a projeção do
// `hooks.manifest` do consumidor) casa por BASENAME sozinho, de propósito, para aquele uso — mas
// isso confundiria um script de terceiro que só COINCIDE no nome (`.claude/hooks/pre-tool-use/
// prevent-secrets-leak.sh`, medido no vellus-enterprise-ai-platform) com o nosso gancho homônimo
// sob `.forge/hooks/pre-tool-use/`, fazendo o gerador se abster de emitir a entrada PRÓPRIA por
// julgar (errado) que ela já é alcançável em outro lugar.
// findWiredForms(existingGroups, hook) — achado de correção HIGH (revisão adversarial, 2ª
// iteração; ampliado na iteração 3 do modo correção): devolve TODAS as `{ matcher, contrato }` dos
// grupos onde `hook` já está fiado por uma das formas de comando exatas que este gerador emite ou
// já emitiu (`hookCommandDirect`/`hookCommandBridge`, e as formas *Legacy* sem aspas — ver acima),
// nunca só a PRIMEIRA. Um gancho fiado sob MAIS DE UM matcher ao mesmo tempo (medido: o mesmo
// comando de `prevent-secrets-leak.sh` fiado separadamente sob `{Bash}` e sob
// `{Edit|MultiEdit}`) é um estado real de campo, não um erro de configuração — e devolver só o
// primeiro fazia o semeador reemitir o gancho só sob ESSE matcher, enquanto `mergeHooksObject`
// remove TODAS as ocorrências (o comando é owned em qualquer matcher). O resultado, sem esta
// correção, era perder cobertura em silêncio: o gancho continuava "fiado" no sentido do gerador,
// mas deixava de rodar para os eventos do(s) matcher(es) descartado(s) — exatamente a classe de
// dano que esta issue existe para fechar, só que pela ponta do próprio semeador em vez da do
// `sync-adapters.mjs` do template.
//
// IGUALDADE DE STRING contra o caminho canônico completo, nunca casamento por basename —
// `derivarFiacao` (LDG-0178/w208) casa só o último token `.sh`, de propósito, para projetar o
// `hooks.manifest` de um consumidor que TAMBÉM controla o diretório; usada aqui ela confundiria um
// script de TERCEIRO que só COINCIDE no nome, fiado noutro caminho qualquer (`.claude/hooks/...`),
// com o nosso gancho homônimo — armando por engano um detector que nunca esteve realmente ativo.
//
// DECISÃO REGISTRADA (achado de correção MEDIUM, revisão adversarial da 2ª iteração): no MODO
// SEMEADOR (sem `hooks.manifest` do consumidor), `doctor.sh` (`_settings_hooks_is_derived`,
// LDG-0189) compara uma projeção de `.claude/settings.json` contra uma chamada fresca de
// `preToolUseWiring(root)` — e essa chamada fresca também lê o MESMO `.claude/settings.json` para
// decidir o(s) matcher(es) preservado(s) aqui. Corromper só o MATCHER de um gancho já semeado (sem
// tocar o comando) deixa de ser detectado como drift: as duas leituras concordam sobre o valor
// corrompido, porque as duas partem do mesmo arquivo. Esse é o MESMO ponto cego que já existia
// para corrupção de COMANDO desde antes desta correção (um comando alterado a ponto de não bater
// nenhuma das formas conhecidas já fazia a derivação "concordar" em não tê-lo armado); a
// preservação de matcher desta correção só ESTENDE o ponto cego ao matcher, pelo mesmo mecanismo.
// Aceito como "desarme consciente" (`tests/w238-settings-json-merge-gate.sh` [6b]) porque a
// alternativa — matcher fixo do produtor, ignorando o que o consumidor já tinha — é o próprio
// alargamento de escopo não anunciado que a correção HIGH acima existe para fechar (achado de
// correção HIGH: NotebookEdit entrando sem aviso num matcher legado `Edit|Write`). Quando o
// CONSUMIDOR tem `hooks.manifest` próprio, o matcher vem do MANIFESTO — uma fonte independente do
// `.claude/settings.json` sendo comparado —, e o doctor continua detectando a mesma corrupção
// normalmente (`tests/w238-settings-json-merge-gate.sh` [6e]): o ponto cego é só do modo semeador.
function findWiredForms(existingGroups, hook) {
  const formas = [
    { cmd: hookCommandDirect(hook), contrato: 'stdin-json' },
    { cmd: hookCommandDirectLegacy(hook), contrato: 'stdin-json' },
    { cmd: hookCommandBridge(hook), contrato: 'argv' },
    { cmd: hookCommandBridgeLegacy(hook), contrato: 'argv' },
  ];
  const out = [];
  for (const g of existingGroups || []) {
    if (!g || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (!h || typeof h.command !== 'string') continue;
      const cmd = h.command.trim();
      const achado = formas.find((f) => f.cmd === cmd);
      if (achado) out.push({ matcher: g.matcher, contrato: achado.contrato });
    }
  }
  return out;
}

function dispatchedHookNames(groups, ownedSet) {
  const PREFIX = '.forge/hooks/pre-tool-use/';
  const out = new Set();
  for (const g of groups || []) {
    if (!g || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (!h || typeof h.command !== 'string' || ownedSet.has(h.command)) continue;
      for (const simples of h.command.split(/;|&&|\|\||\||&|\n/)) {
        const alvos = simples.trim().split(/\s+/).filter(Boolean)
          .map((t) => t.replace(/^[\s'"(]+/, '').replace(/[\s'")]+$/, ''));
        if (!alvos.length) continue;
        const last = alvos[alvos.length - 1];
        if (last.endsWith('.sh') && last.includes(PREFIX)) out.add(last.split('/').pop());
      }
    }
  }
  return out;
}

// derivePreToolUseHooks(root) — o desenho da #125. Devolve { groups, avisos, unresolved,
// ownedSet }: `groups` é o array pronto para `hooks.PreToolUse` (só os ganchos ATIVOS); `avisos`
// nomeia toda decisão que mereça ficar visível no stdout de quem chama (nunca aqui — ver
// `GENERATORS.claude`); `unresolved` é true quando o `hooks.manifest` do consumidor existe mas o
// leitor canônico recusou ou não conseguiu verificar (LDG-0178), OU quando não há
// `hooks.manifest.default` nem `hooks.manifest` do consumidor — em AMBOS os casos só quando já
// existe um `.claude/settings.json` legível anterior (`existingGroups != null`), que é o que
// justifica preservar em vez de reconstruir. Quem chama congela SÓ a categoria `hooks.PreToolUse`
// (ver `frozenCategories` em `mergeHooksObject`), nunca o arquivo inteiro — `SessionStart`/
// `SessionEnd` continuam derivados normalmente. Achado de correção HIGH (revisão adversarial,
// iteração 3 do modo correção): SEM `.claude/settings.json` legível (`existingGroups == null`),
// "manter como estava" não tem referente — não há fiação anterior para preservar — e por isso o
// manifesto do consumidor não resolvido NÃO marca `unresolved`; a derivação cai no caminho de
// instalação nova (precedência 3 abaixo), porque persistir um `PreToolUse` vazio nesse ponto
// criaria uma "vacuidade" legível e silenciosa que o PRÓXIMO `sync` leria como fiação observada,
// nunca mais avisando (o mesmo desarme que esta issue existe para fechar).
//
// PRECEDÊNCIA, por gancho presente no diretório:
//   1. reachable via cadeia de TERCEIRO já existente (ex.: dispatch-file-hook.sh de um
//      consumidor) — o gerador não adiciona entrada própria, e não duplica.
//   2. hooks.manifest do CONSUMIDOR, se existir e resolver (OK ou vacuidade) — matcher, contrato
//      e estado vêm de lá.
//   3. sem manifesto de consumidor, sem settings.json ainda (instalação nova) — usa o ESTADO
//      PADRÃO de hooks.manifest.default (produtor).
//   4. sem manifesto de consumidor, COM settings.json existente (semeador) — deriva o estado do
//      que já está fiado hoje: gancho fiado nasce ativo, gancho não fiado nasce inativo e
//      NOMEADO. Nenhum consumidor ganha bloqueio novo sem saber (alternativa descartada na seção
//      do plano: armar tudo no update).
//   Gancho presente no diretório e ausente dos dois manifestos é IGNORADO com aviso nomeado —
//   nunca reprovação (caso medido: `dispatch-file-hook.sh`, que é despachante, não gancho).
function derivePreToolUseHooks(root) {
  const hooksDir = join(root, '.forge', 'hooks', 'pre-tool-use');
  const hookFiles = listHookFiles(hooksDir);
  const ownedSet = ownedHookCommandsFor(root);
  const existingGroups = readExistingPreToolUseGroups(root);

  const avisos = [];

  const defaultText = readManifestFile(join(hooksDir, 'hooks.manifest.default'));
  const defaultDecls = new Map();
  if (defaultText) {
    const lidoDefault = lerHooksManifest(defaultText, { fiacao: null, origem: 'hooks.manifest.default' });
    for (const d of lidoDefault.declaracoes || []) defaultDecls.set(d.hook, d);
  }

  const consumerText = readManifestFile(join(hooksDir, 'hooks.manifest'));
  let consumerDecls = null;
  let unresolved = false;
  // Nomes citados pelo manifesto do consumidor quando ele existe mas não resolve e não há
  // `.claude/settings.json` (caminho de instalação nova abaixo). Sem esta restrição, o 1º sync
  // armava pelo default um gancho que o consumidor nunca declarou e o 2º sync, já com fiação
  // observada, o desarmava: o conjunto oscilava entre o 1º e o 2º sync (medido quando
  // o gancho de saída de mensagens entre sessões entrou armado no default, change
  // add-liaison-native-bridge).
  let consumerNamedOnly = null;
  if (consumerText != null) {
    const lido = lerHooksManifest(consumerText, {
      fiacao: existingGroups,
      origem: '.forge/hooks/pre-tool-use/hooks.manifest',
    });
    if (lido.desfecho === DESFECHO.RECUSA || lido.desfecho === DESFECHO.NAO_VERIFICADO) {
      if (existingGroups == null) {
        // Achado de correção HIGH (revisão adversarial, iteração 3 do modo correção): sem
        // `.claude/settings.json` legível ainda, "permanece como estava" não tem referente — não
        // há fiação anterior para preservar. Persistir `{ hooks: {} }` neste ponto (o que o ramo
        // `unresolved` fazia antes desta correção) CRIA um estado que o próximo `sync` lê como
        // fiação observada VAZIA e LEGÍVEL: `hooks-manifest.mjs:projetar` então resolve o mesmo
        // manifesto-sem-marcador como VACUIDADE (não como NAO_VERIFICADO), porque a projeção passa
        // a enxergar `existingGroups=[]` em vez de `null` — e VACUIDADE não é um desfecho
        // 'unresolved' aqui, então nenhum WARN sai a partir do segundo `sync`, e o desarme fica
        // permanente e silencioso (medido: `check-language-policy.sh` etc. saem inativos para
        // sempre, sem nenhuma linha nomeando o motivo). A resposta é cair no MESMO caminho de uma
        // instalação nova (`hooks.manifest.default` decide, `existingGroups == null` abaixo) em
        // vez de gravar uma vacuidade fabricada pelo próprio gerador.
        avisos.push(
          `LDG-0178: .forge/hooks/pre-tool-use/hooks.manifest não foi resolvido pelo leitor canônico (${lido.mensagem}) — sem .claude/settings.json anterior para preservar, a fiação parte de hooks.manifest.default (instalação nova)`,
        );
        consumerNamedOnly = new Set(
          consumerText.split('\n')
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#'))
            .map((l) => l.split(/\s+/)[0])
            .filter((h) => h.endsWith('.sh')),
        );
      } else {
        unresolved = true;
        avisos.push(
          `LDG-0178: .forge/hooks/pre-tool-use/hooks.manifest não foi resolvido pelo leitor canônico (${lido.mensagem}) — hooks.PreToolUse de .claude/settings.json permanece como estava`,
        );
      }
    } else {
      // `lido.declaracoes[].armado` vem `null` no modo de PROJEÇÃO (hooks-manifest.mjs não
      // reescreve a declaração depois de derivar `ativos`/`inativos` — a decisão fica só nesses
      // dois arrays de nomes). `lido.ativos` é a fonte de verdade da ativação nos dois modos.
      consumerDecls = new Map();
      const ativosSet = new Set(lido.ativos);
      for (const d of lido.declaracoes) {
        consumerDecls.set(d.hook, { matcher: d.matcher, contrato: d.contrato, armado: ativosSet.has(d.hook) });
      }
      for (const a of lido.avisos) avisos.push(a);
    }
  }

  if (unresolved) {
    return { groups: [], avisos, unresolved: true, ownedSet };
  }

  // Achado de correção MEDIUM (revisão adversarial, 2ª iteração): sem `hooks.manifest.default`
  // (exceção de maquinaria que preservou `hooks/` sem o arquivo novo do produtor) E sem
  // `hooks.manifest` do consumidor, o gerador não tem NENHUMA fonte de matcher/contrato — nem para
  // reconhecer os próprios quatro ganchos do template, nem para distinguir um `.sh` autoral do
  // consumidor de um `.sh` nosso. Nessa lacuna dupla de informação, apagar a fiação existente para
  // reconstruí-la do zero é o MESMO desarme que esta issue fecha, só que por causa raiz diferente
  // — e tentar reconstruí-la por adivinhação estrutural (todo `.sh` sob o diretório canônico, fiado
  // por comando direto) armaria por engano um `.sh` de TERCEIRO só por ele morar no mesmo
  // diretório (o dano da correção HIGH acima). A resposta honesta é não mexer: `PreToolUse`
  // permanece byte a byte como estava, e o WARN nomeia a lacuna em vez de fingir que resolveu.
  if (defaultText == null && consumerText == null && existingGroups != null) {
    avisos.push(
      'hooks.manifest.default ausente e .forge/hooks/pre-tool-use/hooks.manifest ausente — PreToolUse permanece como estava (sem fonte de matcher/contrato para derivar ou reconciliar com segurança)',
    );
    return { groups: [], avisos, unresolved: true, ownedSet: new Set([CMD_SESSION_START, CMD_SESSION_END, CMD_SESSION_START_LEGACY, CMD_SESSION_END_LEGACY, CMD_POST_TOOL_USE]) };
  }

  const foreignReachable = dispatchedHookNames(existingGroups || [], ownedSet);

  // Uma vez que o CONSUMIDOR tenha o próprio hooks.manifest (arquivo presente e resolvido — OK ou
  // vacuidade), ele é quem decide TODO gancho do diretório: um gancho presente e não mencionado
  // nesse manifesto é ignorado (nomeado), mesmo que hooks.manifest.default o declare — o dono do
  // manifesto local optou por não se pronunciar sobre ele, e completar por trás com o default do
  // produtor seria decidir por ele. Sem manifesto de consumidor (arquivo ausente), o produtor
  // decide: hooks.manifest.default para uma instalação nova, ou o semeador (fiação já observada)
  // para uma árvore existente.
  const order = [];
  const byMatcher = new Map();
  // Achado de correção MEDIUM: uma versão mista tronco×worktree pode fazer o mesmo gancho aparecer
  // DUAS VEZES em `findWiredForms` sob o MESMO matcher — uma vez na forma legada (reconhecida pela
  // lib antiga do tronco, que já escreveu essa forma em `.claude/settings.json`) e outra na forma
  // nova (escrita por uma lib mais recente no mesmo arquivo) — e `emit()` reemitia as duas, já
  // migradas para a forma com aspas, produzindo uma duplicata ESTÁVEL: o gancho passa a rodar duas
  // vezes por evento, e o próprio `doctor.sh` não acusa drift porque a projeção fresca reconta as
  // mesmas duas entradas. `emitted` deduplica por (matcher, comando emitido) — nunca só por
  // matcher, que colapsaria matchers distintos de propósito (cenário [21], gancho fiado sob dois
  // matchers ao mesmo tempo) — preservando cada ocorrência ÚNICA e descartando repetições
  // equivalentes (legada+nova, ou a mesma forma citada mais de uma vez).
  const emitted = new Set();
  // emit(hook, matcher, contrato) — sempre a forma NOVA de comando (`hookCommand`, com aspas em
  // `$CLAUDE_PROJECT_DIR` desde o achado de correção MEDIUM), mesmo quando o matcher foi herdado de
  // uma forma *Legacy* já fiada (`findWiredForms`): a migração troca o COMANDO para a forma segura,
  // preservando só o MATCHER que o consumidor já tinha escolhido.
  function emit(hook, matcher, contrato) {
    const command = hookCommand(hook, contrato);
    const chave = `${matcher}\u0000${command}`;
    if (emitted.has(chave)) return;
    emitted.add(chave);
    if (!byMatcher.has(matcher)) { byMatcher.set(matcher, []); order.push(matcher); }
    byMatcher.get(matcher).push({ type: 'command', command });
  }
  for (const hook of hookFiles) {
    if (foreignReachable.has(hook)) {
      avisos.push(`'${hook}' já é alcançado por uma cadeia de terceiro em .claude/settings.json — nenhuma entrada própria adicionada`);
      continue;
    }
    if (consumerDecls) {
      const fromConsumer = consumerDecls.get(hook);
      if (!fromConsumer) {
        avisos.push(`'${hook}' está em .forge/hooks/pre-tool-use/ e não está declarado em hooks.manifest — ignorado`);
        continue;
      }
      if (fromConsumer.armado) emit(hook, fromConsumer.matcher, fromConsumer.contrato);
      continue;
    }
    const fromDefault = defaultDecls.get(hook);
    if (!fromDefault) {
      avisos.push(`'${hook}' está em .forge/hooks/pre-tool-use/ e não está declarado em hooks.manifest.default — ignorado`);
      continue;
    }
    if (existingGroups == null) {
      if (consumerNamedOnly && !consumerNamedOnly.has(hook)) {
        avisos.push(`'${hook}' não está declarado em .forge/hooks/pre-tool-use/hooks.manifest — ignorado (o manifesto do consumidor decide os ganchos do diretório)`);
        continue;
      }
      if (fromDefault.armado) emit(hook, fromDefault.matcher, fromDefault.contrato);
      continue;
    }
    // Semeador — achado de correção HIGH (revisão adversarial, 2ª iteração; ampliado na 3ª
    // iteração): "já fiado" é decidido por IGUALDADE DE STRING contra as formas de comando
    // canônicas (`findWiredForms`, atual e legada), nunca pela leitura por BASENAME de
    // `derivarFiacao` — que casaria por engano um script de TERCEIRO homônimo fiado noutro caminho
    // (`.claude/hooks/pre-tool-use/prevent-secrets-leak.sh`, medido no
    // vellus-enterprise-ai-platform) como se fosse o nosso gancho já armado. Um gancho pode estar
    // fiado sob MAIS DE UM matcher ao mesmo tempo — `findWiredForms` devolve TODAS as ocorrências,
    // e cada uma é reemitida sob o PRÓPRIO matcher, sem colapsar na primeira: reemitir só uma
    // perderia cobertura em silêncio no matcher descartado (o `mergeHooksObject` remove TODAS as
    // ocorrências do comando, porque ele é owned em qualquer matcher). O MATCHER e o CONTRATO
    // herdados são sempre os que o CONSUMIDOR já tinha fiado, nunca os do `hooks.manifest.default`
    // — sobrescrever pelo do produtor alargaria em silêncio o escopo de um gancho que o consumidor
    // restringiu de propósito (medido: matcher legado `Edit|Write`, sem `NotebookEdit`, virando
    // `^(Write|Edit|MultiEdit|NotebookEdit)$` sem aviso nenhum no primeiro `sync` desta correção).
    const wiredForms = findWiredForms(existingGroups, hook);
    if (wiredForms.length) {
      for (const { matcher, contrato } of wiredForms) emit(hook, matcher, contrato);
    } else {
      avisos.push(`'${hook}' não estava fiado em .claude/settings.json — nasce inativo; declare .forge/hooks/pre-tool-use/hooks.manifest para ativar`);
    }
  }

  const groups = order.map((matcher) => ({ matcher, hooks: byMatcher.get(matcher) }));
  return { groups, avisos, unresolved: false, ownedSet };
}

export function preToolUseWiring(root) {
  const forgeYaml = join(root, '.forge', 'forge.yaml');
  const { groups } = derivePreToolUseHooks(root);
  const hooks = {};
  if (groups.length) hooks.PreToolUse = groups;
  const handoffAuto = readYamlAutoFlag(forgeYaml, 'handoff');
  const ledgerAuto = readYamlAutoFlag(forgeYaml, 'ledger');
  const liaisonAuto = readYamlAutoFlag(forgeYaml, 'liaison');
  // SessionStart injeta o handoff, os itens do ledger e/ou o resumo do inbox do liaison — o hook
  // decide o quê lendo o forge.yaml, então basta um dos flags para materializá-lo.
  if (handoffAuto || ledgerAuto || liaisonAuto) {
    hooks.SessionStart = [{ hooks: [{ type: 'command', command: CMD_SESSION_START }] }];
  }
  // SessionEnd regenera o scaffold do handoff (handoff.auto) e/ou roda o diagnóstico de
  // cobertura `native check --report` do liaison (liaison.auto, REQ-08, design §2.6) — basta um
  // dos dois flags para materializar o hook; o `.sh` decide internamente o que de fato roda.
  if (handoffAuto || liaisonAuto) {
    hooks.SessionEnd = [{ hooks: [{ type: 'command', command: CMD_SESSION_END }] }];
  }
  // PostToolUse — renovação automática do bastão (TASK-26/27, REQ-12, design §2.8): liga quando
  // liaison.auto está ligado E liaison.baton.auto_renew não é false (ausente VALE true, design
  // §2.6 — por isso readYamlNestedFlag, não readYamlAutoFlag, que colapsaria ausência em false).
  // Categoria DERIVADA, como SessionStart/SessionEnd: nunca congelada, nunca duplicada (o mesmo
  // ownedSet que decide PreToolUse decide esta).
  const batonAutoRenew = readYamlNestedFlag(forgeYaml, ['liaison', 'baton', 'auto_renew']);
  if (liaisonAuto && batonAutoRenew !== false) {
    hooks.PostToolUse = [{ matcher: '.*', hooks: [{ type: 'command', command: CMD_POST_TOOL_USE }] }];
  }
  return hooks;
}

// mergeHooksObject(existingHooks, derivedHooks, ownedSet, frozenCategories) — issue #160/#125:
// pura, sem I/O. Para cada categoria (PreToolUse/SessionStart/SessionEnd, ou qualquer categoria de
// terceiro nunca emitida por este gerador), remove das entradas JÁ EXISTENTES só os itens cujo
// `command` bate por IGUALDADE DE STRING com `ownedSet` (issue #125: `ownedHookCommandsFor(root)`,
// calculado a partir do CONTEÚDO de `.forge/hooks/pre-tool-use/` — antes desta issue era um `Set`
// fixo de três comandos); um grupo {matcher, hooks:[...]} que fica sem nenhum hook
// depois da remoção é descartado por inteiro (era só do gerador). O que sobra (hooks de terceiro,
// de qualquer matcher) entra ANTES dos grupos recém-derivados, sempre na mesma ordem relativa —
// é essa ordem estável, não uma fusão por matcher, que torna dois `sync` seguidos byte-idênticos:
// na segunda passada, o grupo próprio já reaparece como "existente" e volta a ser removido antes
// de ser reemitido, sem duplicar.
//
// `frozenCategories` — achado de correção MEDIUM (revisão adversarial, iteração 3 do modo
// correção): uma categoria nomeada aqui (hoje só `PreToolUse`, quando `derivePreToolUseHooks`
// devolve `unresolved: true`) sai IDÊNTICA ao que já estava em `existingHooks`, sem passar pelo
// filtro de `ownedSet` nem receber `derivedGroups` — o congelamento é ESCOPADO a essa categoria, e
// nunca ao `.claude/settings.json` inteiro. Antes desta correção, "manifesto do consumidor não
// resolvido" congelava o ARQUIVO INTEIRO (o chamador emitia `existingSettingsText` byte a byte),
// levando junto `SessionStart`/`SessionEnd` — que não têm NADA a ver com a resolução de
// `hooks.manifest` de PreToolUse — e ignorando em silêncio as flags `handoff.auto`/`ledger.auto`/
// `liaison.auto` do `forge.yaml` sempre que o manifesto do consumidor estivesse em esquema não
// reconhecido (medido: `handoff.auto: true` sem `hooks.manifest.default` no diretório não produzia
// `SessionStart` nenhum, e nenhuma linha avisava disso).
function mergeHooksObject(existingHooks, derivedHooks, ownedSet, frozenCategories) {
  const frozen = frozenCategories || new Set();
  const categories = [];
  const seen = new Set();
  for (const k of Object.keys(existingHooks || {})) { categories.push(k); seen.add(k); }
  for (const k of Object.keys(derivedHooks || {})) { if (!seen.has(k)) { categories.push(k); seen.add(k); } }
  const out = {};
  for (const cat of categories) {
    if (frozen.has(cat)) {
      const frozenGroups = Array.isArray(existingHooks?.[cat]) ? existingHooks[cat] : [];
      if (frozenGroups.length) out[cat] = frozenGroups;
      continue;
    }
    const existingGroups = Array.isArray(existingHooks?.[cat]) ? existingHooks[cat] : [];
    const derivedGroups = Array.isArray(derivedHooks?.[cat]) ? derivedHooks[cat] : [];
    const foreignGroups = [];
    for (const group of existingGroups) {
      if (!group || !Array.isArray(group.hooks)) { foreignGroups.push(group); continue; }
      const keptHooks = group.hooks.filter((h) => !(h && ownedSet.has(h.command)));
      // Achado de correção LOW (revisão adversarial): descarta o grupo só quando ele TINHA hooks e
      // TODOS eram do gerador (`group.hooks.length > 0` e nada sobrou depois do filtro) — nunca só
      // por `keptHooks.length === 0`, que também é verdade para um grupo de terceiro/exótico que já
      // nasceu com `hooks: []` (Claude Code nunca emite essa forma, mas um `settings.json` editado à
      // mão pode) e que não continha nenhum hook owned para justificar a remoção.
      if (group.hooks.length > 0 && keptHooks.length === 0) continue; // grupo inteiro era do gerador — descarta
      foreignGroups.push(keptHooks.length === group.hooks.length ? group : { ...group, hooks: keptHooks });
    }
    const merged = [...foreignGroups, ...derivedGroups];
    if (merged.length) out[cat] = merged;
  }
  return out;
}

// decodeAndValidateSettings(bytes) — issue #160, achado de correção (revisão adversarial,
// MEDIUM e LOW): um `.claude/settings.json` é ILEGÍVEL — backup byte-idêntico + WARN, nunca
// regenerado por cima em silêncio — não só quando o JSON não parseia, mas em qualquer forma que
// faria `mergeSettingsJson`/`mergeHooksObject` descartar dado do consumidor, ou corromper o
// próprio protótipo do objeto de saída, sem preservação nem aviso: (1) bytes que não são UTF-8
// válido (decodificar com `TextDecoder` não-estrito substituiria byte inválido por U+FFFD e
// reescreveria o arquivo com o valor corrompido, silenciosamente); (2) JSON válido cujo nível de
// topo não é um objeto plano (por exemplo um array — `existing` cairia em `null` e todo o
// conteúdo seria descartado, também em silêncio); (3) a chave `hooks`, quando presente, não sendo
// um objeto plano (um array em `hooks` seria substituído pela fiação derivada sem backup); (4)
// qualquer CATEGORIA dentro de `hooks` (`PreToolUse`, ou qualquer nome de terceiro) que não seja
// um array — `mergeHooksObject` trataria essa categoria como `[]` e descartaria o conteúdo em
// silêncio; (5) a própria chave de topo `__proto__` — `JSON.parse` a cria como propriedade OWN
// (diferente de um literal de objeto JS), mas copiá-la depois com `out[k] = existing[k]` aciona o
// setter de `Object.prototype.__proto__` e TROCA o protótipo de `out` em vez de criar a chave,
// perdendo o conteúdo em silêncio e sem nunca aparecer no JSON de saída (`JSON.stringify` só
// serializa propriedades OWN). `bytes` é o `Buffer` bruto lido do disco — nunca uma string já
// decodificada, para que o backup do chamador preserve os bytes originais mesmo quando a causa da
// ilegibilidade é a própria codificação. Devolve `{ text, reason: null }` quando a forma é
// aceitável, ou `{ text: null, reason }` quando não é — `reason` é a forma concreta (achado de
// correção LOW: o WARN do chamador dizia sempre "JSON inválido", inclusive para bytes não-UTF-8 e
// para formas de `hooks` inválidas).
function decodeAndValidateSettings(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return { text: null, reason: 'bytes não são UTF-8 válido' }; }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch { return { text: null, reason: 'JSON inválido' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { text: null, reason: 'nível de topo não é um objeto' };
  }
  if (Object.prototype.hasOwnProperty.call(parsed, '__proto__')) {
    return { text: null, reason: "chave de topo '__proto__' presente" };
  }
  if (parsed.hooks !== undefined) {
    if (parsed.hooks === null || typeof parsed.hooks !== 'object' || Array.isArray(parsed.hooks)) {
      return { text: null, reason: "'hooks' não é um objeto" };
    }
    for (const cat of Object.keys(parsed.hooks)) {
      if (!Array.isArray(parsed.hooks[cat])) {
        return { text: null, reason: `'hooks.${cat}' não é um array` };
      }
    }
  }
  return { text, reason: null };
}

// mergeSettingsJson(existingText, derivedHooks, ownedSet, frozenCategories) — issue #160: pura.
// `existingText` é o conteúdo bruto (string) do `.claude/settings.json` já materializado — já
// validado por `decodeAndValidateSettings` no chamador —, ou `null` quando não existe ou era
// ilegível (o chamador já tratou o backup nesse caso — ver `backupUnreadableSettings`).
// Preserva toda chave de topo que não seja `hooks`, na MESMA posição em que já estava — o gerador
// só é dono do que ele mesmo referencia dentro de `hooks`, nunca de `permissions`, `env`,
// `includeCoAuthoredBy` ou qualquer chave de terceiro. Sem `existingText`, o resultado é
// `{ hooks: derivedHooks }`, igual ao comportamento anterior a esta issue. `frozenCategories`
// repassa para `mergeHooksObject` — ver o comentário lá.
function mergeSettingsJson(existingText, derivedHooks, ownedSet, frozenCategories) {
  let existing = null;
  if (existingText != null) {
    try {
      const parsed = JSON.parse(existingText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
    } catch { existing = null; }
  }
  const existingHooks = (existing && existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks))
    ? existing.hooks : {};
  const mergedHooks = mergeHooksObject(existingHooks, derivedHooks, ownedSet, frozenCategories);
  const out = {};
  if (existing) {
    for (const k of Object.keys(existing)) {
      if (k === 'hooks') { out.hooks = mergedHooks; continue; }
      // Object.defineProperty, nunca `out[k] = existing[k]` (achado de correção LOW): esta função é
      // chamada só com `existing` já validado por `decodeAndValidateSettings` — que rejeita
      // `__proto__` como ilegível —, mas escrever a chave por atribuição comum aciona o SETTER de
      // `Object.prototype.__proto__` caso essa validação um dia mude ou seja contornada, trocando o
      // protótipo de `out` por engano em vez de criar a chave. `defineProperty` cria sempre uma
      // propriedade OWN, comum ou chamada `__proto__`, nunca aciona o acessor herdado.
      Object.defineProperty(out, k, { value: existing[k], enumerable: true, writable: true, configurable: true });
    }
  }
  if (!('hooks' in out)) out.hooks = mergedHooks;
  return out;
}

// resolveGitDir(root) — mesma resolução de `bin/forge.mjs:596`: numa worktree LIGADA, `.git` é um
// ARQUIVO (não diretório) apontando para o gitdir real sob o repositório principal, e o caminho
// literal `<root>/.git/forge-backups/` falharia (ENOTDIR). `git -C <root> rev-parse --git-dir`
// resolve certo nos dois casos — devolve `null` fora de um repositório git.
function resolveGitDir(root) {
  try {
    return resolve(root, execFileSync('git', ['-C', root, 'rev-parse', '--git-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { return null; }
}

// backupUnreadableSettings(root, settingsPath, bytes, reason) — issue #160, mesma política da
// #120 (DA-09): um `.claude/settings.json` com JSON ilegível NUNCA é regenerado por cima em
// silêncio. Os bytes anteriores vão para `<git-dir>/forge-backups/settings-<n>.json` (fora do
// universo de qualquer gate e de `git status` — mesmo raciocínio do backup do `update`), e um WARN
// nomeia o caminho antes de a geração seguir como se o arquivo não existisse (rc 0). Fora de um
// repositório git, o backup cai ao lado do próprio arquivo. `reason` (achado de correção LOW) é a
// forma concreta de ilegibilidade devolvida por `decodeAndValidateSettings` — antes desta correção
// o WARN dizia sempre "JSON inválido", inclusive para bytes não-UTF-8 e para `hooks` em formato
// inválido, o que é falso para quem lê o log tentando diagnosticar a causa real.
function backupUnreadableSettings(root, settingsPath, bytes, reason) {
  const gitDir = resolveGitDir(root);
  const bakRoot = gitDir ? join(gitDir, 'forge-backups') : dirname(settingsPath);
  mkdirSync(bakRoot, { recursive: true });
  let n = 1;
  while (existsSync(join(bakRoot, `settings-${n}.json`))) n++;
  const bakPath = join(bakRoot, `settings-${n}.json`);
  writeFileSync(bakPath, bytes);
  console.error(`WARN: .claude/settings.json ilegível (${reason || 'JSON inválido'}) — conteúdo anterior salvo em ${bakPath}`);
  return bakPath;
}

// pruneSettingsJson(abs) — issue #160/LDG-0189, achado de correção MEDIUM (revisão adversarial):
// `.claude/settings.json` é um arquivo COMPARTILHADO mesmo quando o adapter `claude` é desativado
// — pode conter chaves de topo autorais (`permissions`, `env`, ...) e hooks de terceiro que nenhum
// outro adapter possui. Antes desta correção, desativar o adapter (`--set` sem `claude` na lista)
// caía no mesmo `unlinkSync` incondicional de qualquer outro destino do lockfile, apagando o
// arquivo inteiro — o mesmo dano de fundo que a #160 fecha para o `sync`, só que pela poda em vez
// da emissão. Remove só as entradas OWNED (mesma projeção de `mergeHooksObject`, contra
// `derivedHooks` vazio — o adapter desativado não deriva hook nenhum) e preserva o arquivo quando
// sobra conteúdo não-owned (outra chave de topo, ou hook de terceiro); remove o arquivo só quando
// nada sobra. JSON ilegível segue a mesma política de backup da #160 (nunca some sem rastro).
// Devolve `true` quando o arquivo foi tocado (removido ou reescrito), para contar no total podado.
function pruneSettingsJson(abs) {
  if (!exists(abs)) return false;
  const rawBytes = readFileSync(abs);
  const { text: legible, reason } = decodeAndValidateSettings(rawBytes);
  if (legible == null) {
    backupUnreadableSettings(ROOT, abs, rawBytes, reason);
    unlinkSync(abs);
    return true;
  }
  const existing = JSON.parse(legible);
  const existingHooks = (existing.hooks && typeof existing.hooks === 'object' && !Array.isArray(existing.hooks))
    ? existing.hooks : {};
  const prunedHooks = mergeHooksObject(existingHooks, {}, ownedHookCommandsFor(ROOT));
  const out = {};
  for (const k of Object.keys(existing)) {
    if (k === 'hooks') continue;
    Object.defineProperty(out, k, { value: existing[k], enumerable: true, writable: true, configurable: true });
  }
  if (Object.keys(prunedHooks).length) out.hooks = prunedHooks;
  if (Object.keys(out).length === 0) { unlinkSync(abs); return true; }
  const newText = JSON.stringify(out, null, 2) + '\n';
  if (newText === legible) return false; // nada owned para remover — arquivo intocado
  writeFileSync(abs, newText);
  return true;
}

function writeActive(names) {
  let y = readFileSync(FORGE_YAML, 'utf8');
  const block = '  adapters:\n' + names.map((n) => `    - ${n}`).join('\n') + '\n';
  const re = /^  adapters:\n(?:    - .*\n)+/m;
  y = re.test(y) ? y.replace(re, block) : y.replace(/^(harness:\n)/m, `$1${block}`);
  writeIfChanged(FORGE_YAML, y);
}

// ── lockfile per generation unit ─────────────────────────────────────────────
function makeLock() {
  const entries = [];
  const api = {
    entries,
    emit(destAbs, content, srcAbs = null) {
      writeIfChanged(destAbs, content);
      // O bit de execução é parte do artefato, não metadado descartável. Uma skill pode trazer
      // `scripts/` (o motor determinístico que ela invoca); projetado sem +x, o script funciona
      // no canônico `.forge/` e falha com "permission denied" no adapter — maquinaria entregue
      // quebrada, e a diferença só aparece quando alguém a executa. Espelha SÓ o bit de
      // execução do fonte; nunca amplia permissão de leitura ou escrita.
      if (srcAbs && existsSync(srcAbs) && (statSync(srcAbs).mode & 0o111)) {
        chmodSync(destAbs, statSync(destAbs).mode | 0o111);
      }
      entries.push({ dest: relative(ROOT, destAbs), src: srcAbs ? relative(ROOT, srcAbs) : null, sha256: sha256(Buffer.from(content)) });
    },
    linkToAgentsMd(linkName) {
      const p = join(ROOT, linkName);
      if (COPY_LINKS) { api.emit(p, projectAgentsMd(), join(FORGE, 'FORGE.md')); return; }
      if (exists(p)) {
        const st = lstatSync(p);
        if (st.isSymbolicLink() && readlinkSync(p) === 'AGENTS.md') {
          entries.push({ dest: linkName, src: 'AGENTS.md', sha256: 'symlink' });
          return;
        }
        unlinkSync(p);
      }
      symlinkSync('AGENTS.md', p);
      entries.push({ dest: linkName, src: 'AGENTS.md', sha256: 'symlink' });
    },
  };
  return api;
}
function readLockDests(name) {
  const p = join(ADAPTERS_DIR, `${name}.lock.yaml`);
  if (!existsSync(p)) return [];
  return [...readFileSync(p, 'utf8').matchAll(/^ {2}- dest: (.*)$/gm)].map((m) => m[1]);
}
function writeLock(name, lock) {
  lock.entries.sort((a, b) => a.dest.localeCompare(b.dest));
  const out = [
    '# Generated by sync-adapters.mjs — drift detection input for forge doctor (§15).',
    `adapter: ${name}`,
    'files:',
    ...lock.entries.map((e) =>
      [`  - dest: ${e.dest}`, e.src ? `    src: ${e.src}` : null, `    sha256: ${e.sha256}`].filter(Boolean).join('\n')),
    '',
  ].join('\n');
  writeIfChanged(join(ADAPTERS_DIR, `${name}.lock.yaml`), out);
}

// ── shared projections ───────────────────────────────────────────────────────
const commandFiles = () =>
  walk(join(FORGE, 'commands')).filter((f) => f.endsWith('.md') && basename(f) !== 'README.md');
const skillFiles = () => walk(join(FORGE, 'skills'));

function emitAgentsCommands(lock) {
  for (const src of commandFiles()) lock.emit(join(ROOT, '.agents/commands/forge', basename(src)), readFileSync(src, 'utf8'), src);
}
function emitAgentsSkills(lock) {
  for (const src of skillFiles()) {
    const rel = relative(join(FORGE, 'skills'), src);
    lock.emit(join(ROOT, '.agents/skills', rel), readFileSync(src, 'utf8'), src);
  }
}

// ── core (always generated) ──────────────────────────────────────────────────
function generateCore(lock) {
  lock.emit(join(ROOT, 'AGENTS.md'), projectAgentsMd(), join(FORGE, 'FORGE.md'));
}

// ── adapter generators ───────────────────────────────────────────────────────
const GENERATORS = {
  claude(lock) {
    // Slash commands /forge:* NÃO são projetados em .claude/commands/ (contract C1, revisado): o
    // Claude Code (>= 2.x) descontinuou o namespace via subdiretório ali — comandos soltos viram
    // /<arquivo>, sem o prefixo `forge:`. Os /forge:* canônicos passam a vir de um PLUGIN
    // (name: forge), instalado por `npx forge-harness install-plugin` (auto no init) ou pelo
    // marketplace git. Gerador: template/.forge/scripts/lib/plugin-build.mjs.
    for (const tree of ['agents', 'skills']) {
      for (const src of walk(join(FORGE, tree))) {
        lock.emit(join(ROOT, '.claude', tree, relative(join(FORGE, tree), src)), readFileSync(src, 'utf8'), src);
      }
    }
    // #160/LDG-0189: o gerador só é dono do que ele referencia dentro de `hooks` (ver
    // `mergeHooksObject`) — toda outra chave de topo (`permissions`, `env`,
    // `includeCoAuthoredBy`, ...) e todo hook de terceiro sobrevivem ao `sync`, de forma
    // idempotente. JSON ilegível vira backup (nunca é sobrescrito em silêncio) antes de a
    // geração seguir como se o arquivo não existisse.
    const settingsPath = join(ROOT, '.claude/settings.json');
    let existingSettingsText = null;
    if (existsSync(settingsPath)) {
      // `rawBytes` é o Buffer bruto (nunca decodificado antes do backup): achado de correção
      // MEDIUM — decodificar para string antes de fazer o backup perderia byte não-UTF-8 na
      // reescrita (`writeFileSync` re-encodaria a string, não os bytes originais).
      const rawBytes = readFileSync(settingsPath);
      const { text: legible, reason } = decodeAndValidateSettings(rawBytes);
      if (legible != null) {
        existingSettingsText = legible;
      } else {
        backupUnreadableSettings(ROOT, settingsPath, rawBytes, reason);
        existingSettingsText = null;
      }
    }
    // #125/LDG-0178: quando o `.forge/hooks/pre-tool-use/hooks.manifest` do consumidor existe mas
    // o leitor canônico não conseguiu resolvê-lo (esquema marcado mal formado, ou fiação não
    // verificável — e o mesmo vale para "sem hooks.manifest.default nem hooks.manifest do
    // consumidor" com settings.json já existente), a categoria `hooks.PreToolUse` do
    // `.claude/settings.json` anterior fica BYTE-IDÊNTICA — nunca passa pelo filtro de `ownedSet`
    // nem recebe grupo derivado. Achado de correção MEDIUM (revisão adversarial, iteração 3 do
    // modo correção): o congelamento é ESCOPADO a `PreToolUse`, nunca ao arquivo inteiro — antes
    // desta correção, o `.claude/settings.json` INTEIRO era emitido byte a byte
    // (`existingSettingsText`), levando junto `SessionStart`/`SessionEnd` e ignorando em silêncio
    // as flags `handoff.auto`/`ledger.auto`/`liaison.auto` do `forge.yaml` sempre que o manifesto
    // do consumidor estivesse em esquema não reconhecido. `SessionStart`/`SessionEnd` e qualquer
    // outra categoria continuam merged normalmente por `mergeHooksObject`, com o mesmo `ownedSet`.
    // Sem `existingSettingsText` (consumidor novo, ou JSON anterior ilegível — já tratado acima) E
    // sem `unresolved` (ver `derivePreToolUseHooks`: sem `.claude/settings.json` legível não há
    // fiação anterior a preservar, então o manifesto do consumidor não resolvido cai no caminho de
    // instalação nova em vez de marcar `unresolved`), segue para o merge normal.
    const derivation = derivePreToolUseHooks(ROOT);
    for (const aviso of derivation.avisos) console.error(`WARN: ${aviso}`);
    const frozenCategories = derivation.unresolved ? new Set(['PreToolUse']) : new Set();
    const mergedSettings = mergeSettingsJson(existingSettingsText, preToolUseWiring(ROOT), derivation.ownedSet, frozenCategories);
    lock.emit(settingsPath, JSON.stringify(mergedSettings, null, 2) + '\n');
    lock.linkToAgentsMd('CLAUDE.md');
  },
  codex(_lock) { /* consumes the canonical AGENTS.md (core) — no extra target (§15) */ },
  gemini(lock) { lock.linkToAgentsMd('GEMINI.md'); },
  qwen(lock) { emitAgentsCommands(lock); lock.linkToAgentsMd('QWEN.md'); },
  'forge-cli'(lock) { emitAgentsCommands(lock); emitAgentsSkills(lock); },
  'agents-skills'(lock) { emitAgentsSkills(lock); },
  kiro(lock) {
    const steering = `# Forge — steering for Kiro

> Generated from .forge/FORGE.md by \`forge sync-adapters\`. Do not edit. Re-run sync after
> editing .forge/**.

Project: **${val('project.display')}** (\`${val('project.name')}\`) — ${val('project.description')}

Rules for working in this repository:

1. The canonical source of governance and specs is **\`.forge/\`**. Read \`AGENTS.md\` (root)
   for the operational guide and \`.forge/FORGE.md\` for full governance.
2. **Never create or use \`.kiro/specs/\`** — the spec lifecycle lives in
   \`.forge/specs/active/\` and \`.forge/product/current/\` (single source of truth, §15).
3. Conventions are enforced by \`.forge/rules/\`; validate work with
   \`bash .forge/scripts/doctor.sh --report\` before declaring done.
4. Worktrees live under \`.forge/worktrees/<change-id>/\`; branches \`feature/<change-id>\`
   target \`develop\`.
`;
    lock.emit(join(ROOT, '.kiro/steering/forge.md'), steering, join(FORGE, 'FORGE.md'));
  },
  cursor(lock) {
    const mdc = `---
description: Forge Project Harness — canonical governance pointer (source of truth .forge/)
alwaysApply: true
---

This repository uses the Forge Project Harness. The canonical source is \`.forge/\`; the
operational guide is \`AGENTS.md\` (root). Follow \`.forge/rules/\` conventions; specs live in
\`.forge/specs/active/\` (never edit \`.forge/product/current/\` by hand). Identifiers in
English; docs in Portugues Brasileiro; money as integer cents; no AI co-authorship in commits.
Validate with \`bash .forge/scripts/doctor.sh --report\` before declaring work done.
`;
    lock.emit(join(ROOT, '.cursor/rules/forge.mdc'), mdc, join(FORGE, 'FORGE.md'));
  },
};

// Deterministic order; core is implicit and always first.
const ORDER = ['claude', 'codex', 'gemini', 'qwen', 'forge-cli', 'agents-skills', 'kiro', 'cursor'];
const KNOWN = new Set(ORDER);

// ── reconcile (generate active + prune deactivated) ──────────────────────────
// NÃO exportada (#130): a iteração 1 exportava esta função para
// #160/#125 acionarem a reconciliação sem depender do CLI, mas nenhuma delas precisa — as duas
// importam `preToolUseWiring(root)` (acima), a leitura PURA e parametrizada, para comparar sem
// escrever. `reconcile` nunca foi exportada em `origin/develop` antes desta issue, e exportá-la
// agora exporia uma escrita implícita no ROOT do módulo (derivado de --root/cwd de quem importa,
// pré-existente à #130 — já em 480ac52) para qualquer futuro import: um `mod.reconcile([...])`
// chamado com cwd na raiz de outro projeto reconciliaria ESSE projeto, o mesmo dano que a #130
// fecha para o import simples. Mantida como função de módulo, só para o galho principal (abaixo)
// chamar. Se um consumidor real precisar de reconciliação programática, o desenho correto é uma
// função parametrizada pela raiz explícita (`reconcileAt(root, names)`), a abrir como item de
// ledger próprio quando esse consumidor existir — não esta.
//
// process.exit só dentro do galho principal (#130): as duas
// validações abaixo LANÇAM, nunca chamam `process.exit` diretamente, para que importar o
// módulo nunca mate o processo de quem importa (`reconcile` é interna ao CLI, não exportada). O galho principal, ao final do arquivo, é quem converte a exceção em `FAIL (...)` +
// `exit(1)` para o uso via CLI.
function reconcile(activeNames) {
  if (!existsSync(join(FORGE, 'FORGE.md'))) {
    throw new CliError(`no .forge/FORGE.md under ${ROOT} — run /forge:init first`);
  }
  for (const n of activeNames) {
    if (!KNOWN.has(n)) throw new CliError(`unknown adapter '${n}' — known: ${ORDER.join(', ')}`);
  }
  const active = ORDER.filter((n) => activeNames.includes(n)); // canonical order

  const coreLock = makeLock();
  generateCore(coreLock);
  writeLock('core', coreLock);

  const activeDests = new Set(coreLock.entries.map((e) => e.dest));
  const prevDestsByAdapter = new Map();   // lockfile dests BEFORE regeneration (for stale prune)
  for (const name of active) {
    prevDestsByAdapter.set(name, readLockDests(name));
    const lock = makeLock();
    GENERATORS[name](lock);
    writeLock(name, lock);
    lock.entries.forEach((e) => activeDests.add(e.dest));
    console.log(`OK ${name} adapter synced (${lock.entries.length} targets)`);
  }

  // prune STALE dests of still-active adapters: paths an adapter emitted before but no longer does
  // (e.g. .claude/commands/forge/* after C1 moved /forge:* to the plugin). Remove only if no active
  // adapter/core now owns the path. Keeps upgrades clean without a manual sweep; idempotent (a fresh
  // tree has no prior lockfile, so nothing to prune, and a second run finds nothing stale).
  let prunedStale = 0;
  for (const name of active) {
    for (const dest of prevDestsByAdapter.get(name) || []) {
      if (activeDests.has(dest)) continue;
      const abs = join(ROOT, dest);
      if (exists(abs)) { try { unlinkSync(abs); prunedStale++; } catch { /* already gone */ } }
    }
  }

  // prune deactivated adapters: remove their dests not owned by any active adapter/core
  let pruned = 0;
  for (const file of readdirSync(ADAPTERS_DIR)) {
    if (!file.endsWith('.lock.yaml')) continue;
    const name = file.replace('.lock.yaml', '');
    if (name === 'core' || active.includes(name)) continue;
    const lockText = readFileSync(join(ADAPTERS_DIR, file), 'utf8');
    for (const m of lockText.matchAll(/^ {2}- dest: (.*)$/gm)) {
      const dest = m[1];
      if (activeDests.has(dest)) continue;
      const abs = join(ROOT, dest);
      // #160/LDG-0189 (achado MEDIUM): .claude/settings.json é compartilhado mesmo com o adapter
      // desativado — poda só as entradas owned em vez de apagar o arquivo inteiro (pruneSettingsJson).
      if (dest === '.claude/settings.json') { if (pruneSettingsJson(abs)) pruned++; continue; }
      if (exists(abs)) { unlinkSync(abs); pruned++; }
    }
    unlinkSync(join(ADAPTERS_DIR, file));
    console.log(`OK ${name} adapter pruned (deactivated)`);
  }
  for (const dir of ['.claude', '.agents', '.cursor', '.kiro']) removeEmptyDirs(join(ROOT, dir));

  const totalPruned = pruned + prunedStale;
  console.log(`OK reconcile complete: ${active.length} active [${active.join(', ')}]${totalPruned ? `, ${totalPruned} files pruned` : ''}`);
}

// ── main guard (#130) ────────────────────────────────────────────────────────
// Sem isto, importar o módulo (`import(...)`) para ler uma exportação executava o bloco de
// entrada por igual — reconciliando os 70 arquivos do consumidor como efeito colateral do
// import. `realpathSync` nos DOIS lados: `sync-adapters.sh` invoca por `exec node
// ".../lib/sync-adapters.mjs"`, e comparar string crua (`import.meta.url` vs `process.argv[1]`
// sem normalizar) diria "não sou o principal" também para essa invocação legítima, desarmando
// o gerador em vez de só desarmar o import — exatamente a armadilha que a retratação da issue
// #130 registra (uma versão anterior usava `require('node:fs')` dentro de ESM; o
// `ReferenceError` caía no `catch` e o resultado era `false` também na invocação direta).
function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// ── entry ────────────────────────────────────────────────────────────────────
// process.exit só dentro deste galho (#130): TODA validação abaixo
// (e as de `reconcile`, chamada de dentro do try) lança `Error`; este é o ÚNICO lugar do arquivo
// que converte exceção em `console.error('FAIL (...)')` + `process.exit(1)`, e só roda quando o
// arquivo é o principal — nunca quando é importado.
if (isMainModule()) {
  try {
    // Checagem de .forge/FORGE.md na PRIMEIRA linha do galho principal (achado de correção #130,
    // #130): antes rodava só dentro de reconcile(), então --set chamava writeActive()
    // (gravando forge.yaml) ANTES de chegar lá, e o modo default/--adapter all chamava
    // readActive() primeiro — que lê forge.yaml e falha com ENOENT cru se .forge/ nem existir,
    // vazando uma mensagem diferente da amigável ("no .forge/FORGE.md ... — run /forge:init
    // first") e, no caso do --set, mutando o consumidor no próprio caminho de falha (a mesma
    // classe de defeito que a #130 fecha para o bloco de entrada). Checar aqui garante mensagem e
    // ordem idênticas nos três modos, e nenhuma escrita antes de validar.
    if (!existsSync(join(FORGE, 'FORGE.md'))) {
      throw new CliError(`no .forge/FORGE.md under ${ROOT} — run /forge:init first`);
    }
    if (SET !== null) {
      const names = SET.split(',').map((s) => s.trim()).filter(Boolean);
      if (names.length === 0) throw new CliError('--set needs at least one adapter');
      for (const n of names) {
        if (!KNOWN.has(n)) throw new CliError(`unknown adapter '${n}' — known: ${ORDER.join(', ')}`);
      }
      writeActive(ORDER.filter((n) => names.includes(n)));
      reconcile(names);
    } else if (ADAPTER === 'all' || ADAPTER === null) {
      reconcile(readActive());
    } else {
      // regenerate a single adapter (no prune, no active-list change); core first — checagem de
      // FORGE.md já rodou acima, no topo do galho principal; não duplicar aqui.
      if (!KNOWN.has(ADAPTER)) throw new CliError(`unknown adapter '${ADAPTER}' — known: ${ORDER.join(', ')}, all`);
      const coreLock = makeLock();
      generateCore(coreLock);
      writeLock('core', coreLock);
      const lock = makeLock();
      GENERATORS[ADAPTER](lock);
      writeLock(ADAPTER, lock);
      console.log(`OK ${ADAPTER} adapter synced (${lock.entries.length} targets)`);
    }
  } catch (e) {
    // Só um CliError (validação intencional) vira FAIL de uma linha; qualquer outra exceção
    // (bug interno, EACCES, ENOTDIR de um .forge/ corrompido) imprime o stack completo primeiro
    // — o diagnóstico que o Node dava por padrão antes deste try/catch existir (achado de
    // #130).
    if (!(e instanceof CliError)) console.error(e.stack || String(e));
    console.error(`FAIL (${e.message})`);
    process.exit(1);
  }
}
