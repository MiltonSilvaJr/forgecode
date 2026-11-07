# Design — squad-kanban-view

> Design técnico do change `squad-kanban-view`. Depende do change `squad-orchestration`, cujos
> contratos são citados com arquivo:linha no branch `feature/squad-orchestration` (head `da634f4185`,
> worktree `.forge/worktrees/squad-orchestration`).
> Não há decisão durável/transversal nova que justifique ADR: a view não cria estado, contrato ou
> política; ela projeta dois documentos existentes. Se a escrita for aprovada em outro change, essa
> decisão (como mover/atribuir) pedirá ADR própria.

## 1. Contexto e restrições

### 1.1 O que já existe e é reutilizado

| Capacidade | Onde está | Como a view usa |
|---|---|---|
| Documento de painel com colunas, cards, estágios e evidência | semântica: `Squad.PanelDocument` (`packages/schema/src/squad.ts:215-223`); produtor `packages/core/src/squad/panel.ts:31-53`; rota `GET /api/experimental/squad/panel` (`packages/protocol/src/groups/squad.ts:395-406`) | fonte única do board e do detalhe; nenhum campo derivado no cliente |
| Relatório de liveness por sessão | semântica: `Squad.LivenessReport`/`SessionStatus` (`squad.ts:337-372`); produtor `packages/core/src/squad/status.ts:30-67`; rota `GET /api/experimental/squad/liveness` (`protocol/src/groups/squad.ts:257-268`) | painel de sessões; veredito e `cause` vêm prontos |
| Client gerado do grupo `experimental.squad` | `context.client.experimental.squad.panel()`/`.liveness()` (`packages/client/src/promise/generated/client.ts:1601-1611`, `:1727-1737`); tipos `SquadPanelDocument` (`types.ts:2460`) e `SquadLivenessReport` (`types.ts:2971`) | duas chamadas de leitura por refresh; o client desembrulha `data` |
| Plugin de TUI com rota, keymap de camada e tema | `Plugin.define`, `context.ui.router.register`, `context.keymap.layer`, `context.theme` (`packages/plugin/src/tui/context.ts:544-560`); exemplo `packages/tui/src/feature-plugins/system/stats.tsx:151-215` | registro do board, navegação e comando de paleta |
| Teste de frame de TUI | `testRender` + `captureCharFrame()` (ex.: `packages/tui/test/feature-plugins/sidebar-context.test.tsx:43-51`); contagem de montagem `getRenderable(id)` (`packages/tui/test/session-mount-budget.test.tsx:98-101`) | provas de REQ-01..REQ-10 e NFR-01 |
| Story fixture-driven | `packages/tui/src/feature-plugins/system/storybook/index.tsx` (array `stories`), carregada só com `OPENCODE_STORY` (`packages/tui/src/plugin/builtins.ts:31-33`) | exploração offline (REQ-10) |
| Resumo textual do painel | `squad panel show` (`packages/cli/src/commands/handlers/squad/panel-show.ts`, `formatPanel` em `packages/cli/src/commands/squad.ts:139-148`) | alternativa C (§3); não é reusado pela view |

### 1.2 Normas vigentes aplicáveis

