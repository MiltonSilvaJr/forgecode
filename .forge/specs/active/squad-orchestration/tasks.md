# Tasks — squad-orchestration

> Tasks do change `squad-orchestration`, ordenadas por dependência. Formato de ID: `TASK-NN` (numeração contínua).
> Status: `[ ]` todo · `[-]` em progresso · `[X]` concluída · `[!]` bloqueada (exige intervenção humana).
> Cada task é atômica (commit de vermelho + commit de implementação) e rastreia a um REQ/seção do design.
> `Teste (comando)` roda o arquivo de teste da própria task; o Red é provado por execução em `/forge:implement` (`bash .forge/scripts/red-evidence.sh task --red <sha> --green <sha> --command "<comando>" --failure-pattern "<padrão>"`). `Padrão de falha` é a asserção real do teste, no formato de diff do runner (`Expected:` / `Received:`; `toContain` imprime `Expected to contain:`), que `lib/red-classify.mjs` reconhece como falha comportamental.
> Nenhuma task adiciona gate a `runtime.gates`; o canal de prova é a suíte de testes de cada pacote, executada pelo job real de CI (`bun turbo test --concurrency=3`). Task cujo entregável é uma checagem de usuário (`check`, `panel`) não é gate de CI: é comando do produto, provado pelo teste da própria task.
> Referências de design citadas com o change que as define: "design §N (DD-NN squad-orchestration)".

## Wave 0 — ADR (pré-requisito de toda wave)

- [X] TASK-00 — ADR da decisão estrutural (camada de orquestração multi-sessão como serviço de controle do servidor, estado operacional em banco, canal pela inbox) (rastreia: REQ-02, design §5 (item 7), §2.1 (DD-01 squad-orchestration); paths: `.forge/product/current/adr/`; depende: —)
  - Teste (comando): `bash .forge/scripts/red-evidence.sh task --red <sha> --green <sha> --command "test -f .forge/product/current/adr/0001-squad-orchestration-service-control.md" --failure-pattern "not found"`
  - Padrão de falha: `Expected: exit 0[\s\S]*Received: exit 1`
  - Notas: `/forge:adr new` registra a decisão em `.forge/product/current/adr/`; **todas as waves dependem dela** (a ADR precede qualquer código). Task documental com asserção executável de existência do artefato; numeração do ADR atribuída na execução. Sem ADR, nenhuma task das waves 1-8 começa.

## Wave 1 — Fundação (config, schema, persistência, serviço, git)

- [X] TASK-01 — Bloco de config `squad` com flag default desligado e validação de duração (rastreia: REQ-01, design §2.10 (DD-12 squad-orchestration); paths: `packages/schema/src/config/squad.ts`, `packages/schema/src/config.ts`, `packages/core/src/config/normalize.ts`, `packages/core/test/config/squad.test.ts`; depende: —)
  - Teste (comando): `cd packages/core && bun run test test/config/squad.test.ts`
  - Padrão de falha: `Expected: false[\s\S]*Received: undefined`
  - Notas: config ausente ⇒ `enabled === false`; `stale_after: 0` e duração malformada produzem diagnóstico, não default silencioso; chave desconhecida dentro de `squad` gera diagnóstico. Rebase obrigatório sobre forgequeue/subscription-auth antes de editar o registro de config (PRD §6; sobreposição medida em design §1.2).

- [X] TASK-02 — Schemas públicos da camada (`Generation`, `SessionEntry`, `Dispatch`, `Checkpoint`, `TransitionReceipt`, `Liveness`, `PanelDocument`, `AuditEntry`, `CheckReport`, `PlanDocument`) (rastreia: REQ-02, REQ-14, REQ-17, design §4.2; paths: `packages/schema/src/squad.ts`, `packages/schema/test/squad.test.ts`; depende: —)
  - Teste (comando): `cd packages/schema && bun run test test/squad.test.ts`
  - Padrão de falha: `Expected: false[\s\S]*Received: true`
  - Notas: codec round-trip de cada tipo; enum de estado recusa valor fora do conjunto; `SessionName` recusa espaço e nome vazio.

- [X] TASK-03 — Tabelas `squad_*` em Drizzle e migration aditiva com índices parciais (rastreia: REQ-02, design §2.2 (DD-02 squad-orchestration), §4.4; paths: `packages/core/src/squad/sql.ts`, `packages/core/src/database/migration/`, `packages/core/src/database/migration.gen.ts`, `packages/core/test/squad/store-schema.test.ts`; depende: TASK-02)
  - Teste (comando): `cd packages/core && bun run test test/squad/store-schema.test.ts`
  - Padrão de falha: `Expected: 10[\s\S]*Received: 0`
  - Setup do teste: `cd packages/core && bun run migration`
  - Notas: asserção lê `sqlite_master` e falha se qualquer das **dez** tabelas faltar (as nove originais + `squad_block`); segundo teste prova que dois `insert` em `squad_generation(state='active')` violam o índice parcial. Cobre também as colunas novas: `squad_session.adopted_at`, `squad_tree_owner` com índice parcial **global** `(tree_key) where released_at is null`, `squad_checkpoint` pk `(generation_id, name, sha256)`, `squad_dispatch.exigidos/accepted_at/accepted_by`, `squad_audit.actor/prev_hash`.

