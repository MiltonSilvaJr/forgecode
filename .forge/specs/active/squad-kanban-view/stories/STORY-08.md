---
story_id: STORY-08
epic: squad-kanban-view
title: Registro do plugin, rota e comando
depends_on: [STORY-04, STORY-05, STORY-06, STORY-07]
status: todo
---

# STORY-08 — Registro do plugin, rota e comando

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar `index.tsx` (o plugin `opencode.squad-board`) e o registro em `builtins.ts`: rota
`squad-board`, comando de paleta/slash `squad.board.open` gateado pela chave
`config.experimental.squad_board` (DA-01), keymap da rota ativo só enquanto ela está montada e
**nenhum** `bind` global.

## Embedded context

### Requirements

- **REQ-02 crit. 3:** o plugin registra rota própria (`context.ui.router.register`) e uma camada de
  keymap ativa só enquanto a rota está montada; o único item global é o comando de paleta/slash que
  abre a rota (sem `bind`), no padrão `stats.tsx:190-215`. Fora da rota, `j`/`k` mantêm o
  comportamento atual.
- **REQ-07 crit. 1:** o diff só pode tocar `packages/tui/src/feature-plugins/squad/**`,
  `packages/tui/src/plugin/builtins.ts`, `storybook/{index.tsx,squad-board.tsx}` (STORY-09),
  `packages/tui/test/feature-plugins/squad-*` e a seção do README (STORY-09). **Nenhum** outro path
  — em particular, não tocar `packages/schema/**` nem `packages/tui/src/component/**`.

### Design

- §2.8 (DD-08): `Plugin.define({ id: "opencode.squad-board", setup })` registra a rota `squad-board`
  e, num `context.ui.slot({ append: "app" })` com camada `mode: "global"`, o comando
  `squad.board.open` (`slash: { name: "squad-board" }`, `palette: true`, **sem `bind`**), exatamente
  como `stats.tsx:190-215`; `builtins.ts` importa e adiciona o plugin; a remoção do builtin desliga
  a view (rollback).
- **DA-01 → (a):** a view é experimento opt-in pela chave `config.experimental.squad_board`
  (`packages/tui/AGENTS.md` manda UI experimental opt-in para o registro de experimentos com chave
  `config.experimental`). O comando da view só aparece com a chave ligada. Atenção ao desdobramento:
  o **gate** da chave é implementado no plugin lendo `config.experimental.squad_board` (padrão
  `config.experimental.*` do `AGENTS.md` raiz, sem tocar `packages/schema`); a entrada no **dialog**
  de experimentos (`dialog-experiments.tsx`) ficaria fora da allowlist de paths de REQ-07 crit. 1 —
  se o operador quiser o toggle visual no dialog, isso exige emenda de escopo em REQ-07 e fica fora
  desta story.
- §5 (rollout): sem polling; se `squad.enabled` estiver desligado, a rota mostra o estado `403`
  (REQ-06) — a chave `config.experimental.squad_board` gateia o **comando/rota**; a flag
  `squad.enabled` do base continua valendo por trás dela.

### Contratos / interfaces

- `Plugin.define`, `context.ui.router.register`, `context.keymap.layer`, `context.ui.slot`
  (`packages/plugin/src/tui/context.ts:544-560`); exemplo `stats.tsx:151-215`.
- O plugin constrói a porta de leitura a partir de `context.client.experimental.squad` passando
  **só** `{ panel, liveness }` (DD-05) — nenhum outro método do client é referenciado.

### Rules aplicáveis

- `packages/tui/AGENTS.md` "TUI Experiments" — experimento opt-in via `config.experimental` (DA-01).
- `AGENTS.md` (raiz) §Experimental API — consome `experimental.squad.*`; não cria rota.
- `.forge/rules/testing/regression-red-first.md` — vermelho por asserção com stub
  (`Plugin.define` sem registrar rota).
- Skill `tui-tests` — se o teste precisar do app inteiro, usar `createAppFixture` com
  `config: { animations: false }` (custo de import a frio documentado).

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-10 — Registrar o builtin, a rota `squad-board` e o comando de paleta/slash, sem `bind` global (paths: `packages/tui/src/feature-plugins/squad/index.tsx`, `packages/tui/src/plugin/builtins.ts`, `packages/tui/test/feature-plugins/squad-plugin.test.tsx`; depende: TASK-06, TASK-07, TASK-08, TASK-09 — STORY-04..STORY-07)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-plugin.test.ts`
  - Padrão de falha: `Expected: true[\s\S]{0,200}Received: false`
  - Stub: `index.tsx` exporta `Plugin.define({ id: "opencode.squad-board", setup() {} })` sem registrar rota; asserção `expect(builtins.includes(SquadBoard) && routeRegistered("squad-board")).toBe(true)`.

## Acceptance criteria

- [ ] `builtins.ts` importa o plugin e o adiciona ao array `builtins`; a rota `squad-board` é
      registrada pelo `setup`.
- [ ] O comando `squad.board.open` existe com `slash: { name: "squad-board" }` e `palette: true`,
      **sem `bind`**, e só é oferecido com `config.experimental.squad_board` ligada (DA-01).
- [ ] Nenhuma camada `mode: "global"` do plugin declara `bind` — as teclas ficam na camada da rota
      (STORY-04).
- [ ] A remoção do builtin de `builtins.ts` desliga a view (rollback verificável).
- [ ] O plugin constrói a porta de leitura só com `{ panel, liveness }` de
      `context.client.experimental.squad` (DD-05).
- [ ] O diff desta story toca apenas `feature-plugins/squad/**`, `plugin/builtins.ts` e
      `test/feature-plugins/squad-*` (REQ-07 crit. 1); nada de `packages/schema`,
      `dialog-experiments.tsx` ou outros paths fora da allowlist.
- [ ] Vermelho falha por asserção (`Expected: true` / `Received: false`), não por
      `Cannot find module`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Story, README e guardas estáticas (STORY-09); emenda de REQ-17 do base (DA-08, acontece no
  `squad-orchestration` antes do archive dele); toggle visual no dialog de experimentos
  (`dialog-experiments.tsx` fica fora da allowlist de REQ-07 — ver nota de DA-01 acima).
