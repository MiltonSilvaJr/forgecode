# NoSQL — catálogo de antipatterns

Conjunto fechado de ids deste catálogo (design §2.5 do change `data-engineer-agent`): N-01 a N-17 vêm da base consolidada (§2.7); N-18 e N-19 foram acrescentados pelo design (exposição de banco pela regra de integração do dono); N-20 a N-23 foram acrescentados pela revisão de DBA de 2026-09-26 (transacional de negócio no MongoDB, H-01 a). Id fora desse conjunto reprova o w250.

Cada entrada tem cinco campos. `Detecção` usa um de quatro rótulos: `scan.sh <ID>` (estática, o `scripts/scan.sh` executa), `ferramenta`, `runtime` (comando contra o sistema real, documentado e nunca executado pelo scanner) e `revisão`; um segundo rótulo complementar pode vir depois de `;`. Comandos de runtime foram redigidos pela pesquisa e não executados contra sistema real. Toda varredura recursiva de exemplo usa `grep -a` ou `rg`.

### N-01 — Array sem teto (MongoDB)
- **Sintoma:** documento que cresce a cada evento, latência de escrita subindo, erro ao passar de 16 MiB.
- **Por quê:** `$push` sem limite faz o documento crescer sem teto; o limite de BSON é 16 MiB e a reescrita do documento inteiro fica cada vez mais cara.
- **Correção:** `$push` com `$each` e `$slice`, bucket por tempo ou contagem, ou referência em coleção separada para o que cresce sem limite.
- **Detecção:** `scan.sh N-01` (estática: `$push` sem `$slice` na mesma linha); runtime — agregação com `$bsonSize` ordenada.
- **Evidência:** [1F] MongoDB anti-patterns e limits; detector [Heurística].

### N-02 — Índice sem uso (MongoDB)
- **Sintoma:** escrita mais lenta e memória de índice sem ganho de leitura.
- **Por quê:** todo índice custa escrita e RAM.
- **Correção:** remover depois de confirmar a janela representativa (ocultar o índice antes de apagar).
- **Detecção:** runtime — `$indexStats` com `accesses.ops == 0` após a janela.
- **Evidência:** [1F] MongoDB.

### N-03 — Coleção por tenant ou por dia
- **Sintoma:** milhares de coleções; nome de coleção interpolado em código.
- **Por quê:** cada coleção e índice tem custo fixo; operação e isolamento viram gestão de nomes.
- **Correção:** coleção única com campo `tenant` (obrigatório pela `data-transactional-nosql.md`), filtro obrigatório no repositório e índice composto começando por `tenant`; bucket por tempo dentro do documento.
- **Detecção:** runtime — `db.getCollectionNames().length`; revisão — nome de coleção interpolado.
- **Evidência:** [1F] MongoDB anti-patterns.

### N-04 — $lookup como join no caminho quente
- **Sintoma:** agregações com `$lookup` em toda requisição; latência instável.
- **Por quê:** join em document store anula a vantagem de ler o agregado inteiro de uma vez.
- **Correção:** embutir o que é lido junto com cardinalidade limitada; desnormalizar de forma controlada; se os joins ad hoc crescem, reavaliar o modelo de leitura.
- **Detecção:** `scan.sh N-04` (estática em código).
- **Evidência:** [1F] MongoDB anti-patterns; [J] Azure sobre joins ad hoc crescentes.

### N-05 — Shard key monotônica ou de baixa cardinalidade
- **Sintoma:** um shard recebe toda a escrita; chunks jumbo.
- **Por quê:** chave crescente (timestamp, ObjectId) concentra inserção no último chunk; baixa cardinalidade limita a divisão.
- **Correção:** chave composta de alta cardinalidade e baixa frequência, hashed sharding para chave monotônica; `reshardCollection` (5.0+) para corrigir.
- **Detecção:** runtime — `analyzeShardKey` (7.0+) e `sh.status()`.
- **Evidência:** [1F] MongoDB shard key.

