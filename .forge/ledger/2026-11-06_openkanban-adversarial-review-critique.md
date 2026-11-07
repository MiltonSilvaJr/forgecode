---
date: 2026-11-06
id: openkanban-adversarial-review-critique
title: Crítica da revisão adversarial — OpenKanban / squad orchestration
status: review
reviewed_target: .forge/ledger/2026-11-06_openkanban-adversarial-review.md
reviewed_context:
  - .forge/ledger/2026-11-06_openkanban-executive-summary.md
  - .forge/ledger/2026-11-06_openkanban-evaluation.md
  - .forge/ledger/2026-11-06_openkanban-technical-analysis.md
  - .forge/ledger/2026-11-06_openkanban-integration-roadmap.md
  - .forge/ledger/README.md
  - .forge/specs/active/squad-orchestration/
severity_summary: "4 CRIT, 6 HIGH, 5 MEDIUM"
verdict: "A revisão melhora a estrutura do material, mas não é confiável como gate: erra fato verificável do upstream, ignora o change squad-orchestration que já existe e fabrica os próprios números que acusa. Aproveitar 4 achados; descartar o veredito e o cronograma."
tags:
  - meta-review
  - adversarial-review
  - openkanban
  - squad-orchestration
  - evidence-based
priority: critical
---

# Crítica da revisão adversarial — OpenKanban

> **Objeto desta crítica.** Não avalio o OpenKanban nem o squad orchestration. Avalio a
> qualidade, a solidez e a honestidade de
> `.forge/ledger/2026-11-06_openkanban-adversarial-review.md` (doravante "a revisão").
>
> **Método.** Confrontei cada afirmação verificável com (a) os arquivos crus do upstream
> (`raw.githubusercontent.com/TechDufus/openkanban/main/...`), (b) a API do GitHub, (c) os
> documentos irmãos citados pela revisão e (d) o estado real deste repositório
> (`git merge-base --is-ancestor`, `git rev-list --count`, leitura de
> `.forge/specs/active/squad-orchestration/`). Onde não pude verificar, digo
> "não verificável" e classifico como tal — não como fato.
>
> **Conformidade de registro.** Os arquivos `.md` em `.forge/ledger/` (incluindo este) **não**
> seguem `.forge/schemas/ledger.schema.json`; são notas ad-hoc. O ledger canônico é
> `.forge/ledger/ledger.json` + a view `.forge/ledger/LEDGER.md`, operado por
> `.forge/scripts/ledger-ops.sh`. Recomendo consolidar os achados duráveis no ledger canônico e
> **preservar** os markdowns como anexos históricos — nada deve ser apagado.

---

## 1. Veredito

| Dimensão | Avaliação | Base |
|---|---|---|
| Fidelidade factual ao upstream | **Baixa** | afirma "no mouse support" (falso); não vê que keybindings não são configuráveis; não vê a integração com o servidor OpenCode |
| Consistência interna | **Baixa** | 2 semanas vs 4 semanas de validação; $80k vs $40k/semana; 5 FTE vs 4,5; 90% vs 60–70% |
| Consistência contra os irmãos | **Média** | acerta o 6 vs 14; repete "7 estados" quando o roadmap define 8; herda premissas não checadas |
| Qualidade epistemológica | **Baixa–Média** | acusa números fabricados e fabrica custos; exige pesquisa de usuário sem desenho; exige dados de performance e afirma que Dioxus é mais rápido |
| Cegueira de contexto do repositório | **Grave** | ignora `squad-orchestration` (25 REQ, 40 tasks, branch 205 commits à frente de `origin/dev`, não merged) e propõe reconstruir o que já existe |
| Risco jurídico | **Superdimensionado** | transforma doutrina de copyright em risco "CRITICAL" com afirmações incorretas (atribuição obrigatória, "conceptual copying") |
| Utilidade decisória | **Baixa** | o único passo decisivo (validação de problema) não tem amostra, instrumento, métrica de decisão nem critério de parada; o cronograma "corrigido" é 50% maior que o criticado |
| **Veredito** | **Aproveitável como lista de perguntas, não como gate** | 4 achados resistem; o resto deve ser reescrito contra o estado real do repo |

---

## 2. Achados CRIT (bloqueadores)

### CRIT-01 — A revisão ignora o change `squad-orchestration` que já existe e recomenda reconstruí-lo

**Afirmação.** "🔴 CRITICAL: No evidence that OpenCode actually needs squad orchestration (problem
statement is unvalidated)" (`2026-11-06_openkanban-adversarial-review.md:38`) e "Risk: Building a
14-week solution to a problem that may not exist" (`:68`). A revisão trata a feature de squad como
hipótese e propõe um plano de 21 semanas para construí-la (`:495-505`).

