# Relacional OLTP — boas práticas

Base: seção 1 da base consolidada do change `data-engineer-agent` (julgada em 2026-09-26), mais as regras da casa do template. Marcas: [J] reconferido pelo juiz na fonte primária; [2F] duas fontes independentes; [1F] documentação oficial do produto; [Interp.] interpretação técnica; [Heurística] limiar de partida. Onde a base e uma rule do template divergem, vale a rule, e o texto diz isso.

## Quando usar e quando não

Relacional é a escolha para integridade referencial forte, restrições declarativas e consulta flexível sobre dado estruturado [J: Azure "Understand data models"]. No template, a `rules/data/data-governance.md` atribui ao PostgreSQL parâmetros, configurações e relacional paramétrico, e atribui o transacional de negócio ao MongoDB; pela decisão H-01 (a) do dono, o relacional só responde pelo transacional de negócio quando um ADR do projeto escolheu SQL. Sem esse ADR, o pedido é conflito de estratégia de persistência e segue o bloco `CONFLITO`.

Não usar como motor de varredura analítica massiva, como armazenamento de binário grande (vai para object storage) nem como fila de alto volume sem desenho específico; escala horizontal exige sharding ou particionamento e tem custo relevante [J: Azure]. Semiestruturado dentro do relacional é legítimo quando o documento é átomo que a regra de negócio não subdivide: `jsonb` com estrutura razoavelmente fixa e tamanho controlado, porque update trava a linha inteira [1F: PostgreSQL JSON types]. Busca textual e vetorial ficam aqui só quando `jsonb`, full-text ou `pgvector` bastam; fora disso, o pedido está fora da cobertura dos especialistas de dados.

## Regras da casa (precedência sobre a base)

- **Dinheiro como inteiro.** Valor monetário é `BIGINT NOT NULL` na menor unidade (centavos), nunca `DECIMAL`, `NUMERIC`, `FLOAT` nem o tipo `money` (`rules/domain/money-as-cents.md` §4). A base recomendava `numeric` para valor e foi subordinada à rule. A rule tem `applies_to` .NET, React e Kotlin; pela decisão H-03 (a) do dono, esta skill estende a recomendação a toda stack e a qualquer `*.sql`, por recomendação própria, sem mudar o `applies_to` da rule, e a resposta diz isso. Nome de coluna com a unidade explícita (`valor_em_centavos`, `amount_in_cents`); aritmética com arredondamento NBR 5891.
- **RLS obrigatório.** Tabela multi-tenant de domínio no PostgreSQL tem `tenant_id`, filtro global na aplicação e Row-Level Security no banco; dispensa só por exceção formal documentada (`data-governance.md`, `data-config-sql.md`). A base oferecia "`tenant_id` à frente do índice composto ou RLS"; a rule tira o "ou": o índice é complemento de desempenho, nunca alternativa.
- **Evolução segura de schema.** Toda migração segue `rules/data/schema-evolution.md`: expand, migrate/backfill, contract, e a task declara engine, impacto em leitura e escrita, compatibilidade, rollback e dados históricos afetados.

## Modelagem e normalização

- Normalizar até a terceira forma normal no OLTP; desnormalizar só como decisão consciente, registrada, com o custo de manter a cópia coerente [2F].
- Toda tabela com chave primária; no PostgreSQL, PK e UNIQUE criam B-tree automaticamente [1F].
- Tipos no PostgreSQL: `timestamptz` em vez de `timestamp`, `text` com `CHECK` em vez de `char(n)`, `jsonb` em vez de `json`, identity em vez de `serial` [2F: wiki "Don't Do This" e regras do squawk]. `numeric` fica para decimal exato não monetário; o tipo `money` nunca (dinheiro é `BIGINT` em centavos pela regra da casa).
- `NOT EXISTS` em vez de `NOT IN (subquery)` (nulo na subconsulta anula o resultado); intervalo de tempo como `>= a AND < b`, não `BETWEEN` com timestamp [1F].
- EAV (tabela genérica de atributo e valor) troca integridade e tipagem por flexibilidade aparente; prefira colunas ou `jsonb` com estrutura conhecida (R-08) [2F: Karwin].
- Soft delete generalizado precisa de índice parcial para unicidade e não atende eliminação de dado pessoal: expurgo físico ou anonimização quando a LGPD exige (R-07) [Interp.].

