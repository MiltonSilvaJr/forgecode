---
title: Autonomia — HITL vs YOLO
applies_to:
  - all
priority: high
last_reviewed: 2026-10-30
based_on: []
---

# Autonomia — modo HITL (default) vs YOLO

## Princípio

O harness tem dois modos de decisão nos gates humanos (§12.1), configurados em
`forge.yaml > autonomy.mode`:

- **`hitl`** (default) — todo gate de aprovação para para decisão humana via `AskUserQuestion`.
- **`yolo`** — os gates de aprovação são decididos por um subagente **Opus effort high** (o agent
  `yolo-gate`), sem parar para o humano. É opt-in explícito: `mode: yolo` no `forge.yaml`, ou o
  flag `--yolo` numa invocação de comando (override só daquela execução).

O objetivo do yolo é deixar **fluxos e loops autônomos** (pipeline de spec, specs-loop, coding-loop)
correrem ponta-a-ponta sem um humano no teclado, **sem** abrir mão da rastreabilidade.

## As duas regras que tornam yolo seguro

### 1. Honestidade de auditoria (inegociável)

Uma decisão autônoma é registrada em `approvals.yaml` **como autônoma** — nunca mascarada como
humana:

```yaml
approvals:
  - gate: design_reviewed
    decision: approve
    autonomous: true                 # ← máquina decidiu
    reason: "design.md cobre INV-01..07, PBTs mapeados, sem NEEDS CLARIFICATION"
    decided_by: "forge-yolo (opus, high)"
    decided_at: "2026-07-10T15:00:00-03:00"
```

Diferente do approve humano (que pode ser silencioso), **todo approve autônomo carrega o motivo** (a
análise) — o `approval-log.sh --autonomous` recusa approve autônomo sem `--reason`. Assim uma
auditoria (contexto regulado/PCI) filtra `autonomous: true` e revisa exatamente os gates que uma
máquina liberou. **Nunca** grave um nome humano numa decisão que a máquina tomou.

### 2. Yolo decide gates — não mascara falhas

Yolo delega **decisões de aprovação de artefato**. Ele **não** transforma o harness em "ignore
problemas":

- **Falha de execução** — TASK `[!]`, `BLOCKER`/`Status: FAIL` no `analysis.md`, teste vermelho,
  build quebrado — **continua parando** o loop (Early Exit, `tasks-writer` §1.8). Não existe
  "aprovar por cima" de uma falha.
- **Conflito de fontes normativas** (rule↔ADR, módulo↔módulo, change↔baseline) — bloqueante em
  qualquer modo (`conflict-handling.md`, guardrail G1). Resolve por ordem de autoridade (FORGE.md
  §2.1) ou escala; nunca "registra e segue".
- **Loop de review** — um `review` do `yolo-gate` alimenta o ciclo builder→validator (§14.6) até **3 iterações**; na 3ª ainda com pendência, **escala ao humano**. Yolo nunca itera ao infinito. O mesmo teto vale para o caminho humano, inclusive quando o dono delega a decisão do gate a um revisor adversarial: Review consecutivos contam para as mesmas 3 rodadas, com escalada obrigatória ao dono, régua de severidade fixada na primeira rodada e regra de convergência (achado que é consequência direta da correção anterior no mesmo mecanismo é nota e não reabre o ciclo). A regra completa está em `/forge:requirements` §4 (Teto e convergência do Review), herdada por `/forge:design` e `/forge:tasks`; o `/forge:analyze` aplica a mesma lógica às rodadas de análise.

## Hard-stops — o que permanece humano mesmo em yolo

`forge.yaml > autonomy`:

- **`human_hard_stops`** (default: `human_archive_approval`) — gates de aprovação que continuam
  exigindo humano mesmo em yolo. O default protege a **mutação de baseline** (`/forge:archive`), que
  §13.1 exige aprovação humana explícita em domínio regulado/financeiro. Esvazie (`[]`) para yolo
  total desassistido, assumindo o risco de auditoria. **Imposto deterministicamente**: o
  `approval-log.sh` lê essa lista e **recusa** (`exit 2`) um `--autonomous` cujo `--gate` esteja nela
  — a fronteira de segurança é mecânica, não fica refém do juízo do agente `yolo-gate`.
- **`irreversible_hard_stops`** (default: `deploy_prd`, `promote_staging`, `adapter_removal`,
  `branch_cleanup`) — ações de alto risco (produção/dados) **nunca** auto-aprovadas em yolo,
  independentemente de `mode`. Merge para `develop` (integração contínua de baixo custo) **é**
  yolo-able; deploy para produção não.
- **Merge com mudança de contenção** (REQ-12, design §2.7) — mesmo com `human_hard_stops` vazio e
  fora de `irreversible_hard_stops`, entra na lista de paradas humanas obrigatórias: um merge de
  `/forge:ship --yolo` cujo `native containment --range develop..HEAD` reporte qualquer achado (ou
  rc 2, detector indisponível) cai para confirmação humana. Não é opção de config — `ship.md` roda
  o detector antes da decisão de merge, e o `yolo-gate` decide `block` com o motivo "mudança de
  contenção exige humano" em vez de aprovar sozinho. A contenção por workspace (`allowed-
  workspaces.json`) é proteção contra liberação induzida pelo próprio fluxo, não fronteira de
  segurança (`liaison-protocol.md`) — e justamente por isso o merge que a altera exige um humano
  fora da sessão, não um juízo autônomo.

## Como um comando se comporta em yolo

Em cada gate HITL, o comando faz:

1. Determina o modo: `--yolo` na invocação **ou** `autonomy.mode: yolo` no `forge.yaml`.
2. Se **hitl** → `AskUserQuestion` como sempre (§12.1).
3. Se **yolo** e o gate está em `human_hard_stops`/`irreversible_hard_stops` → **cai para humano**
   (AskUserQuestion), avisando que era um hard-stop.
4. Se **yolo** e o gate é decidível → invoca o agent `yolo-gate` (**model opus, effort high**), que
   analisa, decide e registra via `approval-log.sh --autonomous`. O comando então segue (transição,
   próxima fase do loop) como no fluxo humano.

## Perguntas de coleta/ambiguidade (não são gates de aprovação)

Um `AskUserQuestion` que **coleta metadado** (change-id, `--type`/`--scale`, resolução de
`NEEDS CLARIFICATION`, escopo de backlog) é natureza diferente de um gate de aprovação. Em yolo, o
`yolo-gate` **infere a melhor opção do contexto e registra o racional**; se for genuinamente
indecidível (informação ausente que não dá para derivar) ou irreversível/regulada, **escala ao
humano** em vez de chutar. A regra "proibido inferir" do `/forge:clarify` continua valendo para
ambiguidades de requisito de alto risco.

## Anti-patterns

- Gravar decisão autônoma sem `autonomous: true` (ou com nome humano em `decided_by`).
- Approve autônomo sem motivo registrado.
- "Aprovar" autonomamente por cima de uma falha de execução, blocker ou conflito de fontes.
- Auto-aprovar `human_archive_approval` ou deploy de produção em yolo com os hard-stops default.
- Loop de `review`, autônomo ou humano delegado, sem teto de 3 rodadas, ou com régua de severidade que muda entre rodadas.

## Referências

- [Sessão longa / Autopilot](./session-discipline.md) · [Tratamento de conflito](./conflict-handling.md)
- Agent `review/yolo-gate.md` · `forge.yaml > autonomy` · doc §12.1/§12.2/§13.1
