# Object storage — boas práticas

Base: seção 4, item T-03 da seção 7.1 e seção 7.2 (LGPD) da base consolidada do change `data-engineer-agent` (julgada em 2026-09-26), mais a decisão H-02 (a) do dono sobre URL pré-assinada. Marcas: [J] reconferido pelo juiz na fonte primária; [2F] duas fontes independentes; [1F] documentação oficial do produto; [Interp.] interpretação técnica; [Heurística] limiar de partida.

## Quando usar e quando não

Objetos imutáveis ou raramente reescritos (arquivo, mídia, backup, export, zona bruta de lake), acesso por chave, custo por GB baixo, ciclo de vida automatizado e retenção regulatória (WORM) [J: Azure "object data stores"]. Não usar para atualização parcial frequente, para metadado consultável como banco, nem para milhões de objetos minúsculos lidos individualmente com latência de milissegundos.

Concorrência: o S3 é last-writer-wins por padrão, mas desde 2024 tem escrita condicional (`If-None-Match` em agosto; `If-Match` com ETag em novembro, com política de bucket podendo exigi-la por `s3:if-match`/`s3:if-none-match`) e, desde setembro de 2025, delete condicional [J: anúncios AWS]. Isso dá controle otimista de concorrência em objeto, não lock nem atomicidade entre chaves; estado mutável compartilhado continua pertencendo a banco (O-10).

## Fatos de plataforma

- S3: consistência forte read-after-write para PUT, DELETE e LIST; configuração de bucket é eventualmente consistente; sem atomicidade entre chaves [1F].
- S3 escala para pelo menos 3.500 escritas e 5.500 leituras por segundo por prefixo particionado; a orientação antiga de randomizar prefixo foi removida em 2018 [1F]. GCS parte de cerca de 1.000 escritas e 5.000 leituras por bucket, com rampa de no máximo dobrar a cada 20 minutos, e ainda recomenda evitar nome sequencial no início da chave [1F]. Código portátil evita prefixo puramente sequencial [Interp.].
- Novos buckets S3 têm Block Public Access e ACL desabilitada desde abril de 2023, e SSE-S3 em todo objeto novo desde janeiro de 2023 [1F]. Azure proíbe acesso anônimo por padrão em contas ARM; GCS tem public access prevention e uniform bucket-level access [2F].
- URL pré-assinada: no máximo 7 dias no S3 (SigV4) e no GCS V4; é bearer token — quem tem a URL tem o objeto. A Azure recomenda user delegation SAS com expiração curta e desabilitar Shared Key [2F].
- WORM: S3 Object Lock (em compliance nem o root apaga; exige versionamento), GCS Bucket Lock e Azure immutable storage, avaliados para SEC 17a-4(f), FINRA e CFTC [2F].
- Multipart: 10.000 partes de 5 MiB a 5 GiB, objeto até 48,8 TiB; partes de upload incompleto são cobradas até o abort [1F].
- Eventos S3: entrega pelo menos uma vez, normalmente em segundos; gravar no bucket que dispara o evento pode gerar loop [1F].
- Ciclo de vida: desde setembro de 2024 objetos menores que 128 KB não transitam por padrão (a cobrança por requisição de transição supera a economia); duração mínima de 90 dias (Glacier Instant e Flexible) e 180 dias (Deep Archive); cada objeto arquivado em Flexible ou Deep Archive carrega 40 KB de metadados (8 KB cobrados em Standard, 32 KB na classe de destino) [J].
- S3 Bucket Keys reduzem chamadas ao KMS em até 99% com SSE-KMS e mudam o contexto de criptografia para o ARN do bucket [1F].
- MinIO: a edição comunitária entrou em modo de manutenção em 2025 (sem binários oficiais, console removida) e o repositório `minio/minio` foi arquivado em 25/04/2026, agora somente leitura [J: página do repositório; 2F com Blocks & Files].

## Bucket público

1. Bloquear acesso público em nível de conta ou organização: S3 Block Public Access com as quatro opções, GCS public access prevention imposto por org policy, Azure `AllowBlobPublicAccess=false` com Azure Policy deny (O-01) [2F].
2. Hospedagem pública de conteúdo estático em conta ou bucket separado, atrás de CDN, nunca no bucket de dado de negócio [2F].
3. ACLs desabilitadas; acesso só por política (bucket owner enforced; uniform bucket-level access) [2F].

