# Tasks — forgequeue

> Tasks do change `forgequeue`, ordenadas por dependência. Formato de ID: `TASK-NN` (numeração contínua).
> Status: `[ ]` todo · `[-]` em progresso · `[X]` concluída · `[!]` bloqueada (exige intervenção humana).
>
> **Como o Red é produzido.** Toda task de código abre o Red com o teste **e** a assinatura exportada
> do módulo devolvendo um valor trivial errado; a falha do vermelho precisa ser de asserção
> (`Expected`/`Received`), nunca `Cannot find module` — falha de build não é Red
> (`.forge/rules/testing/regression-red-first.md`, item 1). A task de artefato gerado (TASK-05)
> declara explicitamente que não tem par vermelho/verde de asserção.
>
> **Onde rodar.** Todo `Teste (comando)` roda do diretório do pacote; a raiz é bloqueada pelo guard
> `do-not-run-tests-from-root`. Os caminhos de teste abaixo são os mesmos citados em
> `spec-delta.yaml`.

## Wave 1 — Fundação

- [X] TASK-01 — Campo de configuração `experimental.forgequeue` (rastreia: REQ-14, design §2.10; paths: `packages/schema/src/config/experimental.ts`, `packages/schema/test/config.test.ts`; depende: —)
  - Teste (comando): `cd packages/schema && bun test test/config.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: o teste afirma o round-trip `{ experimental: { forgequeue: { enabled: true } } }` e que a chave ausente não habilita nada; a flag default é `false` (ausente).
- [X] TASK-02 — Resolução de destino por UUID, nome e geração (rastreia: REQ-02, design §2.3; paths: `packages/cli/src/queue/target.ts`, `packages/cli/test/queue-target.test.ts`; depende: —)
  - Teste (comando): `cd packages/cli && bun test test/queue-target.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: cobre exato, inexistente, ambíguo, só-arquivado (geração anterior) e paginação com `cursor.next`; cliente é `OpenCode.make` com `spyOn` em `session.list`, padrão de `packages/cli/test/session-target.test.ts`.
- [X] TASK-03 — Trilha de auditoria append-only (rastreia: REQ-10, design §2.7; paths: `packages/cli/src/queue/audit.ts`, `packages/cli/test/queue-audit.test.ts`; depende: —)
  - Teste (comando): `cd packages/cli && bun test test/queue-audit.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Setup do teste: `mkdtemp` por teste para o diretório de auditoria injetado
  - Notas: assere acréscimo sem reescrita (bytes da primeira linha), `0600`, ausência do marcador de texto, `idempotencyKey` sempre presente (nunca `null`), `result: failed` com `messageID: null`, truncamento em 200 caracteres e falha de escrita (diretório somente-leitura) que avisa em stderr sem abortar nem reverter a admissão.

## Wave 2 — Admissão e configuração

- [X] TASK-04 — Resolução da feature flag a partir de `GET /api/config` (rastreia: REQ-14, design §2.10; paths: `packages/cli/src/queue/flag.ts`, `packages/cli/test/queue-flag.test.ts`; depende: TASK-01)
  - Teste (comando): `cd packages/cli && bun test test/queue-flag.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: função pura sobre `Config.Entry[]`; assere default desligado, último documento que define a chave vence (inclusive `false` sobre `true` anterior) e entrada `directory` ignorada.
- [X] TASK-05 — Regenerar o client do Protocol (rastreia: REQ-15, design §4.2; paths: `packages/client/src/promise/generated/`, `packages/client/src/effect/generated/`; depende: TASK-01)
  - Teste (comando): `cd packages/client && bun run generate && git diff --exit-code -- src`
  - Padrão de falha: n/a — task de artefato gerado, sem par vermelho/verde de asserção; a prova é o diff de tipos gerados (antes da regeneração, o `ConfigEntry` gerado não tem `forgequeue`) e `bun check` no pacote
  - Notas: nunca editar `src/promise/generated/*` à mão (AGENTS.md); o diff aceitável se limita aos tipos de `Config.Info`.
