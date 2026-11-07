# Epic context — squad-kanban-view

> Gerado por epic-context agent. Leitura rápida — não substitui os artefatos originais.

## Objetivo

Entregar uma view kanban nativa de TUI, **somente leitura**, sobre a camada `squad` do change
`squad-orchestration`: board a partir de `SquadPanelDocument`, drill-down por estágio com evidência,
painel de sessões/liveness a partir de `SquadLivenessReport`, frescor explícito (`revisao`,
`atualizadoEm`, selo "desatualizado") e estados de indisponibilidade acionáveis — sem escrita, sem
persistência, sem endpoint novo.

## Decisões de design (DD)

- **DD-01** — View como plugin de TUI, projeção pura de dois documentos, sem estado próprio →
  composição: um hook de fetch + dois modelos puros + componentes Solid/OpenTUI; nenhum componente
  recalcula regra do produtor.
- **DD-02** — Agrupamento por `card.coluna`, ordem do documento preservada, sem ordenação local;
  janela de montagem `viewport + 4` renderables com id `squad-card-<id>` (NFR-01) → `board-model.ts`,
  `board.tsx`, `layout.ts`.
- **DD-03** — Linha por `SessionStatus` com veredito e `cause` verbatim; vínculo card→sessão por
  igualdade de nome (`card.agente === SessionStatus.name`); geração anterior em bloco separado →
  `session-model.ts`, `sessions.tsx`.
- **DD-04** — Estado discriminado com falha parcial e staleness explícito; `loading` só na primeira
  carga; refresh não apaga conteúdo; `r` dispara exatamente 2 leituras; nenhum `setInterval`/polling →
  `use-squad-board.ts`.
- **DD-05** — Nenhuma affordance de mutação no v1; porta de leitura tipada
  `{ panel(): Promise<SquadPanelDocument>; liveness(): Promise<SquadLivenessReport> }`; guarda de
  escrita por cliente de teste (invariante, não vermelho).
- **DD-06** — Allowlist de renderização: `location`, corpo, credencial e token não têm caminho até o
  frame; `evidence.reference` verbatim (redaction é do produtor); instantes em ms formatados em
  ISO-8601 UTC com `Z` → `render-fields.ts`.
- **DD-07** — Layout: `columns` ≥120, `stacked` 80–119, `minimal` <80; tokens semânticos
  (`text.base`/`text.muted`; `text.feedback.error` só erro; `text.feedback.warning` só "desatualizado";
  seleção em `formfield` focused); status transmitido por texto, não por cor.
- **DD-08** — Builtin registrado em `builtins.ts`; rota `squad-board`; comando de paleta/slash
  `squad.board.open` (`slash: { name: "squad-board" }`, `palette: true`, **sem `bind`**); keymap de
  rota ativo só enquanto a rota está montada (padrão `stats.tsx:151-215`).
- **DD-09** — Story fixture-driven em `system/storybook/squad-board.tsx`, carregada só com
  `OPENCODE_STORY`, sem rede, estados alternáveis por teclas + reset + listagem no `StoryFooter`.

### Decisões do operador (design.md §8.1, 2026-11-06 — fixas)

- **DA-01 → (a).** Chave `config.experimental.squad_board` no registro de experimentos, gateando o
  comando da view.
- **DA-02 → construir v1.** A aprovação da documentação é a decisão de construir; medição de demanda
  fica como follow-up pós-MVP.
- **DA-03 → (a) em v1, (c) no base.** Selo "sem progresso" exibido sempre (fiel ao dado); ajuste de
  `progressa` para considerar só `exigidos[]` é pedido ao base como follow-up.
- **DA-04 → (a).** Nada desenhado para `progressa: true` em v1 (inalcançável com o produtor atual).
- **DA-05 → (a).** Idade só avança com interação; o rótulo mostra "às <hora>" além da idade relativa.
- **DA-06 → (b).** Sem faixa "coluna desconhecida"; o typecheck do client contra o contrato gerado é
  a guarda (não revalidar o que o tipo garante).
- **DA-07 → (b).** Single-flight: tecla `r` durante refresh em voo é ignorada até a conclusão (cada
  `panel` executa comandos por card no servidor, R10).
- **DA-08 → (a).** Emenda de REQ-17 no próprio `squad-orchestration` antes do archive dele.
- **DA-09 (nova).** Implementar AGORA em worktree isolado, branch `squad-kanban-view` com base em
  `feature/squad-orchestration`, rebaseando sobre `origin/dev` quando o base mergear.

