---
title: Evolução segura de schema
applies_to:
  - relational-database
  - migrations
priority: high
last_reviewed: 2026-07-22
---

# Evolução segura de schema

Toda alteração de schema começa pela compatibilidade do contrato em produção, não pela conveniência da migration. Classifique a alteração no design e na task como compatível, expandida ou excepcional.

## Fluxo padrão

1. **Expand:** adicionar tabela, coluna nullable, índice ou nova representação sem remover o caminho antigo.
2. **Migrate/backfill:** preencher dados em lotes idempotentes, com observabilidade, limite de carga e plano para retomar após falha.
3. **Contract:** só remover/renomear coluna, tornar campo obrigatório ou mudar tipo depois que todos os produtores e consumidores estiverem migrados e a janela de compatibilidade tiver encerrado.

## Gate de design

Toda task com migration declara: engine, impacto em leitura/escrita, compatibilidade de API/evento, estratégia de rollback ou mitigação, dados históricos afetados e evidência de teste. Mudança destrutiva sem esses itens é bloqueante, exceto por exceção humana registrada no manifest ou ADR.

## Regras

- Migração precisa ser idempotente quando puder ser reexecutada por deploy, job ou recuperação.
- Não usar `latest` em imagens ou ferramentas de banco.
- Índices grandes, mudança de tipo e `NOT NULL` em tabela populada exigem estratégia específica do engine e avaliação de lock/downtime.
- O schema não é automaticamente o contrato dominante: APIs públicas, eventos versionados e ADRs podem exigir compatibilidade anterior ou posterior à migration.
- Para valores monetários, `domain/money-as-cents.md` prevalece sobre defaults de ORM, banco ou pack.
