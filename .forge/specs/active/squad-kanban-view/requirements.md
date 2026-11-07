# Requirements — squad-kanban-view

> Requisitos do change `squad-kanban-view`. Cada requisito é verificável e rastreável à proposal.
> IDs `REQ-NN` mapeiam 1:1 para `REQ-KANBAN-NNN` no `spec-delta.yaml` (tabela em `design.md` §7).
> O change é **somente leitura**: nenhum critério aqui autoriza mutação, persistência ou endpoint novo.
> **Contrato consumido:** os valores chegam pelo client gerado (`context.client.experimental.squad.panel()`
> e `.liveness()`), que devolve o formato **codificado** (instantes em milissegundos epoch), tipado por
> `SquadPanelDocument`/`SquadLivenessReport` de `packages/client/src/promise/generated/types.ts`
> (`:2460`, `:2971` no branch `feature/squad-orchestration`). `Squad.PanelDocument`/`Squad.LivenessReport`
> de `@opencode/schema/squad` são a fonte semântica desses tipos, não o tipo do valor recebido
> (detalhe em `design.md` §4.2).

## REQ-01 — Board renderizado a partir do documento do painel

- **Quando** o operador abre a rota do board com `squad.enabled` ligado, **o sistema deve** renderizar
  uma coluna para cada entrada de `PanelDocument.colunas`, na ordem do documento, e um card por
  entrada de `PanelDocument.cards`, agrupado por `card.coluna`.
- **Critérios de aceite:**
  - [ ] Fixture com as cinco colunas (`backlog`, `in_progress`, `in_review`, `blocked`, `done`) e três
    cards em colunas distintas renderiza cinco cabeçalhos e três cards, cada um na coluna declarada
    por `card.coluna`.
  - [ ] A ordem dos cards dentro da coluna é a ordem de inserção do documento (ordem estável do
    `cards{}`), e a ordem das colunas é exatamente `colunas[]` — nenhuma ordenação local é aplicada.
  - [ ] Card com `desconhecido[]` não vazio exibe a contagem de estágios desconhecidos e o selo
    "sem progresso" quando `progressa` é `false`; card com `progressa: true` e `desconhecido[]`
    vazio não exibe o selo. (Com o produtor atual, `progressa: true` é inalcançável — ver nota.)
  - [ ] `cards{}` vazio com geração ativa renderiza o estado vazio ("nenhum card na geração ativa"),
    não uma coluna inventada nem um card fantasma.
- **Rastreia:** proposal §2 (itens 1, 3), §4
- **Notas:** a semântica é a de `Squad.PanelDocument` (`packages/schema/src/squad.ts:215-223` no branch
  `feature/squad-orchestration`): `versaoSchema`, `revisao`, `atualizadoEm`, `colunas`, `cards`,
  `fonte`. A view não recalcula `coluna` a partir de estágios; isso é regra do produtor
  (`packages/core/src/squad/panel.ts:104-110`). **Fato do produtor:** `deploy` é sempre
  `unknown("none")` (`panel.ts:70`) e `desconhecido` lista todo estágio `unknown`, exigido ou não
  (`panel.ts:73,98`); logo `progressa` é `false` em todo card produzido hoje
  (`packages/core/test/squad/panel.test.ts:149-151`). O selo aparece em 100% dos cards reais —
  decisão aberta DA-03 (`design.md` §8).

## REQ-02 — Navegação sem mutação

- **Quando** o board está em foco, **o sistema deve** mover o foco com `j/k`, trocar de coluna com
  `h/l`, abrir o detalhe com `enter`, voltar com `esc`, atualizar com `r` e abrir a ajuda com `?`,
  sem executar nenhuma operação de escrita.