- [X] TASK-04 — Serviço `Squad` no core: `Context.Service`, layer/node, `DisabledError`, eventos efêmeros do Bus (rastreia: REQ-01, REQ-02, design §2.1 (DD-01 squad-orchestration), §2.10 (DD-12 squad-orchestration); paths: `packages/core/src/squad/index.ts`, `packages/core/src/squad/event.ts`, `packages/core/test/squad/service.test.ts`; depende: TASK-01, TASK-02, TASK-03)
  - Teste (comando): `cd packages/core && bun run test test/squad/service.test.ts`
  - Padrão de falha: `Expected: "Squad.DisabledError"[\s\S]*Received: undefined`
  - Notas: com flag desligada toda operação falha antes de tocar banco; com flag ligada o serviço publica `squad.generation.opened` no Bus e o teste escuta o evento.

- [X] TASK-05 — `Git.history.resolve` (rev-parse --verify) e `Git.repo.discover` reaproveitado para árvore (rastreia: REQ-14, REQ-15, design §2.8 (DD-09/DD-10 squad-orchestration), §1.1; paths: `packages/core/src/git.ts`, `packages/core/test/git-resolve.test.ts`; depende: —)
  - Teste (comando): `cd packages/core && bun run test test/git-resolve.test.ts`
  - Padrão de falha: `Expected: undefined[\s\S]*Received: "[0-9a-f]{7,40}"`
  - Notas: resolve branch e tag existentes; ref inexistente devolve `undefined` (não lança); repositório temporário criado com `fixture/git.ts`.

## Wave 2 — Registro, leitura e superfícies CLI/HTTP

- [X] TASK-06 — `squad init`, geração única `active` e idempotência transacional (rastreia: REQ-02, design §2.2 (DD-02 squad-orchestration), §2.3 (DD-03 squad-orchestration); paths: `packages/core/src/squad/registry.ts`, `packages/core/src/squad/store.ts`, `packages/core/test/squad/registry.test.ts`; depende: TASK-04)
  - Teste (comando): `cd packages/core && bun run test test/squad/registry.test.ts`
  - Padrão de falha: `Expected: 1[\s\S]*Received: 2`
  - Notas: conta gerações `active` após dois `init` (segundo com `--replace`); falha no meio (store injetado que lança no insert da segunda sessão) não deixa geração parcial; mesma `idempotencyKey` devolve o mesmo id. Registro relido por um layer novo sobre o mesmo banco (reinício) devolve a mesma geração e os mesmos session_id. `--replace` com geração anterior `active` aplica o predicado de `close` e falha (`ConflictError`) listando pendências se não satisfeito (design §2.3 DD-03a).

- [X] TASK-07 — Resolução de nome/UUID e digest canônico do registro (rastreia: REQ-03, REQ-11, design §2.3 (DD-03/DD-04 squad-orchestration); paths: `packages/core/src/squad/registry.ts`, `packages/core/test/squad/resolve.test.ts`, `packages/core/test/squad/digest.test.ts`; depende: TASK-06)
  - Teste (comando): `cd packages/core && bun run test test/squad/resolve.test.ts`
  - Padrão de falha: `Expected: "SessionNotFoundError"[\s\S]*Received: "ses_1"`
  - Notas: nome da geração anterior falha com o nome da geração onde existe; `--session-id` resolve em geração fechada; digest da fixture de `design.md` §2.3 devolve `786d7eb4896706ae559887f05468829c12e45eed0763e4cb3ea3bef925e01498` (segundo arquivo de teste, mesmo comando por diretório). Resolver nome não reescreve session_id de geração anterior nem copia entrada entre gerações.
  - Evidência: vermelho `3c084d94fbf691cdf841023b440b492c59b48189`, verde filho direto `c08aded6408854fea7749282f061cde5e482558c`; `red-evidence.sh task` passou separadamente para `resolve.test.ts` e `digest.test.ts`, com `HUSKY=0 bun install --frozen-lockfile` no setup.

- [X] TASK-08 — Grupo HTTP experimental `squad` (rotas de geração/registro) e regeneração do client (rastreia: REQ-02, REQ-03, REQ-07, design §4.1; paths: `packages/protocol/src/groups/squad.ts`, `packages/protocol/src/api.ts`, `packages/server/src/handlers/squad.ts`, `packages/server/src/handlers.ts`, `packages/protocol/test/squad.test.ts`, `packages/server/test/squad.test.ts`; expoe: POST /api/experimental/squad/generation, GET /api/experimental/squad/session; depende: TASK-07)
  > Resolvido: rebase sobre local-integration concluído (merge a088d4da03). Grupo `squad` com `generation.create` + `session.list`; client regenerado com `Squad` nos type references (brand preservado); flag desligada cobre criação **e** listagem (403). `generate.ts` filtra `{subscription, squad}`; `deprecated-aliases.test.ts` filtra ambos.
  > Red-first: `red-evidence.sh task` devolve `FAIL [topologia]` porque o merge de dependência `a088d4da03` ficou entre o vermelho e o verde; o teste falha na árvore do vermelho e passa na do verde. Limitação de topologia registrada; não reescrever a história só para o formato.
  - Teste (comando): `cd packages/protocol && bun run test test/squad.test.ts`
  - Padrão de falha: `Expected: \[\][\s\S]*Received: \[\n  "experimental.squad.generation.create POST /api/experimental/squad/generation"`
  - Setup do teste: `cd packages/client && bun run generate`
  - Notas: viola identificador se a rota não começar com `experimental.squad.`; teste de handler em `packages/server/test/squad.test.ts` cobre 403 com flag desligada e 200 com flag ligada via `ServerFetch` + client. Rota de endereçamento usa `:sessionRef` (aceita `name` **ou** `session_id` UUID), não `:sessionName`. Rebase obrigatório sobre forgequeue/subscription-auth antes de editar api.ts/handlers.ts (design §1.2); registro do grupo é aditivo por linha.