## URL pré-assinada

- Regra da casa para terceiro (decisão H-02 (a) do dono, 2026-09-26): URL pré-assinada é entrega REST síncrona admitida somente com todas estas restrições — HTTPS; um único objeto nomeado; expiração em minutos; emitida por endpoint REST autenticado do produto, que autentica o parceiro; log de emissão; bucket privado. Qualquer outra forma de acesso de terceiro a bucket (credencial IAM ou chave de acesso, policy de bucket ou ACL para o parceiro, bucket ou objeto público, URL de prefixo ou de vários objetos, URL de horas ou dias, URL emitida fora de endpoint autenticado ou sem log) é reprovada.
- Mesmo para cliente próprio: minutos, um objeto e um método, restrita por política quando possível (`s3:signatureAge`, `aws:SourceIp`/`aws:SourceVpce`), e conteúdo enviado validado depois do upload (O-02) [2F].
- SAS da Azure: user delegation SAS com expiração curta; conta com Shared Key desabilitada [2F].
- Proxy de upload pela aplicação dá validação síncrona; URL pré-assinada escala e barateia, mas exige validação posterior [Interp.].

## Layout de chaves

- Chave por domínio, zona e ciclo de vida (`raw/`, `tmp/`, `exports/`), para que política de acesso e regra de ciclo de vida se apliquem por prefixo [2F].
- Partição por data estilo Hive (`dt=AAAA-MM-DD/`) é aceitável para arquivo bruto; no GCS, não começar a chave por timestamp (O-09) [2F]. Tabela silver/gold segue a regra de particionamento do especialista analítico (particionamento oculto ou liquid clustering) [base §0.3 item 4].
- Nunca partição por coluna de alta cardinalidade (`user_id=`, `customer=`): milhões de diretórios pequenos (O-14) [Interp.].
- Multi-tenant: prefixo por tenant com política IAM condicionada ao prefixo, ou bucket por tenant quando a regulação exige chave de criptografia por cliente [Interp. da base §7.3].

## Ciclo de vida

- Toda regra de ciclo de vida aborta multipart incompleto (ex.: 7 dias), expira versões não correntes, transiciona por idade só objeto grande o bastante (`ObjectSizeGreaterThan`) e expira temporários (O-03, O-04, O-05) [2F + J].
- Intelligent-Tiering para acesso imprevisível; regras manuais para padrão conhecido [Interp.].
- Inventário (S3 Inventory, blob inventory) e logging de acesso (server access logs ou CloudTrail data events, Azure Storage logs) [2F].

## Versionamento

Versionamento em bucket de dado de negócio, com expiração de versões não correntes: protege contra erro humano e ransomware ao custo de armazenamento (O-04) [2F]. Object Lock exige versionamento [2F].

## Criptografia

- SSE-S3 é gratuito e padrão; SSE-KMS dá controle, trilha e revogação, com custo e cota mitigados por Bucket Key (O-08) [1F].
- Dado regulado com chave do cliente (SSE-KMS com Bucket Key, CMEK, CMK), política de chave de menor privilégio e rotação [2F].
- Bucket por tenant com chave própria quando o contrato ou a regulação exige isolamento criptográfico [Interp.].

## WORM e LGPD

- WORM para trilha de auditoria e registro regulatório; testar em governance ou unlocked antes de travar, porque compliance é irreversível (só se desfaz apagando a conta) [2F].
- Conciliar com a LGPD antes de travar: classificar dado pessoal por base legal e prazo; WORM compliance só para o que tem obrigação legal de retenção, nunca para dado pessoal genérico [Interp. da base §7.2].
- Separar identificador pessoal do fato (pseudonimização): o mapa chave→pessoa fica num armazenamento mutável e eliminável [Interp.].
- Crypto-shredding: cifrar dado pessoal com chave por titular e destruir a chave para eliminar, quando o meio é imutável (bucket travado, backup) [Interp.].

## Eventos