## Chaves e índices

- `bigint` identity em vez de `int` ou `serial` [2F]. UUID como PK quando a geração é distribuída: preferir v7, ordenado por tempo; `uuidv7()` é nativo no PostgreSQL 18 [J]. O ganho de localidade do v7 no B-tree é raciocínio sólido, mas a documentação do PostgreSQL não o afirma [Incerto — base §8.2 item 2].
- Indexar toda coluna de FK: o PostgreSQL não indexa a coluna referenciadora, e `DELETE`/`UPDATE` no pai varre o filho (R-01) [2F: documentação e squawk/strong_migrations].
- Índice nasce da consulta real (`WHERE`, `JOIN`, `ORDER BY`), não da intuição [Heurística: Use The Index, Luke].
- Em produção, `CREATE INDEX CONCURRENTLY`, fora de bloco de transação; se falhar, deixa índice inválido que precisa ser removido [2F]. No MySQL 8.4, índice secundário é `INPLACE` com leitura e escrita liberadas [1F].
- Índice parcial para unicidade condicional (ex.: `UNIQUE (email) WHERE deleted_at IS NULL`), sem substituir particionamento por muitos índices parciais disjuntos [1F].
- Remover índice com `idx_scan = 0` depois de uma janela representativa: índice sem uso custa escrita e memória [1F].
- Multi-tenant com linha compartilhada: `tenant_id` como primeira coluna das PKs e dos índices compostos, junto com o RLS obrigatório [Interp. da base §7.3, subordinada à rule].

## Migrações reversíveis

- Mudança incompatível segue Parallel Change (expand → migrate → contract) [2F: Sato/Fowler; strong_migrations]. A fase contract (drop) vai em deploy separado [Interp.].
- Rename nunca in-place com a aplicação no ar: coluna nova, dual-write, backfill em lotes, migrar a leitura, remover a antiga (R-03) [2F].
- Troca de tipo reescreve a tabela no PostgreSQL e exige `ALGORITHM=COPY` no MySQL: coluna nova com backfill em vez de `ALTER COLUMN ... TYPE` (R-03, R-13) [2F].
- FK e CHECK em tabela grande: `NOT VALID` primeiro, `VALIDATE CONSTRAINT` depois [2F]. `SET NOT NULL` em tabela grande: `CHECK (col IS NOT NULL) NOT VALID`, validar, então `SET NOT NULL` [2F].
- `ADD COLUMN` com default não volátil é só metadado desde o PostgreSQL 11; no MySQL 8.4 é `INSTANT` por padrão [2F/1F].
- `lock_timeout` e `statement_timeout` na sessão da migração, não no `postgresql.conf`: sem `lock_timeout`, um `ALTER` esperando lock enfileira todo o tráfego atrás dele (R-21) [2F].
- Backfill fora da transação de DDL, em lotes, com throttling e retomável [1F]. Migração idempotente quando puder ser reexecutada por deploy ou recuperação (`schema-evolution.md`).
- Migrações entre tecnologias da base: OFFSET → keyset e `serial` → identity seguem o mesmo expand/contract, com leitura dupla até o corte [Interp.].

## Transações e isolamento

- Defaults: PostgreSQL Read Committed; InnoDB REPEATABLE READ; SQL Server READ COMMITTED, com RCSI desligado on-premises e ligado no Azure SQL Database [1F cada]. O mesmo nome de nível tem semânticas diferentes entre motores (phantom, gap locks); nunca porte a suposição de um motor para outro [1F cada].
- Read Committed é barato e basta para operação de linha única ou com lock explícito; Serializable (SSI) protege invariante entre linhas (saldo, limite) ao custo de retry obrigatório [1F].
- Em Repeatable Read e Serializable no PostgreSQL a aplicação reexecuta a transação em SQLSTATE `40001`; deadlock é `40P01` (R-11) [J: apêndice de códigos de erro].
- SQL Server: a Microsoft recomenda o READ COMMITTED com versionamento de linha para toda aplicação que não depende do comportamento bloqueante; a vítima de deadlock recebe o erro 1205 e a sessão `system_health` já captura `xml_deadlock_report` [J].
- `NOLOCK`/READ UNCOMMITTED lê dado não confirmado, duplica ou omite linhas; nunca como "otimização" (R-10) [1F].
- `idle_in_transaction_session_timeout` contra sessão ociosa com transação aberta, que segura lock e trava o vacuum (R-09) [1F].
- Analytics pesado no primário OLTP disputa recurso com a transação: réplica de leitura ou especialista analítico (R-15) [2F].

