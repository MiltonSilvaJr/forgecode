---
description: Tour de arquitetura e domínio para um agente/humano novo no repositório — camadas, módulos, fluxos de dependência e pontos de concentração, derivados do grafo de código. Não lê o repo inteiro; opera sobre graph.json.
argument-hint: "[<módulo ou capability>]"
---

# /forge:onboard — tour de arquitetura

Pré-requisito: `/forge:codegraph` (e baseline, se existir).

## Protocolo

1. Garanta grafo fresco (`/forge:graph update`).
2. Invoque o agent `architecture-analyzer` (Agent tool) sobre o `graph.json`: ele produz camadas presentes, fluxos de dependência entre módulos, violações de direção candidatas e nós de alto fan-in. Se um módulo/capability foi passado como argumento, foque nele (`graph.sh query <módulo>`).
3. Cruze com o baseline: liste as capabilities de `.forge/product/current/capabilities/` relacionadas e os ADRs aplicáveis.
4. Para os nós críticos (alto fan-in) sem summary, ofereça enriquecer via `file-analyzer` (cacheado por fingerprint).

## Saída (mapa navegável, conciso)

- **Camadas e módulos** (contagem por camada, mais a cobertura de `stats.layer_coverage`). Nó `unknown` com `taxonomy: "out"` é código que o repositório declarou fora da taxonomia — frontend, tooling, conteúdo estático — e não é lacuna: reporte-o à parte, nunca como buraco de arquitetura. Já `unknown` sem essa marca é layout que ninguém declarou, e a saída é declará-lo em `codegraph.layers` (ver `/forge:codegraph`);
- **Como as coisas se conectam** (fluxos principais);
- **Onde mexer com cuidado** (alto fan-in, violações de camada candidatas);
- **Próximas leituras** (3-5 arquivos-chave por relevância, não a árvore inteira).

Em greenfield/feature, o material visual é o `/forge:c4` + `overview.html`.