- [X] TASK-09 — Grupo CLI `squad` com `init`, `--json` e mensagem de flag desligada (rastreia: REQ-02, REQ-20, design §4.3; paths: `packages/cli/src/commands/squad.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/src/commands/handlers/squad.ts`, `packages/cli/test/squad.test.ts`; depende: TASK-08)
  - Teste (comando): `cd packages/cli && bun run test test/squad.test.ts`
  - Padrão de falha: `Expected to contain: "squad init"[\s\S]*Received:`
  - Notas: `squad --help` lista `init`; flag desligada encerra código 1 com `squad.enabled is false`; `--json` de erro emite `{error:{code,message,details}}`. Rebase obrigatório sobre forgequeue/subscription-auth antes de editar commands.ts (design §1.2); três grupos novos no mesmo array.

- [X] TASK-10 — `squad check`: modelo/variant, `Location`, branch e presença de credencial (rastreia: REQ-04, REQ-19, design §2.10 (DD-12 squad-orchestration), §4.5; paths: `packages/core/src/squad/check.ts`, `packages/core/src/squad/credential.ts`, `packages/core/test/squad/check.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: GET /api/experimental/squad/check; depende: TASK-05, TASK-07, TASK-09)
  - Teste (comando): `cd packages/core && bun run test test/squad/check.test.ts`
  - Padrão de falha: `Expected: "fail"[\s\S]*Received: "ok"`
  - Notas: variant inexistente ⇒ `fail` com lista de variants; branch divergente ⇒ `fail` com medido/esperado; diretório não-git ⇒ `warn`/`unknown`; sentinela de credencial no ambiente não aparece na saída serializada. Duas execuções produzem o mesmo relatório e nenhuma linha de auditoria de mutação.

- [X] TASK-11 — `squad plan`: simulação com zero efeito e hash do bootstrap (rastreia: REQ-05, design §2.5 (DD-06 squad-orchestration); paths: `packages/core/src/squad/plan.ts`, `packages/core/test/squad/plan.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: GET /api/experimental/squad/plan; depende: TASK-10)
  - Teste (comando): `cd packages/core && bun run test test/squad/plan.test.ts`
  - Padrão de falha: `Expected: 0[\s\S]*Received: 1`
  - Notas: conta sessões do servidor e linhas de auditoria antes/depois; digest do registro inalterado; ordem da configuração preservada; `--help` de `plan` descreve "sem efeito".
  > Red-first: `red-evidence.sh task` → `OK task` (vermelho `7db49e34e2`, verde `b2f572f4c2`, classificação behavioral). Superfície em `feat(squad): TASK-11 — plan surface`.

## Wave 3 — Canal, envio e auditoria

- [X] TASK-12 — Porta `SquadChannel`, adapter ForgeQueue e teste de contrato com servidor falso (rastreia: REQ-08, REQ-19, design §2.4 (DD-05 squad-orchestration), §4.5; paths: `packages/core/src/squad/channel.ts`, `packages/core/test/squad/channel.test.ts`, `packages/core/test/fixture/squad-channel.ts`; depende: TASK-04)
  - Teste (comando): `cd packages/core && bun run test test/squad/channel.test.ts`
  - Padrão de falha: `Expected: "msg_[0-9a-f]{24}"[\s\S]*Received: "msg_"`
  - Notas: mesma chave ⇒ mesmo `message_id`; duas chaves ⇒ ids distintos; `delivery` default `queue`; falha de admissão vira `ChannelError` sem retry silencioso; teste de contrato falha se o adapter passar a devolver prova de leitura. A implementação chama `Session.prompt` (primitiva pré-existente do core, a mesma que o CLI do `forgequeue` consome) — **não** importa módulo do `forgequeue` (que é `packages/cli`, inalcançável a partir do `core`). Teste de fronteira de import lê os arquivos de packages/core/src/squad e falha se módulo fora de channel.ts/credential.ts importar a primitiva de inbox ou de credencial diretamente.
  > Red-first: `red-evidence.sh task` → `OK task` (vermelho `0744851a9c`, verde `86a78ea0ea`, classificação behavioral).

- [X] TASK-13 — `squad send`: nome/UUID, self-send, destino não verificado, message-file e prova (rastreia: REQ-08, design §2.4 (DD-05 squad-orchestration); paths: `packages/core/src/squad/send.ts`, `packages/core/test/squad/send.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/session/:sessionRef/send; depende: TASK-07, TASK-09, TASK-12)
  - Teste (comando): `cd packages/core && bun run test test/squad/send.test.ts`
  - Padrão de falha: `Expected: "ForbiddenError"[\s\S]*Received: "Queued message msg_1"`
  - Notas: self-send recusado sem `--allow-self`; destino `starting` recusado com `ConflictError`; arquivo ausente falha antes de enfileirar; saída não contém "lida", "processada" ou "concluída"; default `queue`. Falha de canal/servidor produz erro nomeado e nenhuma linha de auditoria de sucesso.
  > Red-first: `red-evidence.sh task` → `OK task` (vermelho `55a2a1de6a`, verde `c3a61b6d28`, classificação behavioral).

- [X] TASK-14 — `squad broadcast`: validação prévia de todos e relatório por destinatário (rastreia: REQ-09, design §2.4 (DD-05 squad-orchestration); paths: `packages/core/src/squad/broadcast.ts`, `packages/core/test/squad/broadcast.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/broadcast; depende: TASK-13)
  - Teste (comando): `cd packages/core && bun run test test/squad/broadcast.test.ts`
  - Padrão de falha: `Expected: 0[\s\S]*Received: 2`
  - Notas: conta enfileiramentos quando um destino é inválido (deve ser 0); com todos válidos, `results[]` cobre todos; origem nunca incluída sem `--include-self`; ordem da configuração preservada. Cada destinatário aceito gera linha de auditoria na ordem da configuração. Entrega **best-effort não-transacional** (design §2.14 DD-15): falha no meio mantém os já enfileirados e marca o restante `not_attempted` — sem rollback de inbox.
  > Red-first: `red-evidence.sh task` → `OK task` (vermelho `3580407413`, verde `8fe15bd315`, classificação behavioral).

