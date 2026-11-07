# <NNNN>. Governança de dados e isolamento multi-tenant

- **Status:** accepted
- **Data:** <YYYY-MM-DD>
- **Decisores:** <plataforma/arquitetura>

> ADR de referência para ancorar as rules de governança de dados
> (`.forge/rules/data/*`). Ajuste os stores à stack real do projeto e marque
> `based_on: [ADR-<NNNN>]` nas rules derivadas.

## Contexto e Problema

O produto é multi-tenant e usa mais de um tipo de store. O isolamento entre tenants precisa ser uma
decisão única e transversal (mesmo princípio em todos os bounded contexts), expressa pelo mecanismo
adequado a cada store — não uma escolha por módulo (que gera divergência e vazamento).

## Decisão

Isolamento multi-tenant é **obrigatório** e tem **dono único**. Por store:

- **PostgreSQL (SQL — config/parâmetros/relacional):** `tenant_id` + EF Global Query Filter + **RLS**
  para tabelas multi-tenant de domínio. RLS dispensável **só por exceção formal documentada**.
- **MongoDB (NoSQL — transacional/eventos):** campo `tenant` + filtro de repositório/interceptor
  obrigatório (sem RLS nativo) + índice composto por `tenant`.
- **Redis/Memcache (cache):** namespacing de chave por tenant + TTL; nunca fonte de verdade;
  classes proibidas (segredos, dados de cartão, PII sem mascarar).

## Consequências

- Positivas: defesa em profundidade; sem divergência entre módulos; auditável.
- Negativas/débitos: exceções de RLS exigem registro formal; interceptor de tenant no MongoDB é
  responsabilidade da camada de acesso (não do chamador).

## Links

- Rules derivadas: `.forge/rules/data/{data-governance,data-config-sql,data-transactional-nosql,data-cache}.md`
- Precedência: FORGE.md §2.1; `.forge/rules/conventions/conflict-handling.md`
