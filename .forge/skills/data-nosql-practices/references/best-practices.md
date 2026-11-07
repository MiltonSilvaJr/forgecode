# NoSQL — boas práticas

Base: seção 2 da base consolidada do change `data-engineer-agent` (julgada em 2026-09-26), mais as regras da casa do template. Marcas: [J] reconferido pelo juiz na fonte primária; [2F] duas fontes independentes; [1F] documentação oficial do produto; [Interp.] interpretação técnica; [Heurística] limiar de partida. Limites de produto mudam: confira a versão corrente com o context7 antes de citar um número como definitivo.

## Quando usar e quando não

Usar quando os padrões de acesso são conhecidos, estáveis e de alto volume, escala horizontal por partição é requisito e latência previsível vale mais que consulta ad hoc: "você não começa pelo modelo de dados, começa pelo modelo de consulta" [2F: AWS DynamoDB e Cassandra]. Não usar para consulta exploratória ou analítica, para muitas relações N:N com integridade forte, nem com o domínio ainda em descoberta (single-table em estágio inicial é ruim para agilidade) [1F: DeBrie; AWS]. Sinal para reavaliar: joins ad hoc crescentes em document store pedem um modelo de leitura relacional [J: Azure].

## Regras da casa (precedência sobre a base)

- **Transacional de negócio é MongoDB.** A `rules/data/data-governance.md` atribui "transacional de negócio, eventos, schema flexível, alto volume" ao MongoDB. A base roteava transação multi-entidade estrita para o relacional; pela decisão H-01 (a) do dono (2026-09-26) vale a rule: o transacional de negócio é MongoDB com transação multi-documento, write concern `majority` e P-S-S, salvo ADR do projeto que escolha SQL.
- **Isolamento multi-tenant no MongoDB** (`data-transactional-nosql.md`): campo `tenant` em todo documento de negócio; filtro de `tenant` obrigatório na camada de repositório ou num interceptor que o injeta em toda query, nunca confiando no chamador (o MongoDB não tem RLS nativo); índice composto começando por `tenant`.
- **Redis nunca é fonte de verdade** (`data-governance.md`, `data-cache.md`). Um pedido de "Redis como banco" não vira desenho de chave-valor persistente aqui: é `CONFLITO`, e o store durável é escolhido entre este especialista e o relacional pela matriz do orquestrador.
- **Dinheiro como inteiro** (`money-as-cents.md`): valor monetário em inteiro na menor unidade (`Int64`/`NumberLong` no MongoDB, `N` inteiro no DynamoDB), nunca `Decimal128` nem ponto flutuante [regra da casa].

## Modelagem por padrão de acesso

1. Inventariar padrões de acesso (quem lê, por qual chave, frequência, volume por chave, latência alvo) antes de escolher chave e índice [2F].
2. Toda unidade de agregação tem teto de crescimento: bucket por tempo ou contagem, nunca array ou item que cresce sem limite (N-01, N-09, N-14) [2F].
3. Modelar o que é acessado junto: embutir o que é lido junto e tem cardinalidade limitada; referenciar o que cresce sem limite [1F: MongoDB].
4. Single-table no DynamoDB reduz idas e custo, e encarece mudança de padrão de acesso; em domínio ainda em descoberta, prefira tabelas por entidade [1F: DeBrie].
5. Cassandra: uma tabela por consulta, desnormalizada, minimizando partições lidas por consulta [2F].

## Chave de partição

- Alta cardinalidade, carga uniforme e alinhada ao predicado dominante; alta cardinalidade sozinha não basta — GUID aleatório que nenhuma consulta filtra torna quase toda leitura cross-partition [J: Cosmos DB].
- Chave de partição é decisão de migração: no Cosmos DB não muda in place e exige mover para contêiner novo (container copy jobs) [J].
- Multi-tenant: tenant como prefixo da partition key (`TENANT#t1`) [1F: exemplo AWS] ou primeiro nível da chave hierárquica no Cosmos DB [J]; coleção por tenant é antipattern (N-03); tenant grande vira partição quente — meça por tenant [Interp. da base §7.3].
- MongoDB: shard key de alta cardinalidade, baixa frequência e não monotônica; chave monotônica pede hashed sharding; `reshardCollection` (5.0+) e `analyzeShardKey` (7.0+) para corrigir e medir [1F].
- Cosmos DB `/id` como chave é ótimo para leitura pontual e péssimo para qualquer outro filtro [J].