**Por que falha.** O change existe, está especificado e tem implementação em branch. A revisão não
cita `.forge/specs/active/squad-orchestration/` uma única vez; seu universo é só os quatro markdowns
irmãos. Isso inverte a conclusão: o problema não é "validar se precisamos", é "decidir o que fazer
com um change já implementado e bloqueado".

**Evidência.**
- `ls .forge/specs/active/` → `forgequeue`, `session-activity-monitor`, `squad-orchestration`,
  `subscription-auth`.
- `.forge/specs/active/squad-orchestration/proposal.md:9` registra a operação real que motivou o
  change: "coordenar 13 sessões em paralelo na rodada de 04/11/2026", com seis despachos que
  voltaram "já implementado" por falta de reconciliação (`:13`). É **um caso**, não uma baseline —
  mas é exatamente a evidência que a revisão diz não existir.
- `git merge-base --is-ancestor feature/squad-orchestration origin/dev` → exit **1** (não merged);
  `git rev-list --count origin/dev..feature/squad-orchestration` → **205**.
- O branch já contém `packages/core/src/squad/panel.ts` (`git cat-file -e` → existe), que constrói
  `PanelDocument` com `versaoSchema: 1`, cinco colunas e estágios `jira/ci/merge/deploy/acceptance`.
- `.forge/specs/active/squad-orchestration/requirements.md:202-213` (REQ-17) já especifica o painel
  e o `kanban.json`; `:262-270` (REQ-22) já especifica `dispatch accept`.

**Severidade:** CRITICAL — invalida a recomendação central.

**Correção.** Reescrever a revisão como **delta sobre `squad-orchestration`**: (1) listar os
bloqueadores já conhecidos (B1–B5 do parecer de squad); (2) identificar o que falta para uma view
kanban (nada de estado novo: `panel` + `liveness` já existem); (3) só então discutir validação de
usuário, com o caso de 13 sessões como ponto de partida. Não propor `packages/squad` novo nem
máquina de estados nova.

---

### CRIT-02 — O debate "Ink vs Dioxus" é um falso dilema: o repositório usa OpenTUI/Solid

**Afirmação.** "🟡 HIGH: TUI framework choice (Ink vs Dioxus) is treated as low-risk decision but
could be architectural mistake" (`:40`); "Recommendation: Run performance bake-off in Phase 0
before choosing. Don't pre-commit to Ink" (`:351`); "Dioxus advantages ignored: Rust = faster
rendering… smaller runtime overhead" (`:338-341`).

**Por que falha.** Nenhum dos dois é a stack de TUI deste repositório. O TUI usa `@opentui/core`,
`@opentui/keymap` e `@opentui/solid` (`packages/tui/package.json:62-64`). "Dioxus" é um framework
Rust (web/desktop), não uma biblioteca TypeScript de TUI; adotá-lo mudaria a linguagem do runtime, o
que contradiz a decisão de stack (TypeScript + Effect) que os próprios irmãos declaram. A revisão
exige "dados de performance" (`:337`) e, na frase seguinte, afirma sem medição que Rust renderiza
mais rápido — o mesmo defeito que imputa ao irmão. O "bundle menor" (`:332`) é irrelevante para um
binário TUI, como a própria revisão reconhece em `:342` — ou seja, ela refuta um critério e mantém a
conclusão de que o critério importa.

**Evidência.** `grep '"@opentui\|"ink"\|"react"' packages/tui/package.json packages/app/package.json`
→ apenas `@opentui/core`, `@opentui/keymap`, `@opentui/solid`. Nenhuma dependência `ink`, `react` ou
`dioxus` em `packages/tui`.

**Severidade:** CRITICAL — o achado "HIGH" nº 3 da revisão não tem objeto.

**Correção.** Substituir o bake-off por uma decisão real: a view kanban é um plugin de TUI sobre
OpenTUI/Solid, ou uma página web/desktop, ou apenas `squad panel show`. Comparar essas três, com
critério de custo e superfície — não Ink contra Dioxus.

---

### CRIT-03 — O risco AGPL é elevado a CRITICAL com doutrina incorreta e skepticismo assimétrico

**Afirmação.** "🔴 CRITICAL: 'Learn + Reimplement' may violate AGPL-3.0 under clean-room doctrine"
(`:39`); "Even conceptual copying can trigger license obligations if structure/sequence is
substantially similar" (`:115`); "Attribution requirements — Even reimplementation may require
credit" (`:121`); "Risk: Legal challenge forces OpenCode to open-source entire codebase" (`:129`);
"Consult IP lawyer BEFORE any code study" (`:132`).

**Por que falha.**
1. **"Conceptual copying" não é o teste.** Direito autoral protege expressão, não ideias, métodos ou
   arquitetura. "Structure, sequence and organization" é um teste de similaridade substancial de
   *expressão* (e foi estreitado desde *Whelan v. Jaslow* por *Computer Associates v. Altai*), não
   uma regra de que "padrões arquiteturais" sejam protegidos. A frase funde ideia e expressão.