- [X] TASK-06 — Admissão na inbox com delivery, idempotência obrigatória e auto-envio (rastreia: REQ-01, REQ-04, REQ-08, REQ-12, design §2.2; paths: `packages/cli/src/queue/enqueue.ts`, `packages/cli/test/queue-enqueue.test.ts`; depende: TASK-02, TASK-03)
  - Teste (comando): `cd packages/cli && bun test test/queue-enqueue.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: assere payload (`text`, `delivery` default `queue`, `steer` explícito), id `msg_fq_<chave>`, retry com a mesma chave sem segundo item, chave inválida, chave ausente (código 2, zero admissão), auto-envio por `OPENCODE_SESSION_ID` com e sem `--allow-self`, 409 de id reaproveitado e uma linha de auditoria por tentativa; conta chamadas para provar NFR-02 e NFR-05.

## Wave 3 — Superfície de CLI

- [X] TASK-07 — Comando `queue` com flags, texto e `--json` (rastreia: REQ-01, REQ-03, REQ-05, REQ-12, REQ-13, REQ-14, design §2.4, §2.9, §2.11; paths: `packages/cli/src/commands/commands.ts`, `packages/cli/src/commands/handlers/queue.ts`, `packages/cli/src/queue/format.ts`, `packages/cli/src/index.ts`, `packages/cli/test/queue-command.test.ts`; depende: TASK-04, TASK-06)
  - Teste (comando): `cd packages/cli && bun test test/queue-command.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Setup do teste: `Bun.spawn` sobre `packages/cli/src/index.ts` (padrão de `packages/cli/test/debug-paths.test.ts`) para `--help` e para os erros de uso
  - Notas: prova o despacho do handler no nó pai (`Runtime.Handlers.$`) junto com os subcomandos; cobre `--message-file` (inclusive metacaracteres), exclusividade `--message`/`--message-file`, exclusividade `--thread`/`--to`/`--all` (erro de uso código 2), `--idempotency-key` ausente (erro de uso código 2), flag desligada, ausência de destino e frase de sucesso sem promessa de leitura.
- [X] TASK-08 — `queue list` com estado derivado (rastreia: REQ-06, design §2.5; paths: `packages/cli/src/queue/status.ts`, `packages/cli/src/commands/handlers/queue/list.ts`, `packages/cli/test/queue-status.test.ts`; depende: TASK-03, TASK-06)
  - Teste (comando): `cd packages/cli && bun test test/queue-status.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: cobre `pending`, `delivered`, `cancelled`, `unknown` (erro de transporte), item pendente sem registro de auditoria e que `--limit 5` com 20 registros faz no máximo 5 provas de mensagem (NFR-03).
- [X] TASK-09 — `queue activity` com snapshot e `--watch` (rastreia: REQ-11, design §2.8; paths: `packages/cli/src/queue/activity.ts`, `packages/cli/src/commands/handlers/queue/activity.ts`, `packages/cli/test/queue-activity.test.ts`; depende: TASK-02)
  - Teste (comando): `cd packages/cli && bun test test/queue-activity.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: `state` derivado só de `time.busy`/`time.idle`; `lastMessageAt` de `message.list({limit:1, order:"desc"})`; `--watch` com stream assíncrono injetado filtra por `data.sessionID` e respeita timeout; nenhum caso lê texto de mensagem.

## Wave 4 — Leitura e broadcast

- [X] TASK-10 — Comando `forgecode sessions` (rastreia: REQ-07, design §2.6; paths: `packages/cli/src/commands/handlers/sessions.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/src/index.ts`, `packages/cli/test/sessions.test.ts`; depende: TASK-07)
  - Teste (comando): `cd packages/cli && bun test test/sessions.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: cobre `providerID/modelID`, `-` quando ausente, `busy`/`idle`/`archived`, `--all`, `--json` e paginação por `cursor.next`.
- [X] TASK-11 — Broadcast `--all` com validação prévia (rastreia: REQ-09, REQ-12, design §2.3; paths: `packages/cli/src/queue/target.ts`, `packages/cli/src/queue/enqueue.ts`, `packages/cli/test/queue-broadcast.test.ts`; depende: TASK-06, TASK-07)
  - Teste (comando): `cd packages/cli && bun test test/queue-broadcast.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: prova que todas as validações acontecem antes da primeira admissão, que a origem é excluída (e incluída com `--allow-self`), que falha parcial retorna código 1 listando `queued`/`failed`, que a auditoria recebe uma linha por destino e que a mesma chave gera um item por sessão (id distinto por sessão).
