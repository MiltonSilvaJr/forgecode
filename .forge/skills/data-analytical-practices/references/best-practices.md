# Analítico — boas práticas

Base: seção 5 da base consolidada do change `data-engineer-agent` (julgada em 2026-09-26) e os itens analíticos das seções 7.2 a 7.4. Marcas: [J] reconferido pelo juiz na fonte primária; [2F] duas fontes independentes; [1F] documentação oficial do produto; [Interp.] interpretação técnica; [Heurística] limiar de partida. Limiares são de cada produto e não se transferem entre produtos.

## Quando usar e quando não

Varredura e agregação histórica em larga escala, BI, ciência de dados, com armazenamento colunar e modelo desnormalizado [2F]. Não usar como backend transacional, para lookup de baixa latência nem como fonte da verdade operacional. Não montar warehouse quando réplica de leitura ou columnstore HTAP (índice columnstore não clusterizado sobre tabela OLTP no SQL Server) resolve o volume atual [1F]. Separar OLTP de OLAP quando agregação pesada disputa recurso com a transação [2F].

## Modelagem dimensional

- Processo de quatro passos de Kimball: processo de negócio, **grão**, dimensões e fatos; grão atômico; grãos diferentes nunca na mesma fato (A-01) [1F: Kimball].
- Tipos de fato: transação, snapshot periódico, acumulado e factless; tipos de medida: aditiva, semiaditiva e não aditiva [1F].
- Chave substituta nas dimensões (exceção aceitável: data); a fato liga à dimensão pela chave substituta, nunca pela natural quando a dimensão tem histórico (A-02) [1F].
- Dimensões conformadas e bus matrix para integrar processos [1F].
- Dimensões achatadas (star), evitando snowflake; OLTP replicado como warehouse não é modelo dimensional (A-04) [1F].
- Junk, degenerate e role-playing dimensions [1F].
- Medida monetária em inteiro na menor unidade, coerente com a regra da casa `money-as-cents.md` [regra da casa].
- Multi-tenant: coluna de tenant em toda fato e dimensão conformada; RLS no warehouse para consumo compartilhado [Interp. da base §7.3].

## SCD

- SCD1 sobrescreve; SCD2 acrescenta linha com início, fim e indicador de corrente [2F: Kimball e dbt].
- SCD2 com `dbt snapshot`: estratégia `timestamp` recomendada (robusta a colunas novas ou removidas); `check` só sem `updated_at` confiável [J].
- `hard_deletes` (`ignore` como default, `invalidate`, e `new_record`, que grava a exclusão como linha com `dbt_is_deleted`) a partir do dbt 1.9, substituindo `invalidate_hard_deletes` (A-14) [J].
- `dbt_valid_to_current` como marcador de linha corrente [J].
- Validar sobreposição e buraco de vigência com `lead(valid_from) OVER (PARTITION BY nk ORDER BY valid_from)` comparado a `valid_to` (A-03) [Heurística].
- SCD1 × SCD2: história contra chave substituta e join cuidadoso [Interp.].

## Warehouse e lakehouse

- O paper CIDR 2021 aponta os problemas da arquitetura lake + warehouse (consistência entre as duas, dado defasado, suporte limitado a ML, custo duplicado) e define lakehouse como armazenamento barato com recursos de SGBD — ACID, versionamento, auditoria, indexação [2F: CIDR 2021 e VLDB 2020]. A tese de que o warehouse "vai definhar" é de autores da Databricks e entra como opinião de fornecedor [Incerto].
- Formato de tabela aberto (Iceberg, Delta, Hudi) quando há múltiplos motores ou exigência de evitar lock-in; warehouse gerenciado quando a prioridade é operação simples e SQL maduro [Interp.].
- Camadas bronze → silver → gold (recomendação, não requisito) equivalem a dbt staging (`stg_`) → intermediate (`int_`) → marts (`fct_`/`dim_`) [2F no princípio].
- ELT quando o alvo tem computação elástica; ETL quando o alvo é limitado ou quando compliance exige staging auditado antes da carga [1F: Azure].
- Manutenção de tabela é custo operacional real do lakehouse e entra na decisão: Delta `OPTIMIZE`/`VACUUM`; Iceberg expire snapshots, remove old metadata, delete orphan files, compact data files, rewrite manifests [2F].