2. **"Attribution requirements" é falso para reimplementação independente.** A AGPL exige preservar
   avisos em cópias do programa licenciado; um trabalho independente não deve crédito ao
   OpenKanban. A revisão não cita cláusula nem precedente.
3. **"Entire codebase" é sobrebroad.** No máximo a porção alegadamente derivada; e a defesa de uma
   reimplementação independente é justamente a ausência de derivação.
4. **"Before any code study" não tem base.** Ler código público não é ato infringente; a prática
   usual é não copiar, documentar a criação independente e revisar antes de *distribuir*.
5. **Assimetria.** A revisão ataca o "safest legally" do irmão (`technical-analysis.md:624`), mas
   **nunca** ataca a afirmação oposta e mais consequente do executive summary: "AGPL-3.0 would
   require OpenCode to disclose source (not acceptable)" (`executive-summary.md:245`). As duas são
   afirmações jurídicas sem fonte; só uma é questionada.

**Evidência.** Textos citados acima; `technical-analysis.md:614-624`; `executive-summary.md:245`.
Nenhum dos dois documentos cita advogado, cláusula ou precedente.

**Severidade:** CRITICAL (de processo) — a severidade publicada não é sustentada pela própria
evidência; um risco real (não copiar código) vira bloqueio de leitura.

**Correção.** Reclassificar como **MEDIUM**: (a) a regra operacional é "não copiar código, não
vendorizar, documentar autoria"; (b) a pergunta jurídica estreita é "a implementação resultante é
substancialmente similar à expressão do OpenKanban?", a ser respondida por counsel **antes de
distribuir**, não antes de ler; (c) registrar a resposta também para a afirmação do executive
summary, que é a que decide a arquitetura.

---

### CRIT-04 — O "sprint de validação" não é operacionalizável: 2 vs 4 semanas, sem amostra, instrumento, métrica ou parada

**Afirmação.** "allocate **2 weeks for validation spike**" (`:44`) contra "run 4-week validation
sprint" (`:564`) e "Validation: 4 weeks (Steps 1-4 above)" (`:498`). O passo decisivo é:
"Interview 10-15 OpenCode users… Measure actual pain points… Go/No-Go: If users don't report
significant pain, STOP" (`:70-74`, `:456-461`).

**Por que falha.** É a mesma acusação que a revisão faz ao irmão ("no user research"), reproduzida
sem desenho: não define **quem** são os 10–15 (internos? usuários pagos? recrutados como?), **qual**
instrumento (entrevista semiestruturada? survey? protocolo de observação?), **qual** métrica de
decisão ("significant pain" é adjetivo), **qual** limiar (quantos de 15? qual redução de tempo?) nem
**quem** executa (os 5 FTE nunca nomeados). Também não declara o custo real do sprint além de um
número sem base (ver HIGH-01). Os passos somam 1 + 1 + 2 + 3 dias ≈ **4,4 semanas**, não 4 — e a
contradição 2 vs 4 nunca é resolvida.

**Evidência.** `:44`, `:70-74`, `:456-461`, `:485-491`, `:497-505`, `:564`, `:572`.

**Severidade:** CRITICAL — o "gate" que a revisão propõe não distingue GO de NO-GO de forma
reproduzível.

**Correção.** Definir: amostra (n, critério de inclusão, recrutamento), instrumento (roteiro com
perguntas e escala), métrica primária (ex.: minutos de coordenação por tarefa, erros por dia,
medidos em 5 dias de uso), limiar de decisão (ex.: ≥ 8/12 relatam dor semanal e ≥ 30% de redução
medida) e critério de parada antecipada. Sem isso, o sprint é opinião com cronograma.

---

## 3. Achados HIGH

### HIGH-01 — Os custos são fabricados e mutuamente incompatíveis

**Afirmação.** "Cost of validation: 4 weeks (~$80k if 5 FTE @ $40k/week)" (`:572`); "Cost of
skipping validation: … (~$280k)" (`:574`); o README repete `$80k`/`$280k` (`README.md:133-134`).

**Por que falha.** A aritmética não fecha em nenhuma leitura e a composição de time não soma 5.
Ver tabela §4. Além disso, `$4k/FTE-semana` (o único valor que torna `$80k` e `$280k` compatíveis
entre si) não é uma taxa de engenharia sênior plausível e não tem fonte. A revisão acusa o irmão de
"3+ errors per day" sem fonte e produz três números sem fonte na mesma página.

**Evidência.** `executive-summary.md:81` ("5 FTE (backend 2, TUI 1, QA 1, PM 0.5)" = 4,5);
`integration-roadmap.md:517-524` (8+5+6+3 = 22 FTE-weeks; "~5.5 weeks in parallel");
`:572-574`; `README.md:133-134`.

