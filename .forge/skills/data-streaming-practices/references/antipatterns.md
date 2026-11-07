# Mensageria — catálogo de antipatterns

Conjunto fechado de ids deste catálogo (design §2.5 do change `data-engineer-agent`): RMQ-AP-01 a RMQ-AP-19, KFK-AP-01 a KFK-AP-08, D-AP-01 a D-AP-03 e o transversal T-02 vêm da base consolidada (§6.4, §6.5, §6.7 e §7.1); RMQ-AP-20, KFK-AP-09, KFK-AP-10, D-AP-04 e D-AP-05 foram acrescentados pelo design; RMQ-AP-21 a RMQ-AP-28 e KFK-AP-11 a KFK-AP-15 foram acrescentados pela revisão de DBA de 2026-09-26 (operação do RabbitMQ 4.x, parceiro fora do cluster interno, erro de consumidor e KRaft no Kafka); as famílias `SCH-AP-*`, `INB-AP-*`, `OBX-AP-*` e `CDC-AP-*` catalogam antipatterns que a base descreve em prosa sem id (§6.6), com a mesma evidência da prosa. Id fora desse conjunto reprova o w250.

Cada entrada tem cinco campos. `Detecção` usa um de quatro rótulos: `scan.sh <ID>` (estática, o `scripts/scan.sh` executa), `ferramenta`, `runtime` (comando contra o sistema real, documentado e nunca executado pelo scanner) e `revisão`; um segundo rótulo complementar pode vir depois de `;`. Os padrões de API de cliente são heurísticos por linguagem: amqplib e Spring AMQP foram confirmados pelo juiz (em amqplib `nack` e `reject` têm `requeue` default `true` e `noAck` default `false`; em Spring AMQP `defaultRequeueRejected` default `true`, contornável com `AmqpRejectAndDontRequeueException`), as assinaturas de Java, pika, Go e .NET são conhecimento prévio [Incerto — base §8.2 item 8]. Toda varredura recursiva de exemplo usa `grep -a` ou `rg`.

### RMQ-AP-01 — Auto-ack
- **Sintoma:** mensagens "somem" quando o consumidor cai no meio do processamento.
- **Por quê:** com auto-ack o broker considera a mensagem entregue no envio, antes de o efeito persistir.
- **Correção:** ack manual depois do efeito persistido (RMQ-BP-03), com prefetch explícito.
- **Detecção:** `scan.sh RMQ-AP-01` (estática: `basicConsume(…, true` e .NET `BasicConsume(…, autoAck: true`, Go `Consume(fila, consumidor, true, …)` com o auto-ack posicional, `auto_ack=True`, `noAck: true`, `autoAck: true`, `AcknowledgeMode.NONE`, `acknowledge-mode: none`); runtime — `rabbitmqctl list_consumers queue_name ack_required` com `false`.
- **Evidência:** [2F]; [J] amqplib.

### RMQ-AP-02 — Fila sem limite
- **Sintoma:** fila crescendo até disparar o alarme de memória ou disco e bloquear todos os publishers.
- **Por quê:** sem `max-length` e `overflow`, o backlog não tem teto.
- **Correção:** `max-length`/`max-length-bytes` e `overflow` explícito por policy (RMQ-BP-08); em quorum com DLX at-least-once, `overflow=reject-publish`.
- **Detecção:** runtime — `curl .../api/queues | jq` filtrando `effective_policy_definition` e `arguments` sem `max-length*`.
- **Evidência:** [1F].

### RMQ-AP-03 — Conexão ou canal por mensagem
- **Sintoma:** churn de conexões no broker, latência de publicação alta, esgotamento de descritores.
- **Por quê:** abrir conexão AMQP é caro (TCP, TLS, handshake); o modelo é conexão longa com canais.
- **Correção:** poucas conexões longas por processo, canal por thread, conexões separadas para publicar e consumir (RMQ-BP-06).
- **Detecção:** `scan.sh RMQ-AP-03` (estática em código: `newConnection(`, `BlockingConnection(`, `amqp.connect(`, `amqp.Dial(`, `CreateConnection(Async)(`; fora da inicialização é o defeito — julgue).
- **Evidência:** [2F]; detector [Heurística].

### RMQ-AP-04 — Polling com basic.get
- **Sintoma:** CPU e rede gastas em consultas vazias; latência de entrega igual ao intervalo de polling.
- **Por quê:** `basic.get` é uma ida ao broker por mensagem, sem prefetch.
- **Correção:** `basic.consume` com prefetch (RMQ-BP-07).
- **Detecção:** `scan.sh RMQ-AP-04` (estática em código: `basicGet(`, `basic_get(`, `.get(`/`.Get(` em canal, `BasicGet(`).
- **Evidência:** [2F]; detector [Heurística].

### RMQ-AP-05 — Fila como banco (fila longa)
- **Sintoma:** milhões de mensagens paradas; fila consultada como armazenamento.
- **Por quê:** quorum queue não serve backlog de 5 milhões ou mais; fila não é store.
- **Correção:** consumidores suficientes, limite com overflow, e armazenamento durável para o que precisa ser guardado; stream para retenção longa.
- **Detecção:** runtime — `rabbitmqctl list_queues name messages | awk '$2 > 100000'` (limiar ajustado ao SLO).
- **Evidência:** [J] limite de 5M+ da quorum; limiar [Heurística].

