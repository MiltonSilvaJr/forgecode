---
description: Publica o baseline (.forge/product/current/) em docs/product/ como publicação gerada para humanos, com lock de integridade — edições manuais em docs/product passam a ser detectadas pelo validate-archive.
argument-hint: ""
---

# /forge:publish-docs — publicar o baseline

## Execução (determinista)

```bash
bash .forge/scripts/publish-docs.sh
```

O script espelha `product/current/` → `docs/product/` (cópia fiel + `README.md` de aviso) e grava `.forge/cache/publish.lock` com o sha256 de cada arquivo publicado.

## Relatório (2-3 linhas)

Quantos arquivos publicados, áreas cobertas (capabilities/prd/adr/...), e o lembrete: **docs/product é leitura** — mudanças entram por change ativo + `/forge:archive` + re-publish. Se o `validate-archive` acusar "changed without baseline origin", a correção é reverter a edição manual (ou trazê-la para um change) e re-publicar.

## Regras

- Nunca edite `docs/product/` à mão depois do publish (§8.2 — o lock existe para flagrar isso).
- Re-execução é idempotente (sobrescreve publicação + lock).
- Em repo legado ainda não ingerido (`docs/product` é fonte antiga), rode primeiro `bash .forge/scripts/ingest-legacy.sh` — o publish só cobre o que está no baseline.
