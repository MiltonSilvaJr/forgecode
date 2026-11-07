# Rebrand OpenCode -> ForgeCode: inventário, risco e validação (2026-11-06)

Medido por `git diff 261538c1a8 HEAD` e `git status`. Durante o trabalho, o commit
`09b33e51f6 feat(rebrand): adopt forgecode identity and the 0.1.x SemVer line` (255 arquivos,
autor Milton) apareceu em HEAD, feito fora deste subagente. Nada foi reescrito. Este agente
adicionou 2 commits por cima (ver fim).

## Classificação do commit 09b33e51f6 (255 arquivos)

| Classe | Arquivos | Caminhos | Justificativa |
|---|---|---|---|
| (a) brand puro, texto | ~150 | `packages/app/src/runtime/i18n/*.ts` (63), docs `*.md/mdx` (15), comentários, mensagens de CLI/TUI, textos de skill/prompt em `packages/core/src/plugin/skill*`, `initialize.txt` | só string visível ou comentário |
| (a) brand em testes | 64 | `**/*.test.ts`, `e2e/*.spec.ts` | expectativas de string/caminho |
| (b) funcional, não é só brand | ~25 | ver tabela abaixo | muda comportamento/compat |
| (c) versão/lockfile | 36 | 35 `package.json` + `bun.lock`: `2.2.5 -> 0.1.0` | reset de SemVer, não é texto |
| (d) harness/.forge | 0 no commit | | `.forge/`, `.claude/`, `CLAUDE.md`, `prompts/`, workflows novos ficaram fora (bom) |
| (e) incerto | 3 | `install`, `README.md`, `.github/release/*` | misturam brand, versão e URLs ainda do upstream |

### Mudanças funcionais (b)

| Caminho | O que muda de fato |
|---|---|
| `packages/util/src/identity.ts` (novo), `global.ts` | `APP="forgecode"`: diretórios globais de dados/config/cache/estado passam a `.../forgecode`. SEM fallback para `~/.local/share/opencode` |
| `packages/cli/src/database-path.ts` | DB `opencode.db` -> `forgecode.db` (no diretório novo; histórico antigo não é lido) |
| `packages/core/src/config.ts`, `config/discovery.ts` | `forgecode.json(c)` + `.forgecode/` nativos; `opencode.json`/`.opencode` lidos como legado (OK). Dir de sistema e plist MDM passam a `forgecode`/`ai.forgecode.managed` com fallback legado só no plist |
| `packages/cli/src/index.ts`, `server-process.ts`, `env.ts`, `script/src/index.ts`, desktop `main/index.ts` | `FORGECODE_*` tem prioridade, `OPENCODE_*` aceito (`installEnvAliases`) |
| `packages/cli/src/services/updater.ts` | política default de update `notify -> disable`; binário `~/.forgecode/bin/forgecode` |
| `packages/cli/src/services/service-config.ts` | regex de versão aceita `0.1.0-<canal>.<n>` e o formato antigo |
| `packages/cli/src/acp/service.ts` | `AuthMethodID` `opencode-login -> forgecode-login` (identificador de protocolo ACP) |
| `packages/cli/src/services/retained-image.ts` | padrão `forgecode-(service|upgrade)-*.exe` |
| `packages/desktop/*` | appId `ai.opencode.desktop* -> ai.forgecode.desktop*`; esquema de URL `forgecode`+`opencode`; `.desktop` linux |
| `packages/gui-plugins/src/ssh/*`, `wsl/*` | diretório remoto `~/.forgecode/...` |
| `packages/tui/src/util/config-directories.ts`, `plugin/discovery.ts` | procura `.opencode` e `.forgecode` |
| `.github/release/plan-release.sh`, `script/release.ts`, `install` | linha `0.x`; tags `v0.*`; versões `0.1.0-<canal>.<n>` |

## Risco de brand (strings que não deveriam mudar) e achados