## Consistência

- Consistência é parâmetro por operação; leitura forte em sistema de quórum exige `W + R > RF` [2F].
- MongoDB: o write concern implícito é `w: "majority"` desde o 5.0, exceto quando há árbitro e os membros com dados não superam a maioria dos votantes (P-S-A), caso em que cai para `w: 1`; a própria MongoDB recomenda P-S-S em vez de P-S-A [J]. Para o transacional de negócio, `majority` explícito e P-S-S (N-07).
- Transação MongoDB curta (limite padrão de 60 s) com retry em `TransientTransactionError` [2F]; o desenho completo do transacional de negócio está na seção seguinte.
- Cosmos DB: consistência de sessão como default; strong e bounded staleness dobram o custo de leitura [1F].
- Cassandra: `LOCAL_QUORUM` em leitura e escrita para leitura forte no datacenter; `QUORUM` global troca latência inter-região por consistência entre DCs [2F].
- Índice secundário global é eventualmente consistente e custa escrita; projete só o necessário [2F; J para Cosmos DB]. Leitura de GSI no DynamoDB é só eventual (N-11) [1F].

## Transacional de negócio no MongoDB

Pela `data-governance.md` e pela decisão H-01 (a), pedido, pagamento, ledger e cobrança moram no MongoDB salvo ADR que escolha SQL. Isso exige o mesmo rigor que o relacional dá ao isolamento; o que segue é o mínimo para dinheiro.

- **API de callback.** `session.withTransaction(fn, opções)` é a forma recomendada: o driver repete a transação inteira em `TransientTransactionError` e repete só o commit em `UnknownTransactionCommitResult` [1F: MongoDB, Transactions API]. Na API core (`startTransaction` e `commitTransaction`) os dois retries são do código: laço externo da transação para `TransientTransactionError` e laço próprio do `commitTransaction` para `UnknownTransactionCommitResult`, sem reexecutar as operações (N-23) [1F: MongoDB, transactions in applications]. O callback precisa ser idempotente, porque o driver pode rodá-lo mais de uma vez [Interp.].
- **Read concern, write concern e read preference.** Transação com `readConcern: "snapshot"` e `writeConcern: { w: "majority" }`: com `majority` no commit, `snapshot` lê um snapshot de dado confirmado pela maioria, sincronizado entre shards; `local` e `majority` não dão snapshot sincronizado entre shards, e sem `w: "majority"` nenhum nível protege contra rollback [1F: MongoDB, transactions and read concern]. Os exemplos de tutorial da própria MongoDB usam `local`; para dinheiro, `snapshot` (N-20) [Interp.]. `readPreference: "primary"` dentro da transação: leitura de transação multi-documento só vai ao primário [1F].
- **Retryable writes.** `retryWrites=true` (default dos drivers atuais) repete uma vez a escrita avulsa fora de transação em erro de rede ou eleição; não substitui o retry da transação nem a chave de idempotência [1F: MongoDB, retryable writes].
- **Write skew sob snapshot isolation.** A transação do MongoDB é snapshot isolation: conflito só é detectado quando duas transações escrevem o mesmo documento. Duas transações que leem o saldo em documentos diferentes e escrevem em documentos disjuntos passam as duas e quebram o invariante (write skew) [Interp. sobre a semântica documentada de conflito de escrita]. Invariante de dinheiro mora num documento de contenção que toda transação escreve: update condicional com filtro e incremento no mesmo documento (`updateOne({ _id: conta, saldo: { $gte: v } }, { $inc: { saldo: -v } })`, que falha sem casar quando não há saldo) ou campo de versão conferido no filtro (`{ _id, versao: n }` com `$inc: { versao: 1 }`) (N-22) [Interp.].
- **Idempotência.** Índice único na chave de idempotência do comando (`{ tenant: 1, chaveIdempotencia: 1 }`, `unique: true`) dentro da mesma transação do efeito; a duplicata falha com `E11000` e o chamador devolve o resultado já gravado [1F: MongoDB, unique indexes; Interp. no uso].
- **Validação de schema.** Validator `$jsonSchema` na coleção do transacional (`validationLevel: "strict"`, `validationAction: "error"`), com o valor monetário tipado como inteiro (`bsonType: "long"`) e nunca `decimal` nem `double` (N-21) [1F: MongoDB, schema validation; regra da casa].
- **Duração.** Transação abaixo do `transactionLifetimeLimitSeconds` (60 s por padrão): trabalho longo vira saga ou lote, nunca uma transação maior [1F].
- **Outbox no MongoDB.** A mensagem vai para uma coleção `outbox` na mesma transação do efeito, e o relay a publica por change stream (com o resume token persistido) ou pelo conector Debezium MongoDB; o desenho do relay é do especialista de mensageria (OBX-AP-04 e CDC-AP-03 no catálogo dele) [1F: MongoDB change streams; Interp. no desenho].

