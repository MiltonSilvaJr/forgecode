# Relacional OLTP — catálogo de antipatterns

Conjunto fechado de ids deste catálogo (design §2.5 do change `data-engineer-agent`): R-01 a R-16 vêm da base consolidada (§1.3); R-17 a R-21 foram acrescentados pelo design (exposição de banco pela regra de integração do dono, dinheiro pela `money-as-cents.md`, RLS pela `data-governance.md` e `lock_timeout` da própria base R-03); R-22 foi acrescentado pela revisão de DBA de 2026-09-26 (índice em migração MySQL). Id fora desse conjunto reprova o w250.

Cada entrada tem cinco campos. `Detecção` usa um de quatro rótulos: `scan.sh <ID>` (estática, o `scripts/scan.sh` executa), `ferramenta` (linter ou analisador que o projeto roda), `runtime` (consulta contra o sistema real, documentada e nunca executada pelo scanner) e `revisão` (sem detector confiável); um segundo rótulo complementar pode vir depois de `;`. Consultas e comandos foram redigidos pela pesquisa e, salvo indicação, não foram executados contra sistema real: teste em ambiente não produtivo antes de promover a gate. Todo exemplo de varredura recursiva usa `grep -a` ou `rg`, para não perder a linha em arquivo com byte de controle.

### R-01 — FK sem índice
- **Sintoma:** `DELETE` ou `UPDATE` no pai fica lento conforme o filho cresce; lock na tabela filha durante a varredura.
- **Por quê:** o PostgreSQL indexa a PK referenciada, não a coluna referenciadora; a checagem de integridade varre o filho inteiro.
- **Correção:** índice (com `CONCURRENTLY` em produção) cujo prefixo cubra as colunas da FK.
- **Detecção:** runtime — `pg_constraint` com `contype = 'f'` sem `pg_index` cujo prefixo cubra `conkey` (validar com índice de expressão e ordem de coluna); ferramenta — squawk e strong_migrations avisam na migração.
- **Evidência:** [1F] PostgreSQL ddl-constraints; detector [Heurística].

### R-02 — Tabela sem chave primária
- **Sintoma:** linhas duplicadas impossíveis de corrigir individualmente; replicação lógica e CDC recusam ou degradam a tabela.
- **Por quê:** sem PK não há identidade de linha; `UPDATE`/`DELETE` pontual e dedupe dependem de todas as colunas.
- **Correção:** PK `bigint` identity ou UUIDv7; em tabela existente, coluna nova preenchida em lotes antes de declarar a PK.
- **Detecção:** runtime — `information_schema.tables` com LEFT JOIN em `table_constraints` do tipo `PRIMARY KEY` nulo.
- **Evidência:** [Heurística] detector; prática [1F] PostgreSQL.

### R-03 — Migração bloqueante
- **Sintoma:** deploy trava a tabela: fila de conexões, timeouts em cascata, aplicação fora do ar durante a migração.
- **Por quê:** `CREATE INDEX` sem `CONCURRENTLY` bloqueia escrita; `ALTER COLUMN ... TYPE` reescreve a tabela; `RENAME` in-place quebra a versão da aplicação que ainda está no ar; `SET NOT NULL` varre a tabela sob lock forte.
- **Correção:** `CREATE INDEX CONCURRENTLY` fora de transação; coluna nova + backfill + troca de leitura para tipo e nome (expand → migrate → contract); `CHECK (...) NOT VALID` + `VALIDATE CONSTRAINT` antes de `SET NOT NULL`; `lock_timeout` curto na sessão.
- **Detecção:** `scan.sh R-03` (estática em `*.sql`; `CREATE INDEX` sobre tabela criada no mesmo arquivo, `SET NOT NULL` em arquivo com `VALIDATE CONSTRAINT` e o trecho de índice de migração MySQL ficam fora — o MySQL é o R-22); ferramenta — `squawk migrations/*.sql` ou strong_migrations no CI.
- **Evidência:** [2F] PostgreSQL sql-createindex e sql-altertable; squawk; strong_migrations.

### R-04 — Tipos problemáticos no PostgreSQL
- **Sintoma:** horário deslocado por fuso, espaço em branco à direita em `char(n)`, arredondamento de `money` dependente de `lc_monetary`, `json` sem índice nem igualdade, sequência de `serial` fora do controle da tabela.
- **Por quê:** `timestamp` sem fuso não guarda instante; `char(n)` preenche; `money` depende de locale; `json` guarda texto; `serial` é sequência avulsa com permissões próprias.
- **Correção:** `timestamptz`, `text`/`varchar` com `CHECK`, `jsonb`, `bigint GENERATED ... AS IDENTITY`; dinheiro nunca em `money` nem `NUMERIC`: `BIGINT` na menor unidade (R-19).
- **Detecção:** `scan.sh R-04` (estática em `*.sql`); ferramenta — squawk `prefer-timestamptz`, `ban-char-field`, `prefer-identity`; runtime — `information_schema.columns` com `timestamp without time zone`, `character`, `money`, `json`.
- **Evidência:** [2F] wiki "Don't Do This" e squawk; detector [Heurística].

### R-05 — N+1
- **Sintoma:** uma consulta por item de uma lista; latência cresce linear com o tamanho da página.
- **Por quê:** carga preguiçosa de associação dentro de laço.
- **Correção:** carga ansiosa (`select_related`/`prefetch_related`, `includes`/`preload`/`eager_load`, `JOIN FETCH`), consulta em lote por `IN`; modo estrito em teste (`strict_loading`).
- **Detecção:** ferramenta — modo estrito do ORM em teste; runtime — `pg_stat_statements` com `calls` alto e `mean_exec_time` baixo para `WHERE fk = $1`.
- **Evidência:** [2F] problema; [Heurística] detector de runtime.

### R-06 — OFFSET profundo
- **Sintoma:** páginas finais lentas; itens repetidos ou pulados quando há inserção concorrente.
- **Por quê:** o banco computa e descarta todas as linhas anteriores ao OFFSET, e a janela se move com cada inserção.
- **Correção:** paginação por keyset (`WHERE (criado_em, id) < ($1, $2) ORDER BY criado_em DESC, id DESC LIMIT n`) com índice na chave de ordenação.
- **Detecção:** `scan.sh R-06` (estática: `OFFSET` com parâmetro ou literal de 3+ dígitos, `.offset(`, `.skip(`); runtime — OFFSET entre as consultas mais caras em `pg_stat_statements`.
- **Evidência:** [2F] Use The Index, Luke e PostgreSQL queries-limit; detector [Heurística].

### R-07 — Soft delete generalizado sem índice parcial
- **Sintoma:** unicidade violada por linhas "apagadas"; toda consulta precisa lembrar de `deleted_at IS NULL`; titular pede eliminação e o dado continua lá.
- **Por quê:** a linha apagada continua ocupando a chave única e o armazenamento.
- **Correção:** índice parcial `UNIQUE (...) WHERE deleted_at IS NULL`; expurgo físico ou anonimização quando a LGPD exige eliminação; soft delete só onde há requisito de auditoria.
- **Detecção:** runtime — `deleted_at`/`is_deleted` e índice `UNIQUE` sem predicado (`pg_index.indpred IS NULL`) na mesma tabela.
- **Evidência:** [1F] índice parcial; opinião (Brandur) no padrão; [Interp.] na parte LGPD (base §7.2).

### R-08 — EAV (entidade-atributo-valor)
- **Sintoma:** tabela genérica `atributo`/`valor`; consultas com pivot, tipos todos em texto, sem integridade.
- **Por quê:** troca o schema pelo dado e perde tipagem, constraint e índice útil.
- **Correção:** colunas reais para o que é conhecido; `jsonb` com estrutura documentada para o que é variável.
- **Detecção:** revisão — tabela com até cinco colunas contendo o par `attribute`/`value` é o sinal de partida.
- **Evidência:** [2F] Karwin, SQL Antipatterns; detector [Heurística].

### R-09 — Transação longa ou ociosa
- **Sintoma:** locks presos, vacuum sem progresso, inchaço de tabela, conexões esgotadas.
- **Por quê:** transação aberta segura lock e impede a limpeza de versões antigas.
- **Correção:** transação curta, sem interação de usuário nem chamada remota dentro dela; `idle_in_transaction_session_timeout`.
- **Detecção:** runtime — `pg_stat_activity` com `state LIKE 'idle in transaction%'` ordenado por idade.
- **Evidência:** [1F] PostgreSQL monitoring-stats e runtime-config-client.

### R-10 — NOLOCK ou READ UNCOMMITTED
- **Sintoma:** relatório com linha duplicada ou ausente, valor que nunca foi confirmado.
- **Por quê:** leitura suja: lê versões não confirmadas e pode percorrer páginas em movimentação.
- **Correção:** READ COMMITTED com versionamento de linha (RCSI) no SQL Server; réplica de leitura para relatório pesado.
- **Detecção:** `scan.sh R-10` (estática em código e `*.sql`); runtime — `sys.databases.is_read_committed_snapshot_on`.
- **Evidência:** [1F] SQL Server SET TRANSACTION ISOLATION LEVEL.

### R-11 — Deadlock ou falha de serialização sem retry
- **Sintoma:** erro 500 esporádico sob carga com `40001`, `40P01`, 1205 (SQL Server) ou 1213 (MySQL) no log.
- **Por quê:** em Repeatable Read e Serializable o banco aborta a transação e espera que a aplicação a reexecute.
- **Correção:** retry com backoff da transação inteira nos códigos `40001`, `40P01` (PostgreSQL), 1205 (SQL Server) e 1213 (MySQL; no MySQL o 1205 é lock wait timeout, que desfaz só a instrução por padrão, não a transação); ordem consistente de locks.
- **Detecção:** revisão — ausência de tratamento de `40001|40P01|1205|1213` na camada de dados.
- **Evidência:** [J] apêndice de códigos de erro do PostgreSQL e guia de deadlocks do SQL Server; [1F] MySQL, server error reference (1205, 1213).

### R-12 — Estado de sessão com pool de conexões
- **Sintoma:** `search_path` trocado entre requisições, `LISTEN` que nunca recebe, advisory lock que "some", prepared statement inexistente; tenant de uma requisição aparecendo na seguinte (`SET app.tenant_id` ou `set_config('app.tenant_id', $1, false)` lidos pela policy de RLS).
- **Por quê:** em modo transaction do PgBouncer a conexão física muda a cada transação; em qualquer pool que reaproveita conexão (Npgsql e EF, HikariCP, node-postgres), GUC de sessão fica na conexão devolvida e vaza o tenant para a próxima requisição, e a RLS filtra pelo tenant errado.
- **Correção:** `SET LOCAL` ou `set_config(..., true)` dentro da transação (vale só até o commit), prepared statement de protocolo com `max_prepared_statements > 0`, advisory lock de transação (`pg_advisory_xact_lock`), conexão dedicada para `LISTEN`.
- **Detecção:** `scan.sh R-12` (estática em código: `SET search_path`, `LISTEN`, `pg_advisory_lock(`, `SET` de GUC com ponto sem `LOCAL`, `set_config(..., false)`; os três primeiros só são defeito atrás de PgBouncer em modo transaction, os dois últimos com qualquer pool).
- **Evidência:** [J] PgBouncer features; [1F] PostgreSQL `set_config` e `SET LOCAL`; [Interp.] quanto ao vazamento de tenant por pool.

### R-13 — ALGORITHM=COPY ou LOCK forçado no MySQL
- **Sintoma:** `ALTER TABLE` que bloqueia escrita por minutos ou horas.
- **Por quê:** força a cópia da tabela e o lock, anulando o DDL online do InnoDB.
- **Correção:** deixar o MySQL escolher `INSTANT`/`INPLACE` com `LOCK=NONE`; mudança que exige cópia vira coluna nova com backfill.
- **Detecção:** `scan.sh R-13` (estática em `*.sql`).
- **Evidência:** [2F] MySQL 8.4 online DDL.

### R-14 — SELECT * em código de aplicação
- **Sintoma:** coluna nova quebra o mapeamento; tráfego e memória com colunas que ninguém lê; índice de cobertura inútil.
- **Por quê:** acopla o código ao schema inteiro e impede índice-only scan.
- **Correção:** listar as colunas; projeção explícita no ORM.
- **Detecção:** `scan.sh R-14` (estática em código); ferramenta — SQLFluff `AM04`.
- **Evidência:** [1F] SQLFluff.

### R-15 — Analytics no primário OLTP
- **Sintoma:** latência transacional sobe no horário do relatório; CPU e I/O do primário tomados por agregação.
- **Por quê:** varredura e agregação disputam recurso com a transação.
- **Correção:** réplica de leitura, columnstore HTAP quando o volume é modesto, ou o especialista analítico.
- **Detecção:** runtime — `pg_stat_statements` por `total_exec_time` com `GROUP BY`/`SUM(` no primário; Query Store no SQL Server.
- **Evidência:** [2F] problema.

### R-16 — Banco compartilhado entre serviços
- **Sintoma:** migração de um serviço quebra outro; ninguém sabe quem é dono da tabela.
- **Por quê:** o schema vira contrato implícito e sem versão entre serviços.
- **Correção:** um dono por schema; integração síncrona interna por gRPC com `.proto` versionado e evento por mensageria com AsyncAPI (regra do dono).
- **Detecção:** runtime — `information_schema.role_table_grants` com INSERT/UPDATE/DELETE por schema, cruzado com o mapa de serviços.
- **Evidência:** [J] antipattern documentado pela Microsoft (Azure).

### R-17 — Banco gerenciado com endereço público
- **Sintoma:** instância RDS/Cloud SQL/Azure acessível da internet; tentativa de login de origem desconhecida.
- **Por quê:** nenhum terceiro recebe rota de rede para banco interno (regra de integração do dono); o endereço público amplia a superfície sem necessidade.
- **Correção:** `publicly_accessible = false`, sub-rede privada, acesso de operação por bastion ou VPN; entrega a parceiro por REST ou fila dedicada.
- **Detecção:** `scan.sh R-17` (estática em IaC); ferramenta — Checkov.
- **Evidência:** [Interp.] norma da regra do dono e do design §2.4; detector sem calibração em caso real.

### R-18 — Regra de rede aberta na porta do banco
- **Sintoma:** security group ou firewall com `0.0.0.0/0` e porta 5432 ou 3306.
- **Por quê:** rota de qualquer origem para banco interno, contra a regra de integração.
- **Correção:** CIDR da VPC ou security group de origem; nunca `0.0.0.0/0` em porta de dado.
- **Detecção:** `scan.sh R-18` (estática em IaC: `0.0.0.0/0` e a porta no mesmo arquivo; localização na linha do CIDR). Aproximação deliberada: Terraform espalha CIDR e porta em linhas diferentes.
- **Evidência:** [Interp.] norma da regra do dono; detector [Heurística].

### R-19 — Coluna monetária em NUMERIC, DECIMAL ou ponto flutuante
- **Sintoma:** coluna `valor_total NUMERIC(12,2)`, `amount DECIMAL(...)`, `amount double precision`, `fee real` (o pior caso: flutuante nem é exato); conversão entre centavos e reais espalhada pelo código.
- **Por quê:** a regra da casa (`rules/domain/money-as-cents.md` §4) manda `BIGINT NOT NULL` na menor unidade, nunca `DECIMAL`/`NUMERIC`; pela decisão H-03 (a) do dono esta skill aplica isso a qualquer `*.sql`, em qualquer stack, sem mudar o `applies_to` da rule.
- **Correção:** coluna `..._em_centavos BIGINT NOT NULL`, conversão só na borda (apresentação e entrada), arredondamento NBR 5891; migração expand/contract com backfill multiplicado por 100.
- **Detecção:** `scan.sh R-19` (estática em `*.sql`: nome monetário tipado `NUMERIC`/`DECIMAL`/`real`/`float`/`double precision`; heurística pelo nome — `taxa_juros NUMERIC` não é dinheiro e não casa).
- **Evidência:** [Heurística] detector; norma da rule da casa (seção Verificação da `money-as-cents.md`).

### R-20 — Tabela multi-tenant sem RLS
- **Sintoma:** `CREATE TABLE` com `tenant_id` e nenhum `ENABLE ROW LEVEL SECURITY`; isolamento dependendo só do filtro da aplicação.
- **Por quê:** a `data-governance.md` torna RLS obrigatório em tabela multi-tenant de domínio no PostgreSQL, dispensável só por exceção formal; um filtro esquecido vaza dado entre tenants.
- **Correção:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **e** `FORCE ROW LEVEL SECURITY` por padrão (sem `FORCE`, o dono da tabela ignora a policy, e a aplicação que conecta com o papel que roda a migração é dona), `CREATE POLICY` por `tenant_id`, papel da aplicação diferente do dono e criado com `NOBYPASSRLS`, tenant por `SET LOCAL` ou `set_config(..., true)` na transação (R-12); exceção só com ADR. Precedente ("já tem RLS igual às demais tabelas") só prova isolamento se alguém grepar o serviço dono por `set_config`/`SET LOCAL` do GUC da policy — zero ocorrências é RLS decorativa — e se o teste de regressão conectar como o papel real da aplicação (`NOBYPASSRLS`), não como o usuário padrão do Testcontainers (superusuário, ignora toda policy).
- **Detecção:** `scan.sh R-20` (estática em `*.sql`: `tenant_id` em arquivo com `CREATE TABLE` e sem `ENABLE ROW LEVEL SECURITY`, localização na declaração do `tenant_id`; `ENABLE ROW LEVEL SECURITY` sem `FORCE` no mesmo arquivo; papel com `BYPASSRLS`; `aviso` porque o RLS pode estar noutra migração); runtime — `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r'`, `SELECT rolname FROM pg_roles WHERE rolbypassrls` e tabelas de negócio sem política em `pg_policies`; revisão — antes de aceitar uma tabela com RLS como precedente, `grep -arn "set_config\|SET LOCAL" <serviço dono>` (zero ocorrências é RLS decorativa) e `grep -arn "Testcontainers\|UseNpgsql" <projeto de teste>` para confirmar que o fixture não conecta como superusuário do container.
- **Evidência:** [Interp.] base §7.3 (multi-tenant), subordinada à rule da casa; detector [Heurística].

### R-21 — Migração sem lock_timeout
- **Sintoma:** um `ALTER TABLE` esperando lock atrás de uma transação longa segura todas as consultas seguintes da tabela; a aplicação para sem o DDL ter sequer começado.
- **Por quê:** o pedido de lock forte entra na fila e bloqueia quem chega depois; sem `lock_timeout` ele espera indefinidamente.
- **Correção:** `SET lock_timeout = '5s'` (e `statement_timeout`) na sessão da migração, com retry do passo.
- **Detecção:** `scan.sh R-21` (estática em `*.sql`: `ALTER TABLE` ou `CREATE INDEX` sem `lock_timeout` no mesmo arquivo); ferramenta — squawk e strong_migrations.
- **Evidência:** [2F] base R-03 ("ausência de lock_timeout"); detector [Heurística].

### R-22 — Índice em migração MySQL sem ALGORITHM e LOCK explícitos
- **Sintoma:** `CREATE INDEX` ou `ALTER TABLE ... ADD INDEX` numa migração MySQL sem `ALGORITHM=INPLACE, LOCK=NONE`.
- **Por quê:** no MySQL 8.x o índice secundário é INPLACE e online por padrão, mas sem os dois explícitos uma variação da operação (coluna de tipo que não suporta INPLACE, versão diferente) cai em cópia bloqueante em silêncio; com eles explícitos o MySQL recusa a DDL em vez de travar a tabela.
- **Correção:** `ALTER TABLE t ADD INDEX idx (c), ALGORITHM=INPLACE, LOCK=NONE` (ou o mesmo em `CREATE INDEX ... ALGORITHM=INPLACE LOCK=NONE`); para o que não é online, ferramenta de schema change online (gh-ost, pt-online-schema-change).
- **Detecção:** `scan.sh R-22` (estática em `*.sql` com marca de MySQL — `ENGINE=`, `AUTO_INCREMENT`, `ALGORITHM=`, identificador entre crases —: índice sem `ALGORITHM=` na linha); ferramenta — squawk não cobre MySQL, gh-ost e pt-osc sim.
- **Evidência:** [1F] MySQL 8.4, online DDL operations; detector [Heurística].
