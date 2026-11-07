---
story_id: STORY-09
epic: squad-kanban-view
title: Story fixture-driven, README e guardas estáticas
depends_on: [STORY-08]
status: todo
---

# STORY-09 — Story fixture-driven, README e guardas estáticas

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar a story do storybook (`squad-board.tsx` + registro em `index.tsx`), reescrever a seção
"Sem painel próprio" de `packages/cli/README.md` e fechar as guardas estáticas de "somente leitura"
que o `/forge:verify` conferirá.

## Embedded context

### Requirements

- **REQ-10:** a story renderiza o **componente de produção** com `PanelDocument` +
  `LivenessReport` estáticos, sem rede, e alterna os estados: normal, vazio, sem geração ativa,
  desatualizado, `403`, `404`, geração anterior, 200 cards; as teclas aparecem no `StoryFooter` e
  há comando de reset; vive em
  `packages/tui/src/feature-plugins/system/storybook/squad-board.tsx`, é registrada no array
  `stories` de `storybook/index.tsx` e, como todo o storybook, só é carregada com `OPENCODE_STORY`
  (`builtins.ts:31-33`).
- **REQ-10 crit. 3:** a seção "Sem painel próprio" de `packages/cli/README.md` (branch base,
  `:113-115`) é reescrita para citar a rota `squad-board`, o comando `/squad-board`, as teclas, a
  frase "somente leitura" e as operações de escrita do base (`squad send`,
  `squad dispatch accept`).
- **REQ-10 crit. 4:** um teste de frame afirma que a ajuda contém "somente leitura".
- **REQ-07 crit. 1, 3, 4 (guardas estáticas, conferidas em `/forge:verify`):** o diff só contém os
  paths allowlisted; `grep -rnE "context\.storage|Bun\.write|writeFile" packages/tui/src/feature-plugins/squad`
  vazio; a view não importa `@opencode/(core|server)`; `packages/tui/package.json` inalterado
  (NFR-03).
- **REQ-08 crit. 4 (guarda):** `grep -rnE "console\.|JSON\.stringify" packages/tui/src/feature-plugins/squad`
  vazio.
- **NFR-04 (guarda):** `grep -rn "fetch(" packages/tui/src/feature-plugins/squad` vazio.

### Design

- §2.9 (DD-09): a story exporta `squadBoardStory`, recebe fixtures estáticas no formato do client e
  uma porta de leitura local (o hook aceita a porta injetada); teclas alternam os estados; reset
  volta ao normal; tudo listado no `StoryFooter`; nenhum `fetch`.
- §4.4 (compatibilidade): a story é a única exceção documental ao "não alterar o base" — a seção do
  README que afirma inexistência de tela TUI fica falsa e é atualizada por esta story.

### Contratos / interfaces

- `AGENTS.md` (raiz) "TUI Stories" — fixture-driven, componente de produção (não cópia visual),
  side effects locais à story, dimensões de estado por keybindings listadas no `StoryFooter`,
  comando de reset; exercitar 80×24 e 120×40 quando o layout é relevante (é — STORY-07).
- Story executável com `OPENCODE_STORY=<story-id> bun run dev:live` no worktree de desenvolvimento.

### Rules aplicáveis

- `AGENTS.md` (raiz) "TUI Stories" — padrão de stories do TUI.
- `.forge/rules/testing/regression-red-first.md` — vermelho por asserção com stub (`render`
  devolve só o `StoryFooter`).

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-11 — Story fixture-driven, documentação e guardas estáticas de "somente leitura" (paths: `packages/tui/src/feature-plugins/system/storybook/squad-board.tsx`, `packages/tui/src/feature-plugins/system/storybook/index.tsx`, `packages/cli/README.md`, `packages/tui/test/feature-plugins/squad-story.test.tsx`; depende: TASK-10 — STORY-08)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-story.test.tsx`
  - Padrão de falha: `Expected to contain: "somente leitura"[\s\S]{0,200}Received:`
  - Stub: `squadBoardStory.render` devolve só o `StoryFooter`.

## Acceptance criteria

- [ ] A story renderiza o componente de produção com fixtures estáticas (`PanelDocument` +
      `LivenessReport`) e porta de leitura local — nenhuma chamada de rede.
- [ ] Teclas da story alternam: normal, vazio, sem geração ativa, desatualizado, `403`, `404`,
      geração anterior, 200 cards; reset volta ao normal; todas listadas no `StoryFooter`.
- [ ] A story é adicionada ao array `stories` de `storybook/index.tsx` e só é carregada com
      `OPENCODE_STORY`.
- [ ] Teste de frame afirma que a ajuda contém "somente leitura" (REQ-10 crit. 4).
- [ ] A seção "Sem painel próprio" de `packages/cli/README.md` cita a rota `squad-board`, o comando
      `/squad-board`, as teclas, "somente leitura" e `squad send`/`squad dispatch accept`.
- [ ] Guardas estáticas prontas para o `/forge:verify` (REQ-07 crit. 1, 3, 4; REQ-08 crit. 4;
      NFR-03; NFR-04): diffs restritos aos paths allowlisted; greps de `context.storage|Bun.write|
      writeFile`, `@opencode/(core|server)`, `console.|JSON.stringify` e `fetch(` vazios em
      `packages/tui/src/feature-plugins/squad`; `packages/tui/package.json` sem diff.
- [ ] Vermelho falha por asserção (`Expected to contain: "somente leitura"`), não por
      `Cannot find module`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Qualquer código de produto além da story, do registro no array `stories` e da seção do README —
  componentes, hook, modelos e plugin estão entregues em STORY-01..08.
- Toggle visual no dialog de experimentos (fora da allowlist de REQ-07; ver STORY-08, nota DA-01).
