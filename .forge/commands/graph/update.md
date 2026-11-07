---
description: Atualiza o grafo de código incrementalmente — só reprocessa se os fingerprints estruturais mudaram. Mudança cosmética (comentário, whitespace) é no-op e custa zero tokens.
argument-hint: ""
---

# /forge:graph update — atualização incremental

## Execução

```bash
bash .forge/scripts/graph.sh update
```

Recalcula os fingerprints estruturais e compara com o cache:

- **Sem mudança estrutural** (só comentários/whitespace/reindentação) → "graph up to date (zero tokens)" — nada é reprocessado, summaries cacheados preservados.
- **Mudança estrutural** (novo import, nova declaração, arquivo novo/removido) → grafo regenerado; summaries dos nós alterados marcados stale para recuradoria sob demanda.

## Quando rodar

- Após implementar tasks que tocaram código (antes de `/forge:impact` ou `/forge:archive`).
- O `doctor` avisa staleness quando arquivos grafados mudaram desde o último build.

## Regras

- É idempotente e barato — pode rodar sempre; o no-op em mudança cosmética é o ponto (§16.2).
- Summaries só são regenerados (LLM) por decisão explícita via `file-analyzer`, nunca automaticamente no update.
