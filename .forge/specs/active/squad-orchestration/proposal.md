# Proposal — squad-orchestration

> Change `squad-orchestration` (type: `feature`, scale 2) — criado em 2026-11-04 por Milton Antonio da Silva Jr.
> PRD/HLD: `prompts/forgecode-three-changes.md` §5 (Change 3 — Squad Orchestration), §6 (dependências/ordem), §7-§10.
> Maquinária de referência lida: `/Users/milton/Downloads/payments-orquestracao-multisessao/` (`README.md`, `squad/squad.py`, `squad/squad.json`, `squad/finalizar-anteriores.py`, `squad/prompts/COMUM.md`, `squad/prompts/ORQUESTRADORA.md`, `squad/state/registry.json`, `squad/transicao.json`, `priorizacao/build_kanban.py`, `priorizacao/jira_live.py`). Logs e evidências pesadas não foram copiadas.

## 1. Por quê (problema / motivação)

O ForgeCode (fork interno do OpenCode V2) já executa sessões concorrentes, mas não tem uma camada de orquestração multi-sessão. A operação real que motivou este change — coordenar 13 sessões em paralelo na rodada de 04/11/2026 — existe hoje como um conjunto de scripts Python/iTerm/Codex em `payments-orquestracao-multisessao`: um launcher (`squad.py`), um registro endereçável por geração (`state/registry.json`), um canal de mensagens por sessão (`codex queue --thread <uuid>`), checkpoints em markdown (`handoffs/<NOME>.md`), um comprovante de encerramento de geração (`transicao.json`) e um painel alimentado por `kanban.json`.

Evidências medidas nessa operação, registradas no próprio pacote de referência:

- **Relato não é prova.** Seis despachos seguidos voltaram "já implementado" porque o backlog tinha trabalho feito e não reconciliado; `gh pr view`, `git rev-parse`, `git merge-base --is-ancestor` e log de job valem mais que resumo de sessão.
- **Ociosidade se mede, não se presume.** `mtime` de rollout parado por duas horas é evidência; sessão "pensando" por vinte minutos não é.
- **Nome de sessão resolve para a geração atual, não para a anterior.** `send --to ORQUESTRADORA` entrega à sucessora; a origem só é alcançável por UUID cru; enfileirar para si mesmo cria duplicata que parece despacho.
- **Painel que mistura estágio de Jira com estágio de entrega mente** quando não há evidência por estágio: card `done` no Jira não é CI verde, nem merge, nem deploy.
- **Uma árvore, um escritor por vez**; troca de dono exige checkpoint e liberação explícita.

Nada disso é produto: não há contrato de CLI, o estado é um JSON escrito à mão, o launcher depende de iTerm2/macOS, o canal é um CLI externo e o painel é um plugin à parte. O ForgeCode tem as primitivas para transformar essa maquinária em camada reutilizável — sessões, inbox durável com `delivery: queue|steer`, eventos `session.inbox.*`/`session.execution.*`, `Location` por diretório, `Git`, `Vcs`, `Model` — e este change as usa.

## 2. O que muda

Uma camada `squad` no ForgeCode, atrás da flag `squad.enabled` (**default desligado**), com comportamento observável:

1. **Registro por geração.** `squad init` cria uma geração nomeada com as sessões declaradas (nome, provider, modelo, effort/variant, `Location`, branch esperada, papel). Existe no máximo uma geração `active`; gerações anteriores ficam `closed` e não são endereçáveis por nome. Cada entrada guarda `run_id`/geração, `session_id`, estado (`creating`, `starting`, `verified`, `closed`, `failed`), hash do prompt de bootstrap e hash do checkpoint.
2. **Resolução de nome escopada à geração.** `squad send --to <nome>` e `squad broadcast` resolvem nome → `session_id` apenas na geração atual; nome inexistente, ambíguo ou de geração anterior falha com erro nomeado e não reutiliza UUID antigo. A geração anterior é alcançável apenas por UUID explícito.
3. **Canal por ForgeQueue.** `squad send`/`broadcast`/`activate` entregam pela fila por sessão do ForgeQueue (semântica `queue` por padrão, `steer` opcional), com chave de idempotência; o retorno prova **apenas enfileiramento** — não existe confirmação falsa de leitura. Enviar para si mesmo é bloqueado por padrão; `broadcast` valida todos os destinatários antes de enfileirar e reporta falha parcial por destinatário.
4. **`check` e `plan` seguros.** `squad check` valida configuração, providers/modelos/variants, `Location` e branch, e **presença** de credencial (nunca o valor); `squad plan` simula a abertura sem criar sessão, sem enfileirar e sem escrever registro.
5. **`launch` com prova de identidade.** `squad launch` cria (ou adota, quando o registro já tem `session_id`) as sessões e verifica por evidência durável: modelo/variant selecionados na sessão, marcador de bootstrap admitido na inbox, marcador entregue e execução iniciada. Estado é gravado antes do efeito (write-ahead); retomar `launch` reconcilia, nunca duplica aba/sessão nem reenvia prompt incerto.
6. **`status` com liveness medida.** `squad status` mostra geração, sessões, estado, UUID, provider/modelo e última atividade medida a partir de eventos duráveis (`session.inbox.delivered`, `session.execution.*`) e do relógio da sessão (`time.busy`/`time.idle`/`time.updated`), classificando `working`, `idle`, `stalled` ou `unknown` por limiar configurável. Nenhum caminho lê texto de agente como prova de vida.
7. **Checkpoint durável por sessão.** `squad checkpoint` grava um checkpoint com seções obrigatórias (resultado, fontes, comandos/provas, limites, próximos passos, posse da árvore), recusa conteúdo com aparência de segredo (salvo override explícito auditado) e registra o `sha256` do corpo.
8. **Fechamento e transição com comprovante.** `squad close --generation <id>` exige checkpoint de toda sessão da geração e ausência de execução ativa, então grava o comprovante (sessões encerradas + checkpoints + hash canônico do registro de origem). `squad transition` valida que a geração anterior fechou por inteiro, amarra o comprovante ao hash do registro de origem e o vincula à geração nova; repetir com o mesmo alvo é no-op, alvo diferente é conflito.
9. **Protocolo de despacho validado.** `squad dispatch create` aceita apenas item nominal com `ORQ-id`, escopo, dono, base/head, DoR, DoD, prova, exclusões e prazo de marco; rejeita incompleto, aloca `ORQ-id` por geração e valida base/head contra o git do dono quando possível, registrando `unknown` quando não for possível medir.
10. **Um escritor por árvore.** O registro mantém dono por árvore (`worktree` ou repositório, conforme configuração); `dispatch` e `send` que carrega despacho recusam takeover sem checkpoint do dono atual e liberação explícita (`squad release`).
11. **Painel sem mentira de estágio.** `squad panel build` gera um `kanban.json` compatível com o painel existente, com evidência por estágio (Jira, CI, merge, deploy, aceite) e `unknown` explícito quando não houver evidência — nunca barra de progresso sobre estágio desconhecido. Jira/CI entram por adapter opcional configurado; nada de reimplementar Jira/TWG/ledger.
12. **Superfície de comando e contrato HTTP.** Grupo CLI `squad` (`init`, `check`, `plan`, `launch`, `status`, `send`, `broadcast`, `activate`, `checkpoint`, `close`, `transition`, `dispatch create|list`, `release`, `panel build|show`), com `--json` onde há saída de dados, e grupo HTTP experimental `/api/experimental/squad/...` com identificadores `experimental.squad.*`, regenerando o client.
13. **Auditoria append-only.** Toda mensagem, despacho, checkpoint, fechamento, transição e ativação gera linha de auditoria com timestamp, alvo, `session_id`, `message_id`, `delivery` e resultado. O corpo da mensagem não é persistido pelo `squad` (só o `sha256` e o `message_id` da inbox), e padrões de segredo são redigidos.

## 3. O que NÃO muda (fora de escopo)

- Não reescreve Jira, TWG, ledger, nem o plugin `painel-kanban`: o painel existente continua sendo o consumidor; o `squad` só produz/consome `kanban.json` e oferece adapters.
- Não substitui a inbox do ForgeCode, os eventos `session.inbox.*`/`session.execution.*`, nem o `SessionExecution`; o `squad` os consome e não cria um segundo barramento.
- Não implementa barramento global entre processos, `agent_message_board` compartilhado, nem confirmação de leitura/ack do modelo.
- Não abre abas de terminal, não depende de iTerm2/AppleScript, não faz `exec` de CLI de provider: sessões são criadas pela API do servidor e consumidas pelo cliente que se conectar.
- Não faz merge, deploy, `terraform apply`, `kubectl apply`, escrita em Jira/ledger, aprovação humana automática ou liberação de execução produtiva.
- Não lê, imprime ou persiste valores de credencial; a resolução de credencial pertence ao `subscription-auth`.
- Não copia logs/evidências pesadas (`~/Downloads/payments-squad-multiprovider-v1/evidence/`, `~/.codex/sessions/`).
- Não altera o comportamento existente de `queue`/`auth`/`prompt`/`inbox`; com `squad.enabled: false` nenhuma rota, comando ou job novo atua.
- Não implementa sharding de stories, `analyze` ou `verify` deste change (fases seguintes do harness).

## 4. Impacto

