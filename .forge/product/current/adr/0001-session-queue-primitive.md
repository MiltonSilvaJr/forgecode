# 0001. Fila por sessão como primitiva do ForgeCode, sem barramento global

- **Status:** accepted
- **Data:** 2026-11-05
- **Decisores:** Milton Antonio da Silva Jr

## Contexto e Problema

O ForgeCode precisa expor uma fila de entrada por sessão com semântica explícita, auditoria e
ergonomia de CLI, reproduzindo o melhor do `codex queue`. Era preciso decidir se essa capacidade
seria um barramento global entre processos ou uma fila por sessão sobre a inbox durável já
existente — e onde moraria a trilha de auditoria.

## Drivers da Decisão

- Preservar o comportamento existente do OpenCode e não criar endpoint novo (REQ-15).
- A inbox durável e a admissão idempotente por id já existem no core (`session.prompt`, `delivery`).
- A confirmação de leitura/ack do modelo está fora de escopo e a ociosidade se mede, não se presume.
- A trilha pedida é do despacho local, não um segundo registro global de estado.

## Opções Consideradas

1. Barramento global compartilhado (`agent_message_board`).
2. Endpoint novo `POST /api/session/:id/queue`.
3. Fila por sessão reusando `session.prompt` com `delivery` + trilha local JSONL.

## Decisão

Fila por sessão reusando `POST /api/session/:sessionID/prompt` com `delivery` (default `queue`) e
`id` idempotente, sem endpoint novo, com trilha de auditoria append-only local (`forgequeue/audit.jsonl`)
e flag `experimental.forgequeue.enabled` (default `false`). Não há barramento global.

## Consequências

- Positivas: nenhuma superfície nova de servidor; a entrega (`queue`/`steer`) e a idempotência são
  herdadas do core; rollout reversível pela flag; leitura (list/activity/sessions) segue disponível
  com a flag desligada.
- Negativas/débitos: a trilha é local ao host e não cobre enfileiramentos de outro cliente; a
  resolução por título é instável se o título mudar (mitigada por `--thread` como caminho canônico
  e erro explícito em ambiguidade); a "geração atual" é aposentada por arquivamento até o Change 3
  trazer registro próprio.

## Links

- Change de origem: forgequeue
