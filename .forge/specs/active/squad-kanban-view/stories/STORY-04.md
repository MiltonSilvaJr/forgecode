---
story_id: STORY-04
epic: squad-kanban-view
title: Navegação de rota somente leitura
depends_on: [STORY-03]
status: todo
---

# STORY-04 — Navegação de rota somente leitura

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar `board-keys.ts` e integrar a camada de keymap da rota: `j/k` movem o foco com clamp,
`h/l` trocam de coluna com clamp, `enter` abre o detalhe, `esc` volta, `r` atualiza (exatamente 2
leituras), `?` abre a ajuda com "somente leitura" — mais a guarda de invariante de que nenhuma
tecla executa escrita.

## Embedded context

### Requirements

- **REQ-02:** `j/k` movem uma posição dentro da coluna (com clamp nas bordas); `h/l` trocam de
  coluna (com clamp); `enter` abre o detalhe do card focado; `esc` retorna ao board; `r` dispara
  exatamente um refresh; `?` abre a ajuda; nenhuma tecla executa escrita.
- **REQ-02 crit. 2 (guarda de invariante, não vermelho):** cliente de teste com a superfície completa
  de `client.experimental.squad` em que cada operação de escrita (`generation.create`,
  `generation.close`, `session.send`, `session.launch`, `session.replace`, `broadcast`, `block`,
  `checkpoint`, `transition`, `activate`, `dispatch.create`, `dispatch.accept`, `release`) lança e
  registra; após exercitar todas as teclas (incluindo `enter` e `r`), zero chamadas de escrita e
  operações chamadas ⊆ `{ panel, liveness }`.
- **REQ-02 crit. 3:** as teclas vivem em camada de keymap ativa **só enquanto a rota está montada**;
  nenhuma camada `mode: "global"` do plugin declara `bind`; o único item global é o comando de
  paleta/slash (sem `bind`), padrão `stats.tsx:190-215`. Fora da rota, `j`/`k` mantêm o
  comportamento atual.
- **REQ-02 crit. 4:** a ajuda lista as teclas e a frase "somente leitura".
- **NFR-02:** `r` faz exatamente duas leituras.

### Design

- §2.5 (DD-05): a prova de "sem escrita" é por construção (porta tipada com 2 funções) + teste de
  cliente completo; o rodapé/ajuda não exibe "mover"/"atribuir"/"aceitar" — a ajuda aponta
  `squad dispatch accept`/`squad send` como operações do base.
- §2.8 (DD-08): camada de rota como `stats.tsx:151-153`; o registro global do comando fica em
  STORY-08.
- §2.7 (DD-07): ajuda (`?`) é um overlay com as teclas e "somente leitura".
- **DA-07 → (b):** `r` é single-flight — durante refresh em voo, a tecla é ignorada.

### Contratos / interfaces

- Superfície completa de `client.experimental.squad` (design §4.1) — necessária para o cliente de
  teste da guarda de invariante: leitura — `session.list`, `check`, `plan`, `liveness`, `audit`,
  `dispatch.list`, `panel`; escrita — `generation.create`, `generation.close`, `session.send`,
  `session.launch`, `session.replace`, `broadcast`, `block`, `checkpoint`, `transition`,
  `activate`, `dispatch.create`, `dispatch.accept`, `release`.

### Rules aplicáveis

- `.forge/rules/testing/regression-red-first.md` — o vermelho desta task é a asserção de navegação;
  a guarda de escrita é invariante (passa antes da implementação) e não serve de Red.
- Skill `tui-tests` — renderer com `kittyKeyboard: true` e `mockInput`.

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-06 — Navegação de rota: `j/k/h/l/enter/esc/r/?`, clamp, ajuda "somente leitura" e guarda de escrita (paths: `packages/tui/src/feature-plugins/squad/board-keys.ts`, `packages/tui/src/feature-plugins/squad/board.tsx`, `packages/tui/test/feature-plugins/squad-board-keys.test.tsx`; depende: TASK-05 — STORY-03)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-board-keys.test.tsx`
  - Padrão de falha: `Expected: "card-2"[\s\S]{0,200}Received: "card-1"`
  - Stub: `boardKeys()` devolve camada sem comandos; asserção `expect(focusedCardID()).toBe("card-2")` após `pressKey("j")`.

## Acceptance criteria

- [ ] `j` move o foco uma posição dentro da coluna e faz clamp na última posição; `h` na primeira
      coluna não vai para a anterior; `k` no primeiro card não sai do limite.
- [ ] `enter` abre o detalhe do card focado e `esc` retorna ao board; `?` mostra a ajuda com as
      teclas e a frase "somente leitura".
- [ ] `r` dispara exatamente um refresh = exatamente 2 leituras; `r` durante refresh em voo não soma
      chamadas (single-flight, DA-07).
- [ ] Guarda de invariante: após exercer todas as teclas (incluindo `enter` e `r`) contra o cliente
      de teste de escrita, `writes` está vazio e as operações chamadas são subconjunto de
      `{ panel, liveness }`.
- [ ] A camada de keymap das teclas só existe enquanto a rota está montada; nenhuma camada global
      do plugin declara `bind` (o registro global do comando é STORY-08).
- [ ] Vermelho falha por asserção (`Expected: "card-2"` / `Received: "card-1"`), não por
      `Cannot find module`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Registro da rota, do comando de paleta e do builtin em `builtins.ts` (STORY-08, com DA-01).
- Detalhe do card em si (STORY-05) — aqui basta a transição `enter`/`esc` com o componente já
  existente ou um placeholder mínimo que a STORY-05 substitui por conteúdo real.
