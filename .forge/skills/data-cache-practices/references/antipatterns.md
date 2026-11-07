# Cache — catálogo de antipatterns

Conjunto fechado de ids deste catálogo (design §2.5 do change `data-engineer-agent`): C-01 a C-15 e os transversais T-01 e T-04 vêm da base consolidada (§3.3 e §7.1); C-16 foi acrescentado pelo design (exposição de cache pela regra de integração do dono); C-17 foi acrescentado pela revisão de DBA de 2026-09-26 (bind em todas as interfaces com autenticação, separado do C-11). Id fora desse conjunto reprova o w250.

Cada entrada tem cinco campos. `Detecção` usa um de quatro rótulos: `scan.sh <ID>` (estática, o `scripts/scan.sh` executa), `ferramenta`, `runtime` (comando contra o sistema real, documentado e nunca executado pelo scanner) e `revisão`; um segundo rótulo complementar pode vir depois de `;`. Comandos de runtime foram redigidos pela pesquisa e não executados contra sistema real. Toda varredura recursiva de exemplo usa `grep -a` ou `rg`.

### C-01 — Invalidação na ordem errada
- **Sintoma:** valor velho volta ao cache logo depois de uma atualização; bug intermitente que some ao limpar o cache.
- **Por quê:** delete antes do commit (ou set em vez de delete) abre janela em que um leitor concorrente relê a origem ainda antiga e repopula a chave.
- **Correção:** gravar a origem, confirmar o commit e só então remover a chave; delete em vez de set; em mudança dirigida por evento, invalidar no consumidor do evento pós-commit.
- **Detecção:** revisão — `grep -arnB3 -A3 -E '\.(del|delete|evict|invalidate)\('` e conferir a ordem em relação ao commit.
- **Evidência:** [2F] Microsoft Cache-Aside e NSDI 2013; detector [Heurística].

### C-02 — Escrita sem TTL
- **Sintoma:** memória cresce até a eviction; dado velho servido indefinidamente.
- **Por quê:** sem expiração, a chave vive até ser despejada; a `data-cache.md` exige TTL explícito em toda entrada.
- **Correção:** TTL proporcional à tolerância a dado velho, com jitter em carga em lote (`SET k v EX 300`, `{ EX: 300 }`, `ex=300`).
- **Detecção:** `scan.sh C-02` (estática: `.set(`/`.hset(`/`.hmset(` de receptor redis, cache, valkey, client ou r sem `EX`/`PX`/`expir…`/`ttl`/`timeout` na linha; Spring `opsForValue().set(` sem `Duration`/`TimeUnit`; StackExchange.Redis `StringSet`/`HashSet` sem `TimeSpan`; go-redis `Set(ctx, …, 0)`); runtime — `redis-cli --scan | head -1000 | xargs -n1 redis-cli TTL | grep -c '^-1$'`.
- **Evidência:** [Heurística] detector e amostragem.

### C-03 — TTL constante sem jitter em carga em lote
- **Sintoma:** picos periódicos de miss com período igual ao TTL.
- **Por quê:** chaves carregadas juntas expiram juntas.
- **Correção:** TTL base mais variação aleatória; o percentual exato é [Incerto].
- **Detecção:** revisão — TTL literal sem componente aleatório; runtime — misses periódicos alinhados ao TTL.
- **Evidência:** [2F] fontes secundárias.

### C-04 — Stampede
- **Sintoma:** ao expirar uma chave quente, dezenas de consultas idênticas chegam à origem ao mesmo tempo.
- **Por quê:** todo leitor que vê o miss recalcula.
- **Correção:** single-flight, lease (`SET chave NX` com prazo), expiração antecipada probabilística (XFetch), soft TTL.
- **Detecção:** revisão — ausência de `singleflight|SET.*NX|setnx|Lock\(` no caminho de miss; runtime — traces com N consultas idênticas.
- **Evidência:** [2F] AWS, NSDI 2013, VLDB 2015.

### C-05 — Chave quente
- **Sintoma:** um shard com CPU alta e os outros ociosos.
- **Por quê:** a carga de uma chave vai inteira para um slot.
- **Correção:** réplica de leitura, cache local de curtíssimo prazo na frente, fatiar a chave.
- **Detecção:** runtime — `redis-cli --hotkeys` (exige política LFU); CPU por shard.
- **Evidência:** [1F] redis-cli.

### C-06 — Chave grande
- **Sintoma:** latência de cauda alta; bloqueio em `DEL` ou em leitura de coleção inteira.
- **Por quê:** operação sobre valor grande ocupa a thread principal.
- **Correção:** fatiar a estrutura; `UNLINK` em vez de `DEL`; ler por página.
- **Detecção:** runtime — `redis-cli --bigkeys` e `--memkeys` (usam SCAN; seguros com `-i`).
- **Evidência:** [1F] redis-cli.