### N-06 — Chave de partição de baixa cardinalidade (Cosmos DB, DynamoDB)
- **Sintoma:** throttling com a capacidade total sobrando; uma partição quente.
- **Por quê:** `status`, `type`, `date`, `country`, `state` ou `category` como chave concentram a carga em poucos valores.
- **Correção:** chave de alta cardinalidade alinhada ao predicado dominante; chave hierárquica no Cosmos DB; write sharding por sufixo no DynamoDB; mudar a chave exige copiar para contêiner ou tabela nova.
- **Detecção:** `scan.sh N-06` (estática em IaC); runtime — Normalized RU por PartitionKeyRangeId, CloudWatch Contributor Insights.
- **Evidência:** [J] antipattern documentado pela Microsoft.

### N-07 — Write concern w:1 para dado crítico ou topologia P-S-A
- **Sintoma:** escrita confirmada ao cliente que some depois de um failover.
- **Por quê:** `w: 1` confirma com um só membro; numa topologia com árbitro (P-S-A) o default cai de `majority` para `w: 1`. O transacional de negócio da casa é MongoDB e exige `majority` (`data-transactional-nosql.md`).
- **Correção:** `w: "majority"` explícito (e `j: true` quando exigido), topologia P-S-S em vez de P-S-A, transação multi-documento com retry em `TransientTransactionError`.
- **Detecção:** `scan.sh N-07` (estática em código de arquivo com marca de MongoDB, fronteira explícita antes de `w` e depois do `1` — `flow: 1`, `w: 10` e `{ w: 1, h: 2 }` fora de arquivo MongoDB não casam); runtime — `rs.conf()` com árbitro.
- **Evidência:** [J] MongoDB write concern.

### N-08 — Scan no caminho da requisição (DynamoDB)
- **Sintoma:** latência e custo proporcionais ao tamanho da tabela; throttling em toda partição.
- **Por quê:** `Scan` lê a tabela inteira (1 MB por página) e consome capacidade de todas as partições.
- **Correção:** `Query` por partition key e sort key; GSI para o padrão de acesso que falta; `Scan` só em job offline paralelo.
- **Detecção:** `scan.sh N-08` (estática em código, só a API do DynamoDB: `ScanCommand`, `ScanInput`, `ScanRequest`, `scan({ TableName`, `table.scan(`; `redis.scan(` e `rows.Scan(` não casam).
- **Evidência:** [1F] DynamoDB.

### N-09 — Item que cresce (DynamoDB)
- **Sintoma:** erro de tamanho de item; custo de escrita subindo com o item.
- **Por quê:** item até 400 KB; `list_append` sem teto faz toda escrita regravar o item inteiro.
- **Correção:** um item por elemento na mesma partition key com sort key ordenada; bucket por período.
- **Detecção:** `scan.sh N-09` (estática em código).
- **Evidência:** [1F] DynamoDB constraints.

### N-10 — GSI subprovisionado ou projeção ALL por padrão
- **Sintoma:** throttling na tabela causado pelo índice; custo de escrita dobrado.
- **Por quê:** GSI com capacidade menor que a tabela aplica back-pressure na escrita; projeção `ALL` copia o item inteiro.
- **Correção:** capacidade do GSI igual ou maior que a da tabela; projeção `KEYS_ONLY` ou `INCLUDE`.
- **Detecção:** `scan.sh N-10` (estática em IaC: `projection_type = "ALL"`); runtime — `describe-table` comparando WCU.
- **Evidência:** [1F] DynamoDB.

### N-11 — Leitura de GSI tratada como forte
- **Sintoma:** erro de validação da API ou dado velho lido logo após a escrita.
- **Por quê:** GSI só oferece leitura eventual; `ConsistentRead: true` com `IndexName` de GSI é recusado.
- **Correção:** leitura forte pela tabela base (`GetItem`/`Query` sem índice) ou aceitar consistência eventual explicitamente.
- **Detecção:** `scan.sh N-11` (estática: `ConsistentRead: true` e `IndexName` na mesma linha).
- **Evidência:** [2F] DynamoDB; detector [Heurística] (objeto em várias linhas escapa).

### N-12 — TransactWriteItems como padrão
- **Sintoma:** custo de escrita dobrado; conflitos de transação sob carga.
- **Por quê:** transação consome duas unidades por item e falha por conflito com outras escritas nos mesmos itens.
- **Correção:** escrita condicional de item único quando basta; transação só onde a atomicidade entre itens é requisito.
- **Detecção:** revisão — contagem de `TransactWriteItems|transactWrite` no código.
- **Evidência:** [1F] DynamoDB.

