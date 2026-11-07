# Evidências e base — session-activity-monitor

## 1. Procedência e preservação
- Medições de código: HEAD `9c98dbb609b7ef7d8e20bf2679d25244876f8870`, 2026-11-05, branch `feature/subscription-auth`; último assunto `docs(subscription-auth): TASK-23 — documento de produto com ToS, flag e limitações`.
- `git rev-parse HEAD origin/dev`: HEAD acima; ref local origin/dev `14638b54d3dfb52162c05c0e3f0c59e1e3f18015`. `git merge-base HEAD origin/dev`: `63a8aefd98ccd30f56b78b618ec7f9e83a6255f5`. `git rev-list --left-right --count HEAD...origin/dev`: `51 1`.
- `git diff --stat origin/dev HEAD`: 74 arquivos, 3725 inserções/45 remoções. `git diff --name-only origin/dev HEAD -- packages/tui packages/client/src/solid packages/schema/src/session.ts packages/schema/src/session-event.ts packages/core/src/session`: vazio. As fontes centrais lidas são iguais nessas refs locais; outros paths (Schema config, clientes gerados, Server handlers) diferem por subscription-auth. Não presumir que 74 arquivos pertencem ao monitor.
- `git status --short --branch` inicial: modificados `.gitattributes`, `.gitignore`, `AGENTS.md`; não rastreados `.claude/`, `.forge/`, `.github/workflows/red-first.yml`, `.github/workflows/staging.yml`, `CLAUDE.md`, `prompts/`. Esta governança e os artefatos novos são **árvore de trabalho não commitada em 2026-11-05**, não conteúdo do SHA citado. Nenhum commit autorizado/executado.
- `git worktree list --porcelain`: raiz nesta branch; worktree externa squad-integration destacada no mesmo HEAD; `.forge/worktrees/squad-orchestration` em `feature/squad-orchestration`, HEAD `c08aded6408854fea7749282f061cde5e482558c`. Não reutilizadas/alteradas.
- `.forge/HANDOFF.md` não encontrado no read inicial. Change session-activity-monitor inexistente no read inicial. Criado uma única vez por `bash .forge/scripts/spec-new.sh session-activity-monitor --type feature --scale 3 --rigor spec-anchored --mode brownfield --owner 'Milton Antonio da Silva Jr'`: `OK .forge/specs/active/session-activity-monitor`. Demais edits apenas nesta pasta.
- Não foi feito fetch nem medição de serviço vivo/provider real. Sem garantia de origin/dev fresco. Nenhum teste funcional/build/TUI live foi executado; comandos futuros nos tasks não são resultados. Nenhum segredo foi lido.