## Documento — MongoDB e Cosmos DB

- Limites do MongoDB: documento BSON até 16 MiB, 64 índices por coleção, aninhamento de 100 níveis [1F].
- Cosmos DB: partição lógica até 20 GB e 10.000 RU/s; chave hierárquica de até três níveis resolve o teto; transação multi-item só dentro de uma partição lógica; consulta cross-partition custa 2–3 RU por partição física extra [J].
- `$lookup` no caminho quente é join em document store: modele pelo que é lido junto (N-04) [1F].
- Índice sem uso custa escrita: `$indexStats` com `accesses.ops == 0` após janela representativa (N-02) [1F].

## Chave-valor persistente — DynamoDB

- Cada partição física entrega no máximo 3.000 RCU e 1.000 WCU por segundo; adaptive capacity vale em on-demand e provisioned, mas não salva uma única chave acima do teto [J].
- Limites: item até 400 KB; transação até 100 itens ou 4 MB; `BatchWriteItem` 25; `BatchGetItem` 100; Query e Scan devolvem até 1 MB por página; LSI limita a item collection a 10 GB [1F].
- `Query`, nunca `Scan`, no caminho quente (N-08); sort key hierárquica (`TENANT#t1`, `ORDER#2026-09-26#123`); write sharding por sufixo calculado quando a leitura pontual precisa continuar possível [1F].
- GSI com capacidade igual ou maior que a da tabela, projeção `KEYS_ONLY` ou `INCLUDE` em vez de `ALL` (N-10) [1F].
- `TransactWriteItems` consome o dobro de unidades: use quando a atomicidade é requisito, não como padrão (N-12) [1F].
- PITR e chave gerenciada pelo cliente para dado regulado (Checkov CKV_AWS_28, CKV_AWS_119) [1F].
- On-demand elimina planejamento; provisioned com auto scaling é mais barato em carga estável [Interp.].

## Coluna larga — Cassandra

- Partição idealmente abaixo de 100 MB e 100.000 linhas, com bucketing (`sensor_id, dia`) (N-14) [1F: DataStax].
- Defaults do `cassandra.yaml` no trunk: `tombstone_warn_threshold: 1000`, `tombstone_failure_threshold: 100000`, `batch_size_warn_threshold: 5KiB`, `batch_size_fail_threshold: 50KiB`, `unlogged_batch_across_partitions_warn_threshold: 10`, `materialized_views_enabled: false`; os guardrails `allow_filtering_enabled` e `secondary_indexes_enabled` vêm comentados com `true`, ou seja, precisam ser desligados explicitamente [J].
- Índice secundário, se inevitável, SAI e restrito a consultas que já filtram a partição (N-13) [1F].
- LWT (Paxos) só para unicidade pontual; o custo quantitativo não está documentado nas fontes [1F; Incerto no custo].
- Fila sobre Cassandra gera tombstones e partição ilimitada: fila é do especialista de mensageria (N-14) [2F].

## Grafo — Neo4j

