# Tasks — squad-kanban-view

> Tasks do change `squad-kanban-view`, ordenadas por dependência. Formato de ID: `TASK-NN`
> (numeração contínua).
> Status: `[ ]` todo · `[-]` em progresso · `[X]` concluída · `[!]` bloqueada (exige intervenção humana).
> **Nada aqui foi implementado.** Todas as tasks estão `[ ]`; o change está em `proposed` e os gates
> HITL estão pendentes.
> Cada task é atômica (commit de vermelho + commit de implementação) e rastreia a um REQ/seção do
> design. `Teste (comando)` roda o arquivo de teste da própria task, de dentro de `packages/tui`
> (nunca da raiz), com o orçamento de CI da skill `tui-tests` (`bun test --timeout 30000 <arquivo>`).
> O Red é provado por execução em `/forge:implement`
> (`bash .forge/scripts/red-evidence.sh task --red <sha> --green <sha> --command "<comando>" --failure-pattern "<padrão>"`).
> **Convenção de vermelho (obrigatória):** o commit de vermelho traz o teste **e um stub de produção**
> do módulo novo, com a assinatura final e o comportamento errado declarado em "Stub do vermelho".
> Sem o stub, o teste falha com `Cannot find module`, que o classificador trata como `build-error`
> (`.forge/scripts/lib/red-classify.mjs:28`) e o motor reprova (`red-replay.mjs:1039`). Os padrões de
> falha abaixo seguem a saída real do `bun test` 1.4.4: `toBe` imprime `Expected: X` / `Received: Y`;
> `toContain` imprime `Expected to contain: "X"` / `Received: ...`; `toEqual` em array imprime um diff
> sem `Expected: [`, por isso não é usado como asserção de vermelho.
> Os padrões **não** foram exercitados por `red-evidence.sh` (não há código); a primeira TASK
> implementada deve rodar `record`+`replay` de amostra antes das demais, como pede
> `.forge/commands/specs/tasks.md:22`.
> **Pré-requisito de todas as tasks:** gate de entrada E1–E8 de `design.md` §1.3 (base merged em
> `origin/dev`, B1–B5 tratados, `/forge:analyze` PASS, `/forge:shard` executado). O worktree parte de
> `origin/dev` após o merge do base, nunca de `feature/squad-orchestration`.

## Wave 1 — Modelos puros de leitura

- [X] TASK-01 — Modelo do board: agrupar o documento por coluna, preservar ordem e expor `exigidos`/`desconhecido`/`progressa` (rastreia: REQ-01, design §2.2 (DD-02); paths: `packages/tui/src/feature-plugins/squad/board-model.ts`, `packages/tui/test/feature-plugins/squad-board-model.test.ts`; depende: —)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-board-model.test.ts`
  - Padrão de falha: `Expected: "backlog,in_progress,in_review,blocked,done"[\s\S]{0,200}Received: ""`
  - Stub do vermelho: `boardModel()` devolve `{ columns: [], empty: true }`; a asserção é `expect(model.columns.map((column) => column.id).join(",")).toBe("backlog,in_progress,in_review,blocked,done")`.
  - Notas: fixture tipada por `SquadPanelDocument` com 5 colunas e 3 cards; a ordem dos cards é a do documento (nenhuma ordenação local); `cards{}` vazio devolve estado vazio; `progressa: false` com `desconhecido` não vazio marca o selo (REQ-01 crit. 3). Não importa renderer nem client. A faixa "coluna desconhecida" depende de DA-06.

- [X] TASK-02 — Modelo de sessões: projetar o relatório em linhas com veredito, `cause`, flags e geração anterior (rastreia: REQ-04, design §2.3 (DD-03); paths: `packages/tui/src/feature-plugins/squad/session-model.ts`, `packages/tui/test/feature-plugins/squad-session-model.test.ts`; depende: —)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-session-model.test.ts`
  - Padrão de falha: `Expected: "presumed_dead"[\s\S]{0,200}Received: "idle"`
  - Stub do vermelho: `sessionRows()` mapeia todo veredito para `"idle"` (o defeito que REQ-04 proíbe).
  - Notas: fixture com `presumed_dead` + `cause` e `stalled`; `lastActivity`/`source`/`cause` ausentes viram `null` (a UI mostra "—"), nunca `Date.now()`; `unknown` não é convertido em `idle`; `inboxPending` vira `inbox: <n>`; fixture `verdict: "working"` com `cause` contendo "dead" continua `working` (REQ-04 crit. 4); `previous` vira bloco separado com `name`, `sessionID` e `closed`; `findSession(rows, card.agente)` devolve `undefined` sem correspondência (REQ-04 crit. 5).