### C-07 — Cache como fonte da verdade
- **Sintoma:** dado que só existe no Redis; perda depois de eviction ou failover.
- **Por quê:** com eviction o Redis descarta chaves; em cluster a replicação assíncrona perde escrita confirmada no failover. A `data-governance.md` e a `data-cache.md` proíbem: nunca fonte de verdade.
- **Correção:** store durável (NoSQL ou relacional pela matriz do orquestrador; mensageria para fila) com o cache na frente; o pedido que insiste em Redis como primário vira `CONFLITO`.
- **Detecção:** runtime — `CONFIG GET save appendonly maxmemory-policy`; revisão — escrita em Redis sem escrita em banco no mesmo fluxo.
- **Evidência:** [J] Redis eviction; regra da casa.

### C-08 — Cache local em frota sem TTL
- **Sintoma:** instâncias respondendo valores diferentes para a mesma chave; origem sobrecarregada quando a frota escala.
- **Por quê:** cada instância guarda sua cópia sem expiração.
- **Correção:** TTL e tamanho máximo (`expireAfterWrite`, `stdTTL`, `AbsoluteExpiration`); invalidação por evento quando a coerência importa.
- **Detecção:** `scan.sh C-08` (estática: `lru_cache`, `Caffeine.newBuilder(`, `CacheBuilder.newBuilder(`, `new NodeCache(`, `new MemoryCache(` sem expiração na linha).
- **Evidência:** [2F]; detector [Heurística] (builder em várias linhas escapa).

### C-09 — KEYS em produção
- **Sintoma:** Redis bloqueado por segundos; latência de todo o tráfego sobe durante a varredura.
- **Por quê:** `KEYS` é O(N) sobre o keyspace inteiro e roda na thread principal.
- **Correção:** `SCAN` com `MATCH` e `COUNT`; bloquear `KEYS` por ACL.
- **Detecção:** `scan.sh C-09` (estática em código: literal `"KEYS"` de comando ou `.keys(` sobre cliente redis); runtime — `SLOWLOG GET 50`.
- **Evidência:** [1F] Redis.

### C-10 — maxmemory 0 ou noeviction em instância de cache
- **Sintoma:** memória do host esgotada, ou erros `OOM command not allowed` em toda escrita.
- **Por quê:** o default de `maxmemory` em 64 bits é 0 (sem limite); com `noeviction` a instância cheia recusa escrita em vez de despejar.
- **Correção:** `maxmemory` explícito com folga para buffers de replicação e AOF; política `allkeys-lru` ou `allkeys-lfu` numa instância que é só cache.
- **Detecção:** `scan.sh C-10` (estática em IaC e `*.conf`); runtime — `CONFIG GET maxmemory maxmemory-policy`.
- **Evidência:** [J] Redis eviction.

### C-11 — Redis exposto, sem autenticação ou sem TLS
- **Sintoma:** instância alcançável da internet; `protected-mode no`; `bind 0.0.0.0`, `bind *` ou `bind * -::*` (sintaxe do Redis 7 para todas as interfaces) sem `requirepass` nem ACL.
- **Por quê:** Redis nunca deve ser exposto; nenhum terceiro recebe rota de rede para cache interno (regra de integração do dono).
- **Correção:** `bind` em interface privada, `protected-mode yes`, ACL por aplicação, TLS em cliente, replicação e barramento.
- **Detecção:** `scan.sh C-11` (estática em IaC e `redis.conf`: `protected-mode no`, e bind em todas as interfaces em arquivo sem `requirepass`, `aclfile` nem `user ... on`; com autenticação o achado é o C-17); ferramenta — Checkov CKV_AWS_29/30/31/191, CKV_AZURE_89/148, CKV_GCP_95/97.
- **Evidência:** [2F] Redis security e Checkov.

### C-12 — Multi-chave cross-slot
- **Sintoma:** erro `CROSSSLOT` depois de migrar para cluster.
- **Por quê:** operação multi-chave só funciona no mesmo slot.
- **Correção:** hash tags (`{user:42}:perfil`, `{user:42}:carrinho`) para chaves operadas juntas.
- **Detecção:** runtime — erro `CROSSSLOT`; testes de integração contra cluster.
- **Evidência:** [1F] Redis cluster spec.

### C-13 — Cache e estado durável na mesma instância com eviction
- **Sintoma:** fila, lock ou sessão que somem sob pressão de memória.
- **Por quê:** a política de eviction não distingue o que é cópia do que é estado.
- **Correção:** instâncias separadas; estado durável fora do cache (fila é do especialista de mensageria).
- **Detecção:** runtime — `redis-cli --scan | cut -d: -f1 | sort | uniq -c` combinado com a política de eviction.
- **Evidência:** [J] Redis recomenda instâncias separadas.

### C-14 — Comando O(N) em estrutura grande
- **Sintoma:** entradas no `SLOWLOG` com `HGETALL`, `SMEMBERS`, `LRANGE 0 -1` sobre coleções grandes.
- **Por quê:** a operação percorre a estrutura inteira na thread principal.
- **Correção:** `HSCAN`/`SSCAN`, paginação, estrutura menor.
- **Detecção:** runtime — `SLOWLOG GET`; `--bigkeys`.
- **Evidência:** [1F] Redis.

### C-15 — Campo de cartão escrito em cache
- **Sintoma:** chamada de escrita em cache com `pan`, `card_number`, `cvv`, `cvc`, `track1/2` ou `pin_block` como identificador (inclusive Go `rdb.Set`, .NET `StringSet`, Spring `opsForValue().set`).
- **Por quê:** SAD não é armazenado após a autorização (PCI DSS 3.3.1) e Redis com persistência, réplica ou snapshot é armazenamento persistente; a `data-cache.md` proíbe PAN/CVV/track em cache.
- **Correção:** cachear o token e metadados não sensíveis (BIN, últimos quatro, marca); SAD só em memória não persistente e pelo tempo da autorização.
- **Detecção:** `scan.sh C-15` (estática em código, chamada sem caixa, fronteira explícita dos dois lados — `span`, `company` e `expand` não casam; `expiry` saiu da lista por ser também o nome da opção de TTL, e cabeçalho, parâmetro e formulário (`headers.put`) não contam como cache; complemento de severidade `aviso` do `check-data-governance.sh`, que é a fonte quando há `data-classification.json`); runtime — DLP offline de dump RDB com regex de PAN e Luhn.
- **Evidência:** [Heurística] detector (T-01 da base §7.1); prática [J] PCI DSS 3.3.1.

### C-16 — Regra de rede aberta na porta do Redis
- **Sintoma:** security group ou firewall com `0.0.0.0/0` e porta do Redis (6379, TLS 6380, barramento de cluster 16379, Sentinel 26379).
- **Por quê:** rota de qualquer origem para cache interno, contra a regra de integração.
- **Correção:** CIDR da VPC ou security group de origem.
- **Detecção:** `scan.sh C-16` (estática em IaC: `0.0.0.0/0` e uma das portas 6379, 6380, 16379 ou 26379 no mesmo arquivo; localização na linha do CIDR).
- **Evidência:** [Interp.] norma da regra do dono; detector [Heurística].

### C-17 — Redis em todas as interfaces com autenticação
- **Sintoma:** `bind 0.0.0.0` (ou `*`, `::`) num `redis.conf` que também tem `requirepass`, `aclfile` ou `user ... on`, típico de pod em Kubernetes.
- **Por quê:** a senha ou a ACL tiram o Redis do C-11, mas a exposição passa a depender de controles fora do arquivo (NetworkPolicy, security group, TLS); sem eles, qualquer origem da rede tenta autenticar.
- **Correção:** NetworkPolicy ou security group que só admite os pods ou serviços do produto, TLS (`tls-port`), ACL por aplicação sem o usuário `default` habilitado; bind em interface privada quando o ambiente permite.
- **Detecção:** `scan.sh C-17` (estática em IaC e `redis.conf`: bind em todas as interfaces em arquivo com autenticação); revisão — NetworkPolicy do namespace.
- **Evidência:** [2F] Redis security; [Interp.] quanto à dependência de controle de rede; detector [Heurística].

### T-01 — PAN ou SAD em cache
- **Sintoma:** PAN em claro ou SAD (CVV, trilha, PIN block) em cache distribuído, inclusive por pouco tempo "para a retentativa".
- **Por quê:** SAD não pode ser armazenado após a autorização nem cifrado, e "It is not permissible to store SAD in persistent memory"; Redis persistente, réplica e snapshot tornam o dado armazenado e trazem todos os requisitos de dado de conta.
- **Correção:** token e metadados não sensíveis; retentativa refaz a coleta ou usa o token do provedor.
- **Detecção:** revisão — com apoio do C-15 e do `check-data-governance.sh`; runtime — DLP de dump RDB offline com regex de PAN e Luhn.
- **Evidência:** [J] PCI DSS v4.0.1 3.3.1 e guidance (via fontes secundárias concordantes); [Interp.] Redis persistente como armazenamento de CHD — validar com o QSA.

### T-04 — Log ou métrica com chave ou payload sensível
- **Sintoma:** PAN, CPF ou e-mail em chave de cache, visíveis no `SLOWLOG`, no `MONITOR`, no APM ou no SIEM.
- **Por quê:** slowlog, monitor e APM registram argumentos de comando; payload logado no consumidor contamina o SIEM.
- **Correção:** chave com identificador substituto (token) ou HMAC com chave secreta gerida em KMS, fora do cache e do código (PCI DSS 3.5.1.1 exige hash criptográfico com chave para PAN); nunca hash sem chave de PAN ou CPF — o espaço do CPF (cerca de 10^9) e o do PAN (BIN conhecido mais dígito verificador) são revertidos por força bruta em segundos, então hash sem chave não torna o PAN ilegível nem serve como pseudonimização para a LGPD; mascarar argumentos no APM; nunca logar payload sensível.
- **Detecção:** revisão — chave montada com dado pessoal ou de cartão; ferramenta — `check-data-governance.sh` para dado sensível em chamada de log.
- **Evidência:** [Interp.] base §7.1; [1F] PCI DSS v4.0.1 3.5.1.1 (hash com chave, obrigatório desde 31/03/2025) — validar com o QSA.