- [X] TASK-15 — Auditoria append-only, redaction e hash de mensagem (rastreia: REQ-18, design §2.2 (DD-02 squad-orchestration), §2.6; paths: `packages/core/src/squad/audit.ts`, `packages/core/src/squad/sql.ts`, `packages/core/test/squad/audit.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: GET /api/experimental/squad/audit; depende: TASK-13)
  - Teste (comando): `cd packages/core && bun run test test/squad/audit.test.ts`
  - Padrão de falha: `Expected: -1[\s\S]*Received: \d+`
  - Notas: `indexOf(sentinela)` na linha de auditoria deve ser `-1` enquanto na inbox de destino é `>= 0`; redaction cobre `Bearer`, `sk-`, `ghp_`, `AKIA`, `"token"` e PEM; não existe update/delete de `squad_audit` (teste tenta via store e falha por ausência de método). Falha também é auditada com motivo, sem stack trace e sem caminho absoluto.
  > Red-first: `red-evidence.sh task` → `OK task` (vermelho `f43b35b416`, verde `b8780de992`, classificação behavioral).

- [X] TASK-37 — Auditoria com `actor`/`prev_hash` e export da cadeia (rastreia: REQ-18, design §2.2 (DD-02 squad-orchestration), §4.3; paths: `packages/core/src/squad/audit.ts`, `packages/core/src/squad/sql.ts`, `packages/core/test/squad/audit-chain.test.ts`, `packages/cli/src/commands/squad.ts`; depende: TASK-15)
  - Teste (comando): `cd packages/core && bun run test test/squad/audit-chain.test.ts`
  - Padrão de falha: `Expected: "integrity_ok"[\s\S]*Received: "integrity_broken"`
  - Notas: cada linha grava `actor` e `prev_hash` (sha256 da linha anterior); `squad audit export --since <iso> --out <path>` grava as linhas e devolve o digest da cadeia; adulterar uma linha intermediária reprova o digest do export. Export é CLI (lê audit + escreve arquivo), consistente com o export de checkpoint.
  > Red-first: `red-evidence.sh task` → `OK task` (vermelho `dc26e120a0`, verde `74fa2c0207`, classificação behavioral).

## Wave 4 — Launch, liveness e status

- [X] TASK-16 — `launch` write-ahead: `creating → starting`, adoção e retomada sem duplicar (rastreia: REQ-06, design §2.5 (DD-06 squad-orchestration); paths: `packages/core/src/squad/evidence.ts`, `packages/core/test/squad/launch-state.test.ts`; depende: TASK-06, TASK-12)
  - Teste (comando): `cd packages/core && bun run test test/squad/launch-state.test.ts`
  - Padrão de falha: `Expected: 1[\s\S]*Received: 2`
  - Notas: conta `session.create` chamados após retomada de `creating`; `starting` reusa o mesmo `message_id`; `verified` não reenvia; `failed` exige `--retry`; queda simulada após persistir `starting` não duplica sessão. --only processa só o nome pedido e falha se ele não existir na geração ativa.

- [X] TASK-17 — Evidência de `launch`: modelo/variant, marcador admitido/entregue, execução iniciada e timeout (rastreia: REQ-06, design §2.5 (DD-06 squad-orchestration); paths: `packages/core/src/squad/evidence.ts`, `packages/core/test/squad/launch-evidence.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/session/:sessionRef/launch; depende: TASK-16)
  - Teste (comando): `cd packages/core && bun run test test/squad/launch-evidence.test.ts`
  - Padrão de falha: `Expected: "starting"[\s\S]*Received: "verified"`
  - Notas: sessão que admite e entrega mas não emite `session.execution.started` permanece `starting` e o erro nomeia `execution`; modelo divergente falha nomeando esperado/medido; timeout configurado em 1s preserva registro e sessão.

- [X] TASK-18 — Classificador de liveness por evento e relógio da sessão (rastreia: REQ-13, design §2.7 (DD-08 squad-orchestration); paths: `packages/core/src/squad/liveness.ts`, `packages/core/test/squad/liveness.test.ts`; depende: TASK-05, TASK-06)
  - Teste (comando): `cd packages/core && bun run test test/squad/liveness.test.ts`
  - Padrão de falha: `Expected: "stalled"[\s\S]*Received: "idle"`
  - Notas: tabela de casos com `TestClock` (10:59 ⇒ idle, 11:01 ⇒ stalled); `working` quando `busy > idle`; `unknown` sem atividade; `working_stale: true` quando `busy` é anterior a `agora − stale_after`; mensagem "estou viva" com `time.updated` antigo ⇒ stalled; `stale_after: 0` reprova configuração.

- [X] TASK-19 — `squad status` e `GET /liveness` com geração atual e anterior (rastreia: REQ-07, REQ-13, design §2.7 (DD-08 squad-orchestration), §4.1; paths: `packages/core/src/squad/status.ts`, `packages/core/test/squad/status.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`, `packages/cli/test/squad.test.ts`; expoe: GET /api/experimental/squad/liveness; depende: TASK-09, TASK-18)
  - Teste (comando): `cd packages/core && bun run test test/squad/status.test.ts`
  - Padrão de falha: `Expected: null[\s\S]*Received: \{"id":"gen-`
  - Notas: `previous` é `null` sem geração fechada e objeto com `session_id`/`closed` quando existe; nenhuma mutação (digest e auditoria inalterados); `--json` sem parsing de texto; fonte da atividade presente em cada linha. Expõe `inbox_pending` por sessão (via `SquadChannel.pending`); a medição de NFR-01 (p95, 30 execuções descartando 2 de warm-up) fica neste arquivo.

