---
description: Extrai capabilities-stub para um baseline vazio a partir dos boundaries do grafo de código (fluxo brownfield) — a parte determinista; requirements ficam para curadoria semântica ou para o archive de changes reais.
argument-hint: "[--dry-run]"
---

# /forge:baseline extract — baseline inicial (brownfield)

Pré-requisito: `/forge:codegraph`; idealmente após `/forge:discover` e `/forge:onboard`.

## Execução

```bash
bash .forge/scripts/baseline-extract.sh --dry-run   # previsão (não grava)
bash .forge/scripts/baseline-extract.sh             # cria stubs em product/current/capabilities/
```

Agrupa os arquivos grafados por boundary (`src/<x>`, `services/<x>`, `packages/<x>`...) em **capabilities candidatas** e escreve `spec.yaml` stubs (sem requirements — `requirements: []`). **Não** sobrescreve capabilities existentes.

## Depois (curadoria — não determinista)

Os stubs marcam o território; os requirements de cada capability nascem:
- pela **curadoria semântica** (agente lê o módulo + docs e propõe requisitos com cenários), ou
- **organicamente**, conforme changes reais são arquivados (`/forge:archive` adiciona requirements às capabilities que tocam).

Em brownfield grande, rode antes o `graph-reviewer` (gate de confiabilidade do grafo). Ingestão de `docs/product` legado: `/forge:publish-docs` é o caminho inverso; para trazer docs antigos ao baseline use `.forge/scripts/ingest-legacy.sh`.
