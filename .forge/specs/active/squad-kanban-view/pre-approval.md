---
date: 2026-11-06
change: squad-kanban-view
reviewer: subagente adversarial (Claude Opus 5.5) — não é aprovação humana
scope: proposal, requirements, design, tasks, spec-delta, traceability, analysis, manifest, approvals; confrontados com feature/squad-orchestration@da634f4185 (worktree .forge/worktrees/squad-orchestration), packages/tui e packages/plugin do checkout atual (forgecode-rebrand), harness .forge/
verdict:
  requirements_reviewed: PRÉ-APROVADO COM RESSALVAS
  design_reviewed: NÃO PRÉ-APROVADO
  tasks_reviewed: NÃO PRÉ-APROVADO
---

# Parecer de pré-aprovação — squad-kanban-view

> Parecer de agente. Não altera gates: `manifest.yaml` mantém os cinco gates `false` e
> `approvals.yaml` mantém `approvals: []`. Nada foi implementado, executado em código ou medido.
> "OK" do `validate-spec.sh` é estrutural, não prova de aptidão.

## 1. Veredito por gate

### `requirements_reviewed` — PRÉ-APROVADO COM RESSALVAS

Os dez REQ agora citam o contrato real, têm critérios observáveis e rastreiam para tasks. Ressalvas que
o humano precisa aceitar ou resolver antes de aprovar:

1. **REQ-03 crit. 4** cobre só `progressa: false`; o caso `true` depende de DA-04 (hoje inalcançável).
2. **REQ-01 crit. 3** descreve um selo que aparece em 100% dos cards reais (DA-03).
3. **Fora de escopo "nenhuma config nova"** depende de DA-01 (`packages/tui/AGENTS.md`).
4. **REQ-10 crit. 3** altera `packages/cli/README.md`, documento entregue pelo base; o requisito do
   baseline do base continua contraditório (DA-08).

### `design_reviewed` — NÃO PRÉ-APROVADO

Bloqueadores:

1. **KV-B01 (condição aberta):** o design consome um contrato que não está em `origin/dev` e pode
   mudar antes do merge (E1, E6 de `design.md` §1.3). Aprovar agora é aprovar sobre contrato não
   congelado — exatamente o erro M3 do parecer do base ("aprovação desatualizada por construção").
