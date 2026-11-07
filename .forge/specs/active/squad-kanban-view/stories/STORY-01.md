---
story_id: STORY-01
epic: squad-kanban-view
title: Modelos puros de leitura (board, sessões e allowlist)
depends_on: []
status: in_progress
---

# STORY-01 — Modelos puros de leitura (board, sessões e allowlist)

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar os três módulos de modelo puro da view — `board-model.ts`, `session-model.ts` e
`render-fields.ts` — com testes de fixture, sem importar renderer, client ou plugin. São as
funções puras que todos os componentes das stories seguintes consomem.

## Embedded context

### Requirements

- **REQ-01:** o board é renderizado a partir do documento: uma coluna por entrada de
  `PanelDocument.colunas` (na ordem do documento) e um card por entrada de `PanelDocument.cards`,
  agrupado por `card.coluna`; ordem dos cards = ordem de inserção do record `cards{}` (nenhuma
  ordenação local); card com `desconhecido[]` não vazio exibe contagem e o selo "sem progresso"
  quando `progressa` é `false`; `cards{}` vazio com geração ativa = estado vazio.
- **REQ-04:** painel de sessões lista, por sessão da geração ativa, veredito de liveness, `cause`,
  flags (`workingStale`, `presumedDead`), `inboxPending`, `lastActivity` + `source` (ausentes viram
  "—", nunca o instante atual); veredito é exatamente `liveness.verdict` (fixture `working` com
  `cause` contendo "dead" continua `working`); geração anterior em bloco separado; no detalhe, a
  sessão de `card.agente` é localizada por igualdade com `SessionStatus.name` — sem correspondência,
  `undefined` (a UI diz "sessão não encontrada nesta geração", nunca inventa `sessionID`).
- **REQ-08:** nunca expor `location`, corpo de checkpoint/mensagem, credencial ou token; fixture com
  `location: { directory: "/Users/segredo/worktree" }` não pode conter `/Users` no texto renderizado;
  `evidence.reference` é renderizado verbatim (redaction é do produtor — decisão registrada no teste).
- **REQ-05 crit. 1:** idade `agora - atualizadoEm` formatada com unidade (`s`, `min`, `h`); fixture
  com `atualizadoEm = T` e relógio em `T + 90_000 ms` devolve `"1 min"` (relógio injetado, nunca
  `Date.now()` no componente).

### Design

- §2.2 (DD-02): `colunas[]` define ordem e conjunto de colunas; ordem estável de `cards{}` é a de
  `Object.entries` (inserção); **DA-06 → (b): sem faixa "coluna desconhecida"** — o typecheck do
  client contra o contrato gerado é a guarda.
- §2.3 (DD-03): linha por `SessionStatus` com `name`, `role`, `state`, `provider/model/variant`,
  `liveness.verdict`, `measuredAt`, `lastActivity` + `source`, `workingStale`, `presumedDead`,
  `cause`, `inboxPending` (vira `inbox: <n>`); ausentes → `null` (a UI mostra "—").
- §2.6 (DD-06): `render-fields.ts` concentra a formatação (título, agente, prioridade, refs,
  evidências, bloqueio, estágio, sessão); instantes em ms epoch → ISO-8601 UTC com sufixo `Z`.
- **DA-03 → (a):** o selo "sem progresso" é exibido sempre que `progressa: false` e
  `desconhecido[]` não vazio — fiel ao dado, sem recalcular regra do produtor.
- **DA-05 → (a):** idade só avança com interação; o rótulo de frescor mostra "às <hora>" além da
  idade relativa (formatadores vivem aqui, para o rodapé de STORY-03 reusar).

### Contratos / interfaces

- Valores de fixture tipados por `SquadPanelDocument` / `SquadLivenessReport` do client gerado
  (`packages/client/src/promise/generated/types.ts:2460, :2971`) — **formato codificado** (instantes
  em ms epoch). `Squad.*` de `@opencode/schema/squad` é a semântica, não o tipo do valor recebido.