- **Capacidades afetadas:** `squad-orchestration` (nova). Depende dos contratos de `forgequeue` (canal por sessão) e `subscription-auth` (presença/resolução de credencial por provider).
- **Paths afetados:** `packages/schema/src/squad.ts`, `packages/schema/src/config/squad.ts`, `packages/schema/src/config.ts`, `packages/core/src/config/normalize.ts`, `packages/core/src/squad/**`, `packages/core/src/database/migration/**`, `packages/core/src/git.ts`, `packages/core/src/session/**` (leitura, sem alteração de comportamento), `packages/protocol/src/groups/squad.ts`, `packages/protocol/src/api.ts`, `packages/protocol/src/errors.ts` (reuso, sem nova classe), `packages/server/src/handlers/squad.ts`, `packages/server/src/handlers.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/src/commands/squad.ts`, `packages/cli/src/commands/handlers/squad.ts`, `packages/client/**` (gerado por `bun run generate`), `packages/cli/README.md` (ou doc do pacote), `docs/` (ADR via `/forge:adr new`).
- **Dependências:**
  - `forgequeue` — dependência de **alinhamento de semântica, não de contrato de servidor**: o `forgequeue` é um CLI que consome a primitiva de inbox pré-existente do core (`Session.prompt` com `delivery` e `id`, `packages/protocol/src/groups/session.ts:337-346`), e **não publica** nenhum endpoint ou função de servidor (`forgequeue/design.md` DD-01: "Reusar `session.prompt` com `delivery`, sem endpoint novo"). O `SquadChannel` liga na **mesma primitiva do core**, nunca no CLI do `forgequeue` (proposal A6); a dependência se restringe a compartilhar a semântica `queue|steer`, a idempotência por `id` e os eventos `session.inbox.enqueued`/`session.inbox.delivered`.
  - `subscription-auth` — presença/validade de credencial por provider via superfície publicada (`SubscriptionAuth.Source.report()` → `{present, state, expiresAt, accountLabel}` e `GET /api/experimental/subscription/status`), mapeada pelo adapter `CredentialPresence` para `present|absent|unknown`, sem valor. Usado só por `check`/`launch` para decidir presença; nunca para autenticar. Fallback `unknown` quando a flag `subscription_auth.enabled` está desligada ou o contrato não está disponível.
  - Ordem do PRD §6: nenhum código deste change é implementado antes dos contratos de fila e auth estabilizarem; a especificação projeta contra o contrato descrito no PRD e isola a divergência no adapter. Há também sobreposição de **arquivos de registro** (`packages/schema/src/config.ts`, `packages/protocol/src/api.ts`, `packages/server/src/handlers.ts`, `packages/cli/src/commands/commands.ts`, `packages/client/src`) — medidas nos manifests deles em 2026-11-04 e registradas em `design.md` §1.2; as edições são aditivas e exigem rebase sobre o estado mergeado dos dois.
- **Riscos:**
  - **Contrato de fila/auth muda durante a implementação** → adapter único + testes de contrato com servidor falso; detecção: teste de contrato falha (ver design §6, R1/R2).
  - **Verificação de launch fraca vira confiança em relato** → prova só por evento durável + `time.*`; detecção: teste com sessão que não executa deve falhar `verified`.
  - **Falso positivo de segredo em checkpoint/dispatch** → override explícito auditado; detecção: teste com texto legítimo contendo `token=` em prosa.
  - **Digest canônico divergente entre gerações** → função única e exemplo computado neste change; detecção: teste de fixture com digest fixo.
  - **Painel mostrar estágio sem evidência** → `unknown` obrigatório e teste que falha se `progressa` for `true` com estágio desconhecido.
  - **Regressão em `queue`/`auth`/inbox** → suíte de regressão dedicada (TASK-31).

## 5. Próximos passos

`/forge:requirements` (este change, scale 2) → `/forge:design` → `/forge:tasks` → `/forge:analyze` (quando exigido) → `/forge:implement` no worktree `.forge/worktrees/squad-orchestration/`, branch `squad-orchestration`, PR para `dev`.

Decisões assumidas nesta proposal (não são perguntas abertas):

- **A1 — O `squad` é serviço de controle dentro do servidor, não script de launcher.** A abertura de "aba" do referencial não tem equivalente nem necessidade no ForgeCode: `launch` cria sessões pela API e o cliente (TUI/desktop) se conecta. Justificativa: PRD §5.9 ("não depender de iTerm2; use a abstração de sessões/processos do ForgeCode").
- **A2 — Estado operacional vive no banco do servidor, não em arquivo versionado na árvore.** A rule `conventions/machinery-propagation.md` exige que estado durável de projeto não nasça na branch; checkpoint e registro são estado de execução, não de projeto. Exportação para arquivo é opcional e fora do versionamento.
- **A3 — "Effort" é o `variant` do modelo** (`provider/model#variant`), único mecanismo real de ajuste de esforço no ForgeCode; não existe campo `effort` próprio.
- **A4 — Liveness usa eventos duráveis e relógio da sessão**, porque o ForgeCode não tem "rollout JSONL"; `time.busy`/`time.idle`/`time.updated` e `session.execution.*` são a evidência equivalente e mais forte que `mtime`.
- **A5 — Um escritor por árvore tem escopo configurável** (`worktree` por padrão), porque o fluxo do ForgeCode isola mudanças em worktrees do mesmo repositório; `writer_scope: repository` reproduz a regra literal do referencial.
- **A6 — O canal é a primitiva de inbox por sessão que o ForgeQueue também expõe**; o `squad` não invoca o CLI `queue` de dentro do servidor. A dependência é de contrato (semântica, idempotência, prova de enfileiramento), não de processo.