- **Critérios de aceite:**
  - [ ] Cada tecla altera apenas o estado de foco/rota esperado: `j`/`k` movem uma posição dentro da
    coluna (com clamp nas bordas), `h`/`l` trocam de coluna (com clamp), `enter` abre o detalhe do
    card focado, `esc` retorna ao board, `r` dispara exatamente um refresh, `?` abre a ajuda.
  - [ ] Um cliente de teste que expõe toda a superfície de `client.experimental.squad` e lança em
    cada operação de escrita (`generation.create`, `generation.close`, `session.send`,
    `session.launch`, `session.replace`, `broadcast`, `block`, `checkpoint`, `transition`,
    `activate`, `dispatch.create`, `dispatch.accept`, `release`) registra **zero** chamadas de
    escrita após exercitar todas as teclas acima, incluindo `enter` e `r`; o conjunto de operações
    chamadas é subconjunto de `{ panel, liveness }`.
  - [ ] As teclas `j k h l enter r ?` são registradas em camada de keymap ativa só enquanto a rota está
    montada; nenhuma camada `mode: "global"` do plugin declara `bind` de tecla. O único item global é
    o comando de paleta/slash que abre a rota (sem `bind`), no padrão de
    `packages/tui/src/feature-plugins/system/stats.tsx:190-215`. Fora da rota, `j`/`k` mantêm o
    comportamento atual.
  - [ ] A ajuda lista as teclas e a frase "somente leitura".
- **Rastreia:** proposal §2 (item 2), §3
- **Notas:** o plugin registra rota própria (`context.ui.router.register`) e uma camada de keymap
  ativa só enquanto a rota está montada, como em `packages/tui/src/feature-plugins/system/stats.tsx:151-153`.
  O client gerado não expõe `post/patch/put/delete`; expõe operações nomeadas
  (`packages/client/src/promise/generated/client.ts:1438-1740` no branch base) — por isso o critério
  enumera as operações reais.

## REQ-03 — Drill-down com evidência por estágio

- **Quando** o operador abre o detalhe de um card, **o sistema deve** exibir os cinco estágios na
  ordem fixa `jira`, `ci`, `merge`, `deploy`, `acceptance`, cada um com status, `source` e evidência
  (tipo, referência, instante) ou a indicação explícita de ausência.
- **Critérios de aceite:**
  - [ ] Cada estágio exibe `verified`, `failed` ou `unknown` exatamente como recebido; `unknown` nunca
    é convertido em `idle`, `pending`, `ok` ou barra parcial.
  - [ ] Estágio com `evidence: null` exibe "sem evidência" e o `source`; estágio com evidência exibe
    `type`, `reference` e `at` verbatim (o `at`, recebido em milissegundos epoch, formatado em
    ISO-8601 UTC com sufixo `Z`).
  - [ ] Cada estágio é rotulado "exigido" ou "não exigido" conforme `exigidos[]`. `desconhecido[]` é
    exibido verbatim como veio do servidor (contém todo estágio `unknown`, exigido ou não —
    `panel.ts:73,98`); estágio não exigido `unknown` exibe "não exigido" seguido do `source` verbatim
    (ex.: `none`) e não impede a leitura dos demais.
  - [ ] Com `progressa: false`, o detalhe não desenha barra de progresso nem percentual. O
    comportamento com `progressa: true` está pendente da decisão aberta DA-04 (`design.md` §8): como
    escrito antes ("pode desenhar barra"), o critério não era testável.
- **Rastreia:** proposal §2 (item 3), §4 (risco de painel mentir)
- **Notas:** contrato `PanelCard` (`estagios`, `exigidos`, `desconhecido`, `progressa`); `StageEvidence`
  tem `type`, `reference` e `at` opcional (`squad.ts:178-182`). A view não inventa estágio a partir de
  status de Jira nem de mensagem de agente (regra herdada de REQ-17 do base).

## REQ-04 — Sessões e liveness medidos no mesmo board

- **Quando** o painel de sessões está visível, **o sistema deve** listar, por sessão da geração
  ativa, nome, papel, estado, provider/modelo/variant, veredito de liveness, `measuredAt`,
  `lastActivity` com `source`, `workingStale`, `presumedDead`, `cause` e `inboxPending`; e, quando
  existir, um bloco separado da geração anterior.
