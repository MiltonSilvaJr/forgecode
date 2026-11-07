---
story_id: STORY-06
epic: squad-kanban-view
title: Painel de sessões e liveness
depends_on: [STORY-02]
status: todo
---

# STORY-06 — Painel de sessões e liveness

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar `sessions.tsx`: o painel lateral que lista as sessões da geração ativa a partir do
`LivenessReport` — nome, papel, estado, provider/modelo/variant, veredito verbatim, `cause`,
flags, `inboxPending` — e a geração anterior como bloco separado somente leitura.

## Embedded context

### Requirements

- **REQ-04:** por sessão da geração ativa: nome, papel, estado, provider/modelo/variant, veredito
  de liveness, `measuredAt`, `lastActivity` com `source`, `workingStale`, `presumedDead`, `cause` e
  `inboxPending`; `presumed_dead` (com `cause`) e `stalled` renderizam rótulos distintos;
  `unknown` nunca é exibido como `idle`; `lastActivity` ausente exibe "—" (nunca o instante atual);
  `source` ausente exibe "—"; `inboxPending > 0` exibido como `inbox: <n>` sem alterar o veredito;
  o veredito exibido é exatamente `liveness.verdict` (fixture `working` com `cause` contendo "dead"
  exibe `working` — nenhum texto de `cause`/`name` reescreve o veredito).
- **REQ-04 crit. 3:** a geração anterior, quando presente, aparece em bloco próprio com
  `closedAt`/`closedBy` (ou "—") e `name`, `sessionID` (ou "—") e estado `closed` de cada sessão;
  não é misturada com as sessões ativas.
- **REQ-08 crit. 1:** `SessionStatus.location` (`Location.Ref` com `directory` absoluto) é
  `sensitive` e **não é renderizado**; nenhum frame contém `/Users`.

### Design

- §2.3 (DD-03): linha por `SessionStatus`; ausentes viram "—"; geração anterior só leitura.
- §2.6 (DD-06): allowlist via `render-fields.ts` (STORY-01); `branch` e `provider/model/variant`
  são exibidos; `sessionID` só no bloco da geração anterior.
- Consome `sessionRows()` de `session-model.ts` (TASK-02, entregue em STORY-01 — disponível porque
  STORY-02 depende de STORY-01) e o estado do hook (TASK-04, STORY-02).

### Contratos / interfaces

- `LivenessReport` (`squad.ts:365-372`): `generation` (nulo sem geração ativa), `sessions[]`,
  `inboxPending`, `cost`, `previous` (nulo ou `{ id, closedAt?, closedBy?, sessions[] }`).
- `SessionStatus` (`squad.ts:337-350`): `name`, `role`, `provider`, `model`, `variant?`,
  `location` (sensitive — nunca renderizado), `branch?`, `sessionID?`, `state`, `liveness`,
  `inboxPending`, `cost`.
- `Liveness` (`squad.ts:138-149`): `verdict`, `measuredAt`, `lastActivity?`, `sentAt?`, `source?`,
  `sessionState?`, `workingStale`, `presumedDead`, `cause?`.

### Rules aplicáveis

- `AGENTS.md` (raiz) "TUI Theme Tokens" — vereditos são palavras, sem cor de `feedback` em v1.
- `.forge/rules/testing/regression-red-first.md` — vermelho por asserção com stub (`Sessions`
  renderiza só os nomes).

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-08 — Painel de sessões: liveness, `cause`, `inboxPending`, geração anterior e vínculo card→sessão (paths: `packages/tui/src/feature-plugins/squad/sessions.tsx`, `packages/tui/test/feature-plugins/squad-sessions.test.tsx`; depende: TASK-04 — STORY-02)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-sessions.test.tsx`
  - Padrão de falha: `Expected to contain: "presumed_dead"[\s\S]{0,200}Received:`
  - Stub: `Sessions` renderiza só os nomes.

## Acceptance criteria

- [ ] Fixture com uma sessão `presumed_dead` (com `cause`) e uma `stalled` renderiza os dois
      rótulos distintos e a `cause` da primeira; `unknown` nunca aparece como `idle`.
- [ ] `inbox: <n>` exibido quando `inboxPending > 0`, sem alterar o veredito; `lastActivity`
      ausente exibe "—" (nunca o instante atual); `source` ausente exibe "—".
- [ ] Geração anterior em bloco separado com `closedAt`/`closedBy` (ou "—"), `name`, `sessionID`
      (ou "—") e estado `closed`; não misturada com as sessões ativas.
- [ ] Veredito exatamente `liveness.verdict` — fixture `verdict: "working"` com `cause` contendo
      "dead" exibe `working`.
- [ ] Nenhum frame contém `/Users` (fixture com `location` no formato `Location.Ref`).
- [ ] Vermelho falha por asserção (`Expected to contain: "presumed_dead"`), não por
      `Cannot find module`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Board, detalhe de card e navegação (STORY-03..05) — o painel é independente do board.
- Story e documentação (STORY-09).