### N-13 — ALLOW FILTERING ou índice secundário como consulta principal (Cassandra)
- **Sintoma:** consulta que varre o cluster; timeouts de leitura sob carga.
- **Por quê:** `ALLOW FILTERING` e índice secundário consultam todas as partições; os guardrails vêm habilitados por padrão.
- **Correção:** uma tabela por consulta, com a partição no predicado; desligar os guardrails `allow_filtering_enabled` e `secondary_indexes_enabled`; SAI só com a partição já filtrada.
- **Detecção:** `scan.sh N-13` (estática: `ALLOW FILTERING` em CQL e código, `CREATE INDEX` em `*.cql`, exceto SAI — `StorageAttachedIndex`, que a skill admite); runtime — guardrails no `cassandra.yaml`.
- **Evidência:** [2F] problema; [J] defaults do `cassandra.yaml`.

### N-14 — Partição ilimitada ou fila sobre Cassandra
- **Sintoma:** leitura lenta e `TombstoneOverwhelmingException`; partição acima de 100 MB.
- **Por quê:** partição sem componente de tempo cresce sem teto; consumir e apagar como fila gera tombstones.
- **Correção:** bucketing (`sensor_id, dia`); fila é trabalho do especialista de mensageria.
- **Detecção:** runtime — `nodetool tablehistograms`; `grep -ai tombstone system.log`; revisão — DDL sem componente de tempo na partition key.
- **Evidência:** [2F].

### N-15 — Batch multi-partição como otimização
- **Sintoma:** avisos de `batch_size_warn_threshold`; coordenador sobrecarregado.
- **Por quê:** batch em Cassandra é atomicidade, não desempenho; atravessar partições concentra o trabalho no coordenador.
- **Correção:** escritas assíncronas por partição; batch só para a mesma partição e quando a atomicidade é requisito.
- **Detecção:** `scan.sh N-15` (estática em CQL e código).
- **Evidência:** [2F]; [J] thresholds do `cassandra.yaml`.

### N-16 — Supernó (Neo4j)
- **Sintoma:** travessias lentas passando por um nó com centenas de milhares de relacionamentos; contenção de lock.
- **Por quê:** nó denso concentra relacionamentos; a partir do 4.3, 50 relacionamentos já o tornam denso de forma irreversível.
- **Correção:** nó intermediário (por período ou categoria); tipos de relacionamento mais específicos.
- **Detecção:** runtime — `MATCH (n) WITH n, COUNT { (n)--() } AS g WHERE g > 100000 RETURN labels(n), g ORDER BY g DESC LIMIT 20` (Neo4j 5).
- **Evidência:** [2F] conceito; [J] limiar de densidade do 4.3; [Heurística] limiar de 100.000.

### N-17 — Relacionamento genérico (Neo4j)
- **Sintoma:** `-[:RELATED_TO]->`, `HAS`, `LINK`, `CONNECTED` em todo o grafo; consultas filtrando por propriedade do relacionamento.
- **Por quê:** o tipo do relacionamento é o índice natural da travessia; genérico obriga a ler e filtrar.
- **Correção:** tipo específico do domínio (`:TRANSFERIU_PARA`, `:TITULAR_DE`).
- **Detecção:** `scan.sh N-17` (estática em `*.cypher` e código); runtime — `CALL db.relationshipTypes()`.
- **Evidência:** [Heurística] fonte secundária.

### N-18 — MongoDB escutando em todas as interfaces
- **Sintoma:** `bindIp: 0.0.0.0` ou `--bind_ip_all` em `mongod.conf`, compose ou manifesto.
- **Por quê:** nenhum terceiro recebe rota de rede para banco interno (regra de integração do dono); com autenticação fraca, é exposição direta.
- **Correção:** `bindIp` restrito às interfaces privadas, TLS e autenticação obrigatórios, acesso de terceiro só por REST ou fila dedicada.
- **Detecção:** `scan.sh N-18` (estática em IaC e `*.conf`).
- **Evidência:** [Interp.] norma da regra do dono e do design §2.4.