- **Critérios de aceite:**
  - [ ] Fixture com uma sessão `presumed_dead` com `cause` e uma `stalled` renderiza os dois rótulos
    distintos e a `cause` da primeira; `unknown` nunca é exibido como `idle`.
  - [ ] `lastActivity` ausente exibe "—" (nunca o instante atual); `source` ausente exibe "—";
    `inboxPending > 0` é exibido como `inbox: <n>` sem alterar o veredito.
  - [ ] A geração anterior, quando presente, aparece em bloco próprio com `closedAt`/`closedBy` (ou
    "—") e `name`, `sessionID` (ou "—") e estado `closed` de cada sessão; não é misturada com as
    sessões ativas.
  - [ ] O veredito exibido é exatamente `liveness.verdict` do relatório: uma fixture com
    `verdict: "working"` e `cause` contendo a palavra "dead" exibe `working`; nenhum texto de `cause`
    ou `name` é usado para decidir ou reescrever o veredito.
  - [ ] No detalhe de um card, a sessão de `card.agente` é localizada por igualdade com
    `SessionStatus.name`; sem correspondência, o detalhe exibe "sessão não encontrada nesta geração"
    e nenhum `sessionID` é inventado.
- **Rastreia:** proposal §2 (item 4), §4
- **Notas:** contrato `LivenessReport` (`squad.ts:365-372`): `generation` (nulo sem geração ativa),
  `sessions[]` (`SessionStatus` com `liveness`, `inboxPending`, `cost`), `inboxPending`, `cost`,
  `previous`. O veredito e a `cause` são calculados pelo servidor (`core/src/squad/status.ts:69-108`);
  a view só projeta. `card.agente` é `dispatch.owner` (`panel.ts:85`), um `SessionName` da mesma
  geração ativa (`dispatch.ts:226-239`), então o vínculo por nome é exato enquanto a sessão existir
  no registro.

## REQ-05 — Frescor explícito e falha parcial

- **Quando** os dados são carregados ou atualizados, **o sistema deve** exibir `revisao` e
  `atualizadoEm`, e tratar falha de refresh sem apagar o último documento válido.
- **Critérios de aceite:**
  - [ ] O rodapé exibe `revisao` e a idade `agora - atualizadoEm`, com `agora` vindo de um relógio
    injetado (não de `Date.now()` dentro do componente), com unidade (`s`, `min`, `h`) e a fonte
    "painel". Fixture com `atualizadoEm = T` e relógio em `T + 90 000 ms` exibe `1 min`.
  - [ ] Se o segundo fetch do painel falhar, o board continua exibindo o documento anterior e passa a
    mostrar o selo "desatualizado" com a idade e a mensagem de erro; não fica em branco e não
    apresenta o dado como fresco.
  - [ ] Se `panel` falhar e `liveness` tiver sucesso, o painel de sessões renderiza e o board mostra o
    erro; o inverso também vale. Nenhuma das duas falhas impede a outra.
  - [ ] Cada refresh dispara exatamente duas chamadas de leitura (painel e liveness), nunca uma
    terceira por card ou por sessão.
- **Rastreia:** proposal §2 (item 5), §4 (risco de dado velho)
- **Notas:** o produtor monta o documento **a cada requisição** e grava `atualizadoEm` com o relógio
  do servidor no momento da montagem (`panel.ts:37-42`); `revisao` é um hash de 12 hex do conteúdo
  dos cards (`panel.ts:41`), não um contador. Na prática a idade só cresce depois de um refresh que
  falhou. Sem timer (DD-04), a idade é recalculada em cada render, mas não há render sem interação
  — decisão aberta DA-05 (`design.md` §8).

## REQ-06 — Estados de indisponibilidade acionáveis

- **Quando** a rota ou os endpoints não estão disponíveis, **o sistema deve** exibir um estado
  nomeado com a remediação, sem stack trace e sem derrubar o TUI.
