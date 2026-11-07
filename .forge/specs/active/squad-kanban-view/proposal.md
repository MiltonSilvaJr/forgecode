# Proposal — squad-kanban-view

> Change `squad-kanban-view` (type: `feature`, scale 3) — criado em 2026-11-06 por Milton Antonio da Silva Jr.
> Depende do change `squad-orchestration` (`.forge/specs/active/squad-orchestration/`), ainda **não
> merged** em `origin/dev`.
> Documento de trabalho: os artefatos estão completos para revisão, mas os gates HITL estão pendentes;
> `status: proposed` é deliberado.

## 1. Por quê (problema / motivação)

A camada `squad` já especificada produz os dados de um board, mas **não entrega uma superfície de
leitura navegável** dentro do produto. A evidência está no próprio change base, não em métrica
inventada:

- `squad-orchestration/requirements.md:210` (REQ-17) é explícito: "Não existe superfície de TUI/app
  própria: o consumidor é o plugin `painel-kanban` externo + `panel show` + o `kanban.json`".
- `squad-orchestration/proposal.md:16` registra a lição operacional que motiva o painel: "Painel que
  mistura estágio de Jira com estágio de entrega mente quando não há evidência por estágio".
- O branch `feature/squad-orchestration` já contém `packages/core/src/squad/panel.ts`, que monta o
  `Squad.PanelDocument` (`versaoSchema: 1`, cinco colunas, estágios `jira|ci|merge|deploy|acceptance`,
  `desconhecido[]`, `progressa`). O dado existe; o que falta é a **view**.

O operador hoje precisa escolher entre (a) rodar `squad panel build --out` e ler JSON, (b) usar um
plugin externo que não conhece o resto do TUI, ou (c) pedir a `squad panel show`, que imprime um
resumo por coluna e não permite drill-down. Nenhuma dessas opções dá navegação e evidência por
estágio no mesmo lugar em que o operador já trabalha.

**Isto é um caso, não uma baseline.** Não há medição de quantos operadores usam o painel externo nem
de quanto tempo perdem. O change parte de uma lacuna declarada na especificação base e de uma
operação real registrada (13 sessões em 04/11/2026, `squad-orchestration/proposal.md:9`), e não
afirma uma frequência que não mediu.

## 2. O que muda

Uma **view kanban nativa, somente leitura**, sobre a camada `squad`:

1. **Board a partir do documento existente.** Renderiza as colunas de `PanelDocument.colunas` e um
   card por entrada de `PanelDocument.cards`, agrupado por `card.coluna`. Nenhum estado novo é
   calculado no cliente: a coluna vem do servidor.
2. **Navegação e drill-down.** `j/k` movem o foco, `h/l` trocam de coluna, `enter` abre o detalhe do
   card, `esc` volta, `r` atualiza, `?` mostra a ajuda. Nenhuma tecla muta estado.
3. **Evidência por estágio no detalhe.** Para `jira`, `ci`, `merge`, `deploy` e `acceptance`: status
   (`verified|failed|unknown`), `source` e `evidence` (tipo, referência, instante) ou "sem
   evidência". `exigidos[]` e `desconhecido[]` são exibidos; `progressa: false` impede qualquer barra
   de progresso.
4. **Sessões e liveness no mesmo lugar.** Painel lateral com `Squad.LivenessReport`: nome, papel,
   estado, provider/modelo/variant, veredito (`working|idle|stalled|presumed_dead|unknown`),
   `measuredAt`, `lastActivity` + `source`, `workingStale`, `presumedDead`, `cause`, `inboxPending`
   e a geração anterior, quando houver.
5. **Frescor explícito.** `revisao` e `atualizadoEm` visíveis; falha de refresh mantém o último
   documento e o marca como desatualizado, com a idade e o erro. Falha de um dos dois endpoints não
   derruba o outro painel.
6. **Estados acionáveis.** `squad.enabled: false` (403), rota ausente (404), geração inexistente e
   erro de servidor têm mensagem nomeada e remediação, nunca stack trace.

## 3. O que NÃO muda (fora de escopo)

- **Nenhuma operação de escrita:** mover card, atribuir agente, criar/aceitar despacho, editar
  título, pausar/retomar. `dispatch accept` e `squad send` já existem no change base e serão
  reusados quando a escrita for aprovada — não duplicados aqui.
- **Nenhum endpoint novo, nenhuma tabela, nenhuma migration, nenhuma alteração em `packages/core`.**
- **Nenhum estado paralelo:** a view não persiste nada, não cacheia em disco e não deriva coluna,
  estágio ou liveness.
- **Nenhum embed de terminal/PTY** e nenhuma execução de agente.
- **Nenhum suporte multi-geração como board:** a geração anterior aparece apenas como bloco
  informativo de sessões fechadas.
- **Nenhuma alteração em `squad-orchestration`:** o change base continua dono do painel, do
  `kanban.json` e das regras de estágio. Única exceção: a seção "Sem painel próprio" de
  `packages/cli/README.md`, que afirma não existir tela de TUI e ficaria falsa (REQ-10). O
  requisito equivalente do baseline do base (REQ-17) é a decisão aberta DA-08 (`design.md` §8).