| Norma | Aplicação | Veredito |
|---|---|---|
| `AGENTS.md` (raiz) — "TUI Theme Tokens" | nenhuma cor literal, nenhum `theme.hue`; `text.feedback` só para status/resultado; seleção por `formfield`; se faltar token, estender o tema em vez de reusar outro | compatível (REQ-09) |
| `AGENTS.md` (raiz) — "TUI Stories" | story em `system/storybook`, registrada em `index.tsx`, componente de produção, teclas no `StoryFooter`, reset | compatível (REQ-10, TASK-11) |
| `packages/tui/AGENTS.md` — "TUI Experiments" | "Temporary, opt-in UI experiments belong in the `experiments` registry in `src/component/dialog-experiments.tsx`, with behavior gated by the matching `config.experimental` key." A view é opt-in e consome API experimental; DD-08 não cria chave de config | **conflito potencial não resolvido** — decisão aberta DA-01 (§8) |
| `AGENTS.md` §Testing — evitar mocks; testar implementação real | o cliente de teste é uma **porta de injeção de borda** (nenhuma rede no teste de TUI), não um mock de regra de negócio; as regras de coluna/estágio/liveness não são reimplementadas no teste | compatível com ressalva registrada em §6 R3 |
| `AGENTS.md` §Experimental API | a view **não** cria rota HTTP; consome rotas `experimental.squad.*` existentes | compatível |
| `AGENTS.md` §Style Guide — validar uma vez na fronteira; não revalidar o que o tipo garante | `card.coluna` é literal fechado no contrato (`squad.ts:190,196`); a faixa "coluna desconhecida" de DD-02 é defesa contra violação de contrato | ressalva — decisão aberta DA-06 (§8) |
| `AGENTS.md` §Direção de dependência | a view usa Client (e opcionalmente Schema); não importa Core/Server | compatível (REQ-07) |
| `rules/testing/change-test-contract.md` — "Tela orientada a dados: loading, sucesso, vazio e erro" | `loading` existe em DD-04 e é coberto por TASK-05; sucesso, vazio e erro por REQ-01/05/06 | compatível |
| `rules/testing/regression-red-first.md` + motor `red-evidence.sh task` | change `type: feature` sem `fixes_defects`; o vermelho de cada TASK precisa falhar **por asserção** (`.forge/scripts/lib/red-classify.mjs:28,48`); `Cannot find module` é `build-error` e reprova | compatível com a convenção de stub em `tasks.md` |
| `rules/frontend/design-system.md` | trata do pacote React/web `@<project>/design-system`; não se aplica a TUI OpenTUI | não aplicável |
| `rules/conventions/git-worktree.md` §6, `FORGE.md` §3.4, `AGENTS.md` "Branch Names" | três convenções de nome de branch divergentes (`<tipo>/<escopo>/<desc>`, `feature/<id>`, sem barra) | drift do repositório; este change segue `feature/<change-id>` como o base (§1.3) |
| `architecture/observability.md` | nenhum boundary novo; nenhum log de documento | compatível |
| `architecture/security-and-secrets.md` / `conventions/no-hardcoded-secrets.md` | allowlist de campos; `location` não renderizado; nenhum segredo buscado | compatível (REQ-08) |
| `conventions/session-discipline.md` | saída de gate em uma linha; sem resumo por task | compatível |

### 1.3 Dependência não congelada e gate de entrada (hard stop)

`Squad.PanelDocument`, `Squad.LivenessReport`, as duas rotas e os métodos do client **não existem em
`origin/dev`**: vivem no branch `feature/squad-orchestration`, 205 commits à frente
(`git rev-list --count origin/dev..feature/squad-orchestration` → 205;
`git merge-base --is-ancestor feature/squad-orchestration origin/dev` → exit 1). Esse branch altera
213 arquivos, 110 deles fora de `squad` (squad + `subscription-auth` + `forgequeue`; B3 do parecer do
base). O próprio base tem bloqueadores abertos (B1–B5 em
`.forge/ledger/2026-11-06_squad-orchestration-adversarial-review.md`).

**Estratégia de base branch (decidida, não contornável):** o worktree
`.forge/worktrees/squad-kanban-view` (branch `feature/squad-kanban-view`) parte de `origin/dev`
**depois** do merge do base. **Não** parte de `feature/squad-orchestration`: isso herdaria os 110
arquivos de outras features e tornaria REQ-07 (diff só em TUI) inverificável. Não serão criados tipos
locais "temporários" para compilar antes disso (decisão A6 da proposal).

**Gate de entrada em `/forge:implement`** — todos devem passar, com a saída anexada ao change:

| # | Condição | Comando | Esperado |
|---|---|---|---|
| E1 | rotas e client do base estão em `origin/dev` | `git fetch origin && git grep -n '"squad.panel"' origin/dev -- packages/protocol/src/groups/squad.ts && git grep -n 'path: \`/api/experimental/squad/liveness\`' origin/dev -- packages/client/src/promise/generated/client.ts` | duas linhas encontradas |
| E2 | base sem contradição de manifesto (B1) | `grep -nE "^status:\|implementation_verified" .forge/specs/active/squad-orchestration/manifest.yaml` (ou o capability arquivado em `.forge/product/current/capabilities/squad-orchestration/`) | `status` ∈ {`verified`,`archived`} e `implementation_verified: true` |
| E3 | verificação do base limpa (B2) | `grep -h '"dirty"' .forge/specs/active/squad-orchestration/evidence/runs/*/run-manifest.json` (ou do arquivo arquivado) | `"dirty": false` no run que sustenta `verified` |
| E4 | escopo do merge do base decidido (B3) | registro em `.forge/specs/active/squad-orchestration/approvals.yaml` ou no PR de merge | decisão humana nominal |
| E5 | B4 (claim no `close`) e B5 (fronteira REQ-19) resolvidos ou formalmente aceitos | `grep -n "B4\|B5" .forge/specs/active/squad-orchestration/approvals.yaml` ou ledger de fechamento | resolução ou aceite nominal |
| E6 | contrato não mudou desde este design | `git diff da634f4185 origin/dev -- packages/schema/src/squad.ts packages/protocol/src/groups/squad.ts` | vazio, ou §4.2 revisado antes de implementar |
| E7 | `/forge:analyze` e `/forge:shard` executados | `grep -n "^## Status" analysis.md`; `grep -n "sharded" manifest.yaml` | `Status: PASS`; `sharded: true` |
| E8 | impacto recalculado com o código do base no grafo | `bash .forge/scripts/graph.sh` seguido de `bash .forge/scripts/impact.sh --change squad-kanban-view` | `impact.json` com `graph_fingerprint` novo |