**Severidade:** HIGH.

**Correção.** Publicar a conta: `FTE × semanas × taxa`, com a taxa nomeada e a fonte (custo
carregado interno ou benchmark). Se a taxa não existe, dizer "não estimável" em vez de inventar.

---

### HIGH-02 — A revisão critica o otimismo do cronograma e propõe um cronograma 50% maior, também sem base

**Afirmação.** "14 weeks realistic (no bottom-up estimate)" (`:592`) é tratado como defeito; a
alternativa é "Total: 21 weeks (5 months)" (`:505`), montada como 4 + 1 + 6 + 2 + 4 + 4.

**Por que falha.** Os blocos de 1/6/2/4/4 semanas são tão top-down quanto o 14 que a revisão
critica: não há decomposição por work item, nem produtividade medida, nem dependência. A revisão
também introduz **16 semanas** (`:374`) e **12 semanas** (`:375`) sem derivação, e "6-8 semanas"
para o "true MVP" (`:217`) sem relação com os 6+4+4 que ela mesma propõe. O efeito líquido é
substituir um número não fundamentado por outro 50% maior, sem reconhecer a mudança de custo.

**Evidência.** `:217`, `:220-224`, `:374-375`, `:495-505`, `:592`.

**Severidade:** HIGH.

**Correção.** Ou apresentar estimativa bottom-up (por task, com premissas de velocity e
dependências), ou declarar explicitamente: "o número revisado é uma hipótese, não uma estimativa; a
estimativa será produzida no spike". E reconciliar 21 vs 14: o que entra a mais?

---

### HIGH-03 — Fidelidade ao upstream: erra "no mouse", perde keybindings e integração com OpenCode, e não vê a contradição dos irmãos

**Afirmação.** "TUI has limitations - No mouse support (or poor)" (`:181`). A revisão também aceita,
sem checar, que o OpenKanban é "agent-agnostic but assumes a CLI-like interface" e que "most agents
are Effect-based" (`:361`).

**Por que falha.**
1. **Mouse:** o upstream trata `tea.MouseMsg` e tem `handleMouse` (`ARCHITECTURE.md:95-96`) e
   documenta scrollback com roda do mouse (`docs/CONFIGURATION.md`, seção `scrollback_lines`).
2. **Keybindings:** o irmão `evaluation.md:34` diz que keybindings são customizáveis via
   `config.json`; o próprio upstream é **contraditório**: o README diz "Agents, keybindings, branch
   naming, cleanup behavior - all customizable", mas `docs/CONFIGURATION.md` diz "Custom keybindings
   coming soon". O `technical-analysis.md:446-459` acerta ("not customizable"). A revisão não percebe
   que os dois irmãos se contradizem — nem que a fonte primária se contradiz — e a contradição é
   factualmente decidível pelo código/documentação detalhada.
3. **Integração com OpenCode:** o upstream tem uma seção inteira "OpenCode Integration" que sobe um
   servidor e usa `opencode attach` para status em tempo real (`docs/CONFIGURATION.md`). A premissa
   "assumes CLI agents; we need Effect integration" é mais fraca do que os irmãos e a revisão
   supõem.
4. **Features omitidas:** labels/priority (`CONFIGURATION.md`), 20 temas, sidebar, `S`/`d`/`e`/
   `g`/`G`/`-`/`/`/`tab`/`[`/`O`/`q` (`CONFIGURATION.md`, Full Keybindings Reference). A revisão
   discute "100+ tasks" e "10+ squads" sem mencionar que o upstream já tem labels, prioridade e
   filtro por projeto.
5. **"Actively maintained" passa sem escrutínio.** `technical-analysis.md:638` chama o projeto de
   "actively maintained"; a API do GitHub devolve `pushed_at: 2026-06-12` (≈5 meses antes de
   2026-11-06) e 6 issues abertas. A revisão, que exige dados para tudo, não mede a manutenção que o
   irmão afirma.

**Evidência.** URLs e trechos citados; `evaluation.md:34` vs `technical-analysis.md:446-459`.

**Severidade:** HIGH.

**Correção.** Corrigir "no mouse"; incluir a contradição de keybindings como achado de fidelidade
do irmão; reconhecer a integração OpenCode; e listar features omitidas que afetam a comparação.

---

### HIGH-04 — A revisão comete os pecados que imputa: fabrica números, exige dados e afirma sem dados, e adia a comparação que cobra

**Afirmação.** Acusa "3+ errors per day (no data source)" (`:583`) e "154 stars" — na verdade a
revisão **não** menciona 154 stars; quem menciona é `evaluation.md:41`, e o número está **correto**
(API do GitHub: `stargazers_count: 154`, `forks_count: 16`, `license: AGPL-3.0`, `language: Go`).
Então a acusação de "número sem fonte" não se aplica a esse item: ele é verificável e verdadeiro.