- [X] TASK-03 — Allowlist e formatação de campos: nunca expor `location`, corpo, credencial ou token; formatar instantes e idade (rastreia: REQ-08, REQ-05, design §2.6 (DD-06), §2.4 (DD-04); paths: `packages/tui/src/feature-plugins/squad/render-fields.ts`, `packages/tui/test/feature-plugins/squad-render-fields.test.ts`; depende: —)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-render-fields.test.ts`
  - Padrão de falha: `Expected: -1[\s\S]{0,200}Received: [0-9]+`
  - Stub do vermelho: `renderSession()` devolve `JSON.stringify(session)` (o conserto ingênuo que vaza tudo); a asserção é `expect(text.indexOf("/Users")).toBe(-1)`.
  - Notas: a fixture inclui `location: { directory: "/Users/segredo/worktree" }`, `body`, `credential`, `token`; cada campo proibido é verificado com `indexOf(...) === -1`. `evidence.reference` é renderizado verbatim (decisão registrada no teste). `formatAge(atualizadoEm, now)` com `now = atualizadoEm + 90_000` devolve `"1 min"` (REQ-05 crit. 1); instantes em ms são formatados em ISO-8601 com `Z`. Controle negativo: com `location` fora da fixture o teste continua verde (a asserção não depende do campo existir).

## Wave 2 — Dados

- [X] TASK-04 — Hook de leitura concorrente: `panel` + `liveness`, falha parcial, último documento, `staleSince` e estados de erro (rastreia: REQ-05, REQ-06, design §2.4 (DD-04), §2.1 (DD-01); paths: `packages/tui/src/feature-plugins/squad/use-squad-board.ts`, `packages/tui/test/feature-plugins/squad-use-board.test.ts`; depende: TASK-01, TASK-02)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-use-board.test.ts`
  - Padrão de falha: `Expected: 2[\s\S]{0,200}Received: 1`
  - Stub do vermelho: o hook chama só `port.panel()`; a asserção é `expect(calls.length).toBe(2)` após um refresh.
  - Notas: porta de leitura injetada `{ panel, liveness }` com contador e relógio `now` injetado; cada refresh faz exatamente 2 leituras (NFR-02); sucesso→falha mantém o documento e marca `staleSince`; falha de `panel` não apaga `liveness` e vice-versa; `ForbiddenError`→`disabled`, `ClientError` `UnexpectedStatus` 404→`unavailable`, `ConflictError`→`failed` com mensagem verbatim, `Transport`/503→`failed("servidor indisponível")`; `generation: null` + `cards{}` vazio → "nenhuma geração ativa"; cleanup no unmount; nenhum `setInterval`; nenhum `context.storage` (REQ-07 crit. 3).

## Wave 3 — Componentes