E2–E5 dependem de decisões e trabalho do change base; este change apenas as exige.

### 1.4 Premissas registradas

- **P1 —** o servidor é a única fonte de coluna, estágio, veredito e `cause`. O cliente não replica
  nenhuma regra do produtor.
- **P2 —** `atualizadoEm` é o instante de montagem do documento no servidor, e o documento é montado
  **a cada requisição** (`panel.ts:37-42`). A idade exibida é `agora - atualizadoEm`, com `agora` de
  um relógio injetado; ela só é significativa depois de um refresh que falhou.
- **P3 —** as duas leituras são independentes: falha de uma não invalida a outra.
- **P4 —** o board é da geração ativa; a anterior é apenas um bloco informativo de sessões fechadas.
- **P5 —** `location` é `sensitive` e não entra no frame.
- **P6 —** a view é opt-in por rota; não há chave de config nova em v1 (sob DA-01).

## 2. Decisão técnica

### 2.1 Visão geral (DD-01)

**DD-01 — View como plugin de TUI, projeção pura de dois documentos, sem estado próprio.**

```
client.experimental.squad.panel()    ──► SquadPanelDocument   ──► board-model   ──► board.tsx ──► card-detail.tsx
                                                                    │
client.experimental.squad.liveness() ──► SquadLivenessReport ──────┴─► session-model ─► sessions.tsx

                     (um hook de fetch, dois modelos puros, componentes Solid/OpenTUI)
```

- O plugin registra a rota `squad-board` e uma camada de keymap ativa apenas enquanto a rota está
  montada (`context.ui.router.register`, `context.keymap.layer`), como em
  `packages/tui/src/feature-plugins/system/stats.tsx:151-153,186-189`.
- Os modelos (`board-model.ts`, `session-model.ts`, `render-fields.ts`) são funções puras e
  testáveis sem renderer. Os componentes consomem os modelos; nenhum componente recalcula regra.
- O hook `use-squad-board.ts` recebe a porta de leitura (§2.5) e um relógio `now: () => number`
  injetáveis, faz as duas leituras em paralelo, com cleanup no unmount, e devolve um estado
  discriminado (§2.4).

### 2.2 Modelo do board (DD-02)

**DD-02 — Agrupamento por `card.coluna`, ordem do documento preservada, sem ordenação local.**

- `colunas[]` define a ordem e o conjunto de colunas. No contrato, `card.coluna` é literal fechado
  (`squad.ts:190,196`) e `colunas` é constante no produtor (`panel.ts:19,43`); um card cuja `coluna`
  não está em `colunas[]` é violação de contrato. O desenho atual o coloca numa faixa "coluna
  desconhecida" com o valor bruto — manter ou remover essa defesa é a decisão aberta DA-06.
- `cards{}` é um record; a ordem estável é a de `Object.entries` (ordem de inserção do JSON). As
  chaves são `ORQ-<geração>-<seq>` (`dispatch.ts:158`), não inteiras, então o JS preserva a ordem de
  inserção, que é a de `seq` (`dispatch.ts:236`). A view não ordena por prioridade, título ou
  `atualizadoEm`.
- `exigidos[]`, `desconhecido[]` e `progressa` são exibidos como vieram; a view não calcula
  `progressa`. Com o produtor atual, `desconhecido` sempre contém `deploy` e `progressa` é sempre
  `false` (§4.2).
- **Contagem e navegação:** o modelo expõe `visibleRows(column, viewportHeight)` e a UI monta no
  máximo `viewport + 4` renderables de card (NFR-01), cada um com id `squad-card-<id>`. A seleção é
  um índice por coluna; `j/k` movem dentro da janela e rolam a janela.

### 2.3 Modelo de sessões/liveness (DD-03)

**DD-03 — Linha por `SessionStatus`, com veredito e `cause` verbatim; vínculo card→sessão por
igualdade de nome.**

- Cada linha exibe `name`, `role`, `state`, `provider/model/variant`, `liveness.verdict`,
  `measuredAt`, `lastActivity` + `source`, `workingStale`, `presumedDead`, `cause`, `inboxPending`.