**Por que falha.** Ao mesmo tempo, a revisão: (a) inventa `$80k`/`$280k`/`$4k-por-FTE-semana`;
(b) inventa `16` e `12` semanas; (c) exige "performance data" e afirma que Dioxus é mais rápido
(`:338-342`); (d) exige "avaliar 3–5 alternativas" (`:271`) mas só lista cinco nomes sem critério,
custo ou evidência (`:260-266`); (e) exige "pesquisa de usuário" e não desenha a pesquisa
(CRIT-04). É o padrão "faça o que eu digo, não o que eu faço".

**Evidência.** `:260-266`, `:271`, `:338-342`, `:572-574`, `:583-586`; API do GitHub
(`https://api.github.com/repos/TechDufus/openkanban`).

**Severidade:** HIGH.

**Correção.** Marcar cada número como `medido`, `estimado (premissa)` ou `não verificável`; remover
"fabricated" onde o correto é "sem instrumento"; e, se exigir comparação de alternativas, fazê-la
com os mesmos critérios que cobra.

---

### HIGH-05 — Falsos dilemas e homens de palha: Effect.ts e multi-project

**Afirmação.** "If Effect.ts is 'already in use,' why is learning curve a high risk? Either team is
proficient (no training needed) or not proficient (1 week insufficient)" (`:301-305`). E "Praised
multi-project as valuable but cutting it from v1… If it's valuable, why defer?" (`:316-321`).

**Por que falha.**
1. **Effect.ts:** "já usado" e "time ainda aprendendo" não são mutuamente exclusivos. Um codebase
   pode usar Effect e o time ter níveis desiguais; a conclusão válida é "medir", não "ou um ou
   outro". É um falso dilema.
2. **Multi-project:** o irmão `evaluation.md:93` diz explicitamente "**Multi-project support** —
   Squad is typically project-scoped; could be extended later", isto é, **não** é apresentado como
   valioso e adiado; é declarado não aplicável. A `technical-analysis.md` só menciona
   multi-project como campo do upstream (`:67`, `:87`), não como recomendação. A revisão atribui
   ao irmão uma posição que ele não tem — homem de palha.

**Evidência.** `:301-305`, `:316-321`; `evaluation.md:93`; `technical-analysis.md:67,87`.

**Severidade:** HIGH.

**Correção.** Trocar o falso dilema por uma pergunta mensurável ("qual a distribuição de
proficiência e qual o custo medido no spike?"); remover a contradição de multi-project ou citar a
frase real que a sustenta.

---

### HIGH-06 — Troca 90% de cobertura por 60–70% sem evidência e sem definir o que é coberto

**Afirmação.** "90% test coverage slows delivery" (`:208`); "Target 60-70% coverage (pragmatic, not
dogmatic)" (`:393`); "Replace '90% coverage' with 'E2E tests for all user workflows + integration
tests for external dependencies'" (`:395`).

**Por que falha.** Não há medição de que 90% desacelera, nem de que 60–70% preserva os caminhos
críticos. Nenhuma regra do repositório exige 90% (`.forge/rules/testing/*.md` não menciona
cobertura), então o número original é de fato arbitrário — mas o substituto também é. A parte
qualitativa ("E2E para todos os fluxos") é boa, mas "todos os fluxos" não é enumerável sem a lista
de REQ; e a revisão não usa a lista de REQ que existe.

**Evidência.** `:208`, `:379-395`; `grep -rn "coverage" .forge/rules/testing/*.md` → vazio;
`requirements.md` tem 25 REQ com critérios de aceite.

**Severidade:** HIGH.

**Correção.** Não propor percentual; propor cobertura **por critério de aceite** (cada REQ com ao
menos um teste observável) e um piso de cobertura de linha apenas para módulos de risco
(transição, digest, close), com justificativa. O 90% e o 60–70% saem ambos.

---

## 4. Achados MEDIUM

### MEDIUM-01 — "Fabricated" é acusação forte demais; o achado correto é "sem instrumento"

**Afirmação.** "Claims like '3+ errors per day' are fabricated without measurement" (`:58`); o
apêndice lista "3+ errors per day (no data source)" (`:583`).

**Por que falha.** Não há como provar invenção; o verificável é que o irmão não cita medição
(`executive-summary.md:90`). A diferença importa porque "fabricated" contamina a credibilidade do
documento inteiro, enquanto "sem instrumento" é uma correção acionável (medir). Além disso, a
revisão **não** aplica o mesmo padrão a "<5 min por tarefa" (`executive-summary.md:89`) nem a
"<0.1 erro/dia" (`:90`), que são alvos igualmente sem instrumento.

**Evidência.** `:58`, `:583`; `executive-summary.md:89-90`.

**Severidade:** MEDIUM.

**Correção.** "Sem baseline nem instrumento de medição"; e incluir os dois outros alvos na mesma
lista.

---

### MEDIUM-02 — "7 estados" está errado (o roadmap define 8) e estados de squad não são colunas de kanban

**Afirmação.** "**7 states is complex** — Most kanban tools start with 3 (To Do, In Progress,
Done)" (`:206`); "7 states for v1" (`:601`).

**Por que falha.** O `integration-roadmap.md:138-172` define **8** estados (Candidate, Assigned,
Active, Paused, Blocked, Escalated, Done, Deleted). Além disso, a comparação é categorial: os 3 do
OpenKanban são **colunas de ticket** (`board.TicketStatus`: backlog/in_progress/done,
`ARCHITECTURE.md`), não estados de orquestração. Reduzir 8 estados de squad a 3 colunas de kanban
não é uma simplificação, é apagar transições (pause/resume/block/escalate) que o próprio irmão
considera necessárias.

**Evidência.** `integration-roadmap.md:138-172`; `ARCHITECTURE.md` (`TicketStatus`);
`technical-analysis.md:467-469` (a matriz diz "7+ states" com 7 nomes).

**Severidade:** MEDIUM.

**Correção.** Corrigir para 8 ou citar a lista; separar explicitamente "coluna de exibição" de
"estado de máquina" e justificar a redução por transição removida, não por contagem.

---

### MEDIUM-03 — A tabela de "alternativas" não é uma avaliação; é uma lista com licenças não verificadas

**Afirmação.** "Alternative Solutions Not Evaluated… Missing Alternatives" (`:254-266`) e "Evaluate
3-5 alternatives in Phase 0" (`:271`).

**Por que falha.** A tabela lista Taskwarrior (MIT), kanban.bash (MIT), "build custom", tmux (BSD) e
GitHub Projects API, sem critério de comparação, sem custo, sem verificação de licença e sem
demonstrar que qualquer uma resolve o problema (coordenação de agentes). Taskwarrior e tmux não são
kanban de agentes; GitHub Projects é SaaS; "build custom" não é alternativa, é a opção. A revisão
cobra uma avaliação que ela mesma não fez.

**Evidência.** `:260-266`, `:271-273`.

**Severidade:** MEDIUM.

**Correção.** Comparar as opções **que disputam a mesma decisão** (view sobre `panel` vs web vs
CLI; reusar `kanban.json` vs inventar formato), com critérios: superfície, custo, reversibilidade,
dependência de estado novo.

---

### MEDIUM-04 — "PTY é a killer feature" é ranking sem fonte; o upstream lista quatro features co-iguais

**Afirmação.** "**OpenKanban's killer feature is PTY embedding** — Without it, squad TUI is just a
task list" (`:363`); "TUI's main advantage is embedded terminals" (`:371`).

**Por que falha.** O README lista quatro features sem hierarquia: worktrees, embedded terminals,
qualquer agente, multi-project (`README.md`, seção Features). A revisão escolhe uma e a chama de
"killer" sem dado de adoção. Pior: o irmão que ela critica defende explicitamente que o valor do
squad TUI é o **board + estado + auditoria** (`integration-roadmap.md:39-44`), não o terminal. A
recomendação de "incluir PTY no v1" (`:374`) decorre de uma premissa não medida.

**Evidência.** README (Features); `integration-roadmap.md:39-44`.

**Severidade:** MEDIUM.

**Correção.** Tratar PTY como hipótese de valor, não fato; testá-la com os usuários do sprint
(se o sprint existir) ou adiá-la sem alegar que "sem PTY não há valor".

---

### MEDIUM-05 — Os critérios de GO/NO-GO da própria revisão são infalsificáveis

**Afirmação.** "If users don't report significant pain, STOP" (`:461`); "If Effect.ts velocity is
<50% of expected, re-estimate" (`:481`); "If legal risk is high, pivot" (`:471`); "Verify 70%+
allocation" (`:488`).

**Por que falha.** "Significant pain", "expected velocity" e "legal risk is high" não têm escala,
limiar ou instrumento. "70%+ allocation" não tem como ser medido (não há timesheet nem definição de
dedicação). Um gate assim não pode reprovar nada — logo, não é gate.

**Evidência.** `:461`, `:471`, `:481`, `:488`.

**Severidade:** MEDIUM.

**Correção.** Para cada gate: métrica, unidade, limiar, janela e quem mede. Ex.: "velocity medida =
tasks concluídas por semana no spike; se < 2/3 da premissa de 3/semana, reestimar".

---

## 5. Erros de aritmética