## Formatos colunares

- Armazenamento colunar com modelo desnormalizado é a base do analítico [2F]; o ganho vem de ler só as colunas da consulta e de comprimir bem colunas homogêneas [Interp.].
- Formatos de tabela abertos (Iceberg, Delta, Hudi) acrescentam ACID, versionamento e evolução de schema sobre arquivos colunares [2F: CIDR 2021 e VLDB 2020].
- Arquivos de 128 MB a 1 GB nas camadas de consumo; milhares de arquivos pequenos degradam leitura e metadado (A-05) [1F: Fabric; 2F no problema].
- Data skipping por min/max funciona melhor com dado ordenado pelas colunas de filtro [2F].

## Particionamento e clustering

1. Não superparticionar. Databricks: não particionar abaixo de 1 TB, liquid clustering de 1 a 100 TB, partição com pelo menos 1 GB, e liquid clustering recomendado para todas as tabelas gerenciadas [J]. BigQuery: preferir clustering quando o particionamento deixaria menos de cerca de 10 GB por partição [J]. Os limiares são de cada produto (A-05).
2. Particionamento oculto (Iceberg): o motor deriva a partição (`day(event_time)`), faz pruning sem o consumidor conhecer o layout e evolui o esquema de partição sem reescrever; no estilo Hive, formato errado da coluna de partição dá resultado silenciosamente incorreto e esquecer o filtro dá varredura total (A-06) [1F: Iceberg].
3. Diretório estilo Hive é aceitável para a zona bruta de arquivos (especialista de object storage); tabela silver/gold usa particionamento oculto ou liquid clustering [J: Databricks e Iceberg; base §0.3 item 4].
4. Clustering ou ordenação pelas colunas de filtro; Snowflake: clustering key só em tabela multi-TB com consulta seletiva, da menor para a maior cardinalidade, e reclustering consome créditos (A-07) [1F]. Delta `ZORDER BY` perde eficácia a cada coluna acrescentada [1F].
5. Particionar × clusterizar: pruning previsível e expiração por partição contra granularidade fina sem explosão de metadados [J: BigQuery].

## dbt, qualidade e contratos

1. Convenções `stg_`/`int_`/`fct_`/`dim_`; mart lê de `ref()`, nunca de `source()` direto (A-10) [1F].
2. Testes em todo modelo: `unique` e `not_null` na chave de grão, `relationships`, `accepted_values` (A-11) [1F].
3. `source freshness` com `warn_after`/`error_after` e `loaded_at_field` [1F].
4. Incremental com `unique_key` e janela de lookback para fato atrasado, mais `--full-refresh` periódico; microbatch com `event_time`, `batch_size` e `lookback` (A-08) [1F].
5. Contratos de modelo (`contract: enforced: true`) nos modelos públicos; remover coluna, mudar tipo ou remover constraint é breaking change e gera nova versão (A-09) [1F]. Entre produtor e consumidor fora do dbt: Open Data Contract Standard (Bitol, LF AI & Data) [1F].
6. `SELECT *` em mart propaga mudança de schema ao consumidor (A-12) [1F: SQLFluff AM04].
7. Lint: dbt-project-evaluator e SQLFluff [1F].
8. Dataset sem catálogo, dono ou contrato vira data swamp (A-13) [1F: CIDR].
9. Incremental × full refresh: custo contra drift; contrato rígido × agilidade: coordenação contra quebra silenciosa [Interp.].

## Dado sensível, LGPD e custo