- [X] TASK-05 — Board: colunas, cards, selo "sem progresso", rodapé de frescor e estados loading/vazio/sem geração/403/404/409/rede (rastreia: REQ-01, REQ-05, REQ-06, design §2.2 (DD-02), §2.4 (DD-04); paths: `packages/tui/src/feature-plugins/squad/board.tsx`, `packages/tui/test/feature-plugins/squad-board.test.tsx`; depende: TASK-03, TASK-04)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-board.test.tsx`
  - Padrão de falha: `Expected to contain: "in_review"[\s\S]{0,200}Received:`
  - Stub do vermelho: `Board` renderiza um `<box />` vazio.
  - Notas: `testRender(..., { width: 120, height: 40 })` sem `start()`, `renderOnce()` e `captureCharFrame()`; fixture de 5 colunas e 3 cards; `progressa: false` mostra o selo e nenhuma barra; `cards{}` vazio mostra "nenhum card"; `generation: null` mostra "nenhuma geração ativa"; `403` contém `squad.enabled`; `404` contém "squad indisponível"; `409` mostra a mensagem do servidor; primeira carga mostra o estado `loading` (`rules/testing/change-test-contract.md`); rodapé mostra `revisao` e a idade com relógio injetado; após refresh com falha, selo "desatualizado"; nenhum frame contém `/Users`.

- [X] TASK-06 — Navegação de rota: `j/k/h/l/enter/esc/r/?`, clamp, ajuda "somente leitura" e guarda de escrita (rastreia: REQ-02, REQ-07, design §2.1 (DD-01), §2.5 (DD-05), §2.8 (DD-08); paths: `packages/tui/src/feature-plugins/squad/board-keys.ts`, `packages/tui/src/feature-plugins/squad/board.tsx`, `packages/tui/test/feature-plugins/squad-board-keys.test.tsx`; depende: TASK-05)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-board-keys.test.tsx`
  - Padrão de falha: `Expected: "card-2"[\s\S]{0,200}Received: "card-1"`
  - Stub do vermelho: `boardKeys()` devolve camada sem comandos; a asserção é `expect(focusedCardID()).toBe("card-2")` após `pressKey("j")`.
  - Notas: renderer com `kittyKeyboard: true` e `mockInput` (skill `tui-tests`); `j` na última posição não passa do limite; `h` na primeira coluna não vai para a anterior; `r` faz exatamente 2 leituras; `?` mostra "somente leitura". **Guarda de invariante (não é o vermelho):** cliente de teste com a superfície completa de `client.experimental.squad` (`design.md` §4.1) em que cada operação de escrita lança e registra; após todas as teclas, `expect(writes).toEqual([])` e operações chamadas ⊆ `{ panel, liveness }` (REQ-02 crit. 2, REQ-07 crit. 2). Esse teste passa antes da implementação por construção e não serve de Red.

- [X] TASK-07 — Detalhe do card: cinco estágios, `source`, evidência ou "sem evidência", `exigidos` e `desconhecido` (rastreia: REQ-03, REQ-08, REQ-09, design §2.2 (DD-02), §2.6 (DD-06), §2.7 (DD-07); paths: `packages/tui/src/feature-plugins/squad/card-detail.tsx`, `packages/tui/test/feature-plugins/squad-card-detail.test.tsx`; depende: TASK-05)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-card-detail.test.tsx`
  - Padrão de falha: `Expected to contain: "sem evidência"[\s\S]{0,200}Received:`
  - Stub do vermelho: `CardDetail` renderiza só o título do card.
  - Notas: fixture com `ci=verified`, `merge=unknown` exigido, `deploy=unknown` com `source: "none"` não exigido e `acceptance=verified`; `unknown` aparece como "unknown", nunca "ok"/"idle"; estágio não exigido mostra "não exigido" + `source` verbatim; `desconhecido[]` exibido verbatim; `progressa: false` não desenha barra; `evidence.reference` verbatim; `at` em ISO-8601 com `Z`; os status aparecem como palavras (REQ-09 crit. 4); fixture com `location: { directory: "/Users/segredo/worktree" }` não vaza no frame (REQ-08 crit. 1).

- [X] TASK-08 — Painel de sessões: liveness, `cause`, `inboxPending`, geração anterior e vínculo card→sessão (rastreia: REQ-04, REQ-08, design §2.3 (DD-03); paths: `packages/tui/src/feature-plugins/squad/sessions.tsx`, `packages/tui/test/feature-plugins/squad-sessions.test.tsx`; depende: TASK-04)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-sessions.test.tsx`
  - Padrão de falha: `Expected to contain: "presumed_dead"[\s\S]{0,200}Received:`
  - Stub do vermelho: `Sessions` renderiza só os nomes.
  - Notas: renderiza `presumed_dead` e `stalled` distintos, `cause` da primeira, `inbox: <n>`; `lastActivity` ausente mostra "—"; geração anterior em bloco separado com `closedAt`/`closedBy` e `sessionID`; `card.agente` sem sessão correspondente mostra "sessão não encontrada nesta geração"; nenhum frame contém `/Users` (fixture com `location` no formato `Location.Ref`).

