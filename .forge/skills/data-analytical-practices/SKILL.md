---
name: data-analytical-practices
description: |
  Boas práticas e catálogo de antipatterns de analítico — modelagem dimensional (Kimball), warehouse e lakehouse (Iceberg, Delta), particionamento e clustering de tabela, formatos colunares, SCD e dbt — com varredura determinística em scripts/scan.sh: partição estilo Hive declarada à mão, modelo incremental sem unique_key, mart lendo source() direto, SELECT * em mart e snapshot com invalidate_hard_deletes. Use ao declarar grão e fatos, desenhar dimensão com histórico, escolher entre warehouse e lakehouse, particionar ou clusterizar tabela, revisar projeto dbt, contrato de modelo e manutenção de tabela, ou quando o data-engineer delegar o domínio analítico. Não use para OLTP, lookup de baixa latência, fonte da verdade operacional, nem para bucket, prefixo e ciclo de vida de arquivo (data-object-storage).
---

# data-analytical-practices

Referência do especialista `data-analytical`. O conhecimento está em `references/` e foi julgado contra fonte primária (base consolidada do change `data-engineer-agent`, 2026-09-26); cada afirmação carrega a marca de evidência da base: [J] reconferido na fonte primária, [2F] duas fontes, [1F] documentação oficial do produto, [Interp.] interpretação técnica, [Heurística] limiar de partida.

## Escopo

Varredura e agregação histórica em larga escala, BI e ciência de dados, sobre armazenamento colunar e modelo desnormalizado. No medallion, este especialista responde por formato de tabela, particionamento e clustering de tabela, modelagem, dbt, contratos e manutenção de tabela; bucket, prefixo, ciclo de vida, criptografia e WORM de arquivo são do `data-object-storage`. Diretório estilo Hive é aceitável só para arquivo bruto; em tabela silver/gold o padrão é particionamento oculto (Iceberg) ou liquid clustering, e nada de partição em tabela abaixo de ~1 TB no Databricks. Séries temporais: agregação histórica e dashboards ficam aqui; ingestão operacional por chave vai para o `data-nosql`.

## Protocolo

Ordem fixa. É a ordem que torna a resposta auditável.

1. **Escopo.** Liste os paths afetados (`models/`, `snapshots/`, DDL de tabela, configs de clustering). Para cada fato: processo de negócio e grão declarado.
2. **Rules do projeto.** Leia `.forge/rules/data/*`, `.forge/rules/domain/money-as-cents.md` (medida monetária em inteiro na menor unidade também no warehouse), ADRs e baseline. Divergência relevante para e vira `CONFLITO` (`.forge/rules/conventions/conflict-handling.md`).
3. **Detecção.** `bash .forge/scripts/check-data-governance.sh --path <path>` (interprete pela linha: `CONFLICT` é achado; `universo-vazio` e `node >= 20` são "não verificado") e `bash .forge/skills/data-analytical-practices/scripts/scan.sh --root <path> [--root <path>...]`. Inventário de campo pessoal (`cpf`, `email`, `nome`, `data_nasc`) é item de revisão com `grep -a` cruzado com o `data-classification.json`, não regra do scanner: todo `email` viraria achado.
4. **Julgamento.** Cada `FOUND` é candidato. `PARTITIONED BY (days(ts))` numa tabela Iceberg é particionamento oculto legítimo e também casa A-06: julgue pelo motor.
5. **Relatório.** Uma linha por regra, inclusive as limpas; todo antipattern apontado cita o id (`A-10`) e, quando o scanner o achou, `arquivo:linha`. Limiar de produto (1 TB no Databricks, ~10 GB por partição no BigQuery) sempre com o produto nomeado: não se transfere entre produtos.

## O que o scanner não faz

Ele lê texto: não verifica grão, sobreposição de SCD2, chave de grão sem teste, modelo público sem contrato nem tamanho de partição, nem se a eliminação do titular chegou ao time travel (A-15) — isso é consulta de runtime ou ferramenta (dbt-project-evaluator, SQLFluff), documentado no catálogo. A maquinaria do harness (`.forge/agents`, `.forge/scripts`, `.forge/schemas`, `.forge/skills`, `.forge/rules` e afins) e os diretórios de adapter (`.claude` e `.agents`) ficam fora do universo, como os worktrees aninhados: numa instalação nova `--root .` só varre o projeto; `.forge/specs` e `.forge/product` entram. O scanner localiza; quem revisa decide.

## Referências

- `references/best-practices.md` — modelagem dimensional, SCD, warehouse e lakehouse, formatos colunares, particionamento e clustering, manutenção, dbt e contratos, com fonte e marca de evidência.
- `references/antipatterns.md` — catálogo A-01 a A-16.
- `scripts/scan.sh` — detecção estática de A-06, A-08, A-10, A-12 e A-14; contrato em `--help`.