- [X] TASK-33 — `squad session replace` e `--retry` a partir de `starting` (rastreia: REQ-23, REQ-06, design §2.5 (DD-06 squad-orchestration); paths: `packages/core/src/squad/registry.ts`, `packages/core/test/squad/session-replace.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/session/:sessionRef/replace; depende: TASK-16, TASK-17)
  - Teste (comando): `cd packages/core && bun run test test/squad/session-replace.test.ts`
  - Padrão de falha: `Expected: "ses_"[0-9a-f]+[\s\S]*Received: "ses_old"`
  - Notas: `replace --name X --provider p [--model m] [--variant v]` gera novo `session_id`, herda checkpoint e grava `last_error`; `--retry` a partir de `starting` com `--reason` sem exigir `failed`; uma entrada por `(generation_id, name)` permanece.

- [X] TASK-34 — Liveness com claim, `presumed_dead` e `sent_at` (rastreia: REQ-13, design §2.7 (DD-08 squad-orchestration); paths: `packages/core/src/squad/liveness.ts`, `packages/core/test/squad/liveness-claim.test.ts`; depende: TASK-18)
  - Teste (comando): `cd packages/core && bun run test test/squad/liveness-claim.test.ts`
  - Padrão de falha: `Expected: "presumed_dead"[\s\S]*Received: "working"`
  - Notas: `working` consulta o claim (`SessionExecution.isActive`/claim de shutdown); `busySince` anterior a `agora − dead_after` escala para `presumed_dead` sem auto-liberar claim; admissão de inbox sai de `lastActivity` e vira `sent_at`; `dead_after <= stale_after` reprova config.

- [X] TASK-35 — `squad block` e `cause` no liveness (rastreia: REQ-24, REQ-13, design §2.7 (DD-08 squad-orchestration), §2.2; paths: `packages/core/src/squad/block.ts`, `packages/core/test/squad/block.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/block; depende: TASK-18)
  - Teste (comando): `cd packages/core && bun run test test/squad/block.test.ts`
  - Padrão de falha: `Expected: "human"[\s\S]*Received: null`
  - Notas: `block --waiting human|tool --reason` grava `squad_block`; liveness reporta `cause` = motivo + `waiting_on`; `--clear` remove; `block` nunca muda `working` → `idle` nem auto-libera claim.

- [X] TASK-36 — Custo/cota projetados e `expiresAt` como aviso (rastreia: REQ-25, design §2.7, §4.5; paths: `packages/core/src/squad/status.ts`, `packages/core/src/squad/credential.ts`, `packages/core/test/squad/cost.test.ts`; depende: TASK-19, TASK-10)
  - Teste (comando): `cd packages/core && bun run test test/squad/cost.test.ts`
  - Padrão de falha: `Expected: \{[\s\S]*"cost":[\s\S]*\}[\s\S]*Received: \{\}`
  - Notas: `status --json` inclui `cost`/`tokens` por sessão e total por geração (de `Session.Info`/`session.usage.recorded`); `CredentialPresence` expõe `expiresAt` com `expiryWarn` (default 7 dias) sem mudar `present|absent|unknown`; `unknown` quando nunca registrou uso.

## Wave 5 — Checkpoint, fechamento, transição e ativação

- [X] TASK-20 — Checkpoint: seções obrigatórias, normalização, `sha256`, varredura de segredo e export (rastreia: REQ-10, design §2.6 (DD-07 squad-orchestration); paths: `packages/core/src/squad/checkpoint.ts`, `packages/core/test/squad/checkpoint.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/checkpoint; depende: TASK-04)
  - Teste (comando): `cd packages/core && bun run test test/squad/checkpoint.test.ts`
  - Padrão de falha: `Expected: \["Posse da árvore"\][\s\S]*Received: \[\]`
  - Notas: ausência de seção lista o nome; hash recomputado confere com fixture de conteúdo normalizado; PEM recusado por default e aceito com `--allow-secret-like-text --reason` (auditado); export com mesmo hash; `\r\n` e BOM não mudam o hash. Checkpoint relido por layer novo sobre o mesmo banco mantém corpo e hash; export grava fora da árvore versionada. Histórico preservado (pk `(generation_id, name, sha256)` — novo checkpoint não sobrescreve o anterior, `squad_session.checkpoint_sha256` aponta o mais recente); corpo acima de `squad.checkpoint.max_bytes` (default 1 MiB) é recusado.

- [X] TASK-21 — `squad close`: exigência de checkpoint/execução idle, comprovante e digest de origem (rastreia: REQ-11, design §2.6 (DD-07 squad-orchestration), §2.3 (DD-04 squad-orchestration); paths: `packages/core/src/squad/transition.ts`, `packages/core/test/squad/close.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/generation/:generationID/close; depende: TASK-07, TASK-20)
  - Teste (comando): `cd packages/core && bun run test test/squad/close.test.ts`
  - Padrão de falha: `Expected: "active"[\s\S]*Received: "closed"`
  - Notas: sem checkpoint ⇒ permanece `active` e lista pendentes; execução ativa ⇒ recusa; comprovante contém `source_registry_digest` igual ao digest da fixture e `previous_orchestrator_kept_open: true`; repetir com mesmo comprovante é no-op.