- **Critérios de aceite:**
  - [ ] `403` (`ForbiddenError`) exibe mensagem contendo `squad.enabled` e a instrução de ligar a flag;
    nenhuma chamada de escrita é tentada.
  - [ ] `404` (rota ausente na versão instalada do servidor; chega como `ClientError` com
    `reason: "UnexpectedStatus"` e `cause.status === 404`) exibe "squad indisponível nesta versão do
    servidor" e a versão do cliente (`context.app.version`); não interpreta como geração vazia.
  - [ ] Erro de rede (`ClientError` `Transport`) ou `503` (`ServiceUnavailableError`) exibe
    "servidor indisponível" e um comando de retry (`r`), preservando o último documento se houver.
  - [ ] Nenhum dos estados lança exceção para o renderer; a rota continua navegável (`esc` retorna).
  - [ ] `409` (`ConflictError`, declarado nas duas rotas) exibe a mensagem do servidor verbatim e o
    comando de retry; não é tratado como `403` nem como vazio.
  - [ ] Com `LivenessReport.generation === null` e `cards{}` vazio, o board exibe "nenhuma geração
    ativa", distinto do estado vazio de REQ-01 (geração ativa sem cards).
- **Rastreia:** proposal §2 (item 6), §4
- **Notas:** o base mapeia `Squad.DisabledError` para `403` com a mensagem
  `squad.enabled is false. Set squad.enabled in config to use squad.`
  (`core/src/squad/index.ts:9-13`, `server/src/handlers/squad.ts:41-55`). As duas rotas declaram
  `[ForbiddenError, ConflictError, ServiceUnavailableError]` (`protocol/src/groups/squad.ts:257-268,
  395-406`); o client gera `declaredStatuses: [400, 401, 403, 409, 503]` e lança `ClientError` para
  status não declarado (`client/src/promise/generated/client.ts:439-446`). Sem geração ativa, o painel
  devolve `cards: {}` (`dispatch.ts:231`) e o liveness devolve `generation: null` (`status.ts:61`).
  A view traduz o erro tipado, não o stack.

## REQ-07 — Sem escrita, sem persistência, sem endpoint novo

- **Quando** o change é comparado com `origin/dev`, **o sistema deve** permanecer estritamente
  somente leitura e aditivo na superfície de TUI.
- **Critérios de aceite:**
  - [ ] O diff do change não contém migration, `packages/core/**`, `packages/schema/**`,
    `packages/protocol/**`, `packages/client/**` nem `packages/server/**`. Os únicos paths alterados
    são `packages/tui/src/feature-plugins/squad/**`, `packages/tui/src/plugin/builtins.ts`,
    `packages/tui/src/feature-plugins/system/storybook/{index.tsx,squad-board.tsx}`,
    `packages/tui/test/feature-plugins/squad-*` e a seção "Sem painel próprio" de
    `packages/cli/README.md` (REQ-10). Verificação: `git diff --name-only origin/dev...HEAD`.
  - [ ] O teste do cliente de teste de REQ-02 afirma que o conjunto de operações chamadas é
    subconjunto de `{ panel, liveness }`, falhando em qualquer operação de escrita enumerada lá.
  - [ ] Nenhum arquivo é escrito em disco e `context.storage` não é usado; refresh reconstrói o estado
    a partir dos dois documentos. Verificação estática:
    `grep -rnE "context\.storage|Bun\.write|writeFile" packages/tui/src/feature-plugins/squad` vazio.
  - [ ] A view usa somente `@opencode/client`, `@opencode/plugin`, `@opentui/*`, `solid-js` e,
    opcionalmente, `@opencode/schema`; não importa `@opencode/core` nem `@opencode/server`
    (o pacote TUI já depende de `@opencode/core`, mas esta view não acrescenta esse acoplamento).
    Verificação: `grep -rnE "@opencode/(core|server)" packages/tui/src/feature-plugins/squad` vazio.
- **Rastreia:** proposal §3, A1, A3
- **Notas:** os métodos de escrita existentes no base (`dispatch.accept`, `session.send`) não são
  expostos pela view; quando a escrita for aprovada, ela reusa esses métodos, não os reimplementa.