- **Nenhuma promessa de paridade com OpenKanban:** worktrees, multi-projeto e spawn de agente são
  do produto OpenKanban, não deste change.

## 4. Impacto

- **Capacidades afetadas:** `squad-kanban-view` (nova). Consome a capacidade
  `squad-orchestration`; não a altera.
- **Paths afetados:** `packages/tui/src/feature-plugins/squad/**`,
  `packages/tui/src/plugin/builtins.ts`, `packages/tui/src/feature-plugins/system/storybook/{index.tsx,squad-board.tsx}`,
  `packages/tui/test/feature-plugins/squad-*`, `packages/cli/README.md` (seção "Sem painel próprio").
- **Dependências:**
  - `squad-orchestration` — **hard dependency de contrato e de código**: os tipos
    `Squad.PanelDocument`/`Squad.LivenessReport` e as rotas
    `GET /api/experimental/squad/panel` e `GET /api/experimental/squad/liveness` só existem no
    branch `feature/squad-orchestration` (205 commits à frente de `origin/dev`, **não merged**;
    `git merge-base --is-ancestor feature/squad-orchestration origin/dev` → exit 1). A implementação
    deste change **não começa** antes desse merge; o próprio base tem bloqueadores abertos
    (B1–B5 em `.forge/ledger/2026-11-06_squad-orchestration-adversarial-review.md`).
  - `packages/client` — client gerado do grupo `experimental.squad`; a view usa o client, nunca
    `fetch` cru.
- **Riscos:**
  - **Dependência não merged** → a view não compila em `dev`; detecção: `bun typecheck` em
    `packages/tui` falha porque `context.client.experimental.squad` e os tipos `SquadPanelDocument`/
    `SquadLivenessReport` do client gerado não existem em `origin/dev`. Mitigação: implementar só
    depois do merge, com worktree a partir de `origin/dev` (gate de entrada E1–E8, `design.md` §1.3);
    declarado como bloqueio, não contornado com tipos locais.
  - **API experimental muda** → o view-model isola o formato; uma mudança quebra um arquivo e um
    teste, não a UI inteira.
  - **Vazamento de caminho absoluto** (`SessionStatus.location`) → allowlist de campos; teste com
    fixture contendo `/Users/...` e asserção de ausência no frame.
  - **Dado velho confundido com atual** → idade visível a partir de `atualizadoEm`, não do momento
    do fetch.

## 5. Próximos passos

Fluxo scale 3: `/forge:requirements` → `/forge:design` → `/forge:tasks` → `/forge:analyze`
(o `analysis.md` atual é uma revisão adversarial manual com Status FAIL; não substitui a execução de
`/forge:analyze`, que exige `tasks-ready`) → `/forge:shard` antes de `/forge:implement` →
implementação no worktree `.forge/worktrees/squad-kanban-view/`, branch `feature/squad-kanban-view`
(mesma convenção do base; ver drift de nomes de branch em `design.md` §1.2), criado a partir de
`origin/dev` depois do merge do base, PR para `dev`.

**Por que scale 3 (e não 2).** O change cria uma **capacidade nova** e uma **superfície nova para o
usuário**, e depende de um contrato ainda não integrado. É o mesmo perfil de risco que o
`squad-orchestration` subdimensionou ao se declarar scale 2 (ver H4 do parecer dele). Para não
repetir o erro, este change: (a) produz `analysis.md`; (b) declara `dev_loop.sharded: false` e
exige `/forge:shard` antes de `implementing`; (c) mantém todos os gates falsos. O tamanho é pequeno,
mas o risco de integração não é — a escala acompanha o risco, não o número de tasks.

Decisões assumidas nesta proposal (não são perguntas abertas):

- **A1 — v1 é somente leitura.** Escrita fica atrás de decisão registrada e reusa as operações do
  change base (`squad send`, `dispatch accept`), nunca uma segunda implementação.
- **A2 — a view é um plugin de TUI (OpenTUI/Solid), não um framework novo.** Alternativas
  (web/desktop, apenas `panel show`, CLI interativo) estão em `design.md` §3 com trade-offs.
- **A3 — nenhum estado novo.** Board e liveness são projeções diretas de dois documentos do
  servidor; o cliente não deriva coluna, estágio nem veredito.
- **A4 — nenhuma chave de config nova em v1.** A view é opt-in por rota/comando; não altera
  `normalize`, `nativeAtomic` nem defaults. Se houver entrada acidental, a decisão é reaberta.
  Pendente de confirmação humana: `packages/tui/AGENTS.md` manda UI experimental opt-in para o
  registro de experimentos com chave `config.experimental` (DA-01, `design.md` §8).
- **A5 — `location` não é renderizado.** É `sensitive` na classificação do change base
  (`requirements.md:372`); a view mostra branch e provider/modelo, nunca o caminho absoluto.
- **A6 — a dependência é bloqueio, não contorno.** Não serão criados tipos locais "temporários" para
  compilar antes do merge do base; isso criaria duas verdades de contrato.
- **A7 — sem PTY e sem worktree.** O valor de v1 é board + evidência + liveness; terminal embutido
  é uma hipótese separada, não uma premissa.