## Locks e deadlock

- Lock pessimista (`SELECT ... FOR UPDATE`) para recurso muito disputado; otimista (coluna de versão ou ETag) quando conflito é raro [1F].
- Prevenção de deadlock: ordem consistente de aquisição de lock, transação curta e sem interação de usuário, retry no aborto [2F].
- DDL também trava: todo `ALTER` pega lock forte; por isso `lock_timeout` curto e retry na migração (R-03, R-21) [2F].
- MySQL: não force `ALGORITHM=COPY` nem `LOCK=SHARED/EXCLUSIVE` (R-13) [2F].
- **Prova de corrida/espera vem do servidor, não do relógio do host.** Testando ordenação de lock em PostgreSQL efêmero (container): medir a duração de uma segunda sessão pelo cronômetro do host confunde contenção real com latência de infraestrutura (um `docker exec` sob carga alta leva segundos por si só); e um laço `WHILE NOT EXISTS (SELECT ... FROM pg_stat_activity ...)` dentro de uma transação pode nunca ver a mudança de outra sessão, porque as estatísticas ficam em cache por transação — o laço estoura o limite e a ordenação pretendida nunca aconteceu, com resultado aparentemente válido. Sinalize entre sessões pelo próprio servidor (`application_name` + `pg_stat_clear_snapshot()` a cada volta do laço de espera), prove espera observando `wait_event_type = 'Lock'` da sessão que está presa em `pg_stat_activity` — não um tempo de parede externo — e rode o harness de dentro do container, para tirar a latência do `docker exec` do caminho [Heurística].

## Acesso a dados: N+1, paginação e pool

- **N+1** resolvido com carga ansiosa (Django `select_related`/`prefetch_related`; Rails `includes`/`preload`/`eager_load`) e modo estrito em teste (Rails `strict_loading`) (R-05) [2F].
- **Paginação** por keyset em lista grande; OFFSET computa e descarta linhas e gera duplicata ou omissão com inserção concorrente (R-06) [2F: Winand e documentação do PostgreSQL]. `LIMIT` sempre com `ORDER BY` determinístico [1F].
- **`SELECT *`** em código de aplicação acopla ao schema e traz coluna que ninguém lê (R-14) [1F: SQLFluff AM04].
- **Pool pequeno.** Ponto de partida `(núcleos × 2) + spindles efetivos`, fórmula atribuída ao projeto PostgreSQL, com a ressalva do próprio texto de que não há análise para SSD e que SSD tende a pedir menos conexões [J: HikariCP; Heurística].
- **PgBouncer em modo transaction:** não usar `SET`/`RESET`, `LISTEN`, cursor `WITH HOLD`, `PREPARE`/`DEALLOCATE` em SQL nem advisory lock de sessão; prepared statement de protocolo funciona com `max_prepared_statements > 0` (R-12) [J]. RLS que depende de `SET` de sessão precisa de `SET LOCAL` dentro da transação nesse modo [Interp.].
- **RLS e pool de conexões (EF/Npgsql, HikariCP, node-postgres, PgBouncer):** o tenant lido pela policy (`current_setting('app.tenant_id')`) é gravado por transação, com `SET LOCAL` ou `set_config('app.tenant_id', $1, true)`, nunca por sessão: o pool devolve a conexão com o GUC ainda setado e a próxima requisição herda o tenant (R-12). No EF Core, o interceptor de conexão ou de comando abre a transação e seta o tenant nela; o `DbContext` com filtro global continua como segunda barreira [Interp. sobre PostgreSQL `set_config` e o reuso de conexão dos pools]. A tabela tem `ENABLE` e `FORCE ROW LEVEL SECURITY`, e a aplicação conecta com papel que não é dono da tabela e não tem `BYPASSRLS` (R-20) [1F: PostgreSQL, row security policies].
- **Banco compartilhado entre serviços** é antipattern: cada serviço dono do seu schema, e integração pelas vias da regra do dono (R-16) [J: Azure].

