---
title: Dados em SQL (PostgreSQL) — config, parâmetros e relacional
applies_to:
  - sql
  - postgresql
priority: high
based_on: []
---

# Dados em SQL (PostgreSQL)

Deriva de `data-governance.md`. Uso: dados relacionais com integridade referencial forte —
parâmetros, configurações, paramétricos, e tabelas de domínio multi-tenant.

## Isolamento multi-tenant (obrigatório)

- **`tenant_id`** em toda tabela de dados de negócio (FK convencional; ver `database-naming`).
- **EF Core Global Query Filter** configurado por entidade multi-tenant — proteção na aplicação.
- **RLS (Row-Level Security)** habilitado para tabelas **multi-tenant de domínio** — proteção no banco.
- RLS **só pode ser dispensado por exceção formal documentada** (ADR ou registro de exceção com
  justificativa e aprovação). Ausência de RLS sem exceção formal = conflito bloqueante.

Defesa em profundidade: a aplicação filtra (EF) **e** o banco isola (RLS) — uma falha de uma camada
não vaza dados de outro tenant.

## Convenções

- Naming conforme `database-naming.md` (snake_case, `tenant_id`, índices `idx_{table}_{cols}`).
- Migrations versionadas; nunca alterar schema sem migration.
- Money como inteiro (centavos) quando aplicável; arredondamento NBR 5891.
