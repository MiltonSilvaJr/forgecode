# Analítico — catálogo de antipatterns

Conjunto fechado de ids deste catálogo (design §2.5 do change `data-engineer-agent`): A-01 a A-14, da base consolidada (§5.6), mais A-15 e A-16, acrescentados na revisão de DBA do change (eliminação do titular no lakehouse). Id fora desse conjunto reprova o w250.

Cada entrada tem cinco campos. `Detecção` usa um de quatro rótulos: `scan.sh <ID>` (estática, o `scripts/scan.sh` executa), `ferramenta`, `runtime` (consulta contra o sistema real, documentada e nunca executada pelo scanner) e `revisão`; um segundo rótulo complementar pode vir depois de `;`. As consultas de runtime foram redigidas pela pesquisa e não executadas contra sistema real; a sintaxe de detectores específicos de produto (INFORMATION_SCHEMA do BigQuery, `DESCRIBE DETAIL`, tabela `files` do Iceberg, `SYSTEM$CLUSTERING_INFORMATION`) é [Incerto] até ser conferida. Toda varredura recursiva de exemplo usa `grep -a` ou `rg`.

### A-01 — Grão misto ou não declarado
- **Sintoma:** soma que dobra ao juntar com uma dimensão; linhas de naturezas diferentes na mesma fato.
- **Por quê:** grãos diferentes na mesma fato tornam toda agregação ambígua.
- **Correção:** declarar o grão atômico por fato (processo, grão, dimensões, fatos); uma fato por grão.
- **Detecção:** runtime — `SELECT <colunas_do_grão>, count(*) FROM fct GROUP BY <colunas_do_grão> HAVING count(*) > 1`.
- **Evidência:** [1F] Kimball.

### A-02 — Fato ligada por chave natural a dimensão SCD2
- **Sintoma:** fato duplicada ao juntar com a dimensão histórica.
- **Por quê:** a chave natural tem várias linhas numa dimensão com histórico.
- **Correção:** chave substituta (`*_sk`) resolvida na carga da fato pela vigência.
- **Detecção:** runtime — `SELECT nk, count(*) FROM dim WHERE is_current GROUP BY nk HAVING count(*) > 1`; revisão — colunas de junção da fato que não são `*_sk`.
- **Evidência:** [2F] Kimball e dbt.

### A-03 — SCD2 com sobreposição ou buraco
- **Sintoma:** duas versões correntes ao mesmo tempo, ou período sem nenhuma versão.
- **Por quê:** carga que não fecha a vigência anterior no mesmo passo.
- **Correção:** `dbt snapshot` com estratégia `timestamp`; teste de vigência contínua.
- **Detecção:** runtime — `lead(valid_from) OVER (PARTITION BY nk ORDER BY valid_from)` comparado a `valid_to`.
- **Evidência:** [Heurística].

### A-04 — Snowflake ou OLTP replicado como warehouse
- **Sintoma:** marts com uma dezena de joins; o schema do OLTP copiado para o warehouse.
- **Por quê:** o modelo normalizado de transação não serve consulta analítica.
- **Correção:** modelo dimensional com dimensões achatadas.
- **Detecção:** ferramenta — dbt-project-evaluator "Models with Too Many Joins"; revisão — contagem de `JOIN` em `models/marts`.
- **Evidência:** [1F] Kimball e dbt-project-evaluator.

### A-05 — Superparticionamento ou arquivos pequenos
- **Sintoma:** milhares de partições de poucos MB; planejamento de consulta mais lento que a execução.
- **Por quê:** partição abaixo do limiar do produto multiplica metadado e arquivos pequenos.
- **Correção:** Databricks: não particionar abaixo de 1 TB, liquid clustering; BigQuery: clustering quando a partição ficaria abaixo de ~10 GB; compactação periódica.
- **Detecção:** runtime — tamanho por partição (INFORMATION_SCHEMA, `DESCRIBE DETAIL`, tabela `files` do Iceberg — sintaxe [Incerto]); contagem em `pg_inherits`.
- **Evidência:** [2F] problema; [J] limiares do Databricks e do BigQuery; detector [Heurística].

