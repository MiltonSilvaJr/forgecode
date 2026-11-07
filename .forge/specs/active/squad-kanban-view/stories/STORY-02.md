---
story_id: STORY-02
epic: squad-kanban-view
title: Hook de leitura concorrente com estados e frescor
depends_on: [STORY-01]
status: todo
---

# STORY-02 — Hook de leitura concorrente com estados e frescor

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar `use-squad-board.ts`: o hook Solid que recebe uma porta de leitura injetada
(`{ panel, liveness }`) e um relógio `now`, dispara as duas leituras em paralelo por refresh e
devolve um estado discriminado com falha parcial, `staleSince` e tradução tipada de erros.

## Embedded context

### Requirements

- **REQ-05:** exibir `revisao` e idade `agora - atualizadoEm` (relógio injetado); falha de refresh
  **não apaga** o último documento válido — marca selo "desatualizado" com idade e erro; falha de
  `panel` não impede `liveness` e vice-versa; cada refresh dispara **exatamente duas** chamadas de
  leitura (painel e liveness), nunca uma terceira por card ou sessão (NFR-02).
- **REQ-06:** `403` (`ForbiddenError`) → mensagem contendo `squad.enabled` e instrução de ligar a
  flag; `404` (`ClientError`, `reason: "UnexpectedStatus"`, `cause.status === 404`) → "squad
  indisponível nesta versão do servidor" + versão do cliente; `409` (`ConflictError`) → mensagem do
  servidor verbatim + retry; rede (`ClientError` `Transport`) ou `503` (`ServiceUnavailableError`) →
  "servidor indisponível" + retry (`r`); com `LivenessReport.generation === null` e `cards{}` vazio →
  "nenhuma geração ativa" (distinto do estado vazio de REQ-01); nenhum estado lança exceção ao
  renderer.
- **REQ-07 crit. 3:** nenhum arquivo escrito em disco, `context.storage` não é usado; o refresh
  reconstrói o estado a partir dos dois documentos.

### Design

- §2.4 (DD-04): `loading` só na primeira carga; depois `ready(panel, liveness)`; refresh com falha →
  `ready(panel, liveness, staleSince, error)` mantendo o conteúdo; `panel` e `liveness` armazenados
  separadamente (falha parcial); idade a partir de `atualizadoEm` (P2 — documento montado a cada
  requisição no servidor); sem `setInterval`; nada roda em background.
- §2.5 (DD-05): a porta é tipada `{ panel(): Promise<SquadPanelDocument>; liveness(): Promise<SquadLivenessReport> }`;
  o plugin a constrói a partir de `context.client.experimental.squad` passando **só** as duas funções
  — nenhum outro método do client é referenciado.
- **DA-07 → (b):** single-flight — tecla `r` durante refresh em voo é **ignorada** até a conclusão
  (cada `panel` executa comandos por card no servidor, R10).

### Contratos / interfaces

- `GET /api/experimental/squad/panel` e `GET /api/experimental/squad/liveness`: erros declarados
  `ForbiddenError` 403 / `ConflictError` 409 / `ServiceUnavailableError` 503; 404 não declarado →
  `ClientError("UnexpectedStatus")`; rede → `ClientError("Transport")` (design §4.1).
- Tipos: `SquadPanelDocument`, `SquadLivenessReport` (client gerado, formato codificado em ms).

### Rules aplicáveis

- `.forge/rules/testing/change-test-contract.md` — `loading` na primeira carga é obrigatório.
- `.forge/rules/testing/regression-red-first.md` — vermelho por asserção com stub.
- `AGENTS.md` §Testing — cliente de teste é porta de injeção de borda (nenhuma rede no teste).

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-04 — Hook de leitura concorrente: `panel` + `liveness`, falha parcial, último documento, `staleSince` e estados de erro (paths: `packages/tui/src/feature-plugins/squad/use-squad-board.ts`, `packages/tui/test/feature-plugins/squad-use-board.test.ts`; depende: TASK-01, TASK-02 — entregues em STORY-01)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-use-board.test.ts`
  - Padrão de falha: `Expected: 2[\s\S]{0,200}Received: 1`
  - Stub: o hook chama só `port.panel()`; asserção `expect(calls.length).toBe(2)` após um refresh.

## Acceptance criteria

- [ ] Cada refresh executa exatamente 2 leituras (`panel` + `liveness`) — teste com porta contadora
      falha em `!== 2` (NFR-02).
- [ ] Sucesso seguido de falha mantém o documento anterior e marca `staleSince`; falha de `panel`
      não apaga `liveness` e vice-versa; o estado nunca fica em branco nem apresenta dado falho como
      fresco.
- [ ] Mapeamento de erros: `ForbiddenError` → `disabled` (mensagem com `squad.enabled`);
      `ClientError` `UnexpectedStatus` 404 → `unavailable` (com versão do cliente);
      `ConflictError` → `failed` com mensagem verbatim; `Transport`/503 →
      `failed("servidor indisponível")`; retry acionável via `r`.
- [ ] `liveness.generation === null` + `cards{}` vazio → estado "nenhuma geração ativa", distinto do
      estado vazio de REQ-01.
- [ ] Cleanup no unmount; **nenhum** `setInterval`; refresh em voo + novo `r` não soma chamadas
      (single-flight, DA-07); nenhum `context.storage`/escrita em disco.
- [ ] Primeira carga passa por `loading` (change-test-contract).
- [ ] Vermelho falha por asserção (`Expected: 2` / `Received: 1`), não por `Cannot find module`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Componentes e renderização (STORY-03 em diante); a porta real a partir de
  `context.client.experimental.squad` (o plugin a constrói em STORY-08 — aqui a porta é injetada).
- Teclas e navegação (STORY-04); timers de idade (DA-05 → (a): idade só avança com interação).