- Modelar a partir das consultas e testar com dados reais [1F].
- Tipos de relacionamento específicos (`:TRANSFERIU_PARA`), não genéricos (`:RELATED_TO`) (N-17) [prática consolidada, fonte secundária].
- Nó intermediário para evitar nó denso [2F]. No Neo4j 4.3+ um nó passa a ser tratado como denso a partir de 50 relacionamentos, de forma irreversível [J: blog de engenharia Neo4j].
- Propriedade × nó: propriedade é barata; nó é travessável [Interp.].

## Séries temporais

Ingestão operacional de alta taxa com consulta por chave e janela curta fica aqui (coluna larga com bucketing por tempo); agregação histórica e dashboards vão para o especialista analítico [base §0.3 item 6].

## Integração, exposição e dado sensível

- Nenhum terceiro recebe credencial, rota de rede ou permissão sobre banco interno: `bindIp: 0.0.0.0` e regra de rede aberta a `0.0.0.0/0` na porta 27017 são reprovados (N-18, N-19); entrega a parceiro por REST ou fila dedicada, pela regra de integração do agente.
- PAN nunca em claro no documento: token no lugar, com o `data-classification.json` do projeto como autoridade sobre campo sensível [J: PCI DSS 3.5.1, via base §7.1].
- Dado pessoal separado do fato por pseudonimização quando o armazenamento dificulta eliminação (backup, réplica, event store) [Interp. da base §7.2].

## Decisões e trade-offs

| Decisão | A favor | Contra |
|---|---|---|
| Embutir × referenciar | uma ida de leitura | atualização duplicada e documento que cresce |
| Hashed × ranged sharding | escrita distribuída | perde range query pela chave |
| Single-table × tabela por entidade | menos idas e menor custo | mudança de padrão de acesso cara |
| On-demand × provisioned | zero planejamento | provisioned com auto scaling é mais barato em carga estável |
| `QUORUM` global × `LOCAL_QUORUM` | consistência entre DCs | latência inter-região |

## Fontes

[MongoDB anti-patterns](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/) · [MongoDB limits](https://www.mongodb.com/docs/manual/reference/limits/) · [MongoDB shard key](https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/) · [MongoDB write concern](https://www.mongodb.com/docs/manual/reference/write-concern/) · [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/) · [MongoDB transactions in applications](https://www.mongodb.com/docs/manual/core/transactions-in-applications/) · [MongoDB retryable writes](https://www.mongodb.com/docs/manual/core/retryable-writes/) · [MongoDB schema validation](https://www.mongodb.com/docs/manual/core/schema-validation/) · [MongoDB change streams](https://www.mongodb.com/docs/manual/changestreams/) · [Cosmos DB partitioning](https://learn.microsoft.com/en-us/azure/cosmos-db/partitioning-overview) · [Cosmos DB consistency](https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels) · [DynamoDB partition key design](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html) · [DynamoDB write sharding](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-sharding.html) · [DynamoDB constraints](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html) · [DeBrie, single-table](https://www.alexdebrie.com/posts/dynamodb-single-table/) · [Cassandra data modeling](https://cassandra.apache.org/doc/latest/cassandra/developing/data-modeling/data-modeling_rdbms.html) · [cassandra.yaml trunk](https://raw.githubusercontent.com/apache/cassandra/trunk/conf/cassandra.yaml) · [DataStax best practices](https://docs.datastax.com/en/cql/hcd/data-modeling/best-practices.html) · [AxonOps anti-patterns](https://axonops.com/docs/data-platforms/cassandra/data-modeling/anti-patterns/) · [Neo4j modeling designs](https://neo4j.com/docs/getting-started/data-modeling/modeling-designs/) · [Neo4j relationship chain locks (4.3)](https://neo4j.com/blog/developer/relationship-chain-locks-dont-block-the-rock/) · [Checkov policy index](https://www.checkov.io/5.Policy%20Index/terraform.html) · Regras da casa: `.forge/rules/data/data-governance.md`, `.forge/rules/data/data-transactional-nosql.md`, `.forge/rules/domain/money-as-cents.md`.