- [X] TASK-22 — `squad transition`: completude, amarração por digest e idempotência (rastreia: REQ-12, design §2.6 (DD-07 squad-orchestration); paths: `packages/core/src/squad/transition.ts`, `packages/core/test/squad/transition.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/transition; depende: TASK-21)
  - Teste (comando): `cd packages/core && bun run test test/squad/transition.test.ts`
  - Padrão de falha: `Expected: "ConflictError"[\s\S]*Received: "ok"`
  - Notas: registro de origem alterado ⇒ conflito e geração nova intacta; conjunto de sessões divergente ⇒ falha nomeando; mesmo alvo ⇒ no-op; alvo diferente ⇒ conflito. Após transição, a geração nova é a única active e a anterior permanece closed, alcançável só por session_id.

- [X] TASK-23 — `squad activate`: pré-condições, transferência e `productive` travado (rastreia: REQ-16, design §2.6 (DD-07 squad-orchestration), §1.4 (P6); paths: `packages/core/src/squad/activate.ts`, `packages/core/test/squad/activate.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/activate; depende: TASK-12, TASK-17, TASK-22)
  - Teste (comando): `cd packages/core && bun run test test/squad/activate.test.ts`
  - Padrão de falha: `Expected: false[\s\S]*Received: true`
  - Notas: `productive` continua falso após ativar; mensagem contém geração, registro e a restrição de bootstrap; nenhum conteúdo de checkpoint; ativação repetida devolve o mesmo `message_id`; sessão em `starting` bloqueia tudo (zero enfileiramento).

- [X] TASK-39 — `close` com `closed_by`, exclusão da sessão emissora e `inbox_pending` (rastreia: REQ-11, REQ-07, design §2.6 (DD-07 squad-orchestration); paths: `packages/core/src/squad/transition.ts`, `packages/core/test/squad/close-by.test.ts`, `packages/cli/src/commands/squad.ts`; depende: TASK-21)
  - Teste (comando): `cd packages/core && bun run test test/squad/close-by.test.ts`
  - Padrão de falha: `Expected: "closed_by"[\s\S]*Received: undefined`
  - Notas: a sessão emissora (default orquestradora; `--by`) é excluída do predicado de execução ativa, exigindo só checkpoint íntegro; `closed_by` gravado no comprovante/auditoria; `close` recusa `inbox_pending > 0` salvo `--force --reason`.

## Wave 6 — Despacho e dono da árvore

- [X] TASK-24 — `dispatch create`: campos obrigatórios, `ORQ-id`/`seq` e base/head medidos (rastreia: REQ-14, design §2.8 (DD-09 squad-orchestration); paths: `packages/core/src/squad/dispatch.ts`, `packages/core/test/squad/dispatch.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/dispatch, GET /api/experimental/squad/dispatch; depende: TASK-05, TASK-07)
  - Teste (comando): `cd packages/core && bun run test test/squad/dispatch.test.ts`
  - Padrão de falha: `Expected: \["dod","proof"\][\s\S]*Received: \["dod"\]`
  - Notas: resposta única com todos os faltantes; `base` inexistente reprova; `head` inexistente válido ⇒ `unknown` com motivo; sem git ⇒ ambos `unknown` e aceite com aviso; `base_oid`/`head_oid` gravados quando resolvem; concorrência de dois despachos mantém `seq` único e monotônico.

- [X] TASK-25 — Dono por árvore (`worktree`/`repository`) e `release` com checkpoint (rastreia: REQ-15, design §2.8 (DD-10 squad-orchestration); paths: `packages/core/src/squad/ownership.ts`, `packages/core/test/squad/ownership.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/release; depende: TASK-20, TASK-24)
  - Teste (comando): `cd packages/core && bun run test test/squad/ownership.test.ts`
  - Padrão de falha: `Expected: "ConflictError"[\s\S]*Received: "released"`
  - Notas: `worktree` distingue duas worktrees do mesmo repositório; `repository` bloqueia as duas; `release` sem checkpoint pertence ao dono atual falha; com checkpoint e motivo, posse antiga fecha e nova abre na mesma transação; auditoria registra `checkpoint_sha256`.

- [X] TASK-26 — Entrega de despacho pela `SquadChannel` e enforcement no `send --dispatch` (rastreia: REQ-14, REQ-15, design §2.8 (DD-09/DD-10 squad-orchestration); paths: `packages/core/src/squad/dispatch.ts`, `packages/core/src/squad/send.ts`, `packages/core/test/squad/dispatch-send.test.ts`, `packages/cli/src/commands/squad.ts`; depende: TASK-13, TASK-15, TASK-24, TASK-25)
  - Teste (comando): `cd packages/core && bun run test test/squad/dispatch-send.test.ts`
  - Padrão de falha: `Expected: 1[\s\S]*Received: 0`
  - Notas: `--send` enfileira uma vez com chave `dispatch:<orq_id>`; mensagem renderiza ORQ-id, escopo, dono, base/head, DoR/DoD, prova, exclusões e marco; `send --dispatch` de alvo que não é dono da árvore falha; `send` sem despacho não é bloqueado por posse.

- [X] TASK-32 — `squad dispatch accept` e estágio `acceptance` (rastreia: REQ-22, REQ-14, REQ-17, design §2.8 (DD-09 squad-orchestration), §2.9 (DD-11 squad-orchestration); paths: `packages/core/src/squad/dispatch.ts`, `packages/core/test/squad/dispatch-accept.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`, `packages/cli/src/commands/squad.ts`; expoe: POST /api/experimental/squad/dispatch/:orqId/accept; depende: TASK-24)
  - Teste (comando): `cd packages/core && bun run test test/squad/dispatch-accept.test.ts`
  - Padrão de falha: `Expected: "accepted"[\s\S]*Received: "open"`
  - Notas: `accept --orq <orq_id>` grava `state=accepted`/`accepted_at`/`accepted_by` e auditoria `dispatch_accept`; só `open` na geração ativa, idempotente; alimenta `estagios.acceptance` (REQ-17) com `head_oid` conferido. Coluna `squad_dispatch.exigidos` já nasce em TASK-03.

- [X] TASK-38 — Posse global por árvore e aquisição no `launch` (rastreia: REQ-15, design §2.8 (DD-10/DD-10a squad-orchestration); paths: `packages/core/src/squad/ownership.ts`, `packages/core/test/squad/ownership-acquire.test.ts`, `packages/core/src/squad/evidence.ts`; depende: TASK-25)
  - Teste (comando): `cd packages/core && bun run test test/squad/ownership-acquire.test.ts`
  - Padrão de falha: `Expected: "ConflictError"[\s\S]*Received: "acquired"`
  - Notas: índice global `(tree_key) where released_at is null` (não escopado por geração); `launch` adquire a primeira linha (`acquired_via: launch`) e o primeiro `dispatch` confirma (`acquired_via: dispatch`); geração nova não adquire enquanto a anterior não liberar.

## Wave 7 — Painel, documentação e regressão

- [X] TASK-27 — Documento de painel compatível com `kanban.json`, estágios internos e evidência de merge (rastreia: REQ-17, design §2.9 (DD-11 squad-orchestration); paths: `packages/core/src/squad/panel.ts`, `packages/core/test/squad/panel.test.ts`, `packages/protocol/src/groups/squad.ts`, `packages/server/src/handlers/squad.ts`; expoe: GET /api/experimental/squad/panel; depende: TASK-18, TASK-24, TASK-32)
  - Teste (comando): `cd packages/core && bun run test test/squad/panel.test.ts`
  - Padrão de falha: `Expected: false[\s\S]*Received: true`
  - Notas: `progressa` é falso quando `desconhecido[]` não vazio; `done` só com todos os `exigidos[]` verificados (estágio não exigido sem fonte não impede `done`); card sem fonte tem estágios `unknown` e coluna `backlog`; merge verificado por `merge-base --is-ancestor` no repositório de fixture; formato contém `versao_schema`, `revisao`, `colunas`, `cards`, `fonte`.

- [X] TASK-28 — Adapters opcionais de Jira e CI, semântica `unknown`/`failed` e leitura apenas (rastreia: REQ-17, design §2.9 (DD-11 squad-orchestration); paths: `packages/core/src/squad/panel.ts`, `packages/core/src/squad/panel/jira.ts`, `packages/core/src/squad/panel/ci.ts`, `packages/core/test/squad/panel-adapters.test.ts`; depende: TASK-27)
  - Teste (comando): `cd packages/core && bun run test test/squad/panel-adapters.test.ts`
  - Padrão de falha: `Expected: "unknown"[\s\S]*Received: "verified"`
  - Notas: comando ausente/falho ⇒ `unknown` com motivo; CI só `verified` quando o check nomeado é `success` no mesmo `head_oid`; check verde de outro ref não conta; Jira só promove estágio com `updated` posterior ao despacho; nenhum adapter escreve (teste com comando que tenta escrever é recusado pela config).

- [X] TASK-29 — CLI `squad panel build|show` e compatibilidade com o consumidor existente (rastreia: REQ-17, design §2.9 (DD-11 squad-orchestration), §4.3; paths: `packages/cli/src/commands/squad.ts`, `packages/cli/src/commands/handlers/squad.ts`, `packages/cli/test/squad.test.ts`, `packages/core/test/squad/panel-compat.test.ts`; depende: TASK-28)
  - Teste (comando): `cd packages/cli && bun run test test/squad.test.ts`
  - Padrão de falha: `Expected to contain: "versao_schema"[\s\S]*Received:`
  - Notas: `panel build --out <path>` grava e devolve o caminho; `show` imprime resumo por coluna; documento passa pelo mesmo conjunto de chaves que `priorizacao/build_kanban.py` lê (fixture com as chaves exigidas); `panel build` não escreve em Jira/git/sessão.

- [X] TASK-30 — Documentação do pacote, ajuda completa e demonstração sem credencial (rastreia: REQ-20, design §5 (itens 4, 8); paths: `packages/cli/README.md`, `packages/cli/test/squad.test.ts`, `packages/cli/script/demo-squad.ts`, `packages/server/test/squad.test.ts`; depende: TASK-29)
  - Teste (comando): `cd packages/cli && bun run test test/squad.test.ts`
  - Padrão de falha: `Expected to contain: "não libera execução produtiva"[\s\S]*Received:`
  - Notas: parte documental (`README`) não tem par vermelho/verde — é task documental, com motivo: texto não é comportamento executável; a asserção de ajuda usa `squad --help` e `squad plan --help` e falha enquanto a descrição segura não existir. A demonstração (`demo-squad.ts`) usa provider falso (fixture injetada, **sem depender de modelo local instalado**) contra o servidor local, e falha legível sem servidor.

