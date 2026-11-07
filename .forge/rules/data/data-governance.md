---
title: Governança de Dados — fonte única e matriz transversal
applies_to:
  - all
priority: high
based_on: []
---

# Governança de Dados (guardrail G4 — decisão transversal com dono único)

> A decisão de **tratamento de dados** é transversal: vale para todos os bounded contexts e se
> expressa de forma **diferente por tipo de store**. Esta é a fonte única; as rules por store
> (`data-config-sql`, `data-transactional-nosql`, `data-cache`) derivam dela. Em projeto real,
> ancore esta rule e as filhas num ADR de governança de dados (`based_on: [ADR-NNNN]`); o template
> não traz ADR (decisão do projeto — `/forge:adr`). Veja `templates/product/adr.md`.

## Isolamento multi-tenant — uma decisão, um mecanismo por store

O isolamento multi-tenant é **uma só decisão** (dono único), mapeada ao mecanismo de cada store.
Um módulo **não escolhe** mecanismo divergente; divergência é conflito relevante e **bloqueia**
(`conflict-handling.md` G1).

| Store | Tipo | Isolamento obrigatório | Defesa em profundidade |
|---|---|---|---|
| PostgreSQL (SQL) | parâmetros, configurações, paramétricos relacionais | `tenant_id` + **EF Global Query Filter** + **RLS** p/ tabelas multi-tenant de domínio | RLS no banco; dispensa **só por exceção formal documentada** |
| MongoDB (NoSQL) | transacional, eventos, alto volume | campo `tenant` + **filtro de repositório/interceptor obrigatório** (Mongo não tem RLS nativo) | índice composto por `tenant`; interceptor na camada de acesso |
| Redis / Memcache (cache) | cache efêmero, performance | **namespacing de chave por tenant** (`tenant:{id}:...`) | TTL explícito; classes proibidas (segredos, PAN/CVV, PII sem mascarar) |

## Como escolher o store

- **Relacional, integridade referencial forte, config/paramétrico** → PostgreSQL.
- **Transacional de negócio, eventos, schema flexível, alto volume** → MongoDB.
- **Cache/performance, dado derivável e descartável** → Redis/Memcache (nunca fonte de verdade).

## Anti-padrões (bloqueantes)

- Um módulo declarar "RLS opcional"/"sem RLS" para tabela multi-tenant de domínio em PostgreSQL.
- Acesso a coleção MongoDB multi-tenant sem filtro de `tenant` na camada de repositório.
- Chave de cache sem namespace de tenant (vetor de vazamento cross-tenant).
- Tratar a mesma questão de isolamento de forma diferente entre dois módulos.