| # | Conta esperada | Conta publicada | Onde | Diagnóstico |
|---|---|---|---|---|
| A1 | 2 + 1 + 1 + 0,5 = **4,5 FTE** | "5 FTE" | `executive-summary.md:81` | Soma errada por 0,5 FTE; propaga para todo custo |
| A2 | 4 semanas × 5 FTE × $40k/semana = **$800k** (por FTE) ou 4 × $40k = **$160k** (time) | **$80k** | `adversarial-review.md:572` | $80k só fecha com $4k/FTE-semana ou $20k/time-semana, o que contradiz o "$40k/week" |
| A3 | 14 semanas × 5 FTE × $8k = **$560k**; a $40k/time-semana = **$560k**; a $40k/FTE = **$2,8M** | **$280k** | `:574` | $280k implica $4k/FTE-semana; nenhuma das taxas declaradas chega lá |
| A4 | 8 + 5 + 6 + 3 = **22 FTE-semanas** | "~22 FTE weeks (~5.5 weeks in parallel)" | `integration-roadmap.md:517-524` | 22 ÷ 3,5 FTE = **6,3 semanas**; 22 ÷ 4,5 = **4,9**; "5,5" não corresponde a nenhuma composição |
| A5 | 4,5 FTE × 14 semanas = **63 FTE-semanas disponíveis** | 22 FTE-semanas planejadas | idem | Utilização de 35%; ou o time não é 4,5 FTE, ou o cronograma é 5 semanas, ou as 22 são subestimadas |
| A6 | 2×6 = 12; 3×6 = **18** | "12-16 weeks (2-3x POC)" | `adversarial-review.md:288` | Faixa não fecha com o multiplicador declarado |
| A7 | 4 + 1 + 6 + 2 + 4 + 4 = **21** | "21 weeks (5 months)" | `:497-505` | Soma correta; 21 semanas = 4,83 meses (arredonda para 5, ok) — mas os blocos não têm derivação |
| A8 | 1 + 1 + 2 + 3 dias = **4,43 semanas** | "4 weeks (Steps 1-4)" | `:498` | Arredonda para baixo e ignora os 3 dias |
| A9 | 14 semanas = **3,5 meses** (14÷4 = 3,5) | "14 weeks (3.5 months)" | `executive-summary.md:28` | Aqui está correto; o erro é a coexistência com 21 semanas = "5 meses" sem reconciliar |
| A10 | 90% → 60–70% = **−20 a −30 p.p.** | "pragmatic, not dogmatic" | `:393` | Sem medição de custo/benefício; o número substituto é tão arbitrário quanto o original |

---

## 6. O que a revisão acertou

Estes pontos resistiram ao escrutínio e devem ser preservados:

1. **Contradição 6 vs 14 semanas.** `technical-analysis.md:608` diz "Total Estimated Effort: 6
   weeks (2 weeks study + 4 weeks implementation)"; `executive-summary.md:138` diz "Total: 14
   weeks". São incompatíveis e a revisão localiza corretamente (`:279-291`).
2. **"3+ erros/dia" e "≥4/5 estrelas" não têm fonte nem instrumento.** Confirmado:
   `executive-summary.md:90,211`; nenhum dos quatro documentos descreve coleta. A severidade
   correta é "sem baseline", não "fabricado" (MEDIUM-01), mas o achado é real.
3. **Time não nomeado e alocação de 100% assumida.** `executive-summary.md:321-324` tem
   `[TBD]` em todos os contatos; `integration-roadmap.md:517-524` lista papéis, não pessoas. O
   risco de disponibilidade é legítimo.
4. **Faltam modos de falha e prontidão operacional.** `grep -rni "backup\|corrupt\|failure
   mode\|rollback" integration-roadmap.md` → **0**. A revisão pede análise de falha, backup,
   monitoramento e rollback (`:401-443`), e isso realmente não está nos irmãos.
5. **Nenhuma alternativa permissiva foi comparada nos irmãos.** `grep -rni
   "taskwarrior\|kanban.bash\|tmux"` nos quatro documentos → **0**. A crítica de que só o
   OpenKanban foi estudado é factual.
6. **"No breaking changes" é afirmação sem desenho de integração.** `executive-summary.md:273`
   afirma; o roadmap só tem uma tabela de dependências (`:538-545`), sem contrato. A revisão
   corretamente exige o contrato antes da fase 5.
7. **"Safest legally" é overclaim sem counsel.** `technical-analysis.md:624` afirma; a revisão
   corretamente exige opinião jurídica — embora erre a doutrina e a severidade (CRIT-03).
8. **Cobertura de 90% não tem base no repositório.** Nenhuma rule de testing exige 90%
   (`grep -rn coverage .forge/rules/testing/` → vazio). O questionamento é válido; o substituto
   não (HIGH-06).