- `lastActivity`/`source`/`cause` ausentes exibem "—"; nunca são preenchidos com o instante atual.
- `card.agente` é `dispatch.owner` (`panel.ts:85`), um `SessionName` da geração ativa — o painel lista
  só despachos da geração ativa (`dispatch.ts:226-239`) e o liveness só sessões dela
  (`status.ts:35-37`). O vínculo `card.agente === SessionStatus.name` é exato; só falha se a sessão
  sair do registro. Nesse caso o detalhe diz "sessão não encontrada nesta geração" (REQ-04) e não se
  inventa `sessionID`.
- A geração anterior (`previous`) fica em um bloco separado, somente leitura, com `name`,
  `sessionID` e `closed`.

### 2.4 Estados e frescor (DD-04)

**DD-04 — Estado discriminado com falha parcial e staleness explícito; nenhum polling silencioso.**

```
loading ──► ready(panel, liveness)
   │           │
   │           ├─ refresh falha ──► ready(panel, liveness, staleSince, error)
   │           └─ refresh ok    ──► ready(...)
   ├─ 403 ForbiddenError                    ──► disabled(message)
   ├─ ClientError UnexpectedStatus 404      ──► unavailable(clientVersion)
   ├─ 409 ConflictError                     ──► failed(message verbatim)  (com retry)
   └─ 503 ServiceUnavailable / Transport    ──► failed("servidor indisponível")  (com retry)

ready com liveness.generation === null e cards vazio ──► "nenhuma geração ativa"
```

- `loading` só na primeira carga; refresh não apaga o conteúdo.
- Falha parcial: `panel` e `liveness` são armazenados separadamente. Se um falhar, o outro continua
  visível; o painel que falhou mostra o erro e, se havia valor anterior, o selo "desatualizado"
  com a idade.
- A idade usa `atualizadoEm` do documento (P2) e o relógio injetado. Sem timer, ela só avança quando
  há render (tecla, refresh) — decisão aberta DA-05.
- `r` dispara exatamente duas leituras (NFR-02). Não há `setInterval`; nada roda em background.
  O comportamento de `r` com um refresh ainda em voo (somar chamadas ou ignorar) não está decidido —
  pendência DA-07, relevante porque cada `panel` executa comandos no servidor (R10).

### 2.5 Sem escrita (DD-05)

**DD-05 — Nenhuma affordance de mutação no v1; o contrato de leitura é imposto por construção e por
teste.**

- O hook tipa a porta como `{ panel(): Promise<SquadPanelDocument>; liveness(): Promise<SquadLivenessReport> }`.
  O plugin a constrói a partir de `context.client.experimental.squad` passando só as duas funções;
  nenhum outro método do client é referenciado em `feature-plugins/squad`.
- A prova em teste usa um cliente de teste com a superfície completa de
  `client.experimental.squad` (§4.1) em que toda operação de escrita lança e registra a chamada;
  o teste afirma zero escritas e operações chamadas ⊆ `{ panel, liveness }`. Esse teste é uma
  **guarda de invariante**: ele passaria antes da implementação (não há escrita a fazer), então não
  serve de vermelho de TASK — o vermelho das tasks de navegação é a asserção de navegação.
- O rodapé não exibe "mover", "atribuir" ou "aceitar"; a ajuda diz "somente leitura" e aponta para
  `squad dispatch accept`/`squad send` como as operações do base.
- Quando a escrita for aprovada, ela será um change próprio que estende esta porta — não um
  `onKey` escondido.

### 2.6 Allowlist de renderização (DD-06)

**DD-06 — A view só renderiza campos nomeados; `location`, corpo e credencial não têm caminho até o
frame.**

- `render-fields.ts` concentra a formatação: título, agente, prioridade, refs, evidências,
  bloqueio, estágio (`status`, `source`, `evidence.type/reference/at`), sessão (`name`, `role`,
  `state`, `provider`, `model`, `variant`, `branch`, liveness) e, só no bloco da geração anterior,
  `sessionID`.
- `location`, `body`, `credential`, `token` **não** estão na allowlist; um teste passa uma fixture
  com esses campos (com `location` no formato `{ directory }`) e afirma ausência no frame (REQ-08).
- A view não reescreve `evidence.reference`: a redaction é do produtor. Essa decisão é registrada no
  teste para não ser "corrigida" por engano depois.
- Instantes chegam em milissegundos epoch e são formatados em ISO-8601 UTC (`Z`).

### 2.7 Layout e tema (DD-07)

**DD-07 — Colunas lado a lado em ≥120 colunas; lista empilhada em 80–119; tokens semânticos.**

