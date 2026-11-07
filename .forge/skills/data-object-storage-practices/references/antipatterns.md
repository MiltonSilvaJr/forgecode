# Object storage — catálogo de antipatterns

Conjunto fechado de ids deste catálogo (design §2.5 do change `data-engineer-agent`): O-01 a O-14 e o transversal T-03 vêm da base consolidada (§4.4 e §7.1). Id fora desse conjunto reprova o w250.

Cada entrada tem cinco campos. `Detecção` usa um de quatro rótulos: `scan.sh <ID>` (estática, o `scripts/scan.sh` executa), `ferramenta`, `runtime` (comando contra o sistema real, documentado e nunca executado pelo scanner) e `revisão`; um segundo rótulo complementar pode vir depois de `;`. Comandos de runtime foram redigidos pela pesquisa e não executados contra sistema real. Toda varredura recursiva de exemplo usa `grep -a` ou `rg`.

### O-01 — Bucket ou objeto público
- **Sintoma:** ACL `public-read`, qualquer das quatro chaves do Block Public Access em `false` (`block_public_acls`, `block_public_policy`, `ignore_public_acls`, `restrict_public_buckets`), policy de bucket com `Principal: "*"` (ou `{"AWS": "*"}`) sem `Condition`, `allUsers`/`allAuthenticatedUsers` no GCS, `allowBlobPublicAccess: true` ou contêiner com `container_access_type = "blob"`/`"container"` na Azure.
- **Por quê:** vazamento direto de dado; e acesso de terceiro a bucket fora das formas admitidas pela decisão H-02 (a) é reprovado pela regra de integração.
- **Correção:** Block Public Access nas quatro opções no nível de conta, public access prevention imposto por org policy, `AllowBlobPublicAccess=false`; conteúdo público em bucket separado atrás de CDN; entrega a terceiro por REST ou URL pré-assinada nas restrições do H-02 (a).
- **Detecção:** `scan.sh O-01` (estática em IaC: as formas do Sintoma; `Principal "*"` em arquivo com `Condition` — endpoint de VPC, organização, conta de origem — fica para a revisão, porque a condição pode torná-lo privado); ferramenta — Checkov CKV2_AWS_6, CKV_AWS_20/53/54/55/56/57/70, CKV_GCP_28/29/114, CKV_AZURE_34/59/190; runtime — `aws s3api get-public-access-block`, IAM Access Analyzer, `gcloud storage buckets describe ... publicAccessPrevention`, Resource Graph `allowBlobPublicAccess`.
- **Evidência:** [2F] S3 Block Public Access, GCS public access prevention, Azure.

### O-02 — URL pré-assinada ou SAS longa ou ampla
- **Sintoma:** `ExpiresIn: 604800`; SAS de conta ou de contêiner; URL enviada a parceiro por e-mail valendo dias.
- **Por quê:** a URL é bearer token: quem a tem lê o objeto até expirar. Para terceiro, a decisão H-02 (a) só admite HTTPS, objeto único nomeado, expiração em minutos, emissão por endpoint REST autenticado do produto com log de emissão e bucket privado.
- **Correção:** expiração em minutos, um objeto e um método, restrição por `s3:signatureAge` e origem; user delegation SAS; emissão por endpoint REST autenticado com log.
- **Detecção:** `scan.sh O-02` (estática em código: expiração com 4+ dígitos em segundos, produto aritmético com duas multiplicações — `60 * 60 * 24` —, `Duration.ofDays`/`ofHours` em presign e `AddDays`/`AddHours` em SAS; linhas de JWT — `jwt`, `jsonwebtoken`, `jose` — ficam fora; revisar acima de 900–3600 s); ferramenta — Checkov CKV2_AZURE_40; revisão — `generate_(account|container)_sas|AccountSasBuilder`.
- **Evidência:** [2F] S3 e GCS presigned URLs, Azure SAS; limiar [Heurística].

### O-03 — Multipart órfão
- **Sintoma:** custo de armazenamento que não bate com o inventário de objetos.
- **Por quê:** partes de upload incompleto são cobradas até o abort.
- **Correção:** regra de ciclo de vida `AbortIncompleteMultipartUpload` (ex.: 7 dias).
- **Detecção:** runtime — `aws s3api list-multipart-uploads`, Storage Lens; ferramenta — Checkov CKV_AWS_300.
- **Evidência:** [2F].