### A-06 — Partição estilo Hive declarada à mão em tabela
- **Sintoma:** `PARTITIONED BY (dt)` e `INSERT ... PARTITION (dt=...)`; consultas sem predicado de partição fazendo varredura total.
- **Por quê:** no estilo Hive o consumidor precisa conhecer o layout; formato errado da coluna de partição dá resultado silenciosamente incorreto e esquecer o filtro varre tudo.
- **Correção:** particionamento oculto (Iceberg, com transformação sobre a coluna de evento) ou liquid clustering; Hive só para arquivo bruto.
- **Detecção:** `scan.sh A-06` (estática em `*.sql`; `PARTITIONED BY` cujo primeiro termo é transformação do Iceberg — `days(`, `months(`, `years(`, `hours(`, `bucket(`, `truncate(` — é o particionamento oculto recomendado e fica fora); revisão — consultas sem predicado de partição.
- **Evidência:** [1F] Iceberg partitioning; detector [Heurística].

### A-07 — Clustering na cardinalidade errada
- **Sintoma:** reclustering consumindo créditos sem ganho de poda.
- **Por quê:** chave de clustering sem relação com os filtros, ou da maior para a menor cardinalidade.
- **Correção:** Snowflake: clustering só em tabela multi-TB com consulta seletiva, da menor para a maior cardinalidade; Delta `ZORDER BY` com poucas colunas.
- **Detecção:** revisão — `cluster_by` nos configs dbt contra os filtros das consultas.
- **Evidência:** [1F] Snowflake e Delta.

### A-08 — Incremental sem unique_key ou sem lookback
- **Sintoma:** linhas duplicadas no grão depois de reprocessar; fato atrasado que nunca entra.
- **Por quê:** sem `unique_key` a carga incremental só acrescenta; sem lookback o dado que chega atrasado fica de fora.
- **Correção:** `unique_key` na chave de grão, janela de lookback, `--full-refresh` periódico; microbatch com `event_time`, `batch_size` e `lookback`.
- **Detecção:** `scan.sh A-08` (estática em `models/**/*.sql`: `materialized='incremental'` sem `unique_key` nem estratégia `microbatch` no arquivo; o microbatch do dbt 1.9+ reprocessa por `event_time` e dispensa `unique_key`).
- **Evidência:** [1F] dbt incremental.

### A-09 — Modelo público sem contrato
- **Sintoma:** consumidor quebra quando uma coluna muda de tipo ou some.
- **Por quê:** sem contrato imposto, mudança de schema passa em silêncio.
- **Correção:** `contract: enforced: true` e versão de modelo para breaking change; ODCS entre produtor e consumidor fora do dbt.
- **Detecção:** ferramenta — dbt-project-evaluator "Public Models Without Contracts".
- **Evidência:** [1F] dbt contracts.

### A-10 — Mart lendo source direto
- **Sintoma:** `source()` dentro de `models/marts/`.
- **Por quê:** pula staging, testes e renomeação; a lógica de limpeza se repete e diverge.
- **Correção:** mart lê de `ref()` de staging ou intermediate.
- **Detecção:** `scan.sh A-10` (estática em `models/marts/`); ferramenta — dbt-project-evaluator "Direct Join to Source".
- **Evidência:** [1F] dbt structure e dbt-project-evaluator.

### A-11 — Chave de grão sem teste
- **Sintoma:** duplicata no grão descoberta pelo usuário do dashboard.
- **Por quê:** sem `unique` e `not_null` na chave, ninguém confere o grão.
- **Correção:** testes `unique` e `not_null` na chave de grão de todo modelo.
- **Detecção:** ferramenta — dbt-project-evaluator "Missing Primary Key Tests".
- **Evidência:** [1F] dbt data tests.

### A-12 — SELECT * em mart
- **Sintoma:** coluna nova da origem aparece no dashboard; coluna removida quebra o consumidor.
- **Por quê:** o mart propaga qualquer mudança de schema de cima.
- **Correção:** listar as colunas; contrato no modelo público.
- **Detecção:** `scan.sh A-12` (estática em `models/marts/`); ferramenta — SQLFluff `AM04`.
- **Evidência:** [1F] SQLFluff.