- `layout.ts` expõe `mode(width)`: `columns` (≥120), `stacked` (80–119), `minimal` (<80, mostra a
  coluna corrente e um aviso de largura). REQ-09 cobre ≥80; o modo `minimal` não tem critério de
  aceite próprio (achado KV-L03, aberto).
- Tokens (`packages/theme/src/tui/types.ts:25-50`): texto em `text.base`/`text.muted`;
  `text.feedback.error` só para erro; `text.feedback.warning` só para "desatualizado"; card e linha
  focados em `text.formfield.focused`/`background.formfield.focused` ("Use `formfield` states for
  ... selection markers", `AGENTS.md` raiz). Nenhuma cor literal, nenhum `theme.hue`/`categorical`.
  Estágios e vereditos não ganham cor de `feedback` em v1; são palavras.
- Ajuda (`?`) é um overlay com as teclas e a frase "somente leitura".

### 2.8 Registro e descoberta (DD-08)

**DD-08 — Builtin registrado em `builtins.ts`, rota própria e comando de paleta; nenhum `bind`
global.**

- `packages/tui/src/plugin/builtins.ts` importa o plugin e o adiciona ao array `builtins`.
- `Plugin.define({ id: "opencode.squad-board", setup })` registra a rota `squad-board` e, num
  `context.ui.slot({ append: "app" })` com camada `mode: "global"`, o comando `squad.board.open`
  (`slash: { name: "squad-board" }`, `palette: true`, **sem `bind`**), exatamente como
  `stats.tsx:190-215`.
- `j/k/h/l/enter/r/?` são uma camada ativa apenas na rota (como `stats.tsx:151-153`). Fora dela, o
  keymap atual permanece intacto (REQ-02).
- **Por que não uma chave de config:** uma flag `experimental.*` exigiria tocar
  `packages/schema/src/config.ts` e `normalize`, criando uma segunda porta de habilitação além de
  `squad.enabled`. Isso colide com `packages/tui/AGENTS.md` (registro de experimentos com
  `config.experimental`) — a escolha está em aberto (DA-01).

### 2.9 Story (DD-09)

**DD-09 — Story fixture-driven, carregada só com `OPENCODE_STORY`, sem rede.**

- A story vive em `packages/tui/src/feature-plugins/system/storybook/squad-board.tsx`, exporta
  `squadBoardStory` e é adicionada ao array `stories` de `storybook/index.tsx`.
- Recebe fixtures estáticas no formato do client e uma porta de leitura local.
- Teclas da story alternam: normal, vazio, sem geração ativa, desatualizado, `403`, `404`, geração
  anterior, 200 cards; reset volta ao normal; todas listadas no `StoryFooter`.
- Nenhum `fetch`; o hook aceita a porta injetada.

## 3. Alternativas consideradas

| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| A. Plugin de TUI OpenTUI/Solid (escolhida) | navegação e drill-down no lugar onde o operador já trabalha; reusa client, tema, keymap e testes de frame; zero dependência nova | superfície TUI adicional; layout estreito exige modo empilhado | é a menor superfície que satisfaz board + navegação + drill-down (REQ-02/03) sem novo protocolo |
| B. Página no app web/desktop | layout rico, acessibilidade melhor, compartilhável | exige montar a view no app, mais um cliente e mais um caminho de auth; o dado é operacional e local | maior custo para o mesmo v1; fica como consumidor futuro do mesmo view-model |
| C. Apenas `squad panel show` | custo quase zero; já existe | imprime contagem por coluna e a lista de cards com `progressa: false` (`cli/src/commands/squad.ts:139-148`); não navega, não mostra estágio/evidência por card (só via `--json`), não mostra liveness junto | não satisfaz REQ-02/03/04 — mas ver nota de valor abaixo |
| D. CLI interativo novo (`squad board`) | independente do TUI; scriptável | duplica renderer e keymap; não reusa o host de plugins; `panel show` já cobre o resumo | duplicação sem ganho de navegação |
| E. Reusar o plugin externo `painel-kanban` | já existe no fluxo do operador | está fora do produto, não conhece o TUI, não tem contrato de navegação | não é uma view do produto; continua válido como consumidor do `kanban.json` |

**Nota de valor (não medida).** A escolha A sobre C é argumento de desenho, não evidência de uso: não
há medição de demanda (proposal §1). O ganho de v1 sobre `squad panel show --json` + `squad status`
é navegação e evidência por estágio + liveness na mesma tela. Como `progressa` é sempre `false` hoje
(§4.2), o selo "sem progresso" não discrimina cards; o valor do drill-down depende de `jira`/`ci`
estarem configurados. Se o produto quiser prova antes de construir, é decisão DA-02.

**Sobre "Ink vs Dioxus":** não é uma alternativa deste change. O TUI deste repositório usa
`@opentui/core`, `@opentui/keymap` e `@opentui/solid` (`packages/tui/package.json:62-64`); Ink e
Dioxus não são dependências, e Dioxus mudaria a linguagem do runtime.

## 4. Contratos e integrações afetados

### 4.1 Endpoints consumidos (somente leitura)

| Método e rota | Método do client | Valor devolvido | Erros |
|---|---|---|---|
| `GET /api/experimental/squad/panel` | `client.experimental.squad.panel()` | `SquadPanelDocument` (o client desembrulha `{ data }`, `client.ts:1727-1737`) | declarados: `ForbiddenError` 403, `ConflictError` 409, `ServiceUnavailableError` 503; não declarados (ex.: 404) → `ClientError("UnexpectedStatus")`; rede → `ClientError("Transport")` |
| `GET /api/experimental/squad/liveness` | `client.experimental.squad.liveness()` | `SquadLivenessReport` (`client.ts:1601-1611`) | idem |

Superfície completa de `client.experimental.squad` (para o cliente de teste de REQ-02/REQ-07,
`client.ts:1438-1740`): leitura — `session.list`, `check`, `plan`, `liveness`, `audit`,
`dispatch.list`, `panel`; escrita — `generation.create`, `generation.close`, `session.send`,
`session.launch`, `session.replace`, `broadcast`, `block`, `checkpoint`, `transition`, `activate`,
`dispatch.create`, `dispatch.accept`, `release`.

Nenhuma rota nova, nenhum payload alterado. As rotas são **experimentais** e podem mudar sem alias
(`AGENTS.md` §Experimental API); a view isola o formato em dois modelos puros.

### 4.2 Tipos consumidos (do change base)

O valor recebido é o **formato codificado** (instantes como `number` em ms epoch), tipado pelo client
gerado; `Squad.*` de `@opencode/schema/squad` é a definição semântica (decodificada, `DateTime.Utc`).
A view usa os tipos do client e não decodifica com Schema (o próprio `squad panel show` do base
consome o formato codificado, `panel-show.ts:16-20`).

- `SquadPanelDocument` (`types.ts:2460-2467`; `squad.ts:215-223`): `versaoSchema`, `revisao` (hash de
  12 hex do conteúdo, `panel.ts:41`), `atualizadoEm` (ms, relógio do servidor na montagem), `colunas`,
  `cards`, `fonte`.
- `PanelCard` (`squad.ts:193-213`): `id`, `titulo`, `coluna`, `agente`, `prioridade?`, `refs`,
  `evidencias`, `bloqueio?`, `atualizadoEm?`, `estagios{jira,ci,merge,deploy,acceptance}`,
  `exigidos`, `desconhecido`, `progressa`.
- `Stage` (`squad.ts:184-188`): `status`, `evidence` (`type`, `reference`, `at?`) ou `null`, `source`.
- `LivenessReport` (`squad.ts:365-372`): `generation` (nulo sem geração ativa), `sessions[]`,
  `inboxPending`, `cost`, `previous` (nulo ou `{ id, closedAt?, closedBy?, sessions[] }`).
- `SessionStatus` (`squad.ts:337-350`): `name`, `role`, `provider`, `model`, `variant?`, `location`
  (`Location.Ref` = `{ directory, workspaceID? }`, `location.ts:8-12`), `branch?`, `sessionID?`,
  `state`, `liveness`, `inboxPending`, `cost`.
- `Liveness` (`squad.ts:138-149`): `verdict`, `measuredAt`, `lastActivity?`, `sentAt?`, `source?`,
  `sessionState?`, `workingStale`, `presumedDead`, `cause?`.

**Fatos do produtor que afetam a view:**
- `deploy` é sempre `unknown` com `source: "none"` (`panel.ts:70`) e `desconhecido` lista todo
  estágio `unknown`, exigido ou não (`panel.ts:73,98`); portanto `progressa` é `false` em todo card
  produzido hoje (`packages/core/test/squad/panel.test.ts:149-151`). Defeito ou intenção do base —
  fora do escopo deste change; registrado no parecer.
- Cada chamada a `panel` executa, por card, o `jira_command`/`ci_command` configurados e uma consulta
  de ancestralidade git (`panel.ts:55-72`, concorrência 4). O custo de um refresh cresce com o número
  de cards no servidor, ainda que a view faça só duas chamadas HTTP (R10).

A view consome o tipo; não redefine nem cria cópia local. `location` existe no tipo e é
**filtrado** na renderização (DD-06).

### 4.3 Modelo de dados

**Não há mudança de banco.** Nenhuma tabela, coluna, migration ou backfill. A view não persiste
nada: sem arquivo, sem `context.storage`, sem cache em memória além do último documento da sessão de
UI (que morre com a rota).

### 4.4 Compatibilidade

- Aditiva na superfície TUI: um builtin novo, uma rota nova, um comando de paleta/slash e uma story;
  nenhum `bind` global, nenhum componente existente alterado.
- `packages/tui/package.json` inalterado (NFR-03).
- Se o servidor não tiver o grupo `squad` (versão anterior), a rota da TUI existe mas mostra o
  estado `404` acionável; nenhum crash (REQ-06).
- A documentação do base (`packages/cli/README.md:113-115`, "Não existe tela de TUI ou de app para o
  painel") e o critério 5 de REQ-17 do base (`squad-orchestration/requirements.md:210`) ficam falsos
  com esta view. A seção do README é atualizada por REQ-10; o requisito do baseline é a decisão
  aberta DA-08.

## 5. Plano de migração / rollout

1. **Pré-requisito:** gate de entrada E1–E8 (§1.3). Sem ele, a implementação não começa.
2. **Modelos puros primeiro:** TASK-01..TASK-03 não importam renderer; são testados com fixtures no
   formato do client.
3. **Hook e componentes:** TASK-04..TASK-09; a rota só é registrada após o board renderizar com
   fixture.
4. **Registro e story:** TASK-10/TASK-11; o builtin é adicionado por último, quando a rota já é
   navegável em teste.
5. **Rollout:** sem flag de config (DD-08, sob DA-01). A view aparece como comando de paleta/slash
   `/squad-board`; se `squad.enabled` estiver desligado, mostra o estado `403`. Não há migração de
   dados nem "big bang".
6. **Rollback:** remover o builtin de `builtins.ts` desliga a view; nenhum estado fica para trás.
7. **Sharding:** scale 3 exige `/forge:analyze` e `/forge:shard` antes de `implementing`;
   `dev_loop.sharded` está `false` de propósito até lá.

## 6. Riscos e mitigação

| Risco | Probabilidade | Impacto | Mitigação / detecção |
|---|---|---|---|
| R1 — `squad-orchestration` não mergeia ou muda o contrato | alta | alto | gate de entrada E1/E6 (§1.3); modelos isolam o formato |
| R2 — API experimental muda depois do merge | média | médio | dois modelos puros + testes de fixture; mudança quebra 1 arquivo, não a UI |
| R3 — teste com cliente de teste não prova o contrato real | média | médio | fixtures tipadas por `SquadPanelDocument`/`SquadLivenessReport` do client gerado (o typecheck quebra se o contrato mudar); o contrato HTTP é provado no base (`packages/server/test/squad.test.ts`); o TUI não sobe servidor |
| R4 — vazamento de `location` | média | alto | allowlist em `render-fields.ts`; teste com `{ directory: "/Users/..." }` e asserção de ausência (REQ-08) |
| R5 — dado velho lido como atual | média | médio | idade a partir de `atualizadoEm`; selo "desatualizado"; teste de refresh com falha (REQ-05). Como o documento é montado por requisição (P2), o risco só existe após falha de refresh |
| R6 — colisão de teclas com o app | média | médio | camada de keymap só na rota; nenhum `bind` em camada global (REQ-02) |
| R7 — board grande trava a UI | média | médio | janela de montagem `viewport + 4`; teste de contagem de renderables com 200 cards (NFR-01) |
| R8 — `card.agente` sem sessão correspondente | baixa | baixo | vínculo exato por nome; mensagem "sessão não encontrada"; nunca inventa `sessionID` (DD-03) |
| R9 — a view vira "quase escrita" e duplica `dispatch accept` | baixa | alto | REQ-07 e DD-05; escrita exige change próprio e reusa o base |
| R10 — refresh custa N execuções de comando no servidor | média | médio | duas chamadas HTTP por refresh (NFR-02); sem polling; comportamento de `r` em voo é DA-07. Origem: M4 do parecer do base |
| R11 — baseline do base contradiz esta view ("não existe superfície de TUI") | alta | médio | DA-08; README atualizado por REQ-10 |
| R12 — `progressa` sempre `false` torna o selo ruído | alta | baixo | DA-03; o fato está em §4.2 |

## 7. Rastreabilidade

| REQ | Seção do design que o atende | `spec-delta` |
|---|---|---|
| REQ-01 | §2.1 (DD-01), §2.2 (DD-02), §4.2 | REQ-KANBAN-001 |
| REQ-02 | §2.1 (DD-01), §2.5 (DD-05), §2.8 (DD-08) | REQ-KANBAN-002 |
| REQ-03 | §2.2 (DD-02), §2.6 (DD-06) | REQ-KANBAN-003 |
| REQ-04 | §2.3 (DD-03) | REQ-KANBAN-004 |
| REQ-05 | §2.4 (DD-04) | REQ-KANBAN-005 |
| REQ-06 | §2.4 (DD-04), §4.1 | REQ-KANBAN-006 |
| REQ-07 | §2.5 (DD-05), §4.3, §4.4 | REQ-KANBAN-007 |
| REQ-08 | §2.6 (DD-06), §4.2 | REQ-KANBAN-008 |
| REQ-09 | §2.7 (DD-07) | REQ-KANBAN-009 |
| REQ-10 | §2.9 (DD-09), §4.4, §5 | REQ-KANBAN-010 |

NFRs: NFR-01 → §2.2/§2.7; NFR-02 → §2.4; NFR-03 → §1.2/§4.4; NFR-04 → §2.1/§4.1.

## 8. Decisões abertas (pendências explícitas para o humano)

Nenhuma destas foi decidida por quem revisou; cada uma tem opções e recomendação no parecer
`pre-approval.md`.

- **DA-01 — Chave `config.experimental` × opt-in por rota.** `packages/tui/AGENTS.md` manda UI
  experimental opt-in para o registro de experimentos com chave `config.experimental`; A4/DD-08 não
  criam chave.
- **DA-02 — Prova de valor antes de construir.** v1 somente leitura × `squad panel show --json` +
  `squad status`.
- **DA-03 — Selo "sem progresso" em 100% dos cards.** Exibir sempre (fiel ao dado), suprimir quando
  todo `exigidos[]` está `verified`, ou pedir ao base que `progressa` considere só `exigidos[]`.
- **DA-04 — `progressa: true`.** Nenhuma barra em v1, ou contagem textual `<n>/<m> exigidos
  verificados`. Hoje inalcançável.
- **DA-05 — Idade sem timer.** Aceitar idade que só avança com interação, ou tick de render de 1 Hz
  sem fetch.
- **DA-06 — Faixa "coluna desconhecida".** Manter defesa contra violação de contrato ou removê-la
  (AGENTS.md: não revalidar o que o tipo garante).
- **DA-07 — `r` com refresh em voo.** Somar chamadas ou ignorar até concluir (single-flight).
- **DA-08 — Requisito do baseline do base.** REQ-17 do base afirma ausência de superfície de TUI;
  este change precisa de `modify_requirement` sobre `REQ-SQUAD-017` (após o archive do base) ou de
  emenda no próprio base antes do archive.

### 8.1 Decisões do operador (2026-11-06, aprovando a documentação para execução)

Decidido pelo operador ao aprovar a documentação; cada item registra a opção escolhida dentre as do
parecer `pre-approval.md` §5 e o motivo.

- **DA-01 → (a).** Chave `config.experimental.squad_board` no registro de experimentos, gateando o
  comando da view. A norma de `packages/tui/AGENTS.md` é explícita e o custo é uma chave.
- **DA-02 → construir v1.** A aprovação da documentação para execução é a decisão de construir; a
  medição de demanda (`squad panel show --json` + `squad status`) fica como follow-up pós-MVP, não
  como pré-condição.
- **DA-03 → (a) em v1, (c) no base.** v1 exibe o selo "sem progresso" sempre (fiel ao dado, sem
  recalcular regra do produtor); o ajuste de `progressa` para considerar só `exigidos[]` é pedido ao
  base (follow-up registrado no ledger).
- **DA-04 → (a).** Nada desenhado para `progressa: true` em v1 (inalcançável com o produtor atual).
- **DA-05 → (a).** Idade só avança com interação; o rótulo mostra "às <hora>" além da idade relativa.
- **DA-06 → (b).** Sem faixa "coluna desconhecida"; o typecheck do client contra o contrato gerado é
  a guarda, conforme o Style Guide (não revalidar o que o tipo garante).
- **DA-07 → (b).** Single-flight: tecla `r` durante refresh em voo é ignorada até a conclusão
  (cada `panel` executa comandos por card no servidor).
- **DA-08 → (a).** Emenda de REQ-17 no próprio `squad-orchestration` antes do archive dele
  (o base ainda não arquivou).
- **DA-09 (nova) — Base branch da implementação.** O gate E1/E2 de §1.3 assume partir de
  `origin/dev` após o merge do base. O operador decide: implementar AGORA em worktree isolado,
  branch `squad-kanban-view` com base em `feature/squad-orchestration` (que contém as correções
  B4/B5 do laudo), e rebasear sobre `origin/dev` quando o base mergear. Aceita o risco de rebase;
  o grafo de tasks não muda.
