# Cache — boas práticas

Base: seção 3 e itens T-01 e T-04 da seção 7.1 da base consolidada do change `data-engineer-agent` (julgada em 2026-09-26), subordinada às regras da casa. Marcas: [J] reconferido pelo juiz na fonte primária; [2F] duas fontes independentes; [1F] documentação oficial do produto; [Interp.] interpretação técnica; [Heurística] limiar de partida.

## Regras da casa (precedência sobre a base)

A `rules/data/data-cache.md` já fixa o que vale em todo projeto e esta referência não a duplica: namespace por tenant em toda chave, TTL explícito em toda entrada, classes de dado proibidas (segredo, chave privada, PAN/CVV/track, PII sem máscara), política de invalidação explícita, serialização versionada e degradação graciosa quando o cache cai. A `data-governance.md` acrescenta a mais importante: cache nunca é fonte de verdade. A base tratava "Redis como armazenamento primário" como desenho válido de outro especialista; no template isso não é desenho válido, é `CONFLITO` com rule (desempate 1 do orquestrador).

## Quando usar e quando não

Só adicionar cache com necessidade justificada por custo, latência ou disponibilidade [1F: AWS Builders' Library]. Não usar quando a maioria das requisições não vai acertar; para dado sensível em cache compartilhado ("Always retrieve this type of data from the primary source"); nem para dataset estático que cabe em memória, que é carregado no startup [2F: Microsoft Learn e AWS]. A origem precisa sobreviver a cache frio: dimensione-a para o pior caso de cache vazio [1F].

## Cache-aside

Lê do cache; no miss, lê da origem e popula; na escrita, grava a origem e invalida a chave [2F]. É simples e resiliente a nó vazio, com staleness entre a escrita e a próxima leitura [Interp.]. É o padrão de partida para leitura muito frequente de dado que muda pouco.

## Write-through e write-behind

Read-through e write-through delegam à camada de cache; write-through dá frescor ao custo de popular dado que nunca será lido e combina com lazy loading e TTL [2F]. Write-behind confirma antes de gravar a origem: para dado que não pode ser perdido é risco lógico não quantificado pelas fontes [Interp.], e no template ele colide com "nunca fonte de verdade" enquanto a escrita na origem não aconteceu.

## TTL

- Todo valor com TTL proporcional à tolerância a dado velho (C-02, C-08) [2F]; é também exigência da rule da casa.
- Jitter no TTL contra expiração sincronizada de chaves carregadas em lote (C-03) [2F, fontes secundárias]; o percentual (±10–20%) é [Incerto — só fontes secundárias].
- Cache negativo (resultado "não existe") com TTL menor que o positivo [1F].
- Soft TTL mais hard TTL para servir o valor velho quando a origem está fora [1F].

## Invalidação

- Atualizar a origem **antes** de remover a chave, e depois do commit: delete antes do commit deixa uma janela em que outro leitor repopula o valor velho (C-01) [2F: Microsoft e NSDI 2013].
- Delete em vez de set na invalidação: delete é idempotente e tolera mensagem duplicada ou fora de ordem [2F].
- Formato serializado versionado na chave (`svc:v2:...`) para deploy sem ler formato antigo [1F].
- Invalidação dirigida por evento de mudança atravessa dois domínios: o mecanismo (outbox, CDC) é do especialista de mensageria; a política (delete após commit, TTL) é daqui [base §0.3 item 5].

## Stampede

Quando uma chave quente expira, N requisições vão juntas à origem. Proteções: single-flight (uma requisição recalcula, as outras esperam), leases, ou expiração antecipada probabilística (XFetch) (C-04) [2F: AWS, NSDI 2013, VLDB 2015].

## Chave quente e chave grande

- Chave quente concentra CPU num shard: `redis-cli --hotkeys` exige política LFU; mitigue com réplica de leitura, cache local de curtíssimo prazo na frente, ou chave fatiada (C-05) [1F].
- Chave grande bloqueia e fragmenta: `redis-cli --bigkeys` e `--memkeys` usam SCAN e são seguros com `-i` (C-06) [1F].
- Comando O(N) sobre estrutura grande aparece no `SLOWLOG` (C-14) [1F].

## Cache como fonte da verdade

Não é desenho aceito no template (`data-governance.md` e `data-cache.md`: nunca fonte de verdade). A razão técnica: com política de eviction o Redis descarta chave para abrir espaço, e em cluster a replicação assíncrona pode perder escrita confirmada no failover — `WAIT` reduz sem eliminar (C-07) [J: eviction; 1F: cluster spec]. Sessão durável, carrinho que não pode sumir, contador financeiro e fila vão para um store durável (NoSQL ou relacional pela matriz do orquestrador, mensageria para fila); o cache fica na frente dele.

## Memória e eviction

- `maxmemory` explícito (o default em 64 bits é 0, sem limite), com folga para buffers de replicação e de AOF, que não contam para a eviction (C-10) [J].
- Política: `allkeys-lru` é o default recomendado quando um subconjunto é muito mais acessado; `allkeys-lfu` quando a frequência pesa mais; `volatile-*` se comporta como `noeviction` se nenhuma chave tem TTL [J]. Redis 8.6 acrescentou `allkeys-lrm` e `volatile-lrm` (menos recentemente modificado) [J].
- Instâncias separadas para cache e para chaves persistentes; fila, lock e sessão com eviction na mesma instância do cache é antipattern (C-13) [J].
- Métricas: hit ratio `keyspace_hits / (keyspace_hits + keyspace_misses)`, `evicted_keys`, `expired_keys` [J]. LRU × LFU se decide medindo `INFO stats`.
- Persistência: RDB aceita perder minutos; AOF `everysec` perde até cerca de 1 s; cache puro pode desligar a persistência [1F].

## Cluster

16.384 slots; operação multi-chave só no mesmo slot, com hash tags (`{user:42}`) (C-12) [1F]. Standalone com Sentinel aceita multi-chave livre; cluster escala e impõe hash tags [Interp.].

## Cache local em processo

Rápido e barato, incoerente entre instâncias, e a carga na origem escala com o tamanho da frota; sempre com TTL e tamanho máximo (C-08) [2F].

## Segurança, multi-tenant e dado sensível

- Nunca exposto à internet: ACL (Redis 6+), TLS no cliente, na replicação e no barramento, `protected-mode` ligado, `bind` em interface privada, rodar sem root; bloquear `CONFIG`, `FLUSHALL`, `DEBUG` e `KEYS` por ACL; `SCAN`, nunca `KEYS`, em código (C-09, C-11) [2F; 1F para SCAN].
- Nenhum terceiro recebe credencial, rota de rede ou permissão sobre cache interno: regra de rede aberta a `0.0.0.0/0` na porta 6379 é reprovada (C-16) [Interp.: regra de integração do dono].
- Multi-tenant: namespace por tenant na chave e ACL por padrão de chave; nunca chave sem tenant em cache compartilhado [Interp. da base §7.3, obrigatório pela `data-cache.md`].
- PAN e SAD: nunca PAN em claro nem SAD em cache distribuído; cacheie o token e metadados não sensíveis (BIN, últimos 4, marca) (T-01, C-15) [J: PCI DSS 3.3.1; detector Heurística]. SAD não é armazenado após a autorização nem cifrado, e a guidance só admite SAD em memória não persistente por tempo curto; Redis com RDB/AOF, réplica e snapshot é persistente [J; a leitura de Redis persistente como armazenamento de CHD é Interp. — validar com o QSA].
- Chave com PAN contamina `SLOWLOG`, `MONITOR` e APM, que registram argumentos (T-04) [Interp.].

## Decisões e trade-offs

| Decisão | A favor | Contra |
|---|---|---|
| Cache-aside × write-through | resiliente a nó vazio, simples | staleness entre escrita e próxima leitura |
| Cache local × distribuído | latência mínima, sem rede | incoerente entre instâncias; carga na origem cresce com a frota |
| TTL curto × longo | menos staleness | mais carga na origem |
| Standalone + Sentinel × cluster | multi-chave livre | cluster escala, mas exige hash tags |
| LRU × LFU | bom para subconjunto quente estável | LFU protege chave frequente de rajada; decida medindo |

## Fontes

[Microsoft Cache-Aside](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside) · [AWS Builders' Library, caching](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/) · [AWS caching patterns](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html) · [Nishtala et al., NSDI 2013](https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf) · [Vattani et al., VLDB 2015](http://www.vldb.org/pvldb/vol8/p886-vattani.pdf) · [Redis eviction](https://redis.io/docs/latest/develop/reference/eviction/) · [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/) · [Redis cluster spec](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/) · [Redis security](https://redis.io/docs/latest/operate/oss_and_stack/management/security/) · [redis-cli](https://redis.io/docs/latest/develop/tools/cli/) · [Checkov](https://www.checkov.io/5.Policy%20Index/terraform.html) · PCI DSS v4.0.1, requisitos 3.3.1 e 3.5.1 · Regras da casa: `.forge/rules/data/data-cache.md`, `.forge/rules/data/data-governance.md`.