### Rules aplicáveis

- `.forge/rules/testing/regression-red-first.md` — vermelho por **asserção** com stub de produção;
  `Cannot find module` é `build-error` e reprova.
- `AGENTS.md` §Testing — sem mocks; fixtures tipadas pelo contrato real.

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [X] TASK-01 — Modelo do board: agrupar o documento por coluna, preservar ordem e expor `exigidos`/`desconhecido`/`progressa` (paths: `packages/tui/src/feature-plugins/squad/board-model.ts`, `packages/tui/test/feature-plugins/squad-board-model.test.ts`; depende: —)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-board-model.test.ts`
  - Padrão de falha: `Expected: "backlog,in_progress,in_review,blocked,done"[\s\S]{0,200}Received: ""`
  - Stub: `boardModel()` devolve `{ columns: [], empty: true }`.
- [ ] TASK-02 — Modelo de sessões: projetar o relatório em linhas com veredito, `cause`, flags e geração anterior (paths: `packages/tui/src/feature-plugins/squad/session-model.ts`, `packages/tui/test/feature-plugins/squad-session-model.test.ts`; depende: —)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-session-model.test.ts`
  - Padrão de falha: `Expected: "presumed_dead"[\s\S]{0,200}Received: "idle"`
  - Stub: `sessionRows()` mapeia todo veredito para `"idle"` (o defeito que REQ-04 proíbe).
- [ ] TASK-03 — Allowlist e formatação de campos: nunca expor `location`, corpo, credencial ou token; formatar instantes e idade (paths: `packages/tui/src/feature-plugins/squad/render-fields.ts`, `packages/tui/test/feature-plugins/squad-render-fields.test.ts`; depende: —)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-render-fields.test.ts`
  - Padrão de falha: `Expected: -1[\s\S]{0,200}Received: [0-9]+`
  - Stub: `renderSession()` devolve `JSON.stringify(session)`; asserção `expect(text.indexOf("/Users")).toBe(-1)`.

## Acceptance criteria

- [ ] `boardModel()` com fixture de 5 colunas (`backlog`, `in_progress`, `in_review`, `blocked`,
      `done`) e 3 cards em colunas distintas devolve as colunas na ordem exata do documento, cards
      agrupados por `card.coluna` na ordem de inserção; nenhuma ordenação local é aplicada.
- [ ] Card com `desconhecido[]` não vazio e `progressa: false` é marcado com o selo "sem progresso";
      `cards{}` vazio devolve estado vazio (sem coluna inventada nem card fantasma).
- [ ] `sessionRows()` projeta `presumed_dead` (com `cause`) e `stalled` como rótulos distintos,
      `inboxPending` como `inbox: <n>`, `previous` como bloco separado com `name`, `sessionID` e
      estado `closed`; `unknown` nunca é convertido em `idle`; veredito `working` com `cause`
      contendo "dead" continua `working`.
- [ ] Ausência de `lastActivity`/`source`/`cause` vira `null` (nunca `Date.now()`);
      `findSession(rows, card.agente)` devolve `undefined` sem correspondência.
- [ ] `renderSession()` com fixture contendo `location: { directory: "/Users/segredo/worktree" }`,
      `body`, `credential`, `token` não contém nenhum desses valores; `evidence.reference` é
      verbatim; controle negativo: com `location` fora da fixture o teste continua verde.
- [ ] `formatAge(atualizadoEm, now)` com `now = atualizadoEm + 90_000` devolve `"1 min"`;
      instantes em ms são formatados em ISO-8601 UTC com sufixo `Z`.
- [ ] Vermelho de cada task falha por asserção (não por `Cannot find module`) — stub com assinatura
      final e comportamento errado, conforme `tasks.md`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Renderer, client e plugin (nenhum import desses módulos nesta story).
- Hook de fetch e estados de erro (STORY-02); componentes board/detalhe/sessões (STORY-03..06).
- Barra de progresso para `progressa: true` — nada desenhado em v1 (DA-04, inalcançável).