### RMQ-AP-06 — Filas espelhadas clássicas
- **Sintoma:** policy de espelhamento clássico (`ha-mode`, `ha-params`, `ha-sync-mode`) em definição, Terraform ou código.
- **Por quê:** espelhamento clássico foi removido no RabbitMQ 4.0; o cluster não sobe a policy ou perde a HA esperada.
- **Correção:** quorum queue (RMQ-BP-01), migração blue-green com `rabbitmqadmin` v2.
- **Detecção:** `scan.sh RMQ-AP-06` (estática em IaC e código); runtime — `rabbitmqctl list_policies` e `rabbitmq-diagnostics check_if_any_deprecated_features_are_used`.
- **Evidência:** [2F]; [J] deprecated features.

### RMQ-AP-07 — Lazy queue esperando efeito
- **Sintoma:** argumento ou policy `x-queue-mode`/`queue-mode` configurado para economizar memória.
- **Por quê:** a configuração não tem efeito desde o 3.12; a economia esperada não existe.
- **Correção:** remover; dimensionar pela fila clássica v2 ou por quorum com limite.
- **Detecção:** `scan.sh RMQ-AP-07` (estática em IaC e código).
- **Evidência:** [J] lazy queues.

### RMQ-AP-08 — Publish sem publisher confirms
- **Sintoma:** mensagens perdidas em restart do broker sem erro no produtor.
- **Por quê:** sem confirms o produtor não sabe se o broker aceitou; mensagem não roteável também passa em silêncio sem `mandatory` ou alternate exchange.
- **Correção:** confirms assíncronos ou em lote (RMQ-BP-02), `mandatory`/alternate exchange.
- **Detecção:** `scan.sh RMQ-AP-08` (estática: arquivo que publica sem `confirmSelect`, `confirm_delivery`, `createConfirmChannel`, `.Confirm(`, `ConfirmSelect` nem `publisher-confirm-type`; Spring configura confirms em arquivo separado — julgue).
- **Evidência:** [1F]; detector [Heurística].

### RMQ-AP-09 — Confirm síncrono por mensagem
- **Sintoma:** throughput de publicação preso em centenas de mensagens por segundo.
- **Por quê:** esperar o confirm de cada mensagem serializa a publicação.
- **Correção:** confirms assíncronos com callback, ou em lote.
- **Detecção:** `scan.sh RMQ-AP-09` (estática: `waitForConfirms`; o defeito é dentro de laço — julgue).
- **Evidência:** [1F]; detector [Heurística].

### RMQ-AP-10 — Requeue infinito
- **Sintoma:** mensagem que falha volta à cabeça da fila e é reentregue sem fim; CPU alta, `redeliver` crescente, fila parada atrás dela.
- **Por quê:** `nack`/`reject` com `requeue=true` recoloca a mensagem; em quorum, `basic.nack` não incrementa `delivery-count`, então o `delivery-limit` não a contém. Em amqplib, pika e Spring AMQP o requeue é `true` por padrão; no amqplib, `nack(msg, false)` é a armadilha clássica, porque o segundo argumento é `allUpTo`, não `requeue`, e a mensagem volta à fila.
- **Correção:** erro permanente com `reject` ou `nack(requeue=false)` para a DLX; erro transitório com retry fora da fila principal (RMQ-BP-12).
- **Detecção:** `scan.sh RMQ-AP-10` (estática: Java/.NET `basicNack(…, …, true)` e `basicReject(…, true)`; pika `basic_nack(`/`basic_reject(` sem `requeue=False` nem o `False` posicional do requeue; amqplib `.nack(msg)`, `.nack(msg, allUpTo)` e `.nack(msg, x, true)`, `reject(msg)` e `reject(msg, true)` sobre o canal; Go `.Nack(…, true)` e `.Reject(true)`; `default-requeue-rejected: true`; a ausência dessa chave no Spring é o RMQ-AP-28); runtime — taxa de redeliver por fila.
- **Evidência:** [J] quorum queues e amqplib channel API; Spring AMQP exception handling.

### RMQ-AP-11 — Sem DLX, ou DLX sem consumidor nem alerta
- **Sintoma:** mensagens envenenadas descartadas em silêncio, ou acumulando num parking lot que ninguém olha.
- **Por quê:** sem DLX o erro permanente some; DLX sem dono é descarte adiado.
- **Correção:** DLX at-least-once em toda fila de trabalho (RMQ-BP-10), parking lot com alerta de profundidade maior que zero e dono.
- **Detecção:** runtime — filas de trabalho sem `dead-letter-exchange`; `*.dlq`/`*.parking` com `messages > 0` e `consumers = 0` sem alerta.
- **Evidência:** [1F].

### RMQ-AP-12 — Mensagem transiente em fila durável
- **Sintoma:** fila sobrevive ao restart do broker e fica vazia.
- **Por quê:** fila durável recupera só mensagem persistente; a transiente é descartada na recuperação.
- **Correção:** `delivery_mode=2`/`persistent: true`/`amqp.Persistent` em toda publicação de dado de negócio (RMQ-BP-05).
- **Detecção:** `scan.sh RMQ-AP-12` (estática: arquivo que publica sem `delivery_mode=2`, `PERSISTENT_`, `persistent: true`, `amqp.Persistent`, `DeliveryMode = 2`).
- **Evidência:** [J] queues; detector [Heurística].

### RMQ-AP-13 — Canal compartilhado entre threads
- **Sintoma:** frames intercalados, erros de protocolo intermitentes, acks trocados.
- **Por quê:** canal AMQP não é thread-safe na maioria dos clientes.
- **Correção:** canal por thread (RMQ-BP-06).
- **Detecção:** revisão — sem grep confiável.
- **Evidência:** [2F].

### RMQ-AP-14 — x-arguments fixos no código
- **Sintoma:** `x-dead-letter-exchange`, `x-message-ttl`, `x-max-length`, `x-delivery-limit` ou `x-overflow` declarados no `queueDeclare`.
- **Por quê:** argumento de declaração só muda recriando a fila; policy muda em runtime e vale para todas.
- **Correção:** configuração por policy (RMQ-BP-09); só `x-queue-type` fica na declaração.
- **Detecção:** `scan.sh RMQ-AP-14` (estática em código).
- **Evidência:** [1F].

### RMQ-AP-15 — Fila transiente não exclusiva ou temporária com nome fixo
- **Sintoma:** `durable: false` sem `exclusive`; declaração negada depois do upgrade para 4.3.
- **Por quê:** fila clássica transiente não exclusiva é depreciada e negada por padrão a partir do 4.3.0.
- **Correção:** fila exclusiva com nome gerado pelo servidor para reply-to e temporária; quorum durável para trabalho.
- **Detecção:** `scan.sh RMQ-AP-15` (estática: `queueDeclare(…, false, false`, `durable: false`, `durable=False`).
- **Evidência:** [J] 4.3 nega por padrão.

### RMQ-AP-16 — Fila única para tudo
- **Sintoma:** mensagens de tipos e SLOs diferentes na mesma fila; um tipo lento atrasa os outros.
- **Por quê:** "A single queue is generally considered to be an anti-pattern".
- **Correção:** fila por tipo de trabalho ou SLO, ligadas por routing key.
- **Detecção:** revisão — inventário de filas contra tipos de mensagem e SLO.
- **Evidência:** [J] queues.

### RMQ-AP-17 — Plugin delayed exchange
- **Sintoma:** exchange do tipo delayed, argumento de tipo atrasado ou o plugin habilitado em `enabled_plugins`.
- **Por quê:** o plugin `rabbitmq-delayed-message-exchange` foi depreciado e arquivado por limitações arquiteturais.
- **Correção:** retry atrasado nativo da quorum (4.3+) ou filas de espera por patamar com TTL e DLX (RMQ-BP-12).
- **Detecção:** `scan.sh RMQ-AP-17` (estática em código e IaC, inclusive `enabled_plugins`); runtime — `rabbitmq-plugins list -e | grep delayed`.
- **Evidência:** [J] blog 4.3 e repositório arquivado.

### RMQ-AP-18 — QoS global
- **Sintoma:** `basicQos(n, true)`, `basic_qos(global_qos=True)`, `prefetch(n, true)`.
- **Por quê:** QoS global é depreciado e streams não o suportam; o prefetch deve ser por consumidor.
- **Correção:** prefetch por consumidor (RMQ-BP-04).
- **Detecção:** `scan.sh RMQ-AP-18` (estática em código). O endpoint de features depreciadas não detecta QoS global.
- **Evidência:** [J] streams e deprecated features.

### RMQ-AP-19 — Upgrade para 4.3 ainda em Mnesia ou com partition handling legado
- **Sintoma:** `cluster_partition_handling = pause_minority` (ou `autoheal`, `pause_if_all_down`) no `rabbitmq.conf`.
- **Por quê:** no 4.3 o Mnesia foi removido e essas estratégias saíram junto; o cluster precisa já estar em Khepri antes do upgrade.
- **Correção:** migrar para Khepri na versão anterior, remover a chave, então atualizar; procedimento exato pela documentação da versão [Incerto].
- **Detecção:** `scan.sh RMQ-AP-19` (estática em `rabbitmq.conf` e IaC).
- **Evidência:** [J] remoção no 4.3; detector [Heurística].

### RMQ-AP-20 — Usuário guest liberado fora do loopback
- **Sintoma:** `loopback_users.guest = false`, `loopback_users = none` ou `default_user = guest` no `rabbitmq.conf` ou no compose.
- **Por quê:** credencial padrão conhecida com acesso remoto; a base pede `guest` removido (RMQ-BP-15) e a regra de integração proíbe acesso de terceiro ao broker interno.
- **Correção:** remover o `guest`, usuário por aplicação com permissão restrita ao vhost, TLS nos listeners.
- **Detecção:** `scan.sh RMQ-AP-20` (estática em `rabbitmq.conf` e compose); runtime — `rabbitmqctl list_users`.
- **Evidência:** [Interp.] T-05 da base §7.1 ([1F] + [Heurística]) e regra do dono; a checagem estática do `rabbitmq.conf` é do design.

### RMQ-AP-21 — Job longo com ack manual acima do consumer_timeout
- **Sintoma:** consumidor com processamento longo tem o canal fechado com `PRECONDITION_FAILED` depois de 30 min, e a mesma mensagem volta em laço.
- **Por quê:** o `consumer_timeout` (padrão 30 min) cancela o consumidor ou fecha o canal AMQP 0.9.1 quando a entrega fica sem ack além do limite, e a mensagem é devolvida.
- **Correção:** ack rápido com estado persistido e o trabalho longo seguindo fora da entrega; ou `consumer_timeout` ajustado por fila acima do maior processamento medido (RMQ-BP-18).
- **Detecção:** runtime — `rabbitmqctl environment | grep consumer_timeout` e taxa de canal fechado com `PRECONDITION_FAILED`; revisão — processamento acima de minutos no handler.
- **Evidência:** [1F] RabbitMQ, consumer timeout.

### RMQ-AP-22 — Stream sem retenção
- **Sintoma:** disco do nó crescendo sem parar; stream com meses de mensagens, inclusive dado pessoal.
- **Por quê:** stream é log append-only que cresce sem limite enquanto não houver `x-max-age` ou `x-max-length-bytes`; a policy só vale se existir quando o stream é declarado.
- **Correção:** `x-max-age` e `x-max-length-bytes` declarados na criação, com prazo compatível com a política de eliminação (RMQ-BP-19).
- **Detecção:** `scan.sh RMQ-AP-22` (estática: arquivo que declara `x-queue-type` `stream` sem `x-max-age`/`x-max-length-bytes`); runtime — `rabbitmqctl list_queues name type arguments`.
- **Evidência:** [1F] RabbitMQ, streams (data retention); detector [Heurística] (a policy pode estar fora do arquivo).

### RMQ-AP-23 — delivery-limit sem DLX
- **Sintoma:** mensagens somem sem registro depois de 20 tentativas, sobretudo logo após o upgrade para o 4.0.
- **Por quê:** desde o 4.0 o `delivery-limit` da quorum é 20 por padrão; sem DLX, a mensagem que passa do limite é descartada.
- **Correção:** DLX (at-least-once) em toda fila quorum de negócio, parking lot com alerta; revisar policies antes do upgrade (RMQ-BP-20).
- **Detecção:** runtime — `rabbitmqctl list_policies` e `list_queues name arguments policy` sem `dead-letter-exchange`.
- **Evidência:** [J] RabbitMQ, quorum queues (poison message handling).

### RMQ-AP-24 — Overflow drop-head silencioso
- **Sintoma:** fila com `max-length` que perde as mensagens mais antigas sem erro para ninguém.
- **Por quê:** o `overflow` padrão é `drop-head`: ao encher, a mais antiga é descartada (ou vai à DLX); `reject-publish` só é visível ao produtor que usa confirms.
- **Correção:** `overflow=reject-publish` com publisher confirms (RMQ-BP-21) e alerta de profundidade.
- **Detecção:** runtime — policies com `max-length` sem `overflow`; revisão — `x-max-length` no código (RMQ-AP-14).
- **Evidência:** [1F] RabbitMQ, queue length limit e quorum queues.

### RMQ-AP-25 — Publicador que ignora connection.blocked
- **Sintoma:** relay da outbox travado ou com timeout durante alarme de memória ou disco, sem alerta, e memória do processo crescendo.
- **Por quê:** o alarme de memória ou de disco bloqueia todas as conexões que publicam no cluster até cessar; sem tratar a notificação, o cliente fica bloqueado às cegas.
- **Correção:** registrar o handler de `connection.blocked`/`unblocked`, pausar o relay e alertar (RMQ-BP-22).
- **Detecção:** revisão — cliente sem handler de conexão bloqueada; runtime — `rabbitmqctl list_connections name state` com `blocked`.
- **Evidência:** [1F] RabbitMQ, memory and disk alarms e blocked connection notifications.

### RMQ-AP-26 — Retry atrasado em fila que promete ordem
- **Sintoma:** evento de um agregado processado depois de um posterior (estorno antes da captura).
- **Por quê:** retry atrasado, fila de espera ou DLX de volta tiram a mensagem da ordem, e as seguintes da mesma chave passam na frente.
- **Correção:** em fila com ordem, bloquear a chave (retry no consumidor, com teto) ou parking lot com a chave marcada até a correção (RMQ-BP-23).
- **Detecção:** revisão — `delayed-retry-type`, fila de espera ou DLX de volta em fila com SAC, consistent hash ou super stream.
- **Evidência:** [Interp.] sobre a semântica de SAC e DLX.

### RMQ-AP-27 — Parceiro com credencial no cluster interno
- **Sintoma:** usuário de parceiro autenticando nos nós internos, mesmo em vhost próprio; backlog do parceiro disparando alarme que bloqueia o publicador de pagamento.
- **Por quê:** vhost dá isolamento lógico, não de rede nem de recurso: o terceiro recebe credencial e rota para os nós internos, e os alarmes de memória e disco valem para o cluster inteiro.
- **Correção:** broker ou cluster de borda dedicado a parceiros, alimentado por shovel ou federation (ou pelo relay do produto), com endpoint TLS e usuário só dele; vhost no cluster interno só por ADR, com `max-connections`, `max-queues`, `max-length` e `overflow` (RMQ-BP-24).
- **Detecção:** revisão — usuário de parceiro em `rabbitmqctl list_users`/`list_permissions` do cluster interno.
- **Evidência:** [1F] RabbitMQ, alarms, shovel, federation e vhost limits; [Interp.] regra do dono.

### RMQ-AP-28 — Spring AMQP sem default-requeue-rejected: false
- **Sintoma:** exceção no `@RabbitListener` reentrega a mesma mensagem em laço.
- **Por quê:** no Spring AMQP o `defaultRequeueRejected` é `true`: exceção que não seja `AmqpRejectAndDontRequeueException` volta a mensagem à fila (RMQ-AP-10 por omissão).
- **Correção:** `spring.rabbitmq.listener.simple.default-requeue-rejected: false` (e `direct`), com DLX e retry fora da fila principal.
- **Detecção:** `scan.sh RMQ-AP-28` (estática: `application*.yml`/`.properties` com `spring.rabbitmq` ou bloco `rabbitmq:` sem `default-requeue-rejected`); revisão — container factory configurado em código.
- **Evidência:** [1F] Spring AMQP, exception handling; detector [Heurística].

### KFK-AP-01 — Auto-commit com efeito colateral
- **Sintoma:** mensagens perdidas quando o consumidor cai depois do commit e antes do efeito.
- **Por quê:** `enable.auto.commit` é `true` por padrão e commita o offset por tempo, não por efeito persistido.
- **Correção:** `enable.auto.commit=false` e commit depois de persistir (KFK-BP-05), com consumidor idempotente.
- **Detecção:** `scan.sh KFK-AP-01` (estática: `enable.auto.commit` `true` explícito); a ausência da chave é o KFK-AP-10.
- **Evidência:** [J] ConsumerConfig.java.

### KFK-AP-02 — acks 0 ou 1, ou idempotência desligada
- **Sintoma:** perda ou duplicata de mensagem no failover de líder.
- **Por quê:** com idempotência implícita, `acks` diferente de `all` ou `retries=0` a desligam em silêncio (log em nível info); `enable.idempotence=false` desliga explicitamente.
- **Correção:** manter os defaults do 3.0+ (`acks=all`, `enable.idempotence=true`), com `min.insync.replicas=2`.
- **Detecção:** `scan.sh KFK-AP-02` (estática em arquivo com marca de Kafka — `kafka`, `bootstrap.servers`, `ProducerConfig`, `kafkajs` —, com fronteira depois do dígito — `acks=10` e `retries=03` não casam — e aceitando o prefixo `spring.kafka.producer.`; `retries: 0` de Playwright ou de async-retry, fora de arquivo de Kafka, não casa).
- **Evidência:** [J] ProducerConfig.java trunk e KIP-679.

### KFK-AP-03 — Produtor sem chave com ordem por entidade
- **Sintoma:** eventos de um mesmo pedido processados fora de ordem.
- **Por quê:** sem chave o particionador espalha; ordem só existe dentro da partição.
- **Correção:** chave = identidade do agregado (KFK-BP-01).
- **Detecção:** `scan.sh KFK-AP-03` (estática: `new ProducerRecord<…>(topic, value)` de dois argumentos).
- **Evidência:** [1F].

### KFK-AP-04 — Aumentar partições de tópico com chave
- **Sintoma:** eventos de uma chave passam a ir para outra partição; ordem quebrada no corte.
- **Por quê:** o mapeamento chave→partição depende do número de partições.
- **Correção:** sobreparticionar para um a dois anos; se precisar mudar, tópico novo com replay.
- **Detecção:** revisão — auditoria de `kafka-topics.sh --alter --partitions`.
- **Evidência:** [1F] artigo de 2015 (custos por partição a revalidar em KRaft).

### KFK-AP-05 — Consumidor read_uncommitted em tópico transacional
- **Sintoma:** consumidor processa mensagens de transação abortada.
- **Por quê:** o default `isolation.level=read_uncommitted` enxerga o que a transação abortou.
- **Correção:** `isolation.level=read_committed` em todo consumidor de tópico com produtor transacional.
- **Detecção:** revisão — `transactional.id` no produtor sem `isolation.level=read_committed` no consumidor.
- **Evidência:** [2F].

### KFK-AP-06 — Durabilidade fraca
- **Sintoma:** escrita confirmada perdida em falha de broker.
- **Por quê:** RF 1 não tem réplica; `min.insync.replicas=1` deixa `acks=all` aceitar com uma réplica; eleição não limpa promove réplica atrasada.
- **Correção:** RF 3, `min.insync.replicas=2`, `unclean.leader.election.enable=false` (KFK-BP-04).
- **Detecção:** `scan.sh KFK-AP-06` (estática em IaC e properties).
- **Evidência:** [1F]; valores 3/2 são prática consagrada [Incerto quanto à segunda fonte].

### KFK-AP-07 — Compaction em tópico sem chave ou de eventos
- **Sintoma:** eventos "somem" depois da compactação.
- **Por quê:** compaction guarda só o último valor por chave; em tópico de eventos isso apaga história.
- **Correção:** compaction só em tópico de estado com chave; tópico de eventos com retenção por tempo.
- **Detecção:** revisão — `cleanup.policy=compact` com produtor sem chave.
- **Evidência:** [1F].

### KFK-AP-08 — Exactly-once tratado como fim a fim
- **Sintoma:** efeito externo (HTTP, banco) duplicado apesar de `exactly_once_v2`.
- **Por quê:** a transação do Kafka cobre só leitura e escrita no próprio Kafka.
- **Correção:** consumidor idempotente ou offset gravado na transação do banco (KFK-BP-06).
- **Detecção:** revisão — `processing.guarantee=exactly_once_v2` com chamada HTTP ou banco no processador.
- **Evidência:** [1F]; KIP-939 [Incerto].

### KFK-AP-09 — Listener PLAINTEXT em todas as interfaces
- **Sintoma:** `listeners=PLAINTEXT://0.0.0.0:9092` ou `KAFKA_LISTENERS` equivalente no compose.
- **Por quê:** sem TLS nem autenticação e com rota aberta; a regra de integração proíbe acesso de terceiro ao broker interno.
- **Correção:** listener `SASL_SSL` ou mTLS, interface privada, ACL por prefixo de tópico.
- **Detecção:** `scan.sh KFK-AP-09` (estática em `server.properties`, compose e IaC).
- **Evidência:** [Interp.] T-05 da base §7.1 e regra do dono.

### KFK-AP-10 — Auto-commit implícito
- **Sintoma:** configuração de consumidor com `group.id` e sem `enable.auto.commit`.
- **Por quê:** a ausência da chave é `true` (KFK-AP-01 por omissão).
- **Correção:** `enable.auto.commit=false` explícito.
- **Detecção:** `scan.sh KFK-AP-10` (estática: arquivo com `group.id`/`groupId`/`GroupId` sem `enable.auto.commit` no mesmo arquivo; linhas com `@KafkaListener` ou `spring.kafka` ficam fora, porque o Spring Kafka já usa `enable.auto.commit=false` por padrão desde o 2.3; configuração espalhada em vários arquivos escapa — julgue).
- **Evidência:** [J] default de ConsumerConfig.java; detector [Heurística].

### KFK-AP-11 — Poison pill de desserialização
- **Sintoma:** consumidor parado no mesmo offset, erro de desserialização em laço, lag crescendo numa partição.
- **Por quê:** registro que não desserializa lança antes de chegar ao handler, e o consumidor tenta de novo a mesma posição.
- **Correção:** `ErrorHandlingDeserializer` (Spring) ou captura da exceção de desserialização, registro bruto para a DLT e avanço do offset (KFK-BP-11).
- **Detecção:** revisão — consumidor sem tratamento de erro de desserialização; runtime — lag parado numa partição.
- **Evidência:** [1F] Spring Kafka, ErrorHandlingDeserializer.

### KFK-AP-12 — Retry bloqueante sem DLT
- **Sintoma:** partição inteira parada atrás de um registro que depende de serviço fora do ar.
- **Por quê:** retry em laço no próprio consumidor bloqueia a partição; sem DLT, a saída é descartar ou travar.
- **Correção:** retry não bloqueante com tópicos de retry e DLT com alerta (KFK-BP-10); a DLT entra no inventário de dado persistente.
- **Detecção:** revisão — handler com laço de retry sem DLT.
- **Evidência:** [1F] Spring Kafka, non-blocking retries.

### KFK-AP-13 — Lag sem monitoramento
- **Sintoma:** atraso de horas descoberto pelo cliente.
- **Por quê:** lag é o único sinal de consumidor lento ou parado.
- **Correção:** alerta por crescimento de lag e pela idade da mensagem mais antiga, por grupo e partição (KFK-BP-12).
- **Detecção:** runtime — `kafka-consumer-groups.sh --describe --group <g>`.
- **Evidência:** [1F] Apache Kafka, consumer groups.

### KFK-AP-14 — Kafka com ZooKeeper
- **Sintoma:** `zookeeper.connect` em `server.properties` ou serviço ZooKeeper no compose.
- **Por quê:** o Kafka 4.0 removeu o ZooKeeper; cluster em ZooKeeper não sobe na 4.0 sem migrar para KRaft antes.
- **Correção:** KRaft (`process.roles`, `controller.quorum.voters`); migração para KRaft numa 3.x antes do upgrade (KFK-BP-13).
- **Detecção:** `scan.sh KFK-AP-14` (estática em IaC: `zookeeper.connect`, `ZOOKEEPER_CONNECT`, serviço `zookeeper`).
- **Evidência:** [1F] Apache Kafka 4.0 release notes e upgrade guide; detector [Heurística].

### KFK-AP-15 — Parceiro com credencial no cluster Kafka interno
- **Sintoma:** ACL de parceiro no cluster que carrega os tópicos internos, mesmo restrita por prefixo.
- **Por quê:** a ACL por prefixo dá ao terceiro credencial e rota de rede para os brokers internos; erro de ACL expõe tópico interno.
- **Correção:** tópico espelhado num cluster de borda (MirrorMaker 2 ou replicador) com a credencial do parceiro só lá; no interno, só com ADR.
- **Detecção:** revisão — principal de parceiro em `kafka-acls.sh --list` do cluster interno.
- **Evidência:** [Interp.] regra do dono; [1F] MirrorMaker 2.

### D-AP-01 — gRPC exposto a terceiro
- **Sintoma:** Ingress, Gateway ou Service `LoadBalancer`/`NodePort` apontando backend gRPC; porta 50051 publicada em `ports:` do compose.
- **Por quê:** gRPC é malha interna; a superfície externa é REST ou fila, sem exceção, pela regra do dono.
- **Correção:** adaptador REST (OpenAPI) ou fila dedicada na frente do serviço gRPC; gRPC-Web só para cliente próprio e com ADR.
- **Detecção:** `scan.sh D-AP-01` (estática em manifests: `grpc` em arquivo de Ingress/Gateway/LoadBalancer/NodePort, e `50051:` em compose).
- **Evidência:** [Interp.] base §6.7 e regra do dono; detector [Heurística].

### D-AP-02 — Fila interna compartilhada com parceiro
- **Sintoma:** usuário de parceiro com permissão no vhost interno; permissão total `.*` em `configure`/`write`/`read`.
- **Por quê:** o parceiro enxerga e altera a topologia interna; nenhum terceiro recebe permissão sobre fila ou vhost internos.
- **Correção:** fila do parceiro num broker ou cluster de borda dedicado, com usuário só dele e permissão restrita ao prefixo dele, alimentada por shovel, federation ou relay do produto; vhost de parceiro no cluster interno só por ADR e com limites (RMQ-AP-27).
- **Detecção:** `scan.sh D-AP-02` (estática: permissão `.*` em `definitions.json` ou `rabbitmq_permissions`; quem é usuário externo é julgamento de revisão); runtime — `rabbitmqctl list_permissions -p <vhost_interna>`.
- **Evidência:** [Interp.] base §6.7 e regra do dono.

### D-AP-03 — Cadeia REST síncrona para fluxo que tolera assincronia
- **Sintoma:** serviço A chama B que chama C por REST, com timeouts em cascata.
- **Por quê:** acoplamento temporal onde a cadência poderia ser desacoplada; e REST síncrono entre serviços internos exige ADR.
- **Correção:** evento por mensageria com AsyncAPI ou comando em fila; gRPC para o que precisa ser síncrono interno.
- **Detecção:** revisão de arquitetura.
- **Evidência:** [Interp.] base §6.7.

### D-AP-04 — Regra de rede aberta na porta do broker
- **Sintoma:** security group ou firewall com `0.0.0.0/0` e porta 5672, 5671, 5552, 5551 (streams), 15672, 15671 (API de gestão, com poder de administrador), 9092 ou 9093.
- **Por quê:** rota de qualquer origem para broker interno.
- **Correção:** CIDR da VPC; API de gestão só na rede de operação; parceiro num broker ou cluster de borda dedicado, atrás de endpoint próprio, com TLS e usuário dele (RMQ-BP-24).
- **Detecção:** `scan.sh D-AP-04` (estática em IaC: `0.0.0.0/0` e a porta no mesmo arquivo; localização na linha do CIDR).
- **Evidência:** [Interp.] norma da regra do dono; detector [Heurística].

### D-AP-05 — Cliente HTTP para host interno em código de domínio
- **Sintoma:** `fetch("http://antifraude:8080/...")`, `RestTemplate`, `HttpClient` apontando nome de serviço sem ponto dentro de `domain/`.
- **Por quê:** comunicação síncrona interna é gRPC salvo ADR; a verificação da `internal-grpc-communication.md` trata HTTP em código de domínio como suspeita de violação.
- **Correção:** porta de domínio implementada por cliente gRPC na infraestrutura; evento por mensageria quando assíncrono; exceção só com ADR.
- **Detecção:** `scan.sh D-AP-05` (estática em código sob caminho com `domain`/`Domain`).
- **Evidência:** [Interp.] seção Verificação da `internal-grpc-communication.md`; detector [Heurística].

### T-02 — PAN ou SAD em payload de fila, tópico, DLQ ou evento de outbox
- **Sintoma:** campo `pan`, `card_number`, `cvv`, `cvc`, `track` ou `pin_block` em `.proto`, `.avsc` ou JSON Schema de evento, ou no payload que o código publica (`publish`, `send`, `produce`, `emit`) ou monta como literal de evento.
- **Por quê:** fila quorum, stream, tópico, DLQ e parking lot são armazenamento persistente; o PAN em claro leva o broker, seus discos, backups e DLQs para o escopo de CHD.
- **Correção:** evento carrega token; se o fluxo exige PAN, cifrar no nível de aplicação e inventariar o broker como CDE.
- **Detecção:** `scan.sh T-02` (estática em schema de evento e em código na mesma linha de `publish`/`send`/`produce`/`emit` ou de literal `evt`/`event`/`payload`/`message`; a fronteira inclui `_`, de modo que `pan_token`, `masked_pan` e `pan_last4` — o formato que a correção recomenda — não casam, nem `span_id`, `company`, `expand` e `tracking_id`; complemento do `check-data-governance.sh`); runtime — amostragem DLP da DLQ e do parking lot.
- **Evidência:** [Interp.] base §7.1 — validar com o QSA.

### SCH-AP-01 — Campo required em .proto
- **Sintoma:** `required string id = 1;` em schema de evento ou de gRPC.
- **Por quê:** `required` impede remover ou tornar opcional depois sem quebrar leitor antigo; o protobuf.dev recomenda nunca usar.
- **Correção:** proto3 sem `required`; validação de presença na aplicação.
- **Detecção:** `scan.sh SCH-AP-01` (estática em `*.proto`).
- **Evidência:** [1F] protobuf.dev.

### SCH-AP-02 — Reuso de tag ou mudança de tipo em Protobuf
- **Sintoma:** campo removido e tag reaproveitada; tipo de campo trocado entre versões.
- **Por quê:** o leitor antigo decodifica o byte novo como o campo velho, em silêncio.
- **Correção:** `reserved` para números e nomes removidos; campo novo com tag nova; primeiro valor de enum = 0.
- **Detecção:** revisão — `git diff main -- '*.proto' | grep -E '^-\s+\w.*=\s*[0-9]+;'` para achar tag removida.
- **Evidência:** [1F] protobuf.dev.

### SCH-AP-03 — Subject em modo NONE no Schema Registry
- **Sintoma:** compatibilidade desligada em subject de produção.
- **Por quê:** qualquer schema entra, inclusive o que quebra consumidores.
- **Correção:** BACKWARD (default) ou BACKWARD_TRANSITIVE para Protobuf; FORWARD quando produtores atualizam antes.
- **Detecção:** runtime — `curl $SR/config/<subject>`.
- **Evidência:** [1F] Confluent schema evolution.

