---
title: Convenções de Nomenclatura de Banco de Dados
applies_to:
  - backend
  - migrations
priority: high
last_reviewed: 2026-05-08
---

# Convenções de Nomenclatura de Banco de Dados

## PostgreSQL — Regra Geral

**Usar `snake_case` para todos os identificadores.** PascalCase e camelCase são PROIBIDOS.

### Tabelas

- Plural para coleções; singular para configuração/lookup
- Prefixo de módulo opcional mas recomendado quando há risco de colisão entre schemas

```sql
-- Correto
ledger_entries
voyage_slots
user_roles
mia_arrecadacao_eventos
system_configs

-- Errado
LedgerEntries   -- PascalCase
userRoles       -- camelCase
```

### Colunas

| Tipo | Convenção | Exemplo |
|------|-----------|---------|
| Primary key | `{tabela_singular}_id` | `ledger_entry_id` |
| Foreign key | `{tabela_referenciada_singular}_id` | `tenant_id`, `user_id` |
| Timestamps | `created_at`, `updated_at`, `deleted_at` | — |
| Booleans | prefixo `is_`, `has_`, `can_` | `is_active`, `has_mfa_enabled` |
| Valores monetários | sufixo `_cents` | `amount_cents`, `fee_cents` |

```sql
-- Correto
tenant_id UUID NOT NULL,
amount_cents BIGINT NOT NULL,
is_active BOOLEAN NOT NULL DEFAULT true,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()

-- Errado
TenantId      -- PascalCase
amountCents   -- camelCase
isActive      -- camelCase
createdAt     -- camelCase
```

### Índices, Constraints e Foreign Keys

| Tipo | Padrão | Exemplo |
|------|--------|---------|
| Índice | `idx_{table}_{cols}` | `idx_ledger_entries_tenant_id` |
| Unique | `uq_{table}_{cols}` | `uq_users_email_tenant_id` |
| Primary key | `pk_{table}` | `pk_ledger_entries` |
| Foreign key | `fk_{table}_{ref_table}` | `fk_voyage_slots_voyages` |
| Check | `chk_{table}_{desc}` | `chk_ledger_entries_amount_positive` |

### Schemas PostgreSQL

- `snake_case`
- Um schema por módulo: `module_a`, `module_b`, etc.
- Schema `public` apenas para objetos compartilhados de infraestrutura

### EF Core — Configuração Obrigatória

EF Core DEVE ser configurado para gerar nomes em `snake_case`:

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    foreach (var entity in modelBuilder.Model.GetEntityTypes())
    {
        entity.SetTableName(entity.GetTableName()!.ToSnakeCase());

        foreach (var property in entity.GetProperties())
            property.SetColumnName(property.GetColumnName().ToSnakeCase());

        foreach (var key in entity.GetKeys())
            key.SetName(key.GetName()!.ToSnakeCase());

        foreach (var index in entity.GetIndexes())
            index.SetDatabaseName(index.GetDatabaseName()!.ToSnakeCase());

        foreach (var fk in entity.GetForeignKeys())
            fk.SetConstraintName(fk.GetConstraintName()!.ToSnakeCase());
    }
}
```

### Migrations

- Nome do arquivo: `{timestamp}_{PascalCaseDescription}.cs`
- Nomes de tabelas e colunas dentro da migration: sempre `snake_case`

```csharp
migrationBuilder.AddColumn<bool>(
    name: "is_active",        // snake_case
    table: "ledger_entries",  // snake_case
    nullable: false,
    defaultValue: true);
```

---

## MongoDB — Convenções

- **Collections**: plural, `camelCase` ou `snake_case` (escolha um e mantenha consistente por BC)
- **Campos**: `camelCase`
- **ID**: `_id` (padrão MongoDB)
- **Timestamps**: `createdAt`, `updatedAt` (camelCase, alinhado com convenção MongoDB)
- Schemas DEVEM ser explicitamente validados (não usar `strictQuery: false` sem justificativa)

```javascript
// Correto
{
  "_id": ObjectId("..."),
  "tenantId": "...",
  "amountCents": 1590,
  "isActive": true,
  "createdAt": ISODate("...")
}
```

---

## Multi-tenancy

- `tenant_id` é **obrigatório** em todas as tabelas de dados de negócio (naming: ver acima).
- A **estratégia de isolamento** (coluna, EF Global Query Filter, RLS) é decidida pela governança de
  dados, não por esta rule de naming: ver `.forge/rules/data/data-config-sql.md` (SQL) e a matriz
  transversal em `.forge/rules/data/data-governance.md`. Esta rule cobre apenas **nomenclatura**;
  quando houver divergência sobre isolamento, a decisão de governança/ADR vence (FORGE.md §2.1).

---

## Proibições Explícitas

- PascalCase ou camelCase em identificadores PostgreSQL
- Prefixos desnecessários (`tbl_`, `col_`, `fld_`)
- Nomes genéricos (`data`, `info`, `temp`, `value`)
- Usar aspas duplas para referenciar identificadores (indica nome errado)
- Valores monetários sem sufixo `_cents`
- `tenant_id` ausente em tabelas de negócio

## Princípio Final

Se você precisa de aspas duplas para referenciar um identificador PostgreSQL, o nome está errado.
