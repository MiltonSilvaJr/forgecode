---
story_id: STORY-03
epic: squad-kanban-view
title: Componente board com estados de erro e rodapé de frescor
depends_on: [STORY-01, STORY-02]
status: todo
---

# STORY-03 — Componente board com estados de erro e rodapé de frescor

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar `board.tsx`: o componente que renderiza colunas e cards a partir do modelo (STORY-01) e do
estado do hook (STORY-02), com selo "sem progresso", rodapé de frescor (`revisao` + idade) e todos
os estados nomeados: `loading`, vazio, sem geração ativa, `403`, `404`, `409`, rede/503 e
"desatualizado".

## Embedded context

### Requirements

- **REQ-01:** coluna por entrada de `colunas[]` na ordem do documento; card por entrada de `cards{}`
  agrupado por `card.coluna`; card com `desconhecido[]` não vazio exibe a contagem e o selo "sem
  progresso" quando `progressa` é `false` (com o produtor atual isso vale para 100% dos cards —
  DA-03 → (a): exibir sempre, fiel ao dado); `cards{}` vazio com geração ativa → "nenhum card na
  geração ativa".
- **REQ-05 crit. 1–2:** rodapé exibe `revisao` e a idade com unidade (`s`, `min`, `h`), com `agora`
  de relógio injetado; após refresh que falha, o board continua exibindo o documento anterior com o
  selo "desatualizado" (idade + erro), nunca em branco.
- **REQ-06:** estados nomeados com remediação: `403` contém `squad.enabled` + instrução; `404` →
  "squad indisponível nesta versão do servidor" + versão do cliente (`context.app.version`), não
  interpretado como geração vazia; `409` → mensagem do servidor verbatim + retry; rede/503 →
  "servidor indisponível" + retry; nenhum estado derruba o TUI nem lança exceção ao renderer;
  `generation === null` + `cards{}` vazio → "nenhuma geração ativa" (distinto do vazio de REQ-01).
- **REQ-08 crit. 1:** nenhum frame contém `/Users` nem valores fora da allowlist.

### Design

- §2.2 (DD-02): a UI monta no máximo `viewport + 4` renderables de card (a janela fina é refinada
  em STORY-07; aqui o board já deve receber o modelo pronto e não recalcular regra).
- §2.4 (DD-04): máquina de estados — `loading` → `ready`; refresh com falha → `ready` + `staleSince`
  + erro; erros tipados traduzidos, nunca stack trace.
- §2.7 (DD-07): tokens semânticos — `text.base`/`text.muted` para textos;
  `text.feedback.error` **só** para erro; `text.feedback.warning` **só** para "desatualizado";
  nenhuma cor literal, `theme.hue` ou `categorical`; status por texto, não por cor.
- `.forge/rules/testing/change-test-contract.md` — primeira carga mostra `loading`.

### Contratos / interfaces

- Consome: `boardModel()` e `render-fields.ts` (STORY-01), estado de `use-squad-board` (STORY-02),
  `formatAge`/`formatInstant` de `render-fields.ts` para o rodapé (DA-05 → (a): rótulo "às <hora>"
  além da idade relativa).
- A versão do cliente vem de `context.app.version` (apenas no estado `404`).

### Rules aplicáveis

- `.forge/rules/testing/change-test-contract.md` — tela orientada a dados: loading/sucesso/vazio/erro.
- `AGENTS.md` (raiz) "TUI Theme Tokens" — papel semântico, nunca `theme.hue`/cor literal.
- `.forge/rules/testing/regression-red-first.md` — vermelho por asserção com stub (`Board` vazio).

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-05 — Board: colunas, cards, selo "sem progresso", rodapé de frescor e estados loading/vazio/sem geração/403/404/409/rede (paths: `packages/tui/src/feature-plugins/squad/board.tsx`, `packages/tui/test/feature-plugins/squad-board.test.ts`; depende: TASK-03, TASK-04 — STORY-01/STORY-02)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-board.test.tsx`
  - Padrão de falha: `Expected to contain: "in_review"[\s\S]{0,200}Received:`
  - Stub: `Board` renderiza um `<box />` vazio.

## Acceptance criteria

- [ ] `testRender(..., { width: 120, height: 40 })` sem `start()`, com `renderOnce()` +
      `captureCharFrame()`; fixture de 5 colunas e 3 cards renderiza os cinco cabeçalhos e três
      cards, cada um na coluna declarada por `card.coluna`.
- [ ] Card com `progressa: false` e `desconhecido[]` não vazio mostra o selo "sem progresso" e
      **nenhuma** barra de progresso (DA-04 → (a)); `cards{}` vazio mostra "nenhum card";
      `generation: null` mostra "nenhuma geração ativa".
- [ ] Estados de erro nomeados: `403` contém `squad.enabled`; `404` contém "squad indisponível" e a
      versão do cliente; `409` mostra a mensagem do servidor verbatim; rede/503 mostra "servidor
      indisponível" com retry.
- [ ] Primeira carga mostra `loading`; rodapé mostra `revisao` e a idade com relógio injetado
      (fixture `T` + 90 000 ms → "1 min"); após refresh com falha, selo "desatualizado" com idade e
      erro, documento anterior preservado.
- [ ] Nenhum frame contém `/Users` (fixture com `location` no formato `Location.Ref`).
- [ ] Vermelho falha por asserção (`Expected to contain: "in_review"`), não por `Cannot find module`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Teclas e navegação (STORY-04); detalhe do card (STORY-05); painel de sessões (STORY-06);
  modo empilhado/janela de montagem fina (STORY-07); registro do plugin e rota (STORY-08).
- Interação com servidor real — o teste injeta a porta de leitura e o relógio.