### SCH-AP-04 — Evento interno sem contrato AsyncAPI
- **Sintoma:** evento publicado entre serviços sem documento AsyncAPI versionado nem schema registrado.
- **Por quê:** a `internal-grpc-communication.md` exige mensageria com AsyncAPI para evento assíncrono entre módulos; sem contrato o consumidor descobre a mudança em produção.
- **Correção:** AsyncAPI versionado no repositório do produtor, schema do payload registrado, compatibilidade no CI.
- **Detecção:** revisão — publicador sem canal correspondente no documento AsyncAPI.
- **Evidência:** [Interp.] regra da casa e base §6.6.

### INB-AP-01 — Dedupe em memória
- **Sintoma:** `processedIds`, `seenMessages` num `Set` do processo.
- **Por quê:** o estado se perde no restart e não vale entre réplicas: a duplicata passa quando mais importa.
- **Correção:** inbox transacional com `(subscriber_id, message_id)` na mesma transação do efeito, ou operação idempotente por semântica.
- **Detecção:** `scan.sh INB-AP-01` (estática em código).
- **Evidência:** [Interp.] base §6.6; detector [Heurística].

### INB-AP-02 — redelivered usado como dedupe
- **Sintoma:** `if (msg.fields.redelivered) { ack; return; }`.
- **Por quê:** `redeliver=true` é pista, não prova: a primeira entrega pode não ter produzido efeito, e a duplicata pode chegar com `redelivered=false`.
- **Correção:** inbox transacional pelo id da mensagem.
- **Detecção:** `scan.sh INB-AP-02` (estática: `redelivered`/`isRedeliver` numa linha com `if`).
- **Evidência:** [Interp.] base §6.6; detector [Heurística].

### OBX-AP-01 — Dual write sem outbox
- **Sintoma:** commit no banco e publish no broker no mesmo handler; evento perdido ou fantasma quando um dos dois falha.
- **Por quê:** sem transação distribuída não há atomicidade entre as duas escritas.
- **Correção:** outbox transacional com relay (polling ou CDC) e confirms.
- **Detecção:** revisão — publish dentro do mesmo handler que faz commit, sem tabela outbox; regra Semgrep a escrever.
- **Evidência:** [2F] base §6.6.

### OBX-AP-02 — Publicar antes do commit
- **Sintoma:** consumidor recebe evento de algo que depois sofreu rollback.
- **Por quê:** o evento sai antes de o estado existir.
- **Correção:** outbox; relay só publica o que commitou.
- **Detecção:** revisão — ordem publish → commit no handler.
- **Evidência:** [2F] base §6.6.

### OBX-AP-03 — Outbox sem expurgo
- **Sintoma:** tabela outbox crescendo sem limite; relay por polling cada vez mais lento.
- **Por quê:** linhas já publicadas nunca são removidas.
- **Correção:** expurgo das linhas publicadas (ou inserir e apagar na mesma transação quando o relay é por CDC).
- **Detecção:** runtime — contagem e idade das linhas publicadas na outbox.
- **Evidência:** [2F] base §6.6; [Interp.] no expurgo.

### OBX-AP-04 — Outbox no MongoDB fora da transação ou publicada no callback
- **Sintoma:** evento publicado de uma transação que abortou, ou evento duplicado quando o driver repete o callback do `withTransaction`.
- **Por quê:** publicar de dentro do callback é dual write, e o driver repete o callback em `TransientTransactionError`; gravar a outbox fora da transação perde a atomicidade.
- **Correção:** documento na coleção `outbox` gravado na mesma transação do efeito, com índice único no id do evento; relay por change stream ou Debezium MongoDB.
- **Detecção:** revisão — `publish`/`send` dentro do callback de `withTransaction`.
- **Evidência:** [1F] MongoDB transactions; [Interp.] no desenho.

### CDC-AP-01 — Slot de replicação retendo WAL
- **Sintoma:** disco do PostgreSQL enchendo com o conector parado ou lento.
- **Por quê:** o slot de replicação segura o WAL até o conector confirmar.
- **Correção:** monitorar o lag do slot, heartbeat em banco de baixo tráfego, remover slot abandonado.
- **Detecção:** runtime — `SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) FROM pg_replication_slots;`.
- **Evidência:** [1F] Debezium PostgreSQL; consulta [Heurística].

### CDC-AP-02 — Tabela interna exposta via CDC como contrato público
- **Sintoma:** consumidores de outros domínios (ou parceiros) lendo o tópico de CDC de uma tabela interna.
- **Por quê:** o schema interno vira contrato sem versão; CDC ou tópico interno compartilhado com terceiro viola a regra de integração.
- **Correção:** evento de domínio publicado via outbox, com AsyncAPI; parceiro só por fila dedicada ou REST.
- **Detecção:** revisão — tópicos de CDC com consumidor fora do domínio dono.
- **Evidência:** [Interp.] alinhada à motivação do outbox no blog Debezium.

### CDC-AP-03 — Change stream sem resume token persistido ou com oplog curto
- **Sintoma:** relay que reprocessa desde o início ou perde eventos depois de uma parada; erro `ChangeStreamHistoryLost` ao retomar.
- **Por quê:** o change stream retoma pelo resume token, e só se o oplog ainda guardar a operação; token não persistido ou parada maior que a janela do oplog perdem a posição.
- **Correção:** persistir o resume token depois de publicar cada evento, retomar com `resumeAfter` (ou `startAfter` depois de invalidação), dimensionar o oplog pela maior parada e alertar pela janela restante.
- **Detecção:** runtime — `rs.printReplicationInfo()` (janela do oplog) e idade do último token persistido; revisão — relay sem persistência do token.
- **Evidência:** [1F] MongoDB change streams e oplog; Debezium MongoDB.