- Fato e dimensão guardam chave substituta ou token, nunca PAN; o mapa chave→pessoa fica num armazenamento mutável e eliminável (pseudonimização) [Interp. da base §7.2].
- Chave derivada de identificador pessoal (CPF, PAN) é HMAC com chave secreta gerida em KMS, nunca hash sem chave: o CPF tem cerca de 10^9 valores e um SHA-256 sem sal é revertido por força bruta em segundos, e para PAN o PCI DSS 4.0.1 (3.5.1.1) exige hash criptográfico com chave [1F: PCI DSS 4.0.1; Interp. para a LGPD].
- Eliminação do titular no lakehouse é `DELETE`/`MERGE` seguido de `VACUUM` (Delta) ou `expire_snapshots` + `remove_orphan_files` (Iceberg) dentro do prazo acordado; a retenção de time travel da tabela com dado pessoal é menor que esse prazo (A-15) [1F: Delta e Iceberg; Interp. no prazo].
- Dimensão SCD2 com dado pessoal guarda só a chave substituta; nome, e-mail, telefone e endereço ficam numa tabela SCD1 mutável e eliminável (A-16) [Interp.].
- Inventário de campo pessoal (`cpf|rg|email|telefone|nome|endereco|data_nasc`) em DDL, schema de evento e modelo dbt, cruzado com a existência de política de retenção por dataset: `grep -arniE '(cpf|rg|email|telefone|nome|endereco|data_nasc)' models/` é item de revisão, não regra do scanner [Heurística].
- Custo: créditos no Snowflake (reclustering), bytes varridos no BigQuery (sem filtro de partição), manutenção de tabela no lakehouse; peça a estimativa da unidade dominante antes de recomendar mudança de modelo [1F; Interp. na síntese].

## Fontes

[Kimball techniques](https://www.kimballgroup.com/data-warehouse-business-intelligence-resources/kimball-techniques/dimensional-modeling-techniques/) · [Lakehouse, CIDR 2021](https://www.cidrdb.org/cidr2021/papers/cidr2021_paper17.pdf) · [Delta Lake, VLDB 2020](https://people.eecs.berkeley.edu/~matei/papers/2020/vldb_delta_lake.pdf) · [Iceberg partitioning](https://iceberg.apache.org/docs/latest/partitioning/) · [Iceberg maintenance](https://iceberg.apache.org/docs/latest/maintenance/) · [Delta VACUUM](https://docs.delta.io/latest/delta-utility.html#remove-files-no-longer-referenced-by-a-delta-table) · [Delta deletion vectors](https://docs.delta.io/latest/delta-deletion-vectors.html) · [LGPD, Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) · [Delta optimizations](https://docs.delta.io/latest/optimizations-oss.html) · [Databricks when to partition](https://docs.databricks.com/aws/en/tables/partitions) · [Databricks medallion](https://docs.databricks.com/aws/en/lakehouse/medallion) · [BigQuery partitioned tables](https://docs.cloud.google.com/bigquery/docs/partitioned-tables) · [Snowflake clustering keys](https://docs.snowflake.com/en/user-guide/tables-clustering-keys) · [Azure ETL/ELT](https://learn.microsoft.com/en-us/azure/architecture/data-guide/relational-data/etl) · [SQL Server columnstore](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/columnstore-indexes-overview) · [Microsoft Fabric medallion](https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture) · [dbt structure](https://docs.getdbt.com/best-practices/how-we-structure/1-guide-overview) · [dbt contracts](https://docs.getdbt.com/docs/mesh/govern/model-contracts) · [dbt snapshots](https://docs.getdbt.com/docs/build/snapshots) · [dbt data tests](https://docs.getdbt.com/docs/build/data-tests) · [dbt incremental](https://docs.getdbt.com/best-practices/materializations/4-incremental-models) · [dbt-project-evaluator](https://dbt-labs.github.io/dbt-project-evaluator/latest/rules/) · [ODCS](https://bitol-io.github.io/open-data-contract-standard/latest/) · [SQLFluff](https://docs.sqlfluff.com/en/stable/reference/rules.html)
