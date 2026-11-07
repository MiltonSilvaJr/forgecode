---
name: conflict-handling
description: Como o harness trata conflitos entre fontes normativas (rule↔ADR, módulo↔módulo, change↔baseline). Conflito arquitetural relevante é bloqueante — o agente para e escala via HITL, nunca "registra e segue". Resolve a precedência pela ordem de autoridade (FORGE.md §2.1).
based_on: []
---

# Tratamento de conflito de fontes (guardrail G1/G2)

> Origem: incidente do piloto (dois módulos divergiram sobre isolamento multi-tenant; o agente
> detectou o conflito e mesmo assim seguiu para tasks). Esta rule torna o tratamento **obrigatório
> e bloqueante**.

## 1. Ordem de autoridade (precedência — FORGE.md §2.1)

Quando duas fontes se contradizem, a de **maior autoridade vence**; a de menor é **drift a corrigir**:

```
constitution > baseline (ADRs aceitos + product/current/capabilities) > rules > context/defaults
```

- "ADR diz RLS obrigatório, rule diz RLS opcional" → **o ADR vence**; a rule está desatualizada.
- Não adivinhe a precedência: ela é esta ordem, declarada. Aplique-a.

## 2. Conflito relevante é BLOQUEANTE

Um conflito é **arquitetural relevante** quando afeta decisão estrutural durável: isolamento de
dados, segurança/auth, contrato de API/evento, modelo de domínio, estratégia de persistência.

Diante de um conflito relevante, o agente **PARA** — não "registra e segue":

1. **Não prosseguir** para `tasks`/`implement` com a inconsistência aberta.
2. **Escalar via HITL** (`AskUserQuestion`): apresente o conflito em 2-3 linhas (as duas posições,
   a fonte de cada uma, e qual vence pela precedência) e as opções: **aplicar a fonte de maior
   autoridade** (recomendado), **abrir/atualizar ADR** (se a decisão precisa mudar), **Block**.
3. **Registrar** a decisão em `approvals.yaml` (gate correspondente, decisão + motivo).
4. Se a fonte perdedora é uma **rule em drift**, sinalizar para correção (atualizar a rule ou seu
   `based_on:` — ver `conflict-handling` G3 / `/forge:constitution`).

Conflitos **não relevantes** (estilo, naming menor) seguem o fluxo normal de review — não bloqueiam.

## 3. No pipeline de specs e no `/forge:analyze`

- `/forge:analyze` classifica conflitos arquiteturais como **BLOCKER** (tipo `conflict`). Um
  `analysis.md` com BLOCKER aberto **trava** a transição para `implementing` (gate determinista —
  `spec-transition.sh` recusa `implementing` enquanto houver BLOCKER no `analysis.md`).
- Os agents de specification e architecture seguem a regra "**Pare e sinalize em conflito
  explícito**" — a mesma que os agents de engineering já adotam.

## 4. Decisões transversais (cross-cutting)

Decisões que vinculam **todos** os bounded contexts (isolamento multi-tenant, auditoria, formato de
erro padrão) têm **dono único** — vivem em ADR/constitution, não como `DD` por módulo. Um módulo que
tome uma `DD` local contradizendo uma decisão global está em conflito relevante (bloqueante).