- [X] TASK-09 — Layout responsivo e janela de montagem: 80×24 empilhado, 120×40 em colunas, `viewport + 4`, tokens (rastreia: REQ-09, NFR-01, design §2.7 (DD-07), §2.2 (DD-02); paths: `packages/tui/src/feature-plugins/squad/layout.ts`, `packages/tui/src/feature-plugins/squad/board.tsx`, `packages/tui/test/feature-plugins/squad-layout.test.tsx`; depende: TASK-05)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-layout.test.tsx`
  - Padrão de falha: `Expected: 5[\s\S]{0,200}Received: 1`
  - Stub do vermelho: `mode()` devolve sempre `"stacked"`; a asserção conta cabeçalhos visíveis em 120×40 com `toBe(5)`.
  - Notas: em 120×40, cinco cabeçalhos no frame; em 80×24 com 10 cards, todos os títulos são alcançáveis por `j` e o cabeçalho corrente permanece visível; com 200 cards numa coluna em 80×24, `getRenderable("squad-card-<id>")` conta no máximo 28 cards montados e o de índice 150 não está montado (NFR-01, padrão de `test/session-mount-budget.test.tsx:98-101`) — contar títulos no frame não serve, o frame já é limitado à altura. Verificação estática de tokens (REQ-09 crit. 3): `grep -rnE "#[0-9a-fA-F]{3,8}\b|RGBA\.from|theme\.hue|categorical" src/feature-plugins/squad` vazio.

## Wave 4 — Registro, story e documentação

- [X] TASK-10 — Registrar o builtin, a rota `squad-board` e o comando de paleta/slash, sem `bind` global (rastreia: REQ-02, design §2.8 (DD-08); paths: `packages/tui/src/feature-plugins/squad/index.tsx`, `packages/tui/src/plugin/builtins.ts`, `packages/tui/test/feature-plugins/squad-plugin.test.tsx`; depende: TASK-06, TASK-07, TASK-08, TASK-09)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-plugin.test.tsx`
  - Padrão de falha: `Expected: true[\s\S]{0,200}Received: false`
  - Stub do vermelho: `index.tsx` exporta `Plugin.define({ id: "opencode.squad-board", setup() {} })` sem registrar rota; a asserção é `expect(builtins.includes(SquadBoard) && routeRegistered("squad-board")).toBe(true)`.
  - Notas: `setup` registra a rota `squad-board` e, num `context.ui.slot({ append: "app" })` com camada `mode: "global"`, o comando `squad.board.open` (`slash: { name: "squad-board" }`, `palette: true`, sem `bind`), como `stats.tsx:190-215`; o teste afirma que nenhuma camada global do plugin declara `bind`; `builtins.ts` importa e adiciona o plugin; a remoção do builtin desliga a view (rollback). Se o teste precisar do app inteiro, usar `createAppFixture` com `config: { animations: false }` (custo de import a frio documentado na skill `tui-tests`).

