---
description: Gera/sincroniza o backlog (markdown-first; Jira/GitHub Issues opcional) a partir de specs aprovadas — somente após gate humano explícito (§14.4). Delega ao agent product-backlog.
argument-hint: ""
---

# /forge:backlog — backlog após gate humano

## Pré-condições (verificar antes de qualquer geração)

1. Existe insumo aprovado: change(s) com `tasks_reviewed: true` no manifest, ou módulos legados com `tasks.md` aprovados (pipeline scale 4).
2. **Gate humano (§14.4):** apresente via `AskUserQuestion` o escopo exato (quais changes/módulos, quantas tasks, se haverá sync Jira/GitHub) e prossiga **somente com Approve**. O gate `tasks_reviewed` aprovado no manifest é o registro formal; esta confirmação de escopo não cria novo registro.

## Execução

Invoque o agent `product-backlog` (Agent tool) com o escopo aprovado. Ele opera **markdown-first** (`product-backlog.md` + sprints) e só depois sincroniza Jira (labels `task:TASK-NN` — convenção consumida por sprint/deploy-orchestrator). Sem MCP atlassian disponível, a parte Jira é pulada com aviso (markdown continua válido).

## Regras

- Nunca crie issues/épicos sem o Approve do passo 2 — backlog dispara trabalho de terceiros.
- Mudou a spec depois do backlog? Re-rode com o mesmo escopo: o agent é idempotente (atualiza em vez de duplicar).
