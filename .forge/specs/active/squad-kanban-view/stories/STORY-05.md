---
story_id: STORY-05
epic: squad-kanban-view
title: Detalhe do card com evidência por estágio
depends_on: [STORY-03]
status: todo
---

# STORY-05 — Detalhe do card com evidência por estágio

> Story auto-contida derivada de `squad-kanban-view`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

Entregar `card-detail.tsx`: a tela de drill-down que exibe os cinco estágios na ordem fixa
(`jira`, `ci`, `merge`, `deploy`, `acceptance`), cada um com status verbatim, `source` e evidência
(tipo, referência, instante em ISO-8601 `Z`) ou "sem evidência", mais `exigidos[]`/`desconhecido[]`
verbatim e o vínculo do card com a sessão de `card.agente`.

## Embedded context

### Requirements

- **REQ-03:** estágios na ordem fixa `jira`, `ci`, `merge`, `deploy`, `acceptance`; cada um exibe
  `verified`/`failed`/`unknown` exatamente como recebido — `unknown` nunca é convertido em `idle`,
  `pending`, `ok` ou barra parcial; estágio com `evidence: null` exibe "sem evidência" e o `source`;
  com evidência, exibe `type`, `reference` e `at` verbatim (ms epoch → ISO-8601 UTC com `Z`); cada
  estágio é rotulado "exigido" ou "não exigido" conforme `exigidos[]`; `desconhecido[]` é exibido
  verbatim (contém todo estágio `unknown`, exigido ou não); estágio não exigido `unknown` exibe
  "não exigido" seguido do `source` verbatim (ex.: `none`) e não impede a leitura dos demais; com
  `progressa: false`, **nenhuma** barra de progresso nem percentual (DA-04 → (a): nada desenhado
  para `progressa: true`).
- **REQ-03 nota:** a view não inventa estágio a partir de status de Jira nem de mensagem de agente
  (regra herdada de REQ-17 do base).
- **REQ-04 crit. 5:** no detalhe, a sessão de `card.agente` é localizada por igualdade com
  `SessionStatus.name`; sem correspondência, exibe "sessão não encontrada nesta geração" e nenhum
  `sessionID` é inventado.
- **REQ-08 crit. 1, 3:** fixture com `location: { directory: "/Users/segredo/worktree" }` não vaza
  no frame; `evidence.reference` é exibido verbatim (redaction do produtor).
- **REQ-09 crit. 4:** os status aparecem como **palavras** no frame (terminal monocromático
  legível).

### Design

- §2.2 (DD-02): o detalhe consome o card do modelo; não recalcula coluna nem estágio.
- §2.6 (DD-06): allowlist — só campos nomeados entram no frame; formatação de instantes via
  `render-fields.ts` (STORY-01).
- §2.3 (DD-03): o vínculo card→sessão por nome é exato enquanto a sessão existir no registro; falha
  só se a sessão sair do registro.
- §2.7 (DD-07): tokens semânticos; texto para status.

### Contratos / interfaces

- `PanelCard` (`squad.ts:193-213`): `id`, `titulo`, `coluna`, `agente`, `prioridade?`, `refs`,
  `evidencias`, `bloqueio?`, `atualizadoEm?`, `estagios{jira,ci,merge,deploy,acceptance}`,
  `exigidos`, `desconhecido`, `progressa`.
- `Stage` (`squad.ts:184-188`): `status`, `evidence` (`type`, `reference`, `at?`) ou `null`,
  `source`.
- Fato do produtor (§4.2): `deploy` é sempre `unknown` com `source: "none"`; `desconhecido` lista
  todo estágio `unknown`, exigido ou não; `progressa` é sempre `false` hoje.

### Rules aplicáveis

- `AGENTS.md` (raiz) "TUI Theme Tokens" — status por texto; tokens por papel semântico.
- `.forge/rules/testing/regression-red-first.md` — vermelho por asserção com stub (`CardDetail`
  renderiza só o título).

### ADRs

- Nenhum ADR novo neste change (design.md §0).

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-07 — Detalhe do card: cinco estágios, `source`, evidência ou "sem evidência", `exigidos` e `desconhecido` (paths: `packages/tui/src/feature-plugins/squad/card-detail.tsx`, `packages/tui/test/feature-plugins/squad-card-detail.test.tsx`; depende: TASK-05 — STORY-03)
  - Teste: `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-card-detail.test.tsx`
  - Padrão de falha: `Expected to contain: "sem evidência"[\s\S]{0,200}Received:`
  - Stub: `CardDetail` renderiza só o título do card.

## Acceptance criteria

- [ ] Fixture com `ci=verified`, `merge=unknown` exigido, `deploy=unknown` com `source: "none"` não
      exigido e `acceptance=verified` renderiza os cinco estágios na ordem fixa
      `jira, ci, merge, deploy, acceptance`.
- [ ] `unknown` aparece como "unknown", nunca "ok"/"idle"/"pending"; estágio não exigido mostra
      "não exigido" + `source` verbatim; `desconhecido[]` exibido verbatim.
- [ ] Estágio com `evidence: null` exibe "sem evidência" e o `source`; com evidência, exibe `type`,
      `reference` verbatim e `at` em ISO-8601 com `Z`.
- [ ] Com `progressa: false`, nenhuma barra de progresso nem percentual; os status aparecem como
      palavras no frame.
- [ ] Sessão de `card.agente` localizada por igualdade de `SessionStatus.name`; sem correspondência,
      "sessão não encontrada nesta geração" e nenhum `sessionID` inventado.
- [ ] Nenhum frame contém `/Users` (fixture com `location` no formato `Location.Ref`).
- [ ] Vermelho falha por asserção (`Expected to contain: "sem evidência"`), não por
      `Cannot find module`.
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- Painel de sessões completo (STORY-06) — aqui apenas o vínculo nome→sessão dentro do detalhe.
- Barra de progresso para `progressa: true` (DA-04 → (a), inalcançável com o produtor atual).
