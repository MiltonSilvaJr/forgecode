---
title: Cache (Redis / Memcache) — efêmero e performance
applies_to:
  - cache
  - redis
  - memcache
priority: high
based_on: []
---

# Cache (Redis / Memcache)

Deriva de `data-governance.md`. Uso: cache efêmero e performance. **Nunca** fonte de verdade — todo
dado em cache deve ser derivável/recuperável da fonte primária.

## Isolamento multi-tenant (obrigatório)

- **Namespacing de chave por tenant**: toda chave inclui o tenant — `tenant:{id}:<recurso>:<id>`.
  Cache sem namespace de tenant é **vetor de vazamento cross-tenant** = conflito bloqueante.
- **TTL explícito** em toda entrada — nada de cache sem expiração.

## Classes de dado proibidas em cache

- Segredos/credenciais, chaves privadas.
- PAN/CVV/track data (PCI) e qualquer dado de cartão.
- PII sem mascaramento.

## Convenções

- Política de invalidação explícita (quando e como a entrada é invalidada na escrita da fonte).
- Serialização versionada (evitar quebrar leitura de cache em deploy).
- Degradação graciosa: indisponibilidade do cache não derruba o fluxo (cai para a fonte).
