---
description: Inventário determinístico do repositório (modo lite, §16.1) — stack, comandos run/test/build, estrutura, boundaries, mudanças e fingerprints — gravado em .forge/graph/manifest.json. Pré-graph barato; o grafo completo chega no MVP4.
argument-hint: ""
---

# /forge:discover — inventário brownfield (lite)

## 1. Execução (determinista)

```bash
bash .forge/scripts/discover.sh
```

O script detecta stack (node-ts/dotnet/python/kotlin-android/go), comandos (run/test/build/typecheck/lint), estrutura de nível 1, boundaries, estado git (changed files, dirty, último commit), fingerprints dos manifestos de build e affected paths — e grava `.forge/graph/manifest.json`. Saída de uma linha.

## 2. Relatório (3-4 linhas, sem dump do JSON)

Leia o manifest gerado e resuma: stack detectada, comandos conhecidos/desconhecidos, nº de arquivos alterados e boundaries. Aponte lacunas (ex.: `test` desconhecido — o repo não declara script de teste).

## 3. Sincronia com o FORGE.md (oferecer, não impor)

Se o bloco `runtime:` do `.forge/FORGE.md` estiver vazio/incompleto e o discover detectou stack/comandos, **ofereça** (AskUserQuestion) preencher `primary_stack`/`run`/`test`/`typecheck`/`lint` com os valores detectados. Ao aplicar:

```bash
bash .forge/scripts/sync-adapters.sh --adapter all   # reflete no AGENTS.md
```

## Regras

- Não construa grafo, não leia conteúdo de código além dos manifestos — isto é o inventário barato; `/forge:codegraph` (MVP4) faz o resto.
- Re-execução é idempotente (sobrescreve o manifest com estado fresco).