## 2. Premissas confirmadas com fonte concreta
| ID | Fato observado, não garantia além do código | Fonte |
|---|---|---|
| E01 | Sidebar tem título com fallback timestamp e slots content/footer, scroll vertical | packages/tui/src/routes/session/sidebar.tsx:17-18,32-76 |
| E02 | Context usa helper de contexto e cost() do Client, mostra percentual/custo | packages/tui/src/feature-plugins/sidebar/context.tsx:12-38 |
| E03 | Session.Info tem agent/model opcionais, tokens/cost, outcome, busy/idle; title sem origem | packages/schema/src/session.ts:31-63 |
| E04 | Renamed só contém title; generator e rename Core publicam o mesmo evento | packages/schema/src/session-event.ts:92-100; packages/core/src/session/title.ts:140-152; packages/core/src/session/session.ts:71-74 |
| E05 | /rename com nome chama update; input vazio chama title.generate; diálogo ignora título whitespace | packages/tui/src/routes/session/index.tsx:1053-1066; packages/tui/src/component/dialog-session-rename.tsx:17-29 |
| E06 | SessionUsage safe() converte ausente/inválido em 0 e usa inputfresh/visible/reasoning/cache disjuntos; custo informado vence catálogo | packages/core/src/session/usage.ts:8-19,44-51 |
| E07 | AI Usage input/output inclusivos; reasoning subconjunto; getters e contextTokens opcionais | packages/ai/src/schema/events.ts:25-61,64-89 |
| E08 | Anthropic map soma usage.iterations para contagem, mas contextTokens pega última iteração tipo message; busca contextTokens revela também Google interactions, não todos protocols | packages/ai/src/protocols/anthropic-messages.ts:1034-1060; packages/ai/src/protocols/google-interactions.ts:400 |
| E09 | applyUsage soma categorias próprias; step end/fail+UsageRecorded atualizam uso, Compaction.Ended não soma de novo; UsageUpdated é valor absoluto | packages/core/src/session/projector.ts:74-83,90-118,1088-1124,1164-1173; packages/schema/src/session-event.ts:160-180,617-620 |
| E10 | sessionFamily sobe à raiz e lista descendentes da raiz; aba usa essa família e fallback regex de título; não é filhos da atual | packages/tui/src/util/session.ts:10-44; packages/tui/src/routes/session/composer/subagents-tab.tsx:41-65; packages/tui/test/util/session.test.ts:5-23 |
| E11 | shell.info tem comando/file/metadata/time, não location; metadata opaca; Client adiciona location/listBySession só compara metadata.sessionID; produtor ShellTool fornece sessionID | packages/schema/src/shell.ts:25-61; packages/client/src/solid/data.ts:118-120,2045-2060; packages/core/src/tool/plugin/shell.ts:196 |
| E12 | server.connected faz overlay de lifecycle em active snapshot; desconectar invalida sync; isso não prova corte atômico de todas fontes | packages/client/src/solid/data.ts:704-730,2150-2158 |
| E13 | cost() na raiz soma família, filha só própria; status() default idle; Info traz tokens do SQL com zeros default | packages/client/src/solid/data.ts:1539-1550; packages/core/src/session/info.ts:33-42; packages/core/src/session/sql.ts:52-56 |
| E14 | lastAssistantWithUsage exclui antes compaction/revert; contextUsage atual soma tokens do último step, não sessão; calcula percentual arredondado inteiro | packages/client/src/solid/usage.ts:8-22; packages/tui/src/util/session.ts:46-60 |
| E15 | shell-tab mostra primeira linha crua e inclui ação kill; novo monitor não deve copiar exposição/controle | packages/tui/src/routes/session/composer/shell-tab.tsx:20-32,97-108,139 |
| E16 | viewer fixa ID/location, usa cursor e buffer64KiB; polling1s enquanto aberto e cleanup; safe navigation pode reutilizá-lo | packages/tui/src/component/dialog-shell-output.tsx:11-13,29-80 |
| E17 | registry Experiments é permanente e toggles lê/escreve config.experimental[id]; config TUI aceita boolean record | packages/tui/AGENTS.md:1-6; packages/tui/src/component/dialog-experiments.tsx:17-28,38-60; packages/tui/src/config/index.tsx:250 |
| E18 | Slot session.composer.top e prompt.footer.status são pontos reais; Composer tabs têm até5 linhas por lista e controles existentes | packages/tui/src/routes/session/index.tsx:1593-1612; packages/tui/src/component/prompt/index.tsx:1901-1902; packages/tui/src/routes/session/composer/index.tsx:127-150 |
| E19 | busy/idle/outcome são projetados; SessionExecution ativo é ownership process-local, não cluster | packages/core/src/session/projector.ts:1062-1070; packages/schema/src/session.ts:44-52; packages/core/src/session/execution.ts:17-43 |
| E20 | feed é global/cross-location/volátil com fila4096 e desconexão por overflow; não promete replay SSE | specs/v2/event-stream-architecture.md:45-64,145-155; packages/client/src/solid/connection.ts:94-115,127-133 |
| E21 | contratos Session públicos derivados de Schema e Shell.output é GET existente | packages/protocol/src/groups/session.ts:45-48,126-143; packages/protocol/src/groups/shell.ts:40-72 |
| E22 | família tem paginação e testes >1página; Client tem testes de races/rename/reconnect de atividade, bons pontos de extensão | packages/client/src/solid/data.ts:567-575; packages/client/test/solid-data.test.ts:55-101,333-436,1433-1471 |
| E23 | TokenUsage.total soma cinco categorias; não existe campo total inclusivo em Session.Info antigo | packages/schema/src/token-usage.ts:5-18; packages/schema/src/session.ts:42-43 |
| E24 | geração de título contabiliza uso auxiliar; isso já faz parte do cumulativo Core | packages/core/src/session/title.ts:62-69,79-95 |
| E25 | session_rename chama plugin host.update, que encaminha rename; Goal também deriva título por update; CLI pode derivar título do prompt; nenhum desses fatos atesta autoria humana | packages/core/src/tool/plugin/opencode.ts:119-135; packages/core/src/plugin/host.ts:594-601; packages/core/src/plugin/goal.ts:403-410; packages/cli/src/run/run.ts:144-151 |
| E26 | App menu/tab renomeiam via Session.update; lista TUI usa mesmo diálogo de rename | packages/app/src/shell/titlebar/project-session-row.tsx:48-60,171-175; packages/app/src/shell/titlebar/tab-strip.tsx:159-168; packages/tui/src/component/dialog-session-list.tsx:289-292 |