### N-19 — Regra de rede aberta na porta do MongoDB
- **Sintoma:** security group ou firewall com `0.0.0.0/0` e porta 27017.
- **Por quê:** rota de qualquer origem para banco interno.
- **Correção:** CIDR da VPC ou security group de origem.
- **Detecção:** `scan.sh N-19` (estática em IaC: `0.0.0.0/0` e 27017 no mesmo arquivo; localização na linha do CIDR).
- **Evidência:** [Interp.] norma da regra do dono; detector [Heurística].

### N-20 — Read concern local ou available no transacional de negócio
- **Sintoma:** transação ou leitura de saldo que enxerga dado desfeito depois de um failover; em cluster shardado, leitura que não bate entre shards.
- **Por quê:** `local` e `available` devolvem dado que a maioria ainda não confirmou; só `snapshot` (ou `majority`) com commit em `w: "majority"` protege contra rollback, e só `snapshot` sincroniza a visão entre shards.
- **Correção:** `readConcern: "snapshot"` e `writeConcern: { w: "majority" }` na transação (`withTransaction` com as opções), `readPreference: "primary"`.
- **Detecção:** `scan.sh N-20` (estática: `ReadConcern.LOCAL`/`AVAILABLE`, `readConcern: { level: "local" }`, `read_concern=ReadConcern("local")`); revisão — opção herdada do cliente ou da sessão.
- **Evidência:** [1F] MongoDB, transactions and read concern; detector [Heurística].

### N-21 — Decimal128 ou ponto flutuante em valor monetário
- **Sintoma:** valor com `Decimal128`/`NumberDecimal` ou `double` em documento do transacional; soma divergente entre serviços em linguagens diferentes.
- **Por quê:** a regra da casa (`money-as-cents.md`) manda inteiro na menor unidade em toda a stack; `Decimal128` não tem tipo nativo em várias linguagens e `double` não é exato.
- **Correção:** `Int64`/`NumberLong` em centavos, com a moeda num campo próprio; validator `$jsonSchema` com `bsonType: "long"` no campo.
- **Detecção:** `scan.sh N-21` (estática: `Decimal128`, `NumberDecimal(`, `$numberDecimal`); revisão — `double` em campo de valor.
- **Evidência:** [1F] MongoDB BSON types; regra da casa `money-as-cents.md`; detector [Heurística] (Decimal128 fora de dinheiro também casa).

### N-22 — Invariante entre documentos sem documento de contenção
- **Sintoma:** saldo negativo ou limite estourado com duas transações concorrentes que passaram as duas.
- **Por quê:** a transação MongoDB é snapshot isolation e só detecta conflito de escrita no mesmo documento; ler vários documentos, decidir e escrever em documentos diferentes permite write skew.
- **Correção:** invariante num documento que toda transação escreve: update condicional com filtro e `$inc` no mesmo documento (`{ _id: conta, saldo: { $gte: v } }` com `$inc: { saldo: -v }`), ou campo de versão conferido no filtro; conferir `matchedCount` e abortar quando zero.
- **Detecção:** revisão — transação que lê um documento para decidir e escreve em outro sem update condicional.
- **Evidência:** [Interp.] sobre a semântica de conflito de escrita documentada pela MongoDB.

### N-23 — Commit pela API core sem retry de UnknownTransactionCommitResult
- **Sintoma:** transação que o cliente dá como falha e que foi confirmada no servidor, ou o inverso; duplicata ao repetir a transação inteira.
- **Por quê:** erro de rede ou eleição no `commitTransaction` deixa o resultado desconhecido; o certo é repetir só o commit, e a transação inteira só em `TransientTransactionError`.
- **Correção:** `withTransaction` (o driver faz os dois retries), ou laço próprio de `commitTransaction` em `UnknownTransactionCommitResult` separado do laço da transação.
- **Detecção:** `scan.sh N-23` (estática: arquivo com `commitTransaction`/`commit_transaction` sem `withTransaction` nem `UnknownTransactionCommitResult`).
- **Evidência:** [1F] MongoDB, transactions in applications; detector [Heurística].