### O-04 — Versionamento sem expiração de versões não correntes
- **Sintoma:** custo crescendo com cada sobrescrita; bucket "vazio" que continua cobrando.
- **Por quê:** toda versão antiga fica armazenada para sempre.
- **Correção:** `NoncurrentVersionExpiration` (e transição de não correntes) no ciclo de vida.
- **Detecção:** ferramenta — Checkov CKV2_AWS_61; revisão — lifecycle sem `NoncurrentVersionExpiration`.
- **Evidência:** [1F] S3.

### O-05 — Transição de objeto pequeno ou de vida curta para classe fria
- **Sintoma:** conta de transição e de duração mínima maior que a economia de armazenamento.
- **Por quê:** objeto abaixo de 128 KB não transita por padrão desde setembro de 2024; classes frias cobram duração mínima (90 ou 180 dias) e 40 KB de metadados por objeto arquivado.
- **Correção:** `ObjectSizeGreaterThan` na regra; transição só para o que vive mais que a duração mínima.
- **Detecção:** runtime — S3 Inventory com Athena `GROUP BY storage_class`; revisão — regra sem `ObjectSizeGreaterThan` ou configuração anterior a 2024 que manteve o comportamento antigo.
- **Evidência:** [J] S3 lifecycle transitions.

### O-06 — Loop de evento
- **Sintoma:** função disparada sem parar, custo explodindo.
- **Por quê:** a função grava no mesmo bucket e prefixo que a disparam.
- **Correção:** trigger restrito a prefixo de entrada e saída em outro prefixo ou bucket.
- **Detecção:** revisão — `aws_s3_bucket_notification` cuja função grava no mesmo bucket sem `filter_prefix` distinto.
- **Evidência:** [1F] S3 event notifications.

### O-07 — Consumidor de evento não idempotente
- **Sintoma:** processamento duplicado de um mesmo upload.
- **Por quê:** eventos S3 são entregues pelo menos uma vez.
- **Correção:** chave de dedupe (`eTag`/`versionId`) ou upsert.
- **Detecção:** revisão — handler sem chave de dedupe nem upsert.
- **Evidência:** [1F] S3 event notifications.

### O-08 — SSE-KMS sem Bucket Key em bucket de alto volume
- **Sintoma:** custo e throttling de KMS proporcionais ao número de objetos.
- **Por quê:** sem Bucket Key cada objeto chama o KMS; Bucket Key reduz as chamadas em até 99%.
- **Correção:** `bucket_key_enabled = true` junto de `sse_algorithm = "aws:kms"`.
- **Detecção:** `scan.sh O-08` (estática em IaC: `aws:kms` sem `bucket_key_enabled` no mesmo arquivo; localização na linha do kms).
- **Evidência:** [1F] S3 Bucket Keys.

### O-09 — Prefixo sequencial no GCS
- **Sintoma:** hotspot de escrita em bucket do GCS; latência crescente em ingestão.
- **Por quê:** o GCS ainda recomenda evitar nome sequencial no início da chave.
- **Correção:** prefixo com componente distribuído (hash curto, domínio) antes da data.
- **Detecção:** runtime — amostra de nomes começando por `\d{4}-\d{2}-\d{2}`.
- **Evidência:** [1F] GCS request rate.

### O-10 — Bucket como banco com read-modify-write concorrente sem escrita condicional
- **Sintoma:** atualizações perdidas quando dois escritores leem, modificam e regravam o mesmo objeto.
- **Por quê:** o S3 é last-writer-wins por padrão; sem `If-Match` o último apaga o anterior.
- **Correção:** escrita condicional com ETag (`If-Match`) e política que a exija; estado mutável compartilhado vai para banco.
- **Detecção:** revisão — get→modify→put na mesma chave sem `If-Match`/`IfMatch`/`if_match`.
- **Evidência:** [J] escrita condicional existe (anúncios AWS 2024–2025); detector [Heurística].

### O-11 — MinIO comunitário arquivado em produção
- **Sintoma:** `image: minio/minio` em compose, Helm ou Dockerfile, com ou sem registry antes do nome (`quay.io/minio/minio`, `docker.io/minio/minio`).
- **Por quê:** a edição comunitária está em modo de manutenção desde 2025 e o repositório foi arquivado em 25/04/2026: sem correção de segurança.
- **Correção:** plano de migração para alternativa mantida ou suporte comercial; imagem com data de tag e dono.
- **Detecção:** `scan.sh O-11` (estática em IaC, compose e Dockerfile).
- **Evidência:** [J] página do repositório no GitHub; [2F] com Blocks & Files.

### O-12 — Small files no lake
- **Sintoma:** milhões de arquivos de poucos KB; consulta lenta e custo de requisição alto.
- **Por quê:** o custo por arquivo (listagem, abertura, metadado) domina.
- **Correção:** compactação para 128 MB a 1 GB nas camadas de consumo; ingestão em lote.
- **Detecção:** runtime — S3 Inventory com Athena agrupando por prefixo com `avg(size) < 16 MiB`.
- **Evidência:** [Heurística] limiar; [1F] Fabric para o tamanho-alvo.

### O-13 — Bronze mutável
- **Sintoma:** job que faz `overwrite`, `MERGE INTO` ou `DELETE FROM` na zona raw ou bronze.
- **Por quê:** o bronze é o registro imutável do que chegou; sem ele não há reprocessamento nem auditoria.
- **Correção:** append-only no bronze; correção e dedupe na silver; política que nega `DeleteObject` no prefixo bruto, **exceto** no prefixo que recebe dado de cartão ou pessoal sujeito a eliminação: lá o ciclo de vida expira o objeto no prazo da política de retenção, e a eliminação segura (PCI DSS 3.2.1, LGPD) prevalece sobre a imutabilidade (T-03).
- **Detecção:** `scan.sh O-13` (estática em código e `*.sql`: escrita destrutiva na mesma linha que `raw`/`bronze` como palavra); revisão — ausência de política negando `DeleteObject` no prefixo.
- **Evidência:** [2F] princípio (Databricks e Fabric); detector [Heurística].

### O-14 — Diretório de alta cardinalidade
- **Sintoma:** `partitionBy("user_id")`, milhões de diretórios com um arquivo cada.
- **Por quê:** partição por identificador cria um diretório por valor.
- **Correção:** partição por data de ingestão no bruto; clustering por identificador na tabela (especialista analítico).
- **Detecção:** `scan.sh O-14` (estática em código).
- **Evidência:** [Interp.] base §4.4.

### T-03 — Bucket bronze com dado de cartão
- **Sintoma:** arquivo bruto de adquirente ou gateway com PAN em claro no bronze.
- **Por quê:** bronze que recebe CHD está no ambiente de dados de cartão e precisa de PAN ilegível onde estiver armazenado (PCI DSS 3.5.1).
- **Correção:** tokenizar na borda de ingestão, antes de gravar no bronze: o bronze de fonte com CHD recebe só o token, e o arquivo original com PAN nunca chega ao lake. Quando a tokenização na borda for inviável (arquivo de adquirente que precisa ser guardado como chegou), criptografia em nível de campo ou de arquivo com chave gerida fora do lake (KMS ou HSM do CDE), de modo que o SSE do bucket não seja o único controle — SSE-KMS/CMEK é criptografia transparente no nível de armazenamento e, pelo PCI DSS 3.5.1.2, não basta sozinha em mídia não removível. Chave por lote ou por período para permitir crypto-shredding; ciclo de vida com expiração alinhada à política de retenção (PCI DSS 3.2.1), e o prefixo com CHD isento do deny-`DeleteObject` do O-13; bronze com CHD no inventário do CDE.
- **Detecção:** revisão — origem do arquivo e classificação no `data-classification.json`; runtime — DLP amostral com regex de PAN e Luhn.
- **Evidência:** [Interp.] apoiada em PCI DSS 3.5.1 (base §7.1); [1F] PCI DSS v4.0.1 3.2.1 (retenção e descarte) e 3.5.1.2 (criptografia transparente de disco ou partição não basta sozinha em mídia não removível) — validar com o QSA.