## REQ-08 — Sem vazamento de caminho, corpo ou segredo

- **Quando** qualquer tela é renderizada, **o sistema deve** exibir apenas os campos allowlisted,
  nunca `location`, corpo de checkpoint, corpo de mensagem, credencial ou token.
- **Critérios de aceite:**
  - [ ] Fixture com `location: { directory: "/Users/segredo/worktree" }` (formato `Location.Ref`,
    `packages/schema/src/location.ts:8-12`) renderiza o board, o detalhe e o painel de sessões sem
    conter `/Users` nem `segredo` em nenhum frame.
  - [ ] Fixture com campos `body`, `credential`, `token` (fora do contrato, para teste de allowlist)
    não faz nenhum desses valores aparecer no frame.
  - [ ] `branch` e `provider/model/variant` são exibidos; `evidence.reference` é exibido verbatim
    (a redaction é do produtor, não da view) e o teste registra essa decisão.
  - [ ] Nenhum log da view imprime o documento completo; mensagens de erro citam apenas o status e a
    mensagem do servidor. Verificação estática:
    `grep -rnE "console\.|JSON\.stringify" packages/tui/src/feature-plugins/squad` vazio.
- **Rastreia:** proposal §2 (itens 2, 4), A5, §4
- **Notas:** `squad_session.location` é `sensitive` no base (`squad-orchestration/requirements.md:372`).
  O painel `fonte{}` descreve a origem do estágio, não contém segredo; ainda assim passa pela allowlist.

## REQ-09 — Layout navegável em terminal estreito e tokens semânticos

- **Quando** o terminal tem 80×24 ou mais, **o sistema deve** manter todas as colunas e cards
  alcançáveis por navegação, sem exigir scroll horizontal; em largura ≥ 120, as colunas são lado a
  lado.
- **Critérios de aceite:**
  - [ ] Em 80×24 com 10 cards, todos os 10 títulos são alcançáveis por `j/k` (após navegar), e o
    cabeçalho da coluna corrente permanece visível.
  - [ ] Em 120×40, os cinco cabeçalhos de coluna aparecem simultaneamente.
  - [ ] Nenhuma cor literal e nenhum tom cru é usado no componente:
    `grep -rnE "#[0-9a-fA-F]{3,8}\b|RGBA\.from|theme\.hue|categorical" packages/tui/src/feature-plugins/squad`
    vazio. Cores vêm do tema por papel semântico: `text.feedback.error` só para erro e
    `text.feedback.warning` só para "desatualizado"; seleção usa `text.formfield`/`background.formfield`
    (estado `focused`); demais textos usam `text.base`/`text.muted`.
  - [ ] Status é transmitido por texto (e não só por cor), de modo que um terminal monocromático
    continue legível: `verified`, `failed`, `unknown` e os vereditos de liveness aparecem como
    palavras no frame.
- **Rastreia:** proposal §2 (itens 1, 2), A2
- **Notas:** diretriz "TUI Theme Tokens" do `AGENTS.md` da raiz (não de `packages/tui/AGENTS.md`, que
  trata do registro de experimentos); tokens em `packages/theme/src/tui/types.ts:25-50`. O layout
  estreito empilha colunas em vez de comprimir células.

## REQ-10 — Story com fixture e documentação de uso

- **Quando** um desenvolvedor abre a story ou a documentação, **o sistema deve** permitir explorar o
  board sem servidor e explicar o escopo somente leitura.
- **Critérios de aceite:**
  - [ ] A story renderiza o componente de produção com `PanelDocument` + `LivenessReport` estáticos,
    sem rede, e alterna os estados: normal, vazio, sem geração ativa, desatualizado, `403`, `404`,
    geração anterior, 200 cards; as teclas aparecem no `StoryFooter` e há comando de reset.
  - [ ] A story vive em `packages/tui/src/feature-plugins/system/storybook/squad-board.tsx`, é
    registrada no array `stories` de `storybook/index.tsx` e, como todo o storybook, só é carregada
    com `OPENCODE_STORY` (`packages/tui/src/plugin/builtins.ts:31-33`).
  - [ ] A seção "Sem painel próprio" de `packages/cli/README.md` (branch base, `:113-115`), que hoje
    afirma "Não existe tela de TUI ou de app para o painel", é atualizada para citar a rota
    `squad-board`, o comando `/squad-board`, as teclas, a frase "somente leitura" e as operações de
    escrita do base (`squad send`, `squad dispatch accept`).
  - [ ] Um teste de frame afirma que a ajuda contém "somente leitura".