## Particionamento de tabela OLTP

Particionar só quando a tabela passa da memória do servidor e a chave de partição está no `WHERE`; poucos milhares de partições é o limite confortável do planner [1F]. Séries temporais cujo volume cabe e cuja consulta cruza dado transacional podem ficar aqui com extensão tipo TimescaleDB; agregação histórica vai para o especialista analítico [J: Azure cita TimescaleDB].

## Integração, exposição e dado sensível

- Nenhum terceiro recebe credencial, rota de rede ou permissão sobre banco interno: nada de usuário read-only para parceiro, `publicly_accessible = true` ou regra de rede aberta a `0.0.0.0/0` na porta do banco (R-17, R-18). Entrega a terceiro é REST ou fila dedicada, pela regra de integração do agente.
- PAN nunca em claro em tabela, log ou backup; token no lugar do PAN, e o `check-data-governance.sh` com o `data-classification.json` do projeto é a fonte sobre quais campos são PAN ou PII [J: PCI DSS 3.5.1, via base §7.1].
- LGPD: soft delete não é eliminação; dado pessoal tem base legal e prazo de retenção antes de escolher o armazenamento [Interp. da base §7.2].

## Decisões e trade-offs

| Decisão | A favor | Contra |
|---|---|---|
| Read Committed × Serializable | barato, sem retry | invariante entre linhas exige lock explícito ou SSI com retry em `40001` |
| Lock pessimista × otimista | previsível sob disputa alta | otimista evita espera quando conflito é raro, mas exige retry |
| PK sequencial × UUIDv7 | compacta e local | UUID gera sem coordenação; v7 reduz a penalidade de localidade [Incerto no benefício] |
| Particionar × não particionar | poda e expurgo por partição | custo de planner e de chave obrigatória no `WHERE` |
| Keyset × OFFSET | estável e barato em página funda | não salta para página arbitrária |

## Fontes

[PostgreSQL docs](https://www.postgresql.org/docs/current/) (transaction-iso, explicit-locking, sql-createindex, sql-altertable, ddl-constraints, indexes-partial, ddl-partitioning, queries-limit, runtime-config-client, monitoring-stats) · [PostgreSQL UUID functions](https://www.postgresql.org/docs/current/functions-uuid.html) · [PostgreSQL error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) · [PostgreSQL wiki, Don't Do This](https://wiki.postgresql.org/wiki/Don%27t_Do_This) · [MySQL 8.4 online DDL](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html) · [MySQL 8.4 isolation](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html) · [SQL Server deadlocks guide](https://learn.microsoft.com/en-us/sql/relational-databases/sql-server-deadlocks-guide) · [SET TRANSACTION ISOLATION LEVEL](https://learn.microsoft.com/en-us/sql/t-sql/statements/set-transaction-isolation-level-transact-sql) · [Azure OLTP](https://learn.microsoft.com/en-us/azure/architecture/data-guide/relational-data/online-transaction-processing) · [Azure data store models](https://learn.microsoft.com/en-us/azure/architecture/data-guide/technology-choices/understand-data-store-models) · [Parallel Change](https://martinfowler.com/bliki/ParallelChange.html) · [Use The Index, Luke — no-offset](https://use-the-index-luke.com/no-offset) · [Django QuerySet API](https://docs.djangoproject.com/en/5.2/ref/models/querysets/) · [Rails Active Record Query Interface](https://guides.rubyonrails.org/active_record_querying.html) · [HikariCP About Pool Sizing](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing) · [PgBouncer features](https://www.pgbouncer.org/features.html) · [squawk rules](https://squawkhq.com/docs/rules) · [strong_migrations](https://github.com/ankane/strong_migrations) · [Brandur, soft deletion](https://brandur.org/soft-deletion) · [Karwin, SQL Antipatterns](https://pragprog.com/titles/bksqla/sql-antipatterns/) · [SQLFluff rules](https://docs.sqlfluff.com/en/stable/reference/rules.html) · Regras da casa: `.forge/rules/domain/money-as-cents.md`, `.forge/rules/data/data-governance.md`, `.forge/rules/data/data-config-sql.md`, `.forge/rules/data/schema-evolution.md`.