2. **KV-H06 / DA-01:** conflito não resolvido com `packages/tui/AGENTS.md` ("Temporary, opt-in UI
   experiments belong in the `experiments` registry ... gated by the matching `config.experimental`
   key"). Pela precedência de `FORGE.md` §2.1, não se "registra e segue".
3. **KV-H07 / DA-08:** o archive deste change produziria um baseline que afirma e nega superfície de
   TUI para o painel ao mesmo tempo.

### `tasks_reviewed` — NÃO PRÉ-APROVADO

Bloqueadores:

1. **KV-B01:** nenhuma task é executável hoje (os imports não existem em `origin/dev`).
2. **Padrões de falha não validados contra o motor.** `.forge/commands/specs/tasks.md:22` exige que
   `Teste (comando)`/`Padrão de falha` sejam validados contra o motor antes do gate. Os padrões foram
   corrigidos para o formato real do `bun test` 1.4.4 (verificado com um teste descartável fora do
   repositório) e para a convenção de stub, mas **não foram exercitados** por
   `red-evidence.sh task` — impossível sem código. Fica como condição da primeira TASK.
3. Dependência de DA-03/04/06/07, que mudam o conteúdo de TASK-01, TASK-04, TASK-05 e TASK-07.

## 2. Pré-condições de entrada em `/forge:implement`

Todas verificáveis; tabela completa em `design.md` §1.3.

| # | Condição | Comando | Esperado | Hoje |
|---|---|---|---|---|
| E1 | base merged em `origin/dev` | `git fetch origin && git grep -n '"squad.panel"' origin/dev -- packages/protocol/src/groups/squad.ts` | 1 linha | **falha** (`git merge-base --is-ancestor feature/squad-orchestration origin/dev` → exit 1; 205 commits à frente) |
| E2 | B1 resolvido | `grep -nE "^status:\|implementation_verified" .forge/specs/active/squad-orchestration/manifest.yaml` | `verified`/`archived` e `true` | **falha** (`status: implemented`, `implementation_verified: false`) |
| E3 | B2 resolvido | `grep -h '"dirty"' .forge/specs/active/squad-orchestration/evidence/runs/*/run-manifest.json` | `"dirty": false` | não verificado aqui |
| E4 | B3 decidido | registro nominal no `approvals.yaml` do base ou no PR | decisão humana | aberto |
| E5 | B4 e B5 resolvidos ou aceitos | `grep -n "B4\|B5" .forge/specs/active/squad-orchestration/approvals.yaml` | resolução ou aceite nominal | aberto |
| E6 | contrato congelado | `git diff da634f4185 origin/dev -- packages/schema/src/squad.ts packages/protocol/src/groups/squad.ts` | vazio | não aplicável até E1 |
| E7 | `/forge:analyze` e `/forge:shard` | `grep -n "^## Status" .forge/specs/active/squad-kanban-view/analysis.md`; `grep -n sharded .forge/specs/active/squad-kanban-view/manifest.yaml` | `PASS`; `true` | `FAIL` (revisão manual); `false` |
| E8 | impacto com o código real no grafo | `bash .forge/scripts/graph.sh` e `bash .forge/scripts/impact.sh --change squad-kanban-view` | `graph_fingerprint` novo | `impact.json` existe, mas `grep -c squad .forge/graph/graph.json` → 0 |
| E9 | estratégia de base branch | `git -C .forge/worktrees/squad-kanban-view merge-base --is-ancestor origin/dev HEAD && ! git -C .forge/worktrees/squad-kanban-view merge-base --is-ancestor feature/squad-orchestration HEAD` | worktree parte de `origin/dev` pós-merge (após o merge o segundo teste é trivialmente verdadeiro; o que importa é não conter commits fora do PR do base) | worktree não existe |
| E10 | decisões DA-01..DA-08 registradas | `approvals.yaml` ou emenda nos artefatos | 8 decisões nominais | abertas |

## 3. Achados da Parte 1

Contagem: **2 BLOCKER, 10 HIGH, 11 MEDIUM, 7 LOW = 30**. Corrigidos nos artefatos: **19**. Abertos: **11**.

### BLOCKER

**KV-B01 — Dependência de código não integrada sem estratégia de base branch nem gate verificável.** *Aberto (condição externa); documento corrigido.*
- Afirmação: "a implementação deste change só começa depois do merge do base" (design §1.3 antigo); B1–B5 apenas citados.
- Evidência: `git merge-base --is-ancestor HEAD origin/dev` no worktree do base → rc 1; `git rev-list --count origin/dev..HEAD` → 205; `git diff --name-only origin/dev...HEAD | wc -l` → 213, `| grep -vc squad` → 110. O manifesto não declarava de qual branch o worktree partiria.
- Por que falha: partir de `origin/dev` não compila; partir de `feature/squad-orchestration` herda 110 arquivos de outras features e torna REQ-07 inverificável. "Depois do merge" sem comando não é gate.
- Correção: `design.md` §1.3 (estratégia + E1–E8), comentário em `manifest.yaml`, `tasks.md` cabeçalho, proposal §5.

**KV-B02 — Os vermelhos declarados não eram executáveis pelo motor.** *Corrigido.*
- Afirmação: cada TASK "declara teste que falha antes e passa depois" (design §1.2 antigo).
- Evidência: (a) módulo novo sem stub → `Cannot find module` = `build-error` (`.forge/scripts/lib/red-classify.mjs:28`), reprovado por `red-replay.mjs:1039`; (b) teste descartável com `bun test` 1.4.4: `expect([]).toEqual([...])` imprime diff (`- Expected  - 4` / `+ Received  + 1`), nunca `Expected: [`, logo o padrão de TASK-01 `Expected: \["backlog",...\][\s\S]*Received: \[\]` jamais casaria; (c) o vermelho de TASK-06 era "contador de escritas = 0", que passa antes da implementação.
- Correção: `tasks.md` — convenção de stub, "Stub do vermelho" por task, padrões reescritos para `toBe`/`toContain`, guarda de escrita separada do Red, comando `bun test --timeout 30000` (skill `tui-tests`).

### HIGH

**KV-H01 — Tipo do valor consumido errado.** *Corrigido.* Design §4.1 dizia resposta `{data: Squad.PanelDocument}`. O client desembrulha `data` e devolve `SquadPanelDocument` com `atualizadoEm: number` (`packages/client/src/promise/generated/client.ts:1727-1737`, `types.ts:2460-2467`); `Squad.PanelDocument` decodifica para `DateTime.Utc`. O próprio `panel show` do base consome o formato codificado (`panel-show.ts:16-20`). Correção: requirements (cabeçalho), design §1.1/§4.1/§4.2.

**KV-H02 — `location` não é string.** *Corrigido.* REQ-08 usava `location: "/Users/segredo/worktree"`; o tipo é `Location.Ref = { directory, workspaceID? }` (`schema/src/location.ts:8-12`, `squad.ts:343`). A fixture não tipava e o teste de vazamento provaria o formato errado. Correção: REQ-08, TASK-03/07/08, SCN-KANBAN-008-A, classificação.

**KV-H03 — Guarda de escrita contra métodos inexistentes.** *Corrigido.* O "cliente falso que lança em `post/patch/put/delete`" testa uma superfície que o client não tem: ele expõe operações nomeadas (`client.ts:1438-1740`: `session.send`, `dispatch.accept`, ...). O teste passaria sempre. Correção: REQ-02 crit. 2, REQ-07 crit. 2, DD-05, design §4.1 (lista completa), TASK-06.

**KV-H04 — NFR-01 tautológico.** *Corrigido.* "O frame não contém mais de `altura + 4` títulos" é sempre verdadeiro: `captureCharFrame()` já é limitado à altura do terminal, mesmo com 200 nós montados. Precedente correto: `getRenderable(id)` em `packages/tui/test/session-mount-budget.test.tsx:98-101`. Correção: NFR-01, DD-02, TASK-09.

**KV-H05 — REQ-07 crit. 1 contradito pelas próprias tasks.** *Corrigido.* "O único arquivo fora de `feature-plugins/squad` é `builtins.ts`", mas TASK-11 altera `storybook/index.tsx` e REQ-10 exige documentação; `affected_paths` não tinha o storybook. Correção: REQ-07 crit. 1, SCN-KANBAN-007-A, manifest, proposal §4.

**KV-H06 — Norma citada no lugar errado e norma real não tratada.** *Aberto (DA-01); citação corrigida.* Design §1.2 atribuía tokens e stories a `packages/tui/AGENTS.md`; esse arquivo trata só do registro de experimentos ("Temporary, opt-in UI experiments belong in the `experiments` registry in `src/component/dialog-experiments.tsx`, with behavior gated by the matching `config.experimental` key"). As regras de tokens/stories estão no `AGENTS.md` da raiz. A view é opt-in sobre API experimental e DD-08 recusa chave de config. Correção: design §1.2, §2.8, §8; proposal A4.

**KV-H07 — Contradição com o baseline e a documentação do base.** *Aberto (DA-08); README incluído.* Base `requirements.md:210`: "Não existe superfície de TUI/app própria"; `packages/cli/README.md:113-115` (base): "Não existe tela de TUI ou de app para o painel". A proposal dizia "nenhuma alteração em `squad-orchestration`". Correção: REQ-10 crit. 3 (README), design §4.4/§8, spec-delta (comentário), proposal §3. O `modify_requirement` sobre REQ-SQUAD-017 é decisão humana.

**KV-H08 — Semântica de `desconhecido`/`progressa` errada.** *Aberto (DA-03, DA-04); semântica corrigida.* `deploy` é sempre `unknown("none")` (`panel.ts:70`); `desconhecido` = todo estágio `unknown`, exigido ou não (`panel.ts:73,98`); `progressa` é sempre `false` (`panel.test.ts:149-151`). REQ-03 crit. 3 dizia que só o exigido entra em `desconhecido` e rotulava o não exigido "sem fonte" (há `source` como `jira_command: snapshot is not newer...`); REQ-03 crit. 4 usava "pode desenhar barra" (não testável). Correção: REQ-01 nota, REQ-03 crit. 3/4, TASK-07, design §4.2.

**KV-H09 — Erro declarado não tratado e escopo fantasma.** *Corrigido.* As duas rotas declaram `ConflictError` 409 (`protocol/src/groups/squad.ts:257-268,395-406`; client `declaredStatuses: [400, 401, 403, 409, 503]`); REQ-06 não o tratava. Proposal §2 item 6 prometia "geração inexistente" sem critério; sem geração o painel devolve `cards: {}` (`dispatch.ts:231`) e o liveness `generation: null` (`status.ts:61`). O `404` não é declarado e chega como `ClientError("UnexpectedStatus")` (`client.ts:439-446`); "versão do servidor" não está disponível ao plugin (`context.app.version` é do cliente, `plugin/src/tui/context.ts:264-267`). Correção: REQ-06 crit. 2/3/5/6, DD-04, TASK-04/05, SCN-KANBAN-006-C.

**KV-H10 — `analysis.md` se apresentava como saída de `/forge:analyze`.** *Aberto (execução pendente); texto corrigido.* Formato fora de `.forge/commands/specs/analyze.md` (sem `## Status`, sem `## Revisão`); afirmava "Nenhum critério depende de adjetivo" (havia "em destaque", "sinalizado", "pode") e "Não é `impact.json`: não há análise de impacto porque não há código" — `impact.sh --change` roda sobre `affected_paths` (rc 0). Pré-condição de `/forge:analyze` é `tasks-ready`. Correção: `analysis.md` reescrito, Status FAIL, natureza declarada.

### MEDIUM

**KV-M01 — Rastreabilidade numérica divergente.** *Corrigido.* Antes: REQ-02 → checklist {06}, tasks {06,10}; REQ-06 → {05} × {04,05}; REQ-07 → {03,11} × {03,06,11}; REQ-10 → {10} × {10,11}; TASK-03 e TASK-06 listadas sob REQ-07 sem rastreá-lo; TASK-09 sob REQ-05 sem cobrir nada de REQ-05; "1, 2, 3, 4" carimbado em todo REQ; NFR-03/04 mapeados a tasks que não os mencionam; `traceability.yaml` sem §4.2 (REQ-01), §2.1 (REQ-02), §4.4 (REQ-07) que o design §7 cita. Contagem final: 10 REQ = 10 `REQ-KANBAN` = 10 entradas em `traceability.yaml` = 10 linhas no design §7 e no tasks; DD-01..09 definidas e todas citadas; TASK-01..11 definidas e todas citadas; NFR-01..04 com task.

**KV-M02 — Critérios sem task.** *Corrigido.* REQ-05 crit. 1 (rodapé), REQ-04 crit. 4, REQ-07 crit. 1/3/4, REQ-08 crit. 4, REQ-09 crit. 4, REQ-10 crit. 3 (sem path de documentação) e o estado `loading` exigido por `rules/testing/change-test-contract.md` não tinham task. Correção: TASK-02/03/05/07/11.

**KV-M03 — DD-03 introduzia vínculo card→sessão sem REQ e o descrevia mal.** *Corrigido.* "best-effort" era impreciso: `card.agente = dispatch.owner` (`panel.ts:85`), `SessionName` da geração ativa (`dispatch.ts:226-239`; `status.ts:35-37`). Correção: REQ-04 crit. 5, DD-03, R8.

**KV-M04 — "Nenhum atalho global" × comando de paleta.** *Corrigido.* O padrão real registra o comando numa camada `mode: "global"` (`stats.tsx:190-215`). REQ-02 crit. 3 agora proíbe `bind` global, não a camada.

**KV-M05 — Tokens de tema.** *Corrigido.* DD-07 usava `background` para seleção; o `AGENTS.md` manda `formfield` para marcadores de seleção. `text.feedback` é um struct `{error, warning, success, info}` (`theme/src/tui/types.ts:37,48`). Faltava a proibição de `theme.hue`. Correção: REQ-09 crit. 3, DD-07.

**KV-M06 — Frescor mal descrito e não determinístico.** *Aberto (DA-05); corrigido no documento.* O documento é montado por requisição com `Date.now()` do servidor (`panel.ts:37-42`); `revisao` é hash de 12 hex (`panel.ts:41`); "recalculada a cada render" sem timer significa idade congelada até a próxima tecla; não havia relógio injetável (skill `tui-tests`: "inject a clock first"). Correção: REQ-05 crit. 1 e notas, P2, DD-04, TASK-03/04/05.

**KV-M07 — Custo de servidor por refresh ignorado.** *Aberto (DA-07).* Cada `panel` roda, por card, `jira_command`/`ci_command` e ancestralidade git (`panel.ts:55-72`, concorrência 4; M4 do base). "Duas leituras" é verdade em HTTP, não em custo. Correção: design §4.2, R10.

**KV-M08 — Classificação de dados contraditória.** *Corrigido.* `titulo`/`prioridade` vêm de `dispatch.scope`/`milestone`, `sensitive` no base (`requirements.md:376`), mas eram `public`; `sessionID` era "não renderizado no board" enquanto REQ-04 crit. 3 o renderiza, e citava um "detalhe da sessão" que não existe. Correção: tabela de classificação, DD-06.

**KV-M09 — Valor sobre `squad panel show` não medido.** *Aberto (DA-02).* `formatPanel` (`cli/src/commands/squad.ts:139-148`) já dá contagem por coluna e lista de `progressa: false`; `--json` dá estágios; `squad status` dá liveness. O ganho de v1 é navegação + evidência + liveness na mesma tela. A escolha da superfície é argumento, não evidência; o change é honesto sobre isso (proposal §1), mas o valor marginal é menor do que a proposal sugere porque `progressa` não discrimina cards. Correção: nota de valor em design §3.

**KV-M10 — Critérios adjetivos.** *Corrigido.* "em destaque" → rótulo "exigido"; "sinalizado" → `inbox: <n>`; "versão do servidor, quando disponível" → `context.app.version`; "pode desenhar barra" → DA-04; "succeeded" (inglês na prosa) corrigido.

**KV-M11 — Impacto com grafo sem o código do base.** *Aberto (E8).* `impact.sh --change squad-kanban-view` → "OK impact: 7 seed(s) -> 71 impacted", rc 0 (após atualizar `affected_paths`; antes, 6 seeds). Limitações: `grep -c squad .forge/graph/graph.json` → 0; os seeds de `packages/tui/test/feature-plugins` são testes existentes não relacionados, que inflam o resultado; `packages/cli/README.md` não é nó do grafo. `impact.json` mantido como gerado.

### LOW

- **KV-L01** *Corrigido.* Branch `squad-kanban-view` (proposal) × `feature/<id>` (`FORGE.md` §3.4) × `<tipo>/<escopo>/<desc>` (`rules/conventions/git-worktree.md:31`) × "sem barra" (`AGENTS.md`). Adotado `feature/squad-kanban-view` como o base; drift registrado.
- **KV-L02** *Corrigido.* `dependencies.code` listava `packages/schema/src/squad-kanban.ts` (adaptador snake_case do `kanban.json`, não consumido) e omitia client e `plugin/src/tui/context.ts`.
- **KV-L03** *Aberto.* Modo `minimal` (<80 colunas) de DD-07 sem critério de aceite.
- **KV-L04** *Aberto (DA-06).* Faixa "coluna desconhecida" revalida um literal fechado do contrato, contra o Style Guide.
- **KV-L05** *Corrigido.* `bun run test` aplica `--only-failures` (`packages/tui/package.json:9`), que esconde o tempo por teste; a skill `tui-tests` recomenda `bun test --timeout 30000 test/<arquivo>`.
- **KV-L06** *Corrigido.* Typo "succeeded" em REQ-05.
- **KV-L07** *Corrigido.* Padrões com `[\s\S]*` ilimitado trocados por `[\s\S]{0,200}`, a mesma janela de `red-classify.mjs:48`.

### Achados no change base (não editados; só relatório)

- `progressa` nunca é `true` (`panel.ts:70,73,99`); possivelmente intencional, mas torna o selo e a "barra" mortos.
- `kanban.json` classificado `public (interno)` (base `requirements.md:378`) embora carregue `titulo = dispatch.scope`, que o próprio base classifica `sensitive` (`:376`).
- Manifesto do base ainda `status: implemented` com `requirements/design/tasks_reviewed: true` e `implementation_verified: false` (B1 persiste).

## 4. Changelog da Parte 2

| Arquivo | Seção | Antes → depois | Motivo |
|---|---|---|---|
| requirements.md | cabeçalho | — → nota do contrato consumido (tipos do client, formato codificado) | KV-H01 |
| requirements.md | REQ-01 crit. 3/4, notas | sem citação → `squad.ts:215-223`, `panel.ts:104-110`; fato `progressa` sempre `false`; crit. 4 restrito a "com geração ativa" | KV-H08, KV-H09 |
| requirements.md | REQ-02 crit. 2/3, notas | `post/patch/put/delete` → 13 operações de escrita reais; "nenhum atalho global" → "nenhum `bind` em camada global" | KV-H03, KV-M04 |
| requirements.md | REQ-03 crit. 2/3/4 | "sem fuso inventado" → ISO-8601 com `Z` a partir de ms; "exigido entra em desconhecidos / sem fonte" → `desconhecido` verbatim + "não exigido" + `source`; "pode desenhar barra" → DA-04 | KV-H08, KV-M10 |
| requirements.md | REQ-04 crit. 2/3/4/5 | "sinalizado" → `inbox: <n>`; crit. 4 com fixture concreta; + crit. 5 (vínculo por nome) | KV-M10, KV-M03, KV-M02 |
| requirements.md | REQ-05 crit. 1/3, notas | sem relógio → relógio injetado + exemplo `90 000 ms → 1 min`; "succeeded" → "tiver sucesso"; notas sobre montagem por requisição e `revisao` hash | KV-M06, KV-L06 |
| requirements.md | REQ-06 | 4 → 6 critérios: 404 via `ClientError`, versão do cliente, 503/Transport, + 409, + sem geração ativa | KV-H09 |
| requirements.md | REQ-07 crit. 1–4 | "único arquivo fora... builtins.ts" → lista completa + comando; comandos de verificação estática | KV-H05, KV-M02 |
| requirements.md | REQ-08 crit. 1/4 | `location: "/Users/..."` → `{ directory: "/Users/..." }`; + comando de verificação de log | KV-H02, KV-M02 |
| requirements.md | REQ-09 crit. 3/4, notas | "cores de `context.theme`" → grep de cor/`theme.hue` + mapa de tokens com `formfield`; nota `packages/tui/AGENTS.md` → `AGENTS.md` raiz | KV-M05, KV-H06 |
| requirements.md | REQ-10 crit. 1/2/3 | story sem arquivo → `storybook/squad-board.tsx` + `stories`; "documentação" → seção do `packages/cli/README.md` | KV-M02, KV-H07 |
| requirements.md | NFR-01..04 | contar títulos no frame → contar renderables montados; medições com comando | KV-H04 |
| requirements.md | checklist de superfície | conjuntos de tasks divergentes → alinhados a tasks.md | KV-M01 |
| requirements.md | classificação de dados | `location` string; `titulo` public; `sessionID` não renderizado → `Location.Ref`; `titulo`/`prioridade` sensitive; `sessionID` só na geração anterior | KV-H02, KV-M08 |
| requirements.md | fora de escopo | "não alterar squad-orchestration" → + exceção do README e DA-01/DA-08 | KV-H07, KV-H06 |
| design.md | §1.1 | citações por change → arquivo:linha; client e tipos reais; linha de `panel show` | KV-H01, KV-M09 |
| design.md | §1.2 | normas atribuídas a `packages/tui/AGENTS.md` → `AGENTS.md` raiz; + experiments registry (conflito), Style Guide, change-test-contract, red-classify, design-system (n/a), branch naming | KV-H06, KV-B02, KV-L01 |
| design.md | §1.3 | "só começa após o merge" → estratégia de base branch + gate E1–E8 com comandos | KV-B01 |
| design.md | §1.4, §2.1–§2.9 | ajustes: P2 montagem por requisição; relógio injetado; porta tipada pelo client; guarda de escrita não é Red; allowlist com `sessionID` da geração anterior; tokens; registro global sem `bind`; story em arquivo próprio; faixa desconhecida → DA-06 | KV-M06, KV-H03, KV-M08, KV-M05, KV-M04, KV-L04 |
| design.md | §3 | — → nota de valor não medido | KV-M09 |
| design.md | §4.1/§4.2/§4.4 | `{data: Squad.PanelDocument}` → valor desembrulhado codificado, erros declarados e não declarados, superfície completa; fatos do produtor; contradição com o README/baseline | KV-H01, KV-H09, KV-H08, KV-M07, KV-H07 |
| design.md | §5, §6 | rollout cita E1–E8; R1/R3/R5/R7/R8 ajustados; + R10, R11, R12 | KV-B01, KV-M07 |
| design.md | §7, §8 | REQ-10 + §4.4; + decisões abertas DA-01..DA-08 | KV-M01 |
| tasks.md | cabeçalho | `bun run test`; sem stub → `bun test --timeout 30000`; convenção de stub; formatos reais; gate E1–E8; base branch | KV-B02, KV-L05, KV-B01 |
| tasks.md | TASK-01..11 | padrões e asserções reais, "Stub do vermelho", notas com critérios órfãos; TASK-03 + REQ-05; TASK-05 + REQ-05 e loading; TASK-06 vermelho de navegação + guarda; TASK-07 + REQ-09; TASK-08 + REQ-08; TASK-09 contagem de montagem; TASK-10 só REQ-02; TASK-11 + story file, README, guardas | KV-B02, KV-H03, KV-H04, KV-M02, KV-L07 |
| tasks.md | rastreabilidade | "1, 2, 3, 4" carimbado → ordinais por task | KV-M01 |
| traceability.yaml | REQ-01/02/05/07/08/09/10 | design_refs e tasks divergentes → espelho do design §7 e tasks.md | KV-M01 |
| spec-delta.yaml | SCN-003-B, 006-B, 007-A, 007-B, 008-A; + SCN-006-C; comentário DA-08 | textos alinhados aos REQ corrigidos | KV-H08, KV-H09, KV-H05, KV-H03, KV-H02, KV-H07 |
| manifest.yaml | affected_paths, dependencies.code, comentários, archive.reason | + storybook e README; − `squad-kanban.ts`; + client/plugin; estratégia de base branch e fases pendentes em comentário; razão com HITL e DA | KV-H05, KV-L02, KV-B01 |
| proposal.md | §3, §4, §5, A4 | exceção do README; paths; risco de typecheck pelo client; branch `feature/…` a partir de `origin/dev`; analysis honesto; A4 sob DA-01 | KV-H07, KV-H05, KV-H01, KV-L01, KV-H10, KV-H06 |
| analysis.md | inteiro | "Artefato de `/forge:analyze`" sem Status → revisão manual no formato do comando, Status FAIL | KV-H10 |
| impact.json | inteiro | regenerado por `impact.sh --change` após `affected_paths` (6 → 7 seeds; 71 impactados) | KV-M11 |
| pre-approval.md | — | criado | Parte 3 |

`approvals.yaml` não foi alterado.

## 5. Decisões abertas para o humano

| ID | Pergunta | Opções | Recomendação |
|---|---|---|---|
| DA-01 | A view entra no registro de experimentos com `config.experimental.<chave>` (`packages/tui/AGENTS.md`)? | (a) sim, chave `experimental.squad_board` gateando o comando; (b) não, opt-in por rota, com emenda/registro de exceção à norma | (a): a norma é explícita, a API consumida é experimental e o custo é uma chave; (b) exige registrar a exceção nominalmente |
| DA-02 | Construir v1 sem prova de demanda? | (a) construir; (b) antes, usar `squad panel show --json` + `squad status` por um período definido e medir a necessidade de drill-down | (b) se o base ainda vai demorar a mergear — o tempo de espera vira janela de medição sem custo |
| DA-03 | Selo "sem progresso" em 100% dos cards | (a) exibir sempre; (b) exibir só quando algum estágio de `exigidos[]` não está `verified`; (c) pedir ao base que `progressa` considere só `exigidos[]` | (c) no base; até lá (a), porque (b) recalcula regra do produtor (viola P1) |
| DA-04 | O que desenhar com `progressa: true` | (a) nada em v1; (b) contagem textual `<n>/<m> exigidos verificados` | (a): inalcançável hoje; evita código morto |
| DA-05 | Idade sem timer | (a) só avança com interação; (b) tick de render de 1 Hz sem fetch | (a) com o rótulo "às <hora>" além da idade, que não envelhece errado |
| DA-06 | Faixa "coluna desconhecida" | (a) manter; (b) remover e confiar no literal do contrato | (b), conforme o Style Guide; o typecheck do client pega mudança de contrato |
| DA-07 | `r` com refresh em voo | (a) somar chamadas; (b) ignorar até concluir | (b): cada `panel` executa comandos por card no servidor |
| DA-08 | Baseline do base afirma ausência de TUI | (a) emendar REQ-17 do base antes do archive dele; (b) `modify_requirement` sobre `REQ-SQUAD-017` neste change, depois do archive do base | (a) se o base ainda não arquivou; senão (b) |

## 6. Comandos para registrar a aprovação (não executados)

Somente quando o humano concordar e as ressalvas/bloqueios do gate estiverem resolvidos:

```bash
bash .forge/scripts/approval-log.sh squad-kanban-view --gate requirements_reviewed --decision approve --reason "REQ-01..10 revisados; DA-01, DA-03, DA-04 e DA-08 decididos: <decisões>"
bash .forge/scripts/approval-log.sh squad-kanban-view --gate design_reviewed --decision approve --reason "E1 e E6 verdes (contrato congelado em origin/dev); DA-01..DA-08 decididos; design §4.2 revisado contra origin/dev"
bash .forge/scripts/approval-log.sh squad-kanban-view --gate tasks_reviewed --decision approve --reason "tasks revisadas após DA-03/04/06/07; padrão de falha da primeira TASK exercitado por red-evidence.sh record+replay"
```

Para bloquear explicitamente enquanto o base não merge:

```bash
bash .forge/scripts/approval-log.sh squad-kanban-view --gate design_reviewed --decision block --reason "KV-B01: squad-orchestration não merged em origin/dev; contrato não congelado"
```

## 7. O que este parecer não fez

- Não escreveu código em `packages/`, não fez commit, stage ou stash, não tocou `product/current/` nem os
  documentos de outros changes.
- Não rodou `approval-log.sh` nem alterou gates ou `approvals.yaml`.
- Não criou `verification.yaml` nem evidência red/green; os padrões de falha não foram exercitados pelo
  motor (não há código).
- Não executou `/forge:analyze` nem `/forge:shard` (pré-condição `tasks-ready`).
- Não regenerou o grafo (`graph.sh`); E3 não foi conferido.
- Executou `git fetch -q` no worktree do base para medir o estado contra `origin/dev` (atualiza refs
  remotas; não altera árvore de trabalho).