- **Rastreia:** proposal §2 (itens 2, 6), §5
- **Notas:** a story é fixture-driven e local; nenhuma chamada ao servidor real. O padrão de stories
  do TUI está em `packages/tui/src/feature-plugins/system/storybook` (`AGENTS.md` raiz, "TUI Stories").

## Requisitos não funcionais do change (quando houver)

- **NFR-01 — Renderização limitada ao viewport.** Com 200 cards numa coluna, a view monta no máximo
  `altura_do_terminal + 4` renderables de card. Medição: teste estrutural em 80×24 que localiza cada
  card por id com `getRenderable("squad-card-<id>")` e conta os montados, no padrão de
  `packages/tui/test/session-mount-budget.test.tsx:98-101`; o card de índice 150 não está montado
  antes de navegar até ele. Contar títulos no `captureCharFrame()` **não** mede isso: o frame já é
  limitado à altura do terminal e passaria com 200 nós montados. (Estrutural, determinístico; sem
  medição de tempo.)
- **NFR-02 — Duas leituras por refresh.** Cada refresh executa exatamente duas chamadas
  (`panel`, `liveness`), independentemente do número de cards/sessões. Medição: cliente de teste que
  conta chamadas; o teste falha em `!== 2`. (Determinístico.)
- **NFR-03 — Nenhuma dependência nova.** `packages/tui/package.json` não ganha dependência; a view
  usa `@opencode/client`, `@opencode/schema`, `@opencode/plugin` e `@opentui/solid` já presentes.
  Medição: `git diff origin/dev...HEAD -- packages/tui/package.json` vazio, conferido em
  `/forge:verify`. (Verificável no diff.)
- **NFR-04 — Sem rede além do client.** Nenhum `fetch` direto; toda chamada passa pelo client gerado.
  Medição: `grep -rn "fetch(" packages/tui/src/feature-plugins/squad` vazio, conferido em
  `/forge:verify`, e o teste usa cliente de teste (sem rede). (Verificável.)

## Checklist de cobertura de superfície

| REQ | Parâmetro/config exposto | Superfície (tela/endpoint/CLI) | Coberto por task |
|---|---|---|---|
| REQ-01 | nenhum parâmetro de config; documento `PanelDocument` | tela TUI `squad-board` (board) | TASK-01, TASK-05 |
| REQ-02 | teclas `j k h l enter esc r ?` | tela TUI `squad-board` (keymap da rota) + comando `/squad-board` | TASK-06, TASK-10 |
| REQ-03 | seleção de card | tela TUI `squad-board` (detalhe) | TASK-07 |
| REQ-04 | nenhum parâmetro; `LivenessReport` | tela TUI `squad-board` (painel de sessões e detalhe) | TASK-02, TASK-08 |
| REQ-05 | tecla `r`; relógio injetado sobre `atualizadoEm` | tela TUI `squad-board` (rodapé) | TASK-03, TASK-04, TASK-05 |
| REQ-06 | nenhum parâmetro | tela TUI `squad-board` (estados 403/404/409/rede/sem geração) | TASK-04, TASK-05 |
| REQ-07 | nenhum parâmetro | ausência de superfície de escrita | TASK-06, TASK-11 |
| REQ-08 | nenhum parâmetro | allowlist de campos no frame | TASK-03, TASK-07, TASK-08, TASK-11 |
| REQ-09 | largura/altura do terminal | tela TUI `squad-board` (layout 80×24 e 120×40) | TASK-07, TASK-09 |
| REQ-10 | `OPENCODE_STORY` | story TUI + `packages/cli/README.md` | TASK-11 |