- [X] TASK-31 — Regressão de `queue`/`auth`/prompt/inbox e desligamento com flag falsa (rastreia: REQ-21, design §5 (itens 1-6), §4.1 (compatibilidade); paths: `packages/core/test/squad/regression.test.ts`, `packages/server/test/squad-regression.test.ts`, `packages/cli/test/squad-regression.test.ts`, `packages/protocol/test/squad.test.ts`; depende: TASK-29, TASK-30)
  - Teste (comando): `cd packages/core && bun run test test/squad/regression.test.ts`
  - Padrão de falha: `Expected: 403[\s\S]*Received: 200`
  - Notas: com flag falsa, rota responde 403 e nenhum caminho de sessão/inbox é tocado; suítes de `session.prompt`, `session.inbox`, `queue` e `auth` rodam sem alteração de expectativa; teste de servidor confirma que o grupo experimental só acrescenta `experimental.squad.*`; `bun run generate` não quebra o client existente.

## Rastreabilidade

| REQ / Design § | Critérios cobertos (ordinais de requirements.md) | Tasks |
|---|---|---|
| REQ-01 | 1, 2, 3 | TASK-01, TASK-04, TASK-31 |
| REQ-02 | 1, 2, 3, 4, 5, 6 | TASK-02, TASK-03, TASK-06, TASK-08, TASK-09, TASK-16, TASK-21 |
| REQ-03 | 1, 2, 3, 4, 5 | TASK-07, TASK-08, TASK-13, TASK-19 |
| REQ-04 | 1, 2, 3, 4 | TASK-10, TASK-19 |
| REQ-05 | 1, 2, 3 | TASK-11, TASK-30 |
| REQ-06 | 1, 2, 3, 4, 5, 6 | TASK-16, TASK-17, TASK-23, TASK-33 |
| REQ-07 | 1, 2, 3, 4, 5 | TASK-08, TASK-19 |
| REQ-08 | 1, 2, 3, 4, 5, 6 | TASK-12, TASK-13, TASK-31 |
| REQ-09 | 1, 2, 3, 4, 5 | TASK-14, TASK-31 |
| REQ-10 | 1, 2, 3, 4, 5 | TASK-20 |
| REQ-11 | 1, 2, 3, 4, 5, 6, 7 | TASK-07, TASK-21, TASK-39 |
| REQ-12 | 1, 2, 3, 4 | TASK-22 |
| REQ-13 | 1, 2, 3, 4, 5, 6, 7, 8 | TASK-18, TASK-19, TASK-34, TASK-35 |
| REQ-14 | 1, 2, 3, 4, 5, 6 | TASK-05, TASK-24, TASK-26, TASK-32 |
| REQ-15 | 1, 2, 3, 4, 5, 6 | TASK-05, TASK-25, TASK-26, TASK-38 |
| REQ-16 | 1, 2, 3, 4 | TASK-23 |
| REQ-17 | 1, 2, 3, 4, 5 | TASK-27, TASK-28, TASK-29, TASK-32 |
| REQ-18 | 1, 2, 3, 4, 5, 6, 7 | TASK-15, TASK-26, TASK-37 |
| REQ-19 | 1, 2, 3, 4 | TASK-10, TASK-12, TASK-26 |
| REQ-20 | 1, 2, 3, 4 | TASK-09, TASK-30 |
| REQ-21 | 1, 2, 3, 4 | TASK-04, TASK-31 |
| REQ-22 | 1, 2, 3 | TASK-32 |
| REQ-23 | 1, 2, 3 | TASK-33 |
| REQ-24 | 1, 2, 3 | TASK-35 |
| REQ-25 | 1, 2, 3 | TASK-36 |
| NFR-01 | medição p95 de `status` | TASK-19 |
| NFR-02 | sentinela de segredo ausente de todo artefato | TASK-15, TASK-20, TASK-28 |
| NFR-03 | nenhuma rede fora de loopback | TASK-10, TASK-12 |
| NFR-04 | digest idêntico sob repetição | TASK-06, TASK-21 |
| NFR-05 | sem AppleScript/iTerm; `path.join` | TASK-05, TASK-25, TASK-30 |
| NFR-06 | log estruturado, métrica de canal, span HTTP | TASK-12, TASK-15, TASK-19 |
| design §2.1 (DD-01 squad-orchestration) | composição serviço/HTTP/CLI | TASK-04, TASK-08, TASK-09 |
| design §2.2 (DD-02 squad-orchestration) | tabelas e invariantes | TASK-03, TASK-06 |
| design §2.3 (DD-03/DD-04 squad-orchestration) | resolução, digest e `--replace` | TASK-07, TASK-21, TASK-06 |
| design §2.4 (DD-05 squad-orchestration) | canal, prova e `pending` | TASK-12, TASK-13, TASK-14, TASK-19 |
| design §2.5 (DD-06 squad-orchestration) | launch, evidência e `replace` | TASK-16, TASK-17, TASK-33 |
| design §2.6 (DD-07 squad-orchestration) | checkpoint/fechamento/transição/ativação | TASK-20, TASK-21, TASK-22, TASK-23, TASK-39 |
| design §2.7 (DD-08 squad-orchestration) | liveness, claim, bloqueio | TASK-18, TASK-19, TASK-34, TASK-35 |
| design §2.8 (DD-09/DD-10 squad-orchestration) | despacho, aceite e posse | TASK-24, TASK-25, TASK-26, TASK-32, TASK-38 |
| design §2.9 (DD-11 squad-orchestration) | painel | TASK-27, TASK-28, TASK-29 |
| design §2.10 (DD-12 squad-orchestration) | flag/erros | TASK-01, TASK-04, TASK-10 |
| design §2.12 (DD-13 squad-orchestration) | check | TASK-10 |
| design §2.13 (DD-14 squad-orchestration) | plan | TASK-11 |
| design §2.14 (DD-15 squad-orchestration) | broadcast | TASK-14 |
| design §4.5 | portas de dependência | TASK-10, TASK-12, TASK-36 |
| design §5 | rollout, ADR, docs | TASK-00, TASK-30, TASK-31 |
