---
title: "Audit Immutability — Append-Only e Triggers de Imutabilidade"
category: domain
priority: Alta
applies_to: ["services/**", "platform/docker/compose/postgres/**"]
---

# Audit Immutability — Append-Only e Triggers de Imutabilidade

## Princípio

Dados de auditoria, ledger e eventos regulatórios são **imutáveis por design**. Uma vez inseridos, nenhum registro pode ser alterado ou removido — nem por operadores, nem por migrações, nem por código de aplicação.

A imutabilidade é **enforced no banco de dados** via dois mecanismos complementares:

1. **REVOKE** — o role de aplicação `app` não possui privilégios de UPDATE/DELETE/TRUNCATE nas tabelas imutáveis.
2. **Trigger BEFORE UPDATE/DELETE** — mesmo que o REVOKE seja contornado (ex.: conexão direta), o trigger lança exceção e aborta a operação.

O código de aplicação não deve confiar apenas na lógica de negócio para garantir imutabilidade — o banco é a última linha de defesa.

---

## Tabelas Afetadas

| Tabela | Banco | BC | Motivo |
|--------|-------|----|--------|
| `ledger_entries` | `<service>_db` | <service> | SHA-256 hash chain de arrecadação |
| `ledger_integrity_checks` | `<service>_db` | <service> | Resultados de verificação de integridade |
| `<regulatory_events>` | `<service>_db` | <service> | Eventos regulatórios — acesso direto SQL |
| `<regulatory_records>` | `<service>_db` | <service> | Registros reportados ao regulador |
| `audit_*` | qualquer | todos | Qualquer tabela de auditoria de ações de usuário |
| `dispute_events` | `<service>_db` | <service> | Eventos de contestação (append-only) |

Toda nova tabela de auditoria ou ledger deve seguir esta convenção antes de entrar em produção.

---

## Mecanismo: REVOKE + Trigger

### Template obrigatório (PostgreSQL)

```sql
-- 1. Função de prevenção (compartilhada, criar apenas uma vez por banco)
CREATE OR REPLACE FUNCTION prevent_immutable_table_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'Tabela imutável: operação % proibida em %.%',
        TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- 2. Trigger por tabela imutável
CREATE TRIGGER trg_<table_name>_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON <table_name>
FOR EACH STATEMENT EXECUTE FUNCTION prevent_immutable_table_modification();

-- 3. REVOKE no role de aplicação
REVOKE UPDATE, DELETE, TRUNCATE ON <table_name> FROM app;
```

### Exemplo real (<service> — ledger_entries)

```sql
CREATE TRIGGER trg_ledger_entries_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON ledger_entries
FOR EACH STATEMENT EXECUTE FUNCTION prevent_immutable_table_modification();

REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM app;
```

---

## Convenção de Migrations

Migrations que criam tabelas imutáveis devem seguir o padrão de nomenclatura:

```
migration_<NNN>_create_immutable_<table_name>.sql
```

Exemplos:
- `migration_0001_create_immutable_ledger_entries.sql`
- `migration_0002_create_immutable_ledger_integrity_checks.sql`
| `<regulatory_events>` | `<service>_db` | <service> | Eventos regulatórios — acesso direto SQL |

Cada migration imutável deve incluir, obrigatoriamente:
1. `CREATE TABLE` com todos os campos e constraints
2. `CREATE TRIGGER trg_<table>_immutable`
3. `REVOKE UPDATE, DELETE, TRUNCATE ON <table> FROM app`

---

## Exceção: Retenção e Purge Legal

Há cenários regulatórios onde dados precisam ser removidos por obrigação legal (ex.: LGPD — direito ao esquecimento para dados não fiscais).

Regras para o caso excepcional:

1. **Role administrativo separado**: um role `app_admin` (diferente do `app`) mantém o privilégio de DELETE exclusivamente para purge legal.
2. **Auditoria do purge**: toda operação de purge deve ser registrada em `audit_purge_log` antes de executar o DELETE.
3. **Aprovação**: purge em produção exige aprovação de 2 membros da equipe (Process Control).
4. **Dados fiscais e regulatórios**: tabelas com obrigação de retenção indefinida sob regulação setorial **não são elegíveis** para purge legal.

---

## Verificação via Teste de Integração

Toda tabela imutável deve ter um teste de integração que verifica o trigger:

```csharp
[Fact]
public async Task LedgerEntries_UpdateAttempt_ThrowsException()
{
    // Arrange — inserir uma entrada válida
    await repository.Insert(validEntry);

    // Act & Assert — tentar UPDATE deve lançar exceção
    await Assert.ThrowsAsync<PostgresException>(async () =>
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.ExecuteAsync("UPDATE ledger_entries SET amount_cent = 0 WHERE entry_id = @id",
            new { id = validEntry.EntryId });
    });
}

[Fact]
public async Task LedgerEntries_DeleteAttempt_ThrowsException()
{
    await repository.Insert(validEntry);

    await Assert.ThrowsAsync<PostgresException>(async () =>
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.ExecuteAsync("DELETE FROM ledger_entries WHERE entry_id = @id",
            new { id = validEntry.EntryId });
    });
}
```

Esses testes devem usar **Testcontainers** com PostgreSQL real (não mock/in-memory).

---

## Anti-Patterns Proibidos

| Anti-pattern | Por quê é proibido |
|---|---|
| `UPDATE` em tabela de ledger para "corrigir" valor | Quebraria a SHA-256 hash chain; use `VOID` entry + nova entrada correta |
| Soft-delete com coluna `is_deleted` em tabelas de ledger | Viola o modelo append-only; registros nunca "desaparecem" |
| Desabilitar trigger em migration | Deixa janela de corrupção silenciosa |
| EF Core `DbContext.SaveChanges()` com `DbSet.Remove()` em entidade de ledger | Deve ser prevenido com override de `OnModelCreating` marcando entidade como sem operações de deleção |
| Usar role `app_admin` em código de aplicação | Role admin é para operações manuais emergenciais, não para código |

---

## Cross-Refs

- Ledger de Arrecadação (SHA-256 hash chain, trigger SQL completo): _spec de módulo a definir._
- PostgreSQL como banco relacional: _ADR a criar — sem equivalente aprovado no catálogo atual (DD-005)._
- [security-and-compliance.md](../architecture/security-and-compliance.md) — princípio geral de auditabilidade