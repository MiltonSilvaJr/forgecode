# Mensageria — boas práticas (RabbitMQ 4.x em profundidade, Kafka e padrões de integração)

Base: seção 6 da base consolidada do change `data-engineer-agent` (julgada em 2026-09-26), itens T-02 e T-05 da seção 7.1 e os itens de mensageria da seção 7.2. Marcas: [J] reconferido pelo juiz na fonte primária; [2F] duas fontes independentes; [1F] documentação oficial do produto; [Interp.] interpretação técnica; [Heurística] limiar de partida; [Incerto] fica fora das regras duras até nova verificação (base §8.2). Fatos de plataforma envelhecem: confira a versão corrente com o context7 antes de citar um default como definitivo.

## Escopo e premissa

RabbitMQ é o broker da stack. Fila RabbitMQ serve para distribuir trabalho entre consumidores concorrentes, rotear por regra, desacoplar cadência e processar tarefa com retry: cada mensagem é unidade de trabalho consumida e descartada [Interp.]. RabbitMQ Streams (mesmo broker) serve fan-out grande, replay por offset ou timestamp, alto throughput e backlog grande com pouca memória [J]. Kafka entra quando o requisito é log durável reprocessável, dezenas de grupos consumidores, ecossistema Connect/CDC/Streams ou throughput acima do cluster RabbitMQ [Interp.]. Desde o Kafka 4.2 os share groups (KIP-932, "Queues for Kafka") estão declarados prontos para produção [J]; ainda assim, com RabbitMQ na stack, não há motivo para migrar fila de trabalho para Kafka [Interp.].

Premissa sistêmica: a entrega prática ponta a ponta é **at-least-once** em RabbitMQ, Kafka (commit depois do processamento), Debezium e relay de outbox; idempotência do consumidor é obrigatória [2F].

## RabbitMQ

### Plataforma 4.x

- Filas espelhadas clássicas foram removidas no RabbitMQ 4.0; HA de fila é quorum queue, e qualquer conselho de espelhamento clássico é obsoleto [J] (deprecated features e quorum queues).
- No 4.3 o Mnesia foi removido: Khepri é o único metastore, e as estratégias de partição `pause_if_all_down`, `pause_minority` e `autoheal` saíram junto [J] (blog 4.3).
- O plugin `rabbitmq-delayed-message-exchange` foi depreciado e arquivado por limitações arquiteturais [J] (blog 4.3; [2F] com o repositório).
- Retry atrasado nativo em quorum queue chegou no 4.3: `delayed-retry-type` (`disabled`, `all`, `returned`, `failed`), `delayed-retry-min` (ms, obrigatório se ligado) e `delayed-retry-max` (ms); atraso = `min(delayed-retry-min × delivery-count, delayed-retry-max)`, backoff linear com teto e sem jitter [J].
- Filas clássicas transientes não exclusivas são depreciadas e não podem ser declaradas por padrão a partir do 4.3.0 [J].
- A configuração de lazy queue não tem efeito desde o 3.12: filas clássicas v2 já mantêm só um subconjunto das mensagens em memória, e texto anterior a 2023 que a recomenda está desatualizado [J].
- Em quorum queue o `delivery-limit` é 20 por padrão desde o 4.0 [J].
- Contagem de entregas em quorum (AMQP 0.9.1): `basic.reject` incrementa `delivery-count`; `basic.nack` incrementa só `acquired-count`, e "Unlimited explicit returns (via nack ...) are allowed without counting toward the delivery limit" — o `nack` com requeue em laço não é contido pelo `delivery-limit` [J].
- Dead-letter at-least-once em quorum exige `dead-letter-strategy=at-least-once`, `overflow=reject-publish` (não `drop-head`) e a feature flag `stream_queue`; dead-letter de fila clássica é at-most-once [J] ([1F] para a clássica).
- Streams não têm DLX, TTL por mensagem, prioridade nem QoS global, e são sempre duráveis; Single Active Consumer e super streams existem desde o 3.11 [J].
- "A single queue is generally considered to be an anti-pattern"; FIFO é quebrado por prioridade e por múltiplos consumidores ativos com redelivery; fila durável recupera só mensagem persistente, e a transiente é descartada na recuperação mesmo em fila durável [J].

### Exchanges e roteamento

- Exchange `topic` durável por domínio (`dominio.eventos`) como ponto de publicação; fila por serviço consumidor ligada por routing key [1F + prática].
- Mensagem não roteável: o confirm chega assim que o broker vê que ela não vai a fila nenhuma, então use `mandatory` ou alternate exchange para não perder em silêncio (RMQ-BP-02) [1F].
- Partição por chave com consistent hash exchange quando a ordem por agregado importa (RMQ-BP-13) [1F].
- **RMQ-BP-16** Topologia como código (`definitions.json`, Terraform, operador) e exchanges duráveis [1F + prática].
- A semântica fina do exchange `headers` (`x-match`) e de `basic.return` não foi detalhada nas páginas lidas [Incerto — base §8.2 item 5].

### Filas quorum

- **RMQ-BP-01** Quorum queue como padrão para dado de negócio (pagamento, transação, bilhetagem); clássica só para efêmero, exclusiva e reply-to [2F + J].
- Não usar quorum para backlog de 5 milhões ou mais de mensagens, fan-out grande (streams servem melhor) ou fila temporária (transiente, exclusiva, alta rotatividade) [J].
- Memória: pelo menos 32 bytes de metadados por mensagem, e nó com pelo menos 3× o tamanho efetivo do WAL em RAM [J]. Membros nunca compartilham nó; número ímpar de nós [2F].
- **RMQ-BP-08** Toda fila com `max-length` ou `max-length-bytes` e `overflow` explícito, por policy [1F].
- **RMQ-BP-21** `overflow=reject-publish` com publisher confirms nas filas de negócio: o default é `drop-head`, que descarta a mensagem mais antiga em silêncio quando a fila enche, e o `reject-publish` só é visível ao produtor que usa confirms (o nack do confirm é o sinal) (RMQ-AP-24) [1F: RabbitMQ, maxlength e quorum queues].
- **RMQ-BP-09** Configuração por policy, não por `x-arguments` no código (exceto `x-queue-type`), para mudar sem redeclarar a fila (RMQ-AP-14) [1F].

### DLX e poison message

- **RMQ-BP-10** DLX em toda fila de trabalho, at-least-once nas quorum com os três requisitos da plataforma (`dead-letter-strategy=at-least-once`, `overflow=reject-publish`, `stream_queue`) [J].
- **RMQ-BP-11** Poison message: manter o `delivery-limit` e a DLX para um parking lot monitorado; erro permanente com `reject` ou `nack(requeue=false)` [J].
- Parking lot com alerta de profundidade maior que zero e dono; DLQ sem consumidor nem alerta é descarte adiado (RMQ-AP-11) [1F].
- **RMQ-BP-20** `delivery-limit` sempre acompanhado de DLX: sem DLX, a mensagem que passa do limite é descartada em silêncio. Como o limite passou a valer 20 por padrão no 4.0, fila quorum antiga sem DLX começa a perder mensagem no upgrade; confira as policies antes de subir de versão (RMQ-AP-23) [J: RabbitMQ, quorum queues, poison message handling].

### Ack e prefetch

- **RMQ-BP-03** Ack manual depois do efeito persistido; auto-ack é inseguro (RMQ-AP-01) [2F].
- **RMQ-BP-04** Prefetch explícito: 100 a 300 costuma otimizar throughput de mensagem rápida; 1 a 10 para processamento lento; 0 é ilimitado [1F + Interp.].
- **RMQ-BP-06** Poucas conexões longas; um canal por thread; conexões separadas para publicar e consumir (RMQ-AP-03, RMQ-AP-13) [2F].
- **RMQ-BP-07** `basic.consume`, nunca polling com `basic.get` (RMQ-AP-04) [2F].
- Prefetch é por consumidor: QoS global é depreciado e streams não o suportam (RMQ-AP-18) [J].
- **RMQ-BP-18** `consumer_timeout` (30 min por padrão, `consumer_timeout = 1800000` no `rabbitmq.conf`) acima do maior tempo de processamento com ack manual: estourado, o broker cancela o consumidor ou fecha o canal (AMQP 0.9.1) e devolve a mensagem, e job longo vira laço de reentrega; trabalho longo vai para o padrão de tarefa assíncrona (ack rápido e estado persistido) ou tem o timeout ajustado por fila (RMQ-AP-21) [1F: RabbitMQ, consumer timeout].

### Publisher confirms

- **RMQ-BP-02** Publisher confirms sempre, assíncronos ou em lote; confirm individual síncrono limita a centenas de mensagens por segundo (RMQ-AP-09); não republicar dentro do callback de confirm [1F].
- **RMQ-BP-05** Mensagem persistente (`delivery_mode=2`) em fila durável; quorum persiste sempre (RMQ-AP-12) [J].
- Relay de outbox publica com confirms quando o destino é RabbitMQ, e só marca a linha como enviada depois do confirm [1F].
- **RMQ-BP-22** Alarme de memória ou de disco bloqueia as conexões que publicam em todo o cluster até o alarme cessar (consumidores continuam); o publicador, e o relay da outbox em especial, trata a notificação `connection.blocked`/`unblocked`, para de consumir a outbox e alerta, em vez de acumular publicação em memória ou dar timeout às cegas (RMQ-AP-25) [1F: RabbitMQ, memory and disk alarms e blocked connection notifications].

### Retry

- **RMQ-BP-12** Retry fora da fila principal. Em 4.3 ou superior, retry atrasado nativo da quorum (`delayed-retry-type=failed`, `delayed-retry-min`, `delayed-retry-max`) [J]. Antes do 4.3, filas de espera por patamar (`retry.5s`, `retry.30s`, `retry.5m`) com TTL de fila e DLX de volta, contando `x-death`; uma fila por patamar porque TTL por mensagem só expira na cabeça da fila [1F]. Nunca o plugin de delayed exchange (RMQ-AP-17) [J].
- Nunca `nack` com requeue como mecanismo de retry: volta à cabeça da fila e não conta para o `delivery-limit` (RMQ-AP-10) [J].
- Jitter no cliente para retry de chamada remota, porque o retry nativo é linear e sem jitter [1F: AWS backoff e jitter].
- **RMQ-BP-23** Retry atrasado (nativo, fila de espera ou DLX de volta) tira a mensagem da ordem: enquanto ela espera, as seguintes da mesma chave são processadas. Em fila que promete ordem (SAC, consistent hash, super stream), erro transitório bloqueia a chave (retry no próprio consumidor, com teto) ou a mensagem vai ao parking lot e a chave fica marcada até a correção; nunca retry atrasado silencioso (RMQ-AP-26) [Interp. sobre a semântica de SAC e DLX].

### Idempotência e inbox

- **RMQ-BP-14** Consumidor idempotente; `redeliver=true` é pista, não prova de duplicata (INB-AP-02) [2F].
- Inbox transacional: `event_id` único e estável definido na origem [2F]; registrar `(subscriber_id, message_id)` com PK composta na mesma transação do efeito [1F: microservices.io]; ack só depois do commit; alternativa sem tabela é operação idempotente por semântica (upsert, "set status = X") [1F: EIP].
- Retenção da inbox maior ou igual à janela máxima de redelivery [Interp.].
- Dedupe em memória perde o estado no restart e não vale entre réplicas (INB-AP-01) [Interp.].

### Ordem

- **RMQ-BP-13** Ordem só onde for requisito: Single Active Consumer, stream com SAC, ou particionar por chave (consistent hash exchange ou super stream) [1F + J].
- FIFO é quebrado por prioridade e por múltiplos consumidores ativos com redelivery; não prometa ordem global com consumidores concorrentes [J].

### Streams

- Stream para fan-out grande, replay por offset ou timestamp e backlog grande com pouca memória [J].
- Sem DLX, sem TTL por mensagem, sem prioridade e sem QoS global: erro de processamento em stream é tratado pelo consumidor (reprocessar do offset, ou mover para fila de erro própria) [J; Interp. na correção].
- Super stream com SAC para ordem por partição com escala [J].
- **RMQ-BP-19** Todo stream com retenção declarada: sem `x-max-age` ou `x-max-length-bytes` o log cresce sem limite de disco e retém dado pessoal indefinidamente (LGPD); declare na criação, porque a policy só se aplica se existir quando o stream é declarado (RMQ-AP-22) [1F: RabbitMQ, streams — data retention].

### Operação e segurança

- **RMQ-BP-15** Cluster de 3, 5 ou 7 nós; TLS; usuário por aplicação; vhost por ambiente ou tenant; `guest` removido; alarmes de memória e disco monitorados [1F].
- **RMQ-BP-17** Antes de upgrade: `rabbitmq-diagnostics check_if_any_deprecated_features_are_used` e `GET /api/deprecated-features/used` (detecta espelhamento clássico, não detecta QoS global) [1F]. Para 4.3, confirmar que o cluster já roda em Khepri antes de atualizar, porque o Mnesia deixou de existir [J para a remoção].
- Infra do CDE com broker: listener sem TLS e usuário `guest` presente são achados (T-05, RMQ-AP-20); `rabbitmqctl list_users` em runtime [1F + Heurística].
- Multi-tenant: vhost por tenant interno com usuário próprio e permissão restrita ao prefixo dele; nunca permissão total `.*` (D-AP-02) [1F].
- **RMQ-BP-24** Parceiro em broker ou cluster de borda dedicado, com endpoint TLS e usuário só dele, alimentado pelo cluster interno por shovel ou federation (ou pelo relay do produto): o terceiro nunca recebe credencial nem rota para os nós internos, e o backlog de um parceiro lento não dispara alarme de memória ou disco no cluster que carrega pagamento. Vhost de parceiro no cluster interno só por ADR, com `max-connections` e `max-queues` no vhost, `max-length` e `overflow` nas filas dele (RMQ-AP-27) [1F: RabbitMQ, shovel, federation e vhost limits; Interp. no desenho].
- Métricas Prometheus do RabbitMQ: nomes não conferidos [Incerto — base §8.2 item 6].

### Receita de referência

Síntese sobre as fontes acima (base §6.3): exchange `dominio.eventos` (topic, durável) → fila `servico.trabalho` (quorum; SAC se exigir ordem) com policy `max-length`, `overflow=reject-publish`, `dead-letter-exchange=servico.dlx`, `dead-letter-strategy=at-least-once`, `delivery-limit=N` e, em 4.3+, `delayed-retry-type=failed`, `delayed-retry-min=1000`, `delayed-retry-max=60000`; `servico.dlx` → `servico.parking` (quorum, com limite e alerta de profundidade > 0). Publisher com confirms assíncronos; consumidor com ack manual, prefetch explícito, inbox transacional e `reject`/`nack(requeue=false)` para erro permanente.

### Migrações

- Filas espelhadas clássicas → quorum: blue-green com `rabbitmqadmin` v2 a partir do 3.13 [1F].
- Mnesia → Khepri antes do upgrade para 4.3: a remoção é fato [J]; o passo a passo (feature flag, janela, rollback) não foi lido e segue a documentação da versão [Incerto — base §8.2 item 17].
- Plugin de delayed exchange → retry atrasado nativo (4.3+) ou filas de espera por patamar [J].
- Fila clássica transiente não exclusiva → fila exclusiva, fila com nome gerado pelo servidor ou quorum durável [J para a depreciação; Interp. na escolha].
- Toda migração segue expand/contract e mantém leitura dupla até o corte [Interp.].

## Kafka

- **KFK-BP-01** Chave de partição = identidade do agregado; ordem só dentro da partição (KFK-AP-03) [2F].
- **KFK-BP-02** Sobreparticionar para um a dois anos: aumentar partições de tópico com chave quebra o mapeamento chave→partição (KFK-AP-04) [1F: artigo de 2015; custos por partição da era ZooKeeper a revalidar em KRaft].
- **KFK-BP-03** Desde o 3.0 (KIP-679) os defaults do produtor são `enable.idempotence=true` e `acks=all` [J]. No código atual do produtor, com idempotência implícita, `acks` diferente de `all` ou `retries=0` a desligam silenciosamente (log em nível info); com idempotência pedida explicitamente, lançam `ConfigException`; `max.in.flight.requests.per.connection` acima de 5 com idempotência ligada lança `ConfigException` (KFK-AP-02) [J: ProducerConfig.java trunk].
- **KFK-BP-04** RF=3, `min.insync.replicas=2`, `unclean.leader.election.enable=false`: com uma só réplica no ISR, `acks=all` ainda aceita, e é o `min.insync.replicas` que faz recusar (KFK-AP-06) [1F; os valores 3/2 são prática consagrada, Incerto quanto a segunda fonte].
- **KFK-BP-05** `enable.auto.commit` é `true` por padrão no consumidor [J: ConsumerConfig.java]; desligar e commitar depois de persistir (KFK-AP-01, KFK-AP-10) [1F].
- **KFK-BP-06** Exactly-once transacional vale dentro do Kafka (read-process-write com `isolation.level=read_committed`; o default `read_uncommitted` enxerga transação abortada) [2F]; efeito externo exige consumidor idempotente ou offset gravado na transação do banco (KFK-AP-05, KFK-AP-08). A 2PC entre Kafka e banco (KIP-939) depende de `transaction.version` 3 e não é tratada como produção hoje [Incerto — base §8.2 item 1].
- **KFK-BP-07** `retention.ms` é SLA de leitura; `retention.bytes` é por partição [1F].
- **KFK-BP-08** Compaction para tópico de estado; tombstone retido por `delete.retention.ms` (24 h por padrão) (KFK-AP-07) [1F].
- **KFK-BP-09** `max.poll.interval.ms` detecta livelock de consumidor [1F].
- Listener com TLS e autenticação; nunca `PLAINTEXT://0.0.0.0` (KFK-AP-09, T-05); ACL por prefixo de tópico e quota por cliente em multi-tenant interno; parceiro lê de tópico espelhado num cluster de borda (MirrorMaker 2 ou replicador), nunca com credencial no cluster interno (KFK-AP-15) [1F + Interp.].
- **KFK-BP-10** Erro de processamento com retry não bloqueante e DLT: tópicos de retry com atraso crescente e um dead-letter topic com alerta (Spring Kafka `@RetryableTopic` e `DeadLetterPublishingRecoverer`), em vez de retry em laço que para a partição; a DLT é armazenamento persistente para PCI e LGPD (KFK-AP-12) [1F: Spring Kafka, non-blocking retries].
- **KFK-BP-11** Poison pill de desserialização: registro que não desserializa trava o consumidor na mesma posição; use `ErrorHandlingDeserializer` (Spring) ou captura explícita da exceção de desserialização, com envio do registro bruto à DLT e avanço do offset (KFK-AP-11) [1F: Spring Kafka, ErrorHandlingDeserializer].
- **KFK-BP-12** Lag de consumidor monitorado por grupo e partição, com alerta por crescimento e por idade da mensagem mais antiga (`kafka-consumer-groups.sh --describe --group <g>`, exporter de lag) (KFK-AP-13) [1F].
- **KFK-BP-13** Kafka 4.0 removeu o ZooKeeper: só KRaft. Cluster novo nasce em KRaft (`process.roles`, `controller.quorum.voters`); o existente migra para KRaft numa versão 3.x antes do upgrade para 4.0. No 4.0 o protocolo novo de rebalanceamento do consumidor (KIP-848, `group.protocol=consumer`) é GA e reduz as paradas de rebalanceamento; o clássico continua disponível (KFK-AP-14) [1F: Apache Kafka 4.0 release notes e upgrade guide].

## Padrões de integração

### Inbox e consumidor idempotente

Ver a subseção "Idempotência e inbox" do RabbitMQ: vale igual para Kafka e para todo relay. O ponto comum é gravar o id da mensagem na mesma transação do efeito e só confirmar depois do commit [1F: microservices.io; EIP].

### Outbox transacional

- Dual write sem transação distribuída (commit no banco e publish no broker no mesmo handler) deixa estado inconsistente (OBX-AP-01) [2F].
- Gravar a mensagem na tabela outbox na mesma transação do efeito e publicar por relay, de modo que a mensagem saia se e somente se a transação commitar [1F: microservices.io].
- Relay por polling ou por log tailing (CDC); CDC tem overhead menor [1F].
- Debezium Outbox Event Router: colunas `id`, `aggregatetype`, `aggregateid` (vira a chave, garantindo ordem por agregado), `type` e `payload`; a tabela só recebe INSERT, e pode-se inserir e apagar na mesma transação porque o conector lê o log [2F].
- Relay com publisher confirms quando o destino é RabbitMQ; outbox com expurgo das linhas já publicadas (OBX-AP-03) [1F; Interp. no expurgo].
- Nunca publicar antes do commit (OBX-AP-02) [2F].
- Outbox no MongoDB: documento na coleção `outbox` gravado na mesma transação multi-documento do efeito (`withTransaction`, `w: "majority"`), com índice único no id do evento; relay por change stream ou Debezium MongoDB; publicar de dentro do callback da transação é dual write, porque o driver pode repetir o callback (OBX-AP-04) [1F: MongoDB transactions; Interp. no desenho].

### CDC com Debezium

- At-least-once, retomada pelo LSN; o slot de replicação retém WAL enquanto o conector está parado, e banco de baixo tráfego precisa de heartbeat (CDC-AP-01) [1F: Debezium PostgreSQL].
- Detector de WAL retido: `SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) FROM pg_replication_slots;` [Heurística, consulta padrão].
- Não expor tabela interna via CDC como contrato público: publicar evento de domínio via outbox (CDC-AP-02) [Interp. alinhada à motivação do outbox no blog Debezium].
- MongoDB: o relay da outbox por change stream persiste o resume token depois de publicar cada evento (at-least-once) e retoma com `resumeAfter` (ou `startAfter` depois de um evento de invalidação); o oplog precisa guardar história suficiente para cobrir a maior parada do relay, porque token que saiu do oplog não retoma (`ChangeStreamHistoryLost`) e exige ressincronização; dimensione o oplog pela janela de parada e alerte pela janela restante. O conector Debezium MongoDB usa change streams e tem o mesmo limite (CDC-AP-03) [1F: MongoDB change streams e oplog; Debezium MongoDB].
- CDC para invalidação de cache: o mecanismo é deste domínio; a política (delete após commit, TTL) é do especialista de cache [base §0.3 item 5].

### Saga

Sequência de transações locais com compensação, em coreografia ou orquestração; sem isolamento entre passos, exige outbox em cada passo [1F: microservices.io]. Compensação idempotente, estado da saga persistido e timeout explícito por passo [Interp.].

### Schema de evento: AsyncAPI e Schema registry

- Contrato de evento interno em AsyncAPI, versionado, com o schema do payload registrado: é o que a `rules/architecture/internal-grpc-communication.md` exige para evento assíncrono entre módulos, com o mesmo rigor do `.proto` do gRPC (SCH-AP-04) [regra da casa].
- O produtor é dono do schema do evento [Interp.].
- Modos de compatibilidade do Schema Registry: BACKWARD (default), FORWARD, FULL, variantes TRANSITIVE e NONE; BACKWARD atualiza consumidores antes, FORWARD produtores antes; para Protobuf recomenda-se BACKWARD_TRANSITIVE; modo NONE em subject de produção é antipattern (SCH-AP-03) [1F: Confluent].
- Protobuf: nunca reutilizar tag, reservar números e nomes removidos, não mudar tipo, sem `required`, primeiro valor de enum = 0 (SCH-AP-01, SCH-AP-02) [1F: protobuf.dev].
- Checagem de compatibilidade no CI com `buf breaking` ou o endpoint de compatibilidade do Schema Registry: sintaxe não conferida [Incerto — base §8.2 item 7].
- Dinheiro no payload como `integer` `int64` em centavos, com a unidade na descrição (`money-as-cents.md` §5) [regra da casa].

### Event sourcing

Estado como sequência de eventos; replay com sistemas externos e evolução de schema são os problemas [1F: Fowler]. Usar em domínio com auditoria e reconstrução temporal forte (ledger, conciliação); fila RabbitMQ nunca é event store [Interp.]. Evento imutável com dado pessoal colide com a eliminação da LGPD: pseudonimização e crypto-shredding (abaixo).

## Escolha de transporte

Regra do dono e `rules/architecture/internal-grpc-communication.md`: comunicação síncrona interna é gRPC com `.proto` versionado; evento assíncrono interno é mensageria com AsyncAPI e schema registrado; externa é REST (síncrona) ou fila/mensageria dedicada (assíncrona); gRPC nunca é exposto a terceiro; toda exceção exige ADR.

| Necessidade | Interno | Externo (parceiro, adquirente, integrador) | Contrato |
|---|---|---|---|
| Consulta ou comando síncrono | gRPC | REST com idempotency key em POST com efeito | `.proto` versionado (interno); OpenAPI (externo) |
| Comando assíncrono, trabalho único | Fila RabbitMQ (quorum) | Fila no broker de borda dedicado a parceiros, com usuário só dele, alimentada por shovel ou federation, ou REST + webhook | AsyncAPI com schema registrado; OpenAPI para o webhook |
| Evento de domínio, poucos assinantes | Exchange topic | Fila por parceiro atrás de exchange; nunca acesso à topologia interna | AsyncAPI com schema registrado |
| Muitos leitores, replay, retenção | RabbitMQ Stream ou Kafka | Adaptador que publica em fila ou tópico dedicado do parceiro | AsyncAPI com schema registrado (Protobuf ou Avro) |
| Streaming bidirecional contínuo | gRPC streaming | Não expor; REST paginado, webhook ou fila | `.proto` (interno); OpenAPI (externo) |

A tabela é da base §6.7 com a coluna de contrato acrescentada pelo design. A limitação técnica do gRPC-Web em navegador reforça a regra [1F: grpc.io]; cliente próprio (web ou mobile do produto) não é terceiro, e para ele a rule admite REST, GraphQL em BFF e gRPC-Web, sempre com ADR. Antipatterns da escolha de transporte: D-AP-01 a D-AP-05 no catálogo.

## Dado sensível e LGPD

- Fila quorum e stream gravam em disco; tópico Kafka retém por `retention.ms`; DLQ e parking lot guardam justamente a mensagem que falhou, por mais tempo: todos são armazenamento persistente [Interp.].
- Evento carrega token, nunca PAN nem SAD; se o fluxo exige PAN (roteamento ao adquirente), a mensagem é cifrada no nível de aplicação e o broker, seus discos, backups e DLQs entram no inventário de CHD (T-02) [Interp.; validar com o QSA].
- Payload logado no consumidor contamina o SIEM: logue ids, não payload [Interp.].
- RabbitMQ Stream e LGPD: stream com dado pessoal tem `x-max-age` compatível com o prazo de eliminação (RMQ-BP-19); DLQ e parking lot também têm prazo [Interp.].
- Kafka e LGPD: tombstone em tópico compactado apaga a chave, mas só depois da compactação e de `delete.retention.ms`; em tópico por tempo o dado vive até a retenção expirar, e o prazo precisa caber na política de eliminação [Interp. da base §7.2].
- Pseudonimização: o evento guarda chave substituta; quando ela é derivada do identificador (CPF, PAN), é HMAC com chave secreta gerida em KMS, nunca hash sem chave, que se reverte por força bruta no espaço pequeno do CPF e não atende o PCI DSS 3.5.1.1 para PAN; o mapa chave→pessoa fica num armazenamento mutável e eliminável. Crypto-shredding quando o meio é imutável (log de eventos, backup) [Interp.; 1F para o 3.5.1.1].
- Custo: RAM por mensagem e WAL em quorum queue [J]; partições e retenção no Kafka [1F].

## Fontes

[RabbitMQ quorum queues](https://www.rabbitmq.com/docs/quorum-queues) · [consumer timeout](https://www.rabbitmq.com/docs/consumers#acknowledgement-timeout) · [maxlength](https://www.rabbitmq.com/docs/maxlength) · [alarms](https://www.rabbitmq.com/docs/alarms) · [blocked connection notifications](https://www.rabbitmq.com/docs/connection-blocked) · [shovel](https://www.rabbitmq.com/docs/shovel) · [federation](https://www.rabbitmq.com/docs/federation) · [vhost limits](https://www.rabbitmq.com/docs/vhosts#limits) · [Kafka 4.0 upgrade](https://kafka.apache.org/documentation/#upgrade) · [Spring Kafka retry topics](https://docs.spring.io/spring-kafka/reference/retrytopic.html) · [MongoDB change streams](https://www.mongodb.com/docs/manual/changestreams/) · [confirms](https://www.rabbitmq.com/docs/confirms) · [production checklist](https://www.rabbitmq.com/docs/production-checklist) · [streams](https://www.rabbitmq.com/docs/streams) · [lazy queues](https://www.rabbitmq.com/docs/lazy-queues) · [DLX](https://www.rabbitmq.com/docs/dlx) · [exchanges](https://www.rabbitmq.com/docs/exchanges) · [queues](https://www.rabbitmq.com/docs/queues) · [channels](https://www.rabbitmq.com/docs/channels) · [consumers](https://www.rabbitmq.com/docs/consumers) · [TTL](https://www.rabbitmq.com/docs/ttl) · [deprecated features](https://www.rabbitmq.com/docs/deprecated-features) · [Quorum queues in 4.0](https://www.rabbitmq.com/blog/2024/08/28/quorum-queues-in-4.0) · [RabbitMQ 4.3 highlights](https://www.rabbitmq.com/blog/2026/04/23/rabbitmq-4.3-release) · [delayed-message-exchange (arquivado)](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange) · [amqplib channel API](https://amqp-node.github.io/amqplib/channel_api.html) · [Spring AMQP exception handling](https://docs.spring.io/spring-amqp/reference/amqp/exception-handling.html) · [Kafka design](https://github.com/apache/kafka/blob/trunk/docs/design/design.md) · [ProducerConfig.java](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/clients/producer/ProducerConfig.java) · [ConsumerConfig.java](https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/clients/consumer/ConsumerConfig.java) · [KIP-679](https://cwiki.apache.org/confluence/display/KAFKA/KIP-679%3A+Producer+will+enable+the+strongest+delivery+guarantee+by+default) · [Kafka 4.2.0](https://kafka.apache.org/blog/2026/02/17/apache-kafka-4.2.0-release-announcement/) · [Confluent EOS](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/) · [Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html) · [Idempotent Consumer](https://microservices.io/patterns/communication-style/idempotent-consumer.html) · [Saga](https://microservices.io/patterns/data/saga.html) · [Debezium Outbox Event Router](https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html) · [Debezium outbox blog](https://debezium.io/blog/2019/02/19/reliable-microservices-data-exchange-with-the-outbox-pattern/) · [Debezium PostgreSQL](https://debezium.io/documentation/reference/stable/connectors/postgresql.html) · [Fowler, Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) · [EIP Idempotent Receiver](https://www.enterpriseintegrationpatterns.com/patterns/messaging/IdempotentReceiver.html) · [Confluent schema evolution](https://docs.confluent.io/platform/current/schema-registry/fundamentals/schema-evolution.html) · [Protobuf dos and don'ts](https://protobuf.dev/programming-guides/dos-donts/) · [AsyncAPI](https://www.asyncapi.com/docs) · [gRPC-Web](https://grpc.io/blog/state-of-grpc-web/) · [AWS backoff e jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) · Regras da casa: `.forge/rules/architecture/internal-grpc-communication.md`, `.forge/rules/domain/money-as-cents.md`.