- [X] TASK-12 — Integração de duas sessões contra servidor real em memória (rastreia: REQ-01, REQ-06, REQ-11, REQ-12, design §2.5, §4.1; paths: `packages/cli/test/queue-integration.test.ts`; depende: TASK-07, TASK-08, TASK-09)
  - Teste (comando): `cd packages/cli && bun test test/queue-integration.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Setup do teste: `ServerFetch.make({ database: { path: ":memory:" }, models: { fetch: false }, fs: { filewatcher: false } })` como `fetch` do cliente
  - Notas: enfileira da sessão A para a B com `--idempotency-key`, assere `session.inbox.enqueued` na inbox de B, que B não processa antes da execução (item continua `pending`), que A não recebe nenhuma confirmação de leitura, que `queue list` classifica `delivered` só depois de a mensagem existir e que repetir a admissão com a mesma chave produz um único item e um único `session.inbox.enqueued`.

## Wave 5 — Regressão e documentação

- [X] TASK-13 — Regressão do default `steer` em `session.prompt` (rastreia: REQ-15, design §4.1; paths: `packages/server/test/session-prompt-delivery.test.ts`; depende: TASK-05)
  - Teste (comando): `cd packages/server && bun test test/session-prompt-delivery.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: admissão sem `delivery` continua `steer`; admissão com `queue` continua `queue`. Controle negativo: o mesmo teste com `delivery: "queue"` precisa falhar se o default for aplicado por engano.
- [X] TASK-14 — Regressão da saída de `session list` (rastreia: REQ-15; paths: `packages/cli/test/queue-regression.test.ts`; depende: TASK-05)
  - Teste (comando): `cd packages/cli && bun test test/queue-regression.test.ts`
  - Padrão de falha: `Expected.*Received`
  - Notas: congela as chaves de `opencode session list --format json` (comando existente) para provar que o comando novo `sessions` não alterou o contrato antigo.
- [X] TASK-15 — Documentação do comando e ADR (rastreia: REQ-05, REQ-12, REQ-14, design §5; paths: `packages/cli/AGENTS.md`, `.forge/product/current/adr/`; depende: TASK-07, TASK-10)
  - Teste (comando): n/a — task documental; a verificação é `grep -n "forgecode queue" packages/cli/AGENTS.md` e o ADR presente em `.forge/product/current/adr/` com o `change-id` na seção Links
  - Padrão de falha: n/a — documental, sem par vermelho/verde
  - Notas: documenta flag (`experimental.forgequeue.enabled`), exemplos sempre com `--idempotency-key` (obrigatório nas escritas), códigos de saída, regra de geração, limitação da trilha local e a decisão de fila por sessão sem barramento global.

## Rastreabilidade

| REQ / Design § | Tasks |
|---|---|
| REQ-01 | TASK-06, TASK-07, TASK-12 |
| REQ-02 | TASK-02, TASK-11 |
| REQ-03 | TASK-07 |
| REQ-04 | TASK-06, TASK-07 |
| REQ-05 | TASK-07, TASK-15 |
| REQ-06 | TASK-08, TASK-12 |
| REQ-07 | TASK-10 |
| REQ-08 | TASK-06 |
| REQ-09 | TASK-11 |
| REQ-10 | TASK-03, TASK-06, TASK-11 |
| REQ-11 | TASK-09, TASK-12 |
| REQ-12 | TASK-06, TASK-07, TASK-11, TASK-12, TASK-15 |
| REQ-13 | TASK-07 |
| REQ-14 | TASK-01, TASK-04, TASK-07, TASK-15 |
| REQ-15 | TASK-05, TASK-13, TASK-14 |
| NFR-01 | TASK-02, TASK-03, TASK-07 |
| NFR-02 | TASK-06, TASK-12 |
| NFR-03 | TASK-08 |
| NFR-04 | TASK-03, TASK-07 |
| NFR-05 | TASK-06, TASK-12 |
| Design §2.11 (handler pai) | TASK-07 |
| Design §5 (rollout e rollback) | TASK-15 |
