---
story_id: STORY-07
epic: squad-kanban-view
title: Layout responsivo e janela de montagem
depends_on: [STORY-03]
status: todo
---

# STORY-07 — Layout responsivo e janela de montagem

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar `layout.ts` e integrar o modo responsivo no board: colunas lado a lado em largura ≥120,
lista empilhada em 80–119, modo minimal <80; e a janela de montagem que limita os renderables de
card a `altura_do_terminal + 4` (NFR-01), cada um com id `squad-card-<id>`.

## Embedded context

### Requirements

- **REQ-09:** em 80×24 ou mais, todas as colunas e cards alcançáveis por navegação, sem scroll
  horizontal; em largura ≥120, as colunas são lado a lado; em 80×24 com 10 cards, todos os 10
  títulos são alcançáveis por `j/k` (após navegar) e o cabeçalho da coluna corrente permanece
  visível; em 120×40, os cinco cabeçalhos aparecem simultaneamente.
- **REQ-09 crit. 3:** nenhuma cor literal, `RGBA.from`, `theme.hue` ou `categorical` no componente;
  cores só por token semântico (`text.feedback.error` só erro; `text.feedback.warning` só
  "desatualizado"; seleção em `text.formfield`/`background.formfield` estado `focused`; demais
  textos `text.base`/`text.muted`).
- **REQ-09 crit. 4 / nota:** status transmitido por texto; o layout estreito **empilha** colunas em
  vez de comprimir células.
- **NFR-01:** com 200 cards numa coluna, a view monta no máximo `altura_do_terminal + 4`
  renderables de card; medição **estrutural** com `getRenderable("squad-card-<id>")` (padrão
  `test/session-mount-budget.test.tsx:98-101`) — o card de índice 150 não está montado antes de
  navegar até ele; contar títulos no `captureCharFrame()` **não** mede isso.

### Design

- §2.7 (DD-07): `layout.ts` expõe `mode(width)`: `columns` (≥120), `stacked` (80–119), `minimal`
  (<80 — mostra a coluna corrente e um aviso de largura; sem critério de aceite próprio, achado
  KV-L03).
- §2.2 (DD-02): o modelo expõe `visibleRows(column, viewportHeight)` e a UI monta no máximo
  `viewport + 4` renderables; a seleção é um índice por coluna — `j/k` movem dentro da janela e
  rolam a janela.

### Contratos / interfaces

- Consome o `boardModel()` (STORY-01) e o board (STORY-03); não toca em hook, keymap ou plugin.

### Rules aplicáveis

- `AGENTS.md` (raiz) "TUI Theme Tokens" — escolher token por papel semântico; estender o tema se
  faltar token, nunca reporpor o mais próximo.
- `.forge/rules/testing/regression-red-first.md` — vermelho por asserção com stub (`mode()` sempre
  `"stacked"`).

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-09 — Layout responsivo e janela de montagem: 80×24 empilhado, 120×40 em colunas, `viewport + 4`, tokens (paths: `packages/tui/src/feature-plugins/squad/layout.ts`, `packages/tui/src/feature-plugins/squad/board.tsx`, `packages/tui/test/feature-plugins/squad-layout.test.tsx`; depende: TASK-05 — STORY-03)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-layout.test.tsx`
  - Padrão de falha: `Expected: 5[\s\S]{0,200}Received: 1`
  - Stub: `mode()` devolve sempre `"stacked"`; asserção conta cabeçalhos visíveis em 120×40 com `toBe(5)`.

## Acceptance criteria

- [ ] Em 120×40 com a fixture de 5 colunas, os cinco cabeçalhos aparecem simultaneamente no frame
      (`mode()` = `columns`).
- [ ] Em 80×24 com 10 cards, todos os 10 títulos são alcançáveis por `j` (após navegar) e o
      cabeçalho da coluna corrente permanece visível (`mode()` = `stacked`).
- [ ] Com 200 cards numa coluna em 80×24, `getRenderable("squad-card-<id>")` conta no máximo 28
      renderables montados e o de índice 150 não está montado antes da navegação (medição
      estrutural, não de frame).
- [ ] Verificação estática de tokens vazia:
      `grep -rnE "#[0-9a-fA-F]{3,8}\b|RGBA\.from|theme\.hue|categorical" src/feature-plugins/squad`
      (a partir de `packages/tui`).
- [ ] Vermelho falha por asserção (`Expected: 5` / `Received: 1`), não por `Cannot find module`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Navegação por teclas (STORY-04) — a janela expõe o que a navegação consome, mas os binds são de
  lá; detalhe do card (STORY-05); painel de sessões (STORY-06).