## 3. Hipóteses não comprovadas e prova necessária
- Autoria humana de nome de qualquer legado: impossível com E04 sozinho; pedir política Q01, não alegar resolver com regex.
- Ocupação exata atual de todos providers: não comprovada; inventariar requests/mappers por iteração e preservar contexto/proveniência em Core. Input/output acumulados não bastam. Mapeamento variante=effort não demonstrado; manter indisponível.
- Uso streaming contínuo oficial: não investigado/provado e opcional. Formato por provider precisa fixture/cassette real sem gravar chave nova nesta tarefa.
- Descendentes de shells/process tree: metadata sessionID correlaciona origem, não árvore de processos. Não há prova de PID descendants nem completude cross-location após move; precisa contrato/teste antes de incluir.
- Segurança completa de autorização por sessionID/shell location: contratos existem, mas negativas de acesso precisam execução real no Server; não declarada garantida só pelo UI filter.
- Atomicidade de snapshot com todos eventos: overlay active existe; uso/shell precisam overlay/watermark e testes. Não afirmar exactly-once/replay do SSE.
- Bidi/RTL perfeito, leitores de tela/axe em OpenTUI, limite50 e desempenho em1000 itens: não verificados; fixtures/contagens/ensaio real previstos, não métricas já obtidas.
- DDL/proveniência exact shape e migration ordinal: propostos após Q02; sem reserva nem baseline nova aprovada.

## 4. Roteamento consultivo de dados (modo sem ferramenta Agent)
PLANO DE ROTEAMENTO
- classificação: lookup/projeção durável por sessão + replay / estruturado / SQLite existente e SSE Client.
- data-relational: avaliar expansão nullable/replay em `packages/core/src/session/{sql,projector,info}.ts` sem escolher store novo; rodar governança/scan nesse path e ler `.forge/agents/data/data-relational.md`, `.forge/skills/data-relational-practices/`.
- data-streaming: avaliar corte snapshot/eventos/presença experimental em `packages/schema/src/session-event.ts` e `packages/client/src/solid/data.ts`, sem broker novo; rodar governança/scan dos paths e ler `.forge/agents/data/data-streaming.md`, `.forge/skills/data-streaming-practices/`.
- checklist transversal: privacidade de comando/título/IDs; ownership sessão/location; reversibilidade expand-only; custo de resync/viewport; retenção existente sem store novo. Conflitos normativos Q02 impedem decisão durável da parte conflitante.
- Não houve especialistas independentes spawned; esta sessão leu ambos protocolos/skills e executou scans, sem alegar parecer externo.

## 5. Verificações executadas e limites
- `check-data-governance.sh --path packages/core/src/session`: OK,52 arquivos código,0 md, sem divergência literal.
- scan relacional nesse diretório: ARQUIVOS-VARRIDOS52; R-03/04/06/10/12/13/14/17/18/19/20/21/22 sem ocorrência. Não verifica runtime SQLite/locks nem autoriza seleção de store.
- scan streaming em session-event.ts e Client data.ts: ARQUIVOS-VARRIDOS2; todas32 regras sem ocorrência. Não há claim de broker saudável ou de atomicidade, o detector é textual.
- `git ls-tree` confirmou fontes TUI centrais e migration dir no HEAD; `git log --all -S'titleSource' -- packages` não retornou entradas (só esse símbolo, não ausência universal de conceito). `git log --all -S'UsageRecorded'` retornou histórico de compactação (2ca545bfb7,acb0f685f8 etc.); contabilidade não é greenfield.
- `git ls-tree -r --name-only origin/dev -- .forge docs/product/adr specs/v2 ...` encontrou specs/v2 e fontes centrais, nenhuma .forge/ADR nesse recorte. Catálogo local só ADR0001 fila; precedência/integridade do baseline local não equivale a integrado.
- Docs primários V2 lidos `https://opencode.ai/v2/docs/cli`; Context7 `/websites/opencode_ai/v2` confirmou cli.json global/experimental somente IDs registrados e sessão rename/update. Docs não substituem fonte do fork e não provam origem manual. Nenhum ID novo foi sugerido como funcional já existente.
- Logs adicionais determinísticos, se presentes em `validation.log`, representam só análise documental. Sucesso estrutural proposed não libera requisitos/gates, e os checks gated por status são invocados separadamente em memória sem alterar manifest.
- Na conferência final, `git status` mostrou **mudanças concorrentes adicionais não feitas por esta sessão** em handlers CLI auth login/logout/refresh/status/test, client/script/generate.ts, client/src/effect/api/api.ts, clientes gerados Effect/Promise, client/test/promise.test.ts e protocol/src/client.ts. Não foram lidas como implementação do monitor, revertidas ou modificadas. Base dos gerados/Protocol deve ser remedida na sessão-pai; não atribuir toda árvore suja ao SHA inicial. `git diff --check -- .forge/specs/active/session-activity-monitor` não encontrou whitespace no diff rastreado, mas a pasta é untracked: resultado não valida sozinho seus arquivos (instrumentos de conteúdo/log fazem essa parte).
