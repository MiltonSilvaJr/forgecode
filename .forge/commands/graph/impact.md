---
description: Análise de impacto de uma spec ou diff sobre o grafo de código — quais arquivos dependem (transitivamente) do que mudou. Obrigatório para scale >= 3 e no pré-flight do /forge:archive quando o change toca código.
argument-hint: "--change <id> | --diff [<base>] | --files a,b,c"
---

# /forge:impact — análise de impacto

Pré-requisito: grafo construído (`/forge:codegraph`); rode `/forge:graph update` antes se tocou código.

## Execução

```bash
bash .forge/scripts/impact.sh --change <change-id>   # seeds = affected_paths do manifest; grava impact.json
bash .forge/scripts/impact.sh --diff [<base>]        # seeds = arquivos alterados (git)
bash .forge/scripts/impact.sh --files a.ts,b.ts      # seeds ad-hoc
```

Calcula o conjunto **impactado** por alcançabilidade reversa no grafo (quem depende, direta ou transitivamente, dos arquivos-semente). Determinista.

## Quando é obrigatório

- **Scale ≥ 3** (§11.2): rode antes de `/forge:tasks` e mantenha atualizado.
- **Pré-flight do `/forge:archive`** (§13.2 passo 7): se o change declara `affected_paths` de código e há grafo, o archive **exige** `impact.json` fresco (fingerprint do grafo batendo) — `--change <id>` grava esse arquivo. Stale → archive falha pedindo re-scan após `/forge:graph update`.

## Relatório (conciso)

Nº de sementes → nº de impactados, e os paths impactados de maior camada (api/application) primeiro. Use para decidir cobertura de testes e revisão. Não despeje a lista inteira se for grande (§17.6) — destaque os críticos.