### A-13 — Data swamp
- **Sintoma:** datasets sem dono, sem catálogo, sem contrato; objetos em bucket sem tabela registrada.
- **Por quê:** dado que ninguém consegue achar nem confiar.
- **Correção:** catálogo, dono e contrato por dataset; retenção declarada.
- **Detecção:** revisão — dataset sem catálogo, dono ou contrato; runtime — objeto em bucket sem tabela registrada.
- **Evidência:** [1F] CIDR 2021.

### A-14 — Snapshot com invalidate_hard_deletes legado
- **Sintoma:** `invalidate_hard_deletes: true` em snapshot.
- **Por quê:** substituído por `hard_deletes` a partir do dbt 1.9 (`ignore`, `invalidate`, `new_record`).
- **Correção:** migrar para `hard_deletes: invalidate` (ou `new_record` quando a exclusão precisa virar linha com `dbt_is_deleted`).
- **Detecção:** `scan.sh A-14` (estática em `snapshots/`, `*.yml` e `*.sql`).
- **Evidência:** [J] dbt snapshots.

### A-15 — Eliminação do titular que para no DELETE
- **Sintoma:** o `DELETE` ou `MERGE` do pedido de eliminação roda, mas a linha continua legível por `VERSION AS OF`/`TIMESTAMP AS OF` (Delta) ou por snapshot anterior (Iceberg) até a manutenção.
- **Por quê:** Delta e Iceberg são versionados: o `DELETE` grava uma versão nova e os arquivos antigos, com o dado do titular, só saem no `VACUUM` (Delta, depois da retenção de `delta.deletedFileRetentionDuration`) ou no `expire_snapshots` seguido de `remove_orphan_files` (Iceberg). Enquanto isso o dado pessoal continua armazenado e recuperável, e a LGPD (art. 16 e art. 18, VI) pede eliminação, não ocultação.
- **Correção:** o procedimento de eliminação é `DELETE`/`MERGE` e, dentro do prazo acordado com o DPO, `VACUUM` (Delta) ou `expire_snapshots` + `remove_orphan_files` (Iceberg); a retenção de time travel da tabela com dado pessoal fica menor que esse prazo; deletion vectors do Delta exigem `REORG TABLE ... APPLY (PURGE)` antes do `VACUUM` para reescrever os arquivos.
- **Detecção:** runtime — `DESCRIBE HISTORY <tabela>` (Delta) ou a tabela de metadados `snapshots` (Iceberg) conferindo que nenhuma versão anterior ao pedido sobrevive além do prazo; revisão — tabela com campo pessoal sem política de retenção de time travel.
- **Evidência:** [1F] Delta Lake (VACUUM, time travel) e Iceberg maintenance; a ligação com o prazo da LGPD é [Interp.].

### A-16 — Dimensão SCD2 com atributo pessoal
- **Sintoma:** `dbt snapshot` ou dimensão tipo 2 com nome, e-mail, telefone ou endereço como coluna rastreada; cada mudança do titular vira uma linha nova.
- **Por quê:** o SCD2 guarda por construção todo o histórico do atributo, então a eliminação do titular precisa apagar N linhas em N versões, e o time travel da tabela multiplica o problema (A-15).
- **Correção:** a dimensão histórica guarda só a chave substituta ou o token; os atributos pessoais ficam numa tabela SCD1 mutável e eliminável, juntada por essa chave quando necessário; se o histórico do atributo pessoal é requisito, ele tem base legal e prazo próprios registrados.
- **Detecção:** revisão — colunas de `snapshots/*.sql` e de `dim_*` com nomes de dado pessoal (`grep -arniE '(cpf|email|telefone|nome|endereco|data_nasc)' snapshots/ models/marts/`).
- **Evidência:** [Interp.] da base §7.2 (pseudonimização) sobre [2F] Kimball e dbt snapshots.