9. **Estrutura e legibilidade.** CRITICAL/HIGH/MEDIUM, "required action" por achado e go/no-go
   tornam a revisão mais utilizável que os irmãos. O problema é o conteúdo, não o formato.
10. **A pergunta sobre PTY é legítima como pergunta de produto** (`:355-375`), mesmo que a
    premissa "killer feature" não seja medida (MEDIUM-04).

---

## 7. O que é não verificável

Não consegui verificar, e não trato como fato:

1. Custo carregado por FTE-semana (`$4k`, `$8k`, `$40k`) e custo total — nenhuma fonte.
2. Tempo de contratação de 4–8 semanas (`:240`) — mercado, sem fonte.
3. "70% de alocação" como realidade — não há instrumento.
4. Distribuição de dor dos usuários e preferência TUI vs web vs IDE — não há pesquisa.
5. Acessibilidade de TUI para leitores de tela (`:193`) — não há auditoria.
6. Performance de Ink ou Dioxus com 100+ tasks — não há benchmark; e é moot (CRIT-02).
7. "Dioxus é mais rápido / menor overhead" — plausível em abstrato, não medido para este caso.
8. Probabilidade e impacto de uma ação judicial AGPL — não verificável; a conclusão "entire
   codebase" é overbroad (CRIT-03).
9. "Estrutura, sequência e organização substancialmente similares" neste caso — depende de perícia
   jurídica e do código resultante, que não existe.
10. "Effect.ts: 1 semana é insuficiente" — não medido; a própria revisão propõe medir.
11. "Most agents are Effect-based" — a população da afirmação não é definida; é checável no
    registro de agentes do repo, mas a revisão não checa.
12. "OpenKanban's killer feature" — ranking sem dado de adoção.
13. Se "3+ erros/dia" foi inventado ou estimado — não é possível provar intenção; só a ausência de
    instrumento.
14. Os cenários de 16 e 12 semanas (`:374-375`) — não há derivação.

---

## 8. Como usar o documento revisado

**Aproveitar (com correção de severidade):**
- A contradição 6 vs 14 semanas (HIGH-02 do documento irmão, na prática).
- A ausência de baseline/instrumento para "3+ erros/dia", "<5 min", "<0.1/dia", "≥4/5" — reescrita
  como "sem instrumento", não "fabricado".
- A ausência de modos de falha, backup, rollback e prontidão operacional.
- A ausência de time nomeado e a ilusão de 100% de alocação.
- A ausência de comparação de alternativas — mas refeita com critérios e contra o estado do repo.

**Descartar:**
- O veredito "CRITICAL" sobre AGPL e a recomendação "lawyer before any code study".
- O sprint de 4 semanas como gate, enquanto não houver amostra/instrumento/limiar.
- O plano de 21 semanas e os números de 16/12 semanas.
- O debate Ink vs Dioxus e o bake-off.
- Os custos `$80k`/`$280k` e qualquer taxa por FTE.
- A afirmação de que "o problema pode não existir" — o change e a operação de 13 sessões existem.

**Reescrever como delta sobre `squad-orchestration`:**
1. **Estado real:** 25 REQ, 40 tasks, branch `feature/squad-orchestration` 205 commits à frente de
   `origin/dev`, **não merged**; bloqueadores B1–B5 já registrados em
   `.forge/ledger/2026-11-06_squad-orchestration-adversarial-review.md`.
2. **Substrato pronto:** `panel.ts` + `GET /api/experimental/squad/panel` +
   `GET /liveness` + `squad panel build|show` já produzem board, estágios e evidência. A view
   kanban é **leitura** sobre isso — não um novo estado.
3. **Escopo v1:** board read-only, navegação, drill-down, evidência por estágio; escrita
   (`move`, `assign`) fora, reusando `dispatch accept`/`send` quando chegar a hora.
4. **Validação de usuário:** desenhar amostra, instrumento, métrica e parada — ou declarar que a
   evidência é o caso operacional e que não haverá pesquisa antes do v1.
5. **Jurídico:** a pergunta é "copiamos código?" (não) e "a implementação parece derivada?"
   (counsel antes de distribuir). Não é bloqueio de leitura.
6. **Custo/tempo:** ou bottom-up, ou "não estimável"; nunca um número sem premissa nomeada.

**Registro.** Os achados duráveis desta crítica foram registrados no ledger canônico
(`.forge/ledger/ledger.json`, view `LEDGER.md`) via `ledger-ops.sh`. Este arquivo e os demais
markdowns de `.forge/ledger/` permanecem como anexos; a consolidação sugerida é migrar o que for
durável e **não apagar** o histórico.

---

**Autor:** Milton (agente de IA) · **Data:** 2026-11-06
**Alvo:** `.forge/ledger/2026-11-06_openkanban-adversarial-review.md`
**Natureza:** meta-revisão adversarial; não altera o documento revisado.