- [X] TASK-11 — Story fixture-driven, documentação e guardas estáticas de "somente leitura" (rastreia: REQ-10, REQ-07, REQ-08, design §2.9 (DD-09), §2.5 (DD-05), §4.4; paths: `packages/tui/src/feature-plugins/system/storybook/squad-board.tsx`, `packages/tui/src/feature-plugins/system/storybook/index.tsx`, `packages/cli/README.md`, `packages/tui/test/feature-plugins/squad-story.test.tsx`; depende: TASK-10)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/feature-plugins/squad-story.test.tsx`
  - Padrão de falha: `Expected to contain: "somente leitura"[\s\S]{0,200}Received:`
  - Stub do vermelho: `squadBoardStory.render` devolve só o `StoryFooter`.
  - Notas: a story renderiza o componente de produção e alterna normal, vazio, sem geração ativa, desatualizado, `403`, `404`, geração anterior e 200 cards, com reset, sem rede; é adicionada ao array `stories` de `storybook/index.tsx` (carregada só com `OPENCODE_STORY`, `builtins.ts:31-33`); o teste de frame afirma "somente leitura" na ajuda. A seção "Sem painel próprio" de `packages/cli/README.md` é reescrita para citar a rota, o comando, as teclas, "somente leitura" e `squad send`/`squad dispatch accept`. Guardas estáticas conferidas em `/forge:verify` (REQ-07 crit. 1, 3, 4; REQ-08 crit. 4; NFR-03; NFR-04): `git diff --name-only origin/dev...HEAD` só com os paths de REQ-07 crit. 1; `grep -rnE "context\.storage|Bun\.write|writeFile|@opencode/(core|server)|console\.|JSON\.stringify|fetch\(" packages/tui/src/feature-plugins/squad` vazio; `git diff origin/dev...HEAD -- packages/tui/package.json` vazio.

## Rastreabilidade

| REQ / Design § | Critérios cobertos (ordinais de requirements.md) | Tasks |
|---|---|---|
| REQ-01 | 1, 2, 3, 4 | TASK-01, TASK-05 |
| REQ-02 | 1, 2, 3, 4 | TASK-06 (1, 2, 4), TASK-10 (3) |
| REQ-03 | 1, 2, 3, 4 (4 parcial: DA-04) | TASK-07 |
| REQ-04 | 1, 2, 3, 4, 5 | TASK-02, TASK-08 |
| REQ-05 | 1, 2, 3, 4 | TASK-03 (1), TASK-04 (2, 3, 4), TASK-05 (1, 2) |
| REQ-06 | 1, 2, 3, 4, 5, 6 | TASK-04, TASK-05 |
| REQ-07 | 1, 2, 3, 4 | TASK-06 (2), TASK-11 (1, 3, 4 — guarda estática em `/forge:verify`) |
| REQ-08 | 1, 2, 3, 4 | TASK-03 (1, 2, 3), TASK-07 (1, 3), TASK-08 (1), TASK-11 (4) |
| REQ-09 | 1, 2, 3, 4 | TASK-09 (1, 2, 3), TASK-07 (4) |
| REQ-10 | 1, 2, 3, 4 | TASK-11 |
| NFR-01 | renderables de card montados ≤ viewport + 4 | TASK-09 |
| NFR-02 | exatamente 2 leituras por refresh | TASK-04, TASK-06 |
| NFR-03 | `package.json` sem dependência nova | TASK-11 (guarda em `/forge:verify`) |
| NFR-04 | nenhum `fetch` direto | TASK-11 (guarda em `/forge:verify`) |
| design §1.3 | gate de entrada E1–E8 | — (pré-requisito, não task de código) |
| design §2.1 (DD-01) | composição hook/modelos/componentes | TASK-01, TASK-02, TASK-04, TASK-05, TASK-06 |
| design §2.2 (DD-02) | agrupamento, ordem, janela | TASK-01, TASK-05, TASK-07, TASK-09 |
| design §2.3 (DD-03) | sessões, liveness, vínculo por nome | TASK-02, TASK-08 |
| design §2.4 (DD-04) | estados, falha parcial, frescor | TASK-03, TASK-04, TASK-05 |
| design §2.5 (DD-05) | nenhuma escrita | TASK-06, TASK-11 |
| design §2.6 (DD-06) | allowlist de campos | TASK-03, TASK-07 |
| design §2.7 (DD-07) | layout e tema | TASK-07, TASK-09 |
| design §2.8 (DD-08) | registro e keymap de rota | TASK-06, TASK-10 |
| design §2.9 (DD-09) | story offline | TASK-11 |

## Nota sobre tasks documentais e guardas

TASK-11 inclui documentação (`packages/cli/README.md`), mas **não é puramente documental**: a story
é um componente executável com asserção de frame ("somente leitura"). As guardas de "zero escrita"
(TASK-06) e as verificações estáticas (TASK-11) são **invariantes**, não vermelhos: passariam antes da
implementação e por isso não são o `Padrão de falha` de nenhuma task. Não há `[X]`,
`verification.yaml` nem evidência de implementação neste change.
