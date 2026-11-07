---
description: Constrói o grafo de código persistente (.forge/graph/graph.json) com o engine nativo zero-dep — nodes (arquivos/camadas) + edges (imports/refs) deterministas. LLM só para summaries opcionais, cacheados por fingerprint.
argument-hint: ""
---

# /forge:codegraph — construir o grafo de código

Engine: subset local nativo (ADR `0001-graph-engine`) — extração estrutural determinista, zero dependência, zero tokens.

## 1. Construção (determinista)

```bash
bash .forge/scripts/graph.sh build
```

Gera `.forge/graph/{graph.json, report.md, cache/}`. Nodes = arquivos de código (lang, loc, fingerprint estrutural, layer); edges = imports/refs internos resolvidos. Summaries nascem `null` (a estrutura não precisa de LLM).

### 1.1 Mapa de camadas declarável

A camada sai de duas fontes, nesta ordem: o bloco `codegraph.layers` do frontmatter do `.forge/FORGE.md`, avaliado na ordem declarada (o primeiro padrão que casar vence), e — para o que ninguém declarou — a heurística embutida do engine (convenções de pasta + sufixo de projeto .NET). Repositório sem o bloco produz exatamente o grafo de sempre.

```yaml
codegraph:
  layers:
    - path: "platform/src/services/*/*.Api"     # plataforma satélite
      layer: api
    - path: "packages/dotnet/*.Abstractions"    # pacotes compartilhados
      layer: contracts
    - path: "legacy/src/*.DAL"                  # monólito pré-Clean-Architecture
      layer: infrastructure
    - path: "apps/web"                          # fora da taxonomia (ver §1.2)
      layer: unknown
  orphans_by_design:
    - "platform/src/services/*/*.Api/AssemblyMarker.cs"
```

Glob no dialeto de `authz.pep_paths` (`*` casa dentro de um segmento; o padrão cobre o próprio path e tudo abaixo dele), mais `**` como segmento inteiro atravessando zero ou mais segmentos. Quando um layout .NET, JVM ou de frontend cai inteiro em `unknown`, a correção é **declarar o layout**, não pedir mais regex ao engine.

### 1.2 `unknown` é estado legítimo, não buraco

`unknown` significa duas coisas distintas e só uma delas é lacuna. Declarar `layer: unknown` para um path é a afirmação "a taxonomia `domain/application/infrastructure/api/contracts` não descreve este código" — frontend, tooling, MDX de documentação, spec de E2E de browser: esses nós recebem `taxonomy: "out"` e **saem do denominador** de `stats.layer_coverage`. `unknown` alcançado por queda da heurística continua no denominador, porque esse é buraco de verdade e a métrica tem de continuar dizendo isso. Reportar os dois com o mesmo número é o que fazia 18% de um repositório medido parecer lacuna sem haver lacuna.

## 2. Validação

```bash
bash .forge/scripts/graph.sh validate
```

`forge validate graph` (§19.5): schema, integridade referencial, IDs duplicados, órfãos, cobertura de camadas, qualidade de summaries, compatibilidade com changed files.

**Órfãos são classificados antes de virarem alerta.** Marcador de assembly resolvido por reflexão, migration descoberta por varredura de assembly, spec de E2E de browser e conteúdo estático são órfãos **por design** — não importar código de produção é o estado correto deles. O warning nomeia só o que sobra: código morto ou import que o extractor não resolveu. Nós de camada `test`, de camada `config`, sob `migrations/` e declarados fora da taxonomia são reconhecidos sem declaração; o resto vai em `codegraph.orphans_by_design`. Sem candidato algum, não há warning — num repositório medido, 926 órfãos escondiam exatamente 4 achados reais.

## 3. Summaries (opcional, sob demanda)

Os nós vêm com `summary: null`. Para enriquecer a semântica (útil ao `/forge:onboard` e `/forge:c4`), invoque o agent `file-analyzer` (Agent tool) **apenas nos nós relevantes** (ex.: alto fan-in) — cada summary é cacheado por fingerprint, então mudança cosmética não re-summariza (zero tokens). Não summarize o repo inteiro de uma vez sem necessidade.

## 4. Relatório (2-3 linhas)

Nodes/edges/linguagens, nós por camada e a **cobertura de camada** (do `report.md`: classificados sobre a população em escopo, com o total declarado fora da taxonomia à parte), e quantos summaries estão stale. Aponte linguagens detectadas que o extractor nativo não cobre bem (candidatas à camada tree-sitter opt-in — ADR 0001) se houver diretórios de código grandes fora do grafo.

## Regras

- Não edite `graph.json`/`cache/` à mão — são gerados; custo/logs ficam fora do commit (§20).
- Em repo grande, comece pelo `/forge:discover` (inventário lite) antes do grafo completo (§16.1).