## Contratos externos

- `GET /api/experimental/squad/panel` — `client.experimental.squad.panel()` → `SquadPanelDocument`
  (formato **codificado**: instantes em ms epoch; client desembrulha `{ data }`). Erros declarados:
  `ForbiddenError` 403, `ConflictError` 409, `ServiceUnavailableError` 503; 404 não declarado →
  `ClientError("UnexpectedStatus")`; rede → `ClientError("Transport")`.
- `GET /api/experimental/squad/liveness` — `client.experimental.squad.liveness()` →
  `SquadLivenessReport`; mesma matriz de erros.
- Tipos do client gerado: `SquadPanelDocument` (`types.ts:2460`), `SquadLivenessReport`
  (`types.ts:2971`). `Squad.*` de `@opencode/schema/squad` é a semântica (decodificada), não o tipo
  do valor recebido; a view não decodifica com Schema.
- Superfície completa de `client.experimental.squad` (§4.1): leitura — `session.list`, `check`,
  `plan`, `liveness`, `audit`, `dispatch.list`, `panel`; escrita — `generation.create`,
  `generation.close`, `session.send`, `session.launch`, `session.replace`, `broadcast`, `block`,
  `checkpoint`, `transition`, `activate`, `dispatch.create`, `dispatch.accept`, `release`. A view usa
  **só** `panel` e `liveness`.
- **Fatos do produtor (§4.2):** `deploy` é sempre `unknown` com `source: "none"`; `desconhecido[]`
  lista todo estágio `unknown` (exigido ou não); logo `progressa` é `false` em todo card hoje. Cada
  chamada `panel` executa comandos por card no servidor (custo cresce com N cards — R10/DA-07).

## ADRs

- Nenhum ADR novo (design.md): a view não cria estado, contrato ou política; escrita futura pedirá
  ADR própria.

## Rules

- `AGENTS.md` (raiz) "TUI Theme Tokens" — cor por papel semântico; nunca `theme.hue`/cor literal;
  estender o tema se faltar token.
- `AGENTS.md` (raiz) "TUI Stories" — story fixture-driven, componente de produção, teclas no
  `StoryFooter`, reset.
- `AGENTS.md` (raiz) §Experimental API — a view consome rotas experimentais existentes; não cria
  rota; rotas experimentais mudam sem alias.
- `AGENTS.md` (raiz) §Testing / §Style Guide — evitar mocks (cliente de teste é porta de injeção de
  borda); validar na fronteira; não revalidar o que o tipo garante (DA-06).
- `packages/tui/AGENTS.md` "TUI Experiments" — experimento opt-in via `config.experimental` (DA-01).
- `.forge/rules/testing/change-test-contract.md` — tela orientada a dados: `loading`, sucesso, vazio
  e erro.
- `.forge/rules/testing/regression-red-first.md` — vermelho por **asserção**, com stub de produção
  (`Cannot find module` é `build-error` e reprova).
- `.forge/rules/conventions/session-discipline.md` — saída de gate em uma linha.

## Invariantes críticas

- **Somente leitura:** nenhuma operação de escrita do client; nenhum `context.storage`, `Bun.write`
  ou arquivo em disco; nenhum `fetch(` fora do client gerado (NFR-04).
- **Allowlist:** `location`, `body`, `credential`, `token` nunca no frame (REQ-08); nenhum
  `console.` nem `JSON.stringify` na view.
- **Duas leituras por refresh** (NFR-02), sem `setInterval`; `r` é single-flight (DA-07).
- **Veredito/`cause`/status verbatim:** `unknown` nunca vira `idle`/`ok`; `presumed_dead`/`stalled`
  distintos; nenhuma derivação local de coluna, estágio ou liveness (P1).
- **Cores só por token semântico;** status aparece como texto (terminal monocromático legível).
- **Gate de entrada E1–E8** (design §1.3) é pré-requisito de implementação; base do worktree =
  `feature/squad-orchestration` sob DA-09, com rebase após o merge do base.
- **Diff limitado** (REQ-07 crit. 1): `packages/tui/src/feature-plugins/squad/**`,
  `packages/tui/src/plugin/builtins.ts`, `storybook/{index.tsx,squad-board.tsx}`,
  `packages/tui/test/feature-plugins/squad-*`, seção "Sem painel próprio" de
  `packages/cli/README.md`. Sem dependência nova em `packages/tui/package.json` (NFR-03).