| # | Achado | Veredito |
|---|---|---|
| R1 | `packages/core/src/console-access.ts` trocava a regex do host legado `console.opencode.ai` por `console.forgecode.ai` (domínio inexistente). Quebrava migração de credenciais salvas. Teste `provider-opencode.test.ts` falhava | CORRIGIDO neste trabalho (commit 182e27f8ed), pois era regressão objetiva |
| R2 | Dados do usuário: `~/.local/share/opencode`, `~/.config/opencode` deixam de ser lidos para dados/sessões/DB. CHANGELOG diz "existing install keeps working", mas só vale para config e env | DECISÃO HUMANA: migrar/linkar diretório legado, ou documentar a perda de histórico |
| R3 | Versão `2.2.5 -> 0.1.0` é rebaixamento. Quem tem 2.x pode não receber 0.x como "mais novo". Tags `v2.*` do upstream e `v0.*` coexistem em `release.ts` | DECISÃO HUMANA |
| R4 | `install`, README e `.github/release/lib.sh`, `publish-*.sh` ainda apontam para `opencode.ai` (installer, `update/api`, `files/bin`, `update.opencode.ai`). O instalador baixaria binário do UPSTREAM; a pipeline de release publicaria na infra do upstream (falharia por OIDC, ou pior) | BLOQUEIA publicar. DECISÃO HUMANA |
| R5 | README: "ForgeCode — the internal fork of OpenCode" e "not published" vs `origin` PÚBLICO | DECISÃO HUMANA em aberto (não resolvida) |
| R6 | Identificador de protocolo ACP `opencode-login -> forgecode-login`; appId desktop; esquema de URL; nome do pacote npm continua `@opencode/*` (bom) | compat de clientes ACP externos e de pins do desktop: DECISÃO HUMANA |
| R7 | Custo de merge com `upstream`: renomeação de identificadores internos (nomes de arquivo `.forgecode`, `FORGECODE_*`, `identity.ts`, cabeçalhos de ~250 arquivos) aumenta conflito em cada merge de `anomalyco/opencode`. Idealmente só texto visível mudaria | custo de manutenção sinalizado |
| R8 | Licença (`LICENSE`) e créditos ao upstream: sem alteração no diff (verificado) | OK |
| R9 | Skill `report.md` e `opencode.md` ainda misturam "opencode" no corpo (`# Report an opencode Issue`) | cosmético, não corrigido |

Nenhuma ocorrência nova de `forgecode.ai/.dev/.com` no repositório rastreado (`git grep`), exceto o R1 já corrigido.

## Validação (comandos rodados)

- `bun run lint`: exit 0 no estado atual e na base `261538c1a8`. Antes do fix, falhava por `packages/gui-plugins/README.md:575` (snippet != `src/pairing/main.ts`). Esse fix de README já está dentro de `09b33e51f6`.
- `bun run typecheck` (raiz, turbo): exit 0.
- Testes por pacote, a partir de `packages/<pkg>`, comparados com a base `261538c1a8` em worktree temporário (já removido):
  - util 140/0, schema 101/0, client 259/0, gui-plugins 422/0.
  - CAUSADOS pelo brand (testes com expectativa antiga) e corrigidos: `tui/test/util/presentation.test.ts` (3), `core/test/plugin/skill.test.ts` (1), `server/test/fetch.test.ts` (2), `server/test/process.test.ts` (1), `cli/test/pair-remote-consent.test.ts` (1). Todos passam após o fix. CAUSADO por código: `core/test/plugin/provider-opencode.test.ts` (R1), corrigido.
  - PRÉ-EXISTENTES (falham igual na base): `cli/test/stats.test.ts` (palette), `debug-config.test.ts` (2), `acp/lifecycle.subprocess` (2), `acp/additional-directories.subprocess` (1), `service.test.ts`, `upgrade.test.ts` e `config.test.ts` (parte), e a suíte `shell output ... %s columns` do tui.
  - FLAKY sob carga (timeout de 5 s; passam isolados): vários de cli, server, core (`snapshot`, `vcs`, `mcp-import-boundary`).
  - Não rodei a suíte completa final de todos os pacotes após os 2 commits; rodei os arquivos afetados.
- `check-secrets.sh range 261538c1a8..HEAD`: OK, 0 achados em 255 arquivos.

## Fora de qualquer commit (nem mexi)

Modificados, classe (d): `.gitattributes`, `.gitignore`, `AGENTS.md` (blocos gerenciados pelo forge).
Untracked, classe (d): `.claude/`, `.forge/` (ledger, specs, product, worktrees), `.github/workflows/red-first.yml`, `.github/workflows/staging.yml`, `CLAUDE.md`, `prompts/`.