Consumidor de evento idempotente (entrega at-least-once, dedupe por `eTag` ou `versionId`) e trigger restrito a prefixo de entrada, com saída em outro prefixo ou bucket (O-06, O-07) [1F].

## Zonas de lake no nível de objeto

- Bronze imutável no formato original, com acesso restrito; silver e gold em formato de tabela transacional; contêineres ou buckets separados por camada [2F: Databricks e Microsoft Fabric]. Escrita destrutiva (overwrite, MERGE, DELETE) na zona bruta é antipattern (O-13) [2F no princípio].
- Arquivos de 128 MB a 1 GB nas camadas de consumo (O-12) [1F: Fabric].
- Bronze que recebe dado de cartão está no CDE e precisa de PAN ilegível (PCI DSS 3.5.1). Tokenize na borda de ingestão, antes de gravar: o bronze de fonte com CHD recebe só o token. Se o arquivo precisa ser guardado como chegou, criptografia em nível de campo ou de arquivo com chave gerida fora do lake, porque SSE-KMS/CMEK sozinho não atende o 3.5.1.2 em mídia não removível; chave por lote para crypto-shredding e ciclo de vida que expira o objeto no prazo de retenção (3.2.1), com o prefixo de CHD isento do deny-`DeleteObject` do bronze (T-03, O-13) [Interp. apoiada em PCI 3.2.1, 3.5.1 e 3.5.1.2; validar com o QSA].

## Integração com a regra do dono

Nenhum terceiro recebe credencial, rota de rede ou permissão sobre bucket interno. Formas válidas de entregar arquivo a parceiro: API REST do produto que serve o objeto (proxy com streaming), URL pré-assinada nas restrições do H-02 (a), fila ou tópico dedicado ao parceiro para notificar disponibilidade, e webhook. Nunca gRPC exposto, nunca SFTP ou bucket compartilhado como atalho.

## Decisões e trade-offs

| Decisão | A favor | Contra |
|---|---|---|
| SSE-S3 × SSE-KMS | gratuito, zero operação | KMS dá controle, trilha e revogação, com custo mitigado por Bucket Key |
| Object Lock governance × compliance | permite bypass com permissão | compliance é irreversível |
| Proxy de upload × URL pré-assinada | validação síncrona | a URL escala e barateia, mas exige validação posterior |
| Versionamento × sem versão | protege contra erro e ransomware | armazenamento de versões não correntes |
| Intelligent-Tiering × regra manual | acesso imprevisível | padrão conhecido fica mais barato com regra |

## Fontes

[S3 user guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) · [S3 performance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html) · [S3 lifecycle transitions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html) · [S3 conditional writes (ago/2024)](https://aws.amazon.com/about-aws/whats-new/2024/08/amazon-s3-conditional-writes) · [S3 If-Match (nov/2024)](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-s3-functionality-conditional-writes) · [S3 enforcement de escrita condicional](https://aws.amazon.com/about-aws/whats-new/2024/11/amazon-s3-enforcement-conditional-write-operations-general-purpose-buckets) · [S3 conditional deletes (set/2025)](https://aws.amazon.com/about-aws/whats-new/2025/09/amazon-s3-conditional-deletes-s3-general-purpose-buckets) · [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html) · [S3 Bucket Keys](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-key.html) · [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) · [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) · [S3 event notifications](https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html) · [GCS request rate](https://docs.cloud.google.com/storage/docs/request-rate) · [GCS public access prevention](https://docs.cloud.google.com/storage/docs/public-access-prevention) · [GCS Bucket Lock](https://docs.cloud.google.com/storage/docs/bucket-lock) · [Azure SAS](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview) · [Azure immutable storage](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview) · [Microsoft Fabric medallion](https://learn.microsoft.com/en-us/fabric/onelake/onelake-medallion-lakehouse-architecture) · [MinIO repositório (arquivado)](https://github.com/minio/minio/issues/21714) · [Blocks & Files, MinIO](https://blocksandfiles.com/2025/06/19/minio-removes-management-features-from-basic-community-edition-object-storage-code/) · [LGPD, Lei 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm) · PCI DSS v4.0.1, requisito 3.5.1.