## Superfícies de API e dados

## Mapa endpoint → ação → recurso → policy

> Tabela de **consumo**: este change não cria nem altera endpoints. As rotas abaixo são do change
> `squad-orchestration` e são chamadas em modo leitura.

| Endpoint | Ação | Recurso | Policy | REQ |
|---|---|---|---|---|
| `GET /api/experimental/squad/panel` | read | documento de painel da geração ativa | middleware `Authorization` + `squad.enabled` (herdada do base) | REQ-01, REQ-03, REQ-07 |
| `GET /api/experimental/squad/liveness` | read | relatório de sessões/liveness da geração ativa | middleware `Authorization` + `squad.enabled` (herdada do base) | REQ-04, REQ-05, REQ-07 |

## Classificação de dados

| Dado/campo | Classificação (pii\|pan\|sensitive\|public) | Mascaramento | Fronteira de tokenização |
|---|---|---|---|
| `SessionStatus.location` (`Location.Ref`, `directory` absoluto) | sensitive | **não renderizado** pela view; presente só na resposta do servidor | não aplicável |
| `SessionStatus.sessionID` / `PreviousSession.sessionID` | sensitive | não mascarado (identificador operacional, como no base `requirements.md:373`); renderizado **apenas** no bloco da geração anterior (REQ-04) | não aplicável |
| `PanelCard.titulo` (`dispatch.scope`), `prioridade` (`dispatch.milestone`) | sensitive | renderizado verbatim; a redaction de segredo é do produtor na escrita (`squad_dispatch`, base `requirements.md:376`) | servidor do `squad` |
| `PanelCard.agente`, `refs`, `evidencias`, `bloqueio` | public (interno) | renderizado verbatim; `refs` contém branch/OID | não aplicável |
| `Stage.evidence.reference` | sensitive | renderizado verbatim; a redaction de segredo é do produtor (`squad`), não da view | servidor do `squad` |
| corpo de checkpoint / corpo de mensagem | sensitive | a view **não busca** esses dados (não há endpoint no caminho) | banco do servidor |
| credencial/token de provider | sensitive | a view **não busca** e não tem campo para exibir | `subscription-auth` |
| `kanban.json` exportado | public (interno) | não é lido pela view (ela usa a rota, não o arquivo) | não aplicável |

## Checklist de sinais OTel por boundary

> Este change não adiciona boundary de serviço; é cliente do boundary existente. As caixas ficam
> desmarcadas de propósito — nada aqui foi verificado.

- [ ] Nenhum span novo é criado pela view; o span HTTP existente do servidor cobre as duas chamadas.
- [ ] Nenhum log estruturado novo no servidor; a view não loga o documento.
- [ ] Nenhuma métrica nova; a contagem de chamadas é coberta por teste (NFR-02), não por telemetria.

## Mapa de eventos auditáveis

> A view não muta estado, portanto não produz evento auditável novo. Os eventos `squad.*` do change
> base continuam sendo a trilha das mutações — que esta view não executa.

| Mutação | Audit event | Payload (sem PII/PAN crua) | REQ |
|---|---|---|---|
| nenhuma (view somente leitura) | nenhum evento novo | — | REQ-07 |

## Fora de escopo (reafirmação)

- Mover card, atribuir agente, criar/aceitar despacho, editar, pausar/retomar (proposal §3).
- Endpoint, tabela, migration, config ou estado novo (proposal §3, A3, A4 — A4 sob decisão aberta
  DA-01, `design.md` §8).
- Embed de terminal/PTY, spawn de agente, worktree, multi-projeto (proposal §3, A7).
- Alterar o código ou os documentos de spec de `squad-orchestration`, ou o `kanban.json` (proposal §3).
  A única exceção é a seção "Sem painel próprio" de `packages/cli/README.md` (REQ-10), que se tornaria
  falsa com esta view.
- Cache em disco, histórico de navegação persistido, filtros salvos (v1.1, se houver demanda).
