---
title: Dados em NoSQL (MongoDB) — transacional e eventos
applies_to:
  - nosql
  - mongodb
priority: high
based_on: []
---

# Dados em NoSQL (MongoDB)

Deriva de `data-governance.md`. Uso: dados transacionais de negócio, eventos, alto volume e schema
flexível.

## Isolamento multi-tenant (obrigatório)

- Campo **`tenant`** obrigatório em todo documento de negócio.
- **Filtro de `tenant` obrigatório na camada de repositório/interceptor** — o MongoDB **não tem RLS
  nativo**, então a defesa em profundidade é: interceptor de acesso que injeta o filtro de tenant em
  toda query, **não** confiar no chamador. Acesso a coleção multi-tenant sem esse filtro = conflito
  bloqueante.
- **Índice composto** começando por `tenant` nas coleções multi-tenant (isolamento + performance).

## Convenções

- Consistência: `write concern` `majority` para dados críticos; leituras conforme criticidade.
- Idempotência em handlers de evento (chave de idempotência).
- Sem PII em claro além do necessário; mascarar em logs.
- Nomes de coleção em kebab/`snake` conforme convenção do projeto; sem tecnologia no nome.
