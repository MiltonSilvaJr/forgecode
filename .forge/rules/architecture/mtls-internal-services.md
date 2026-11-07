---
title: mTLS entre Serviços Internos
category: architecture
priority: Alta
applies_to: ["services/**", "platform/k8s/**"]
---

# mTLS entre Serviços Internos

## Princípio

Toda comunicação interna entre serviços no cluster Kubernetes usa **mTLS (Mutual TLS)** para garantir autenticação mútua e criptografia em trânsito. JWT é mantido para **autorização** (claims, scopes, tenant_id) — mTLS cobre autenticação de serviço a serviço.

**Abordagem adotada:** cert-manager + sidecar TLS manual (sem Istio na fase inicial). _(Decisão de service mesh: ADR a criar — sem equivalente aprovado no catálogo atual; reaponte DD-005.)_

> **Operação e estratégia de PKI** se apoiam em [ADR-0012 — Ciclo de vida do certificado mTLS do trilho PIX](../../../docs/product/adr/0012-pix-mtls-certificate-lifecycle.md) (cert-lifecycle aprovado mais próximo) e nesta rule. _(Uma "Certificate Management Strategy" / PKI interna dedicada é um ADR a criar — distinto do ADR-0012, que é específico do trilho PIX; reaponte DD-005.)_ Esta rule cobre o **uso** correto pelos BCs.

---

## Certificados via cert-manager

### Issuer Interno

O cert-manager está configurado em `platform/k8s/cert-manager/` com:
- `letsencrypt-stg` — certificados de staging Let's Encrypt (para APIs expostas externamente)
- `letsencrypt-prd` — certificados de produção Let's Encrypt
- `internal-ca` — **Intermediate CA** assinada pela Root offline (PS08-04). Estado anterior `selfSigned: {}` foi descontinuado em 2026-05-07 (estratégia de PKI interna — ADR a criar; cf. ADR-0012).

A Intermediate CA (`internal-ca`) é a usada para mTLS interno.

### Certificate por Serviço

Cada serviço que expõe endpoints para outros serviços internos deve declarar um `Certificate` via o **template do `_template` Helm subchart** (PS08-05) — não criar manualmente:

```yaml
# Gerado pelo template quando .Values.mtls.enabled = true
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: <service>-internal-mtls
  namespace: prd
spec:
  secretName: <service>-internal-mtls-tls
  issuerRef:
    name: internal-ca
    kind: ClusterIssuer
  commonName: <service>.<namespace>.svc.cluster.local
  dnsNames:
    - <service>.<namespace>.svc.cluster.local
    - <service>.<namespace>.svc
    - <service>
  duration: 2160h   # 90 dias
  renewBefore: 720h # 30 dias antes (alinhado à estratégia de PKI interna — ADR a criar; cf. ADR-0012)
  privateKey:
    algorithm: ECDSA
    size: 256
    rotationPolicy: Always
  usages:
    - server auth
    - client auth   # mesmo cert para chamadas mútuas entre serviços
```

### Distribuição do CA bundle

Pods que precisam confiar na Intermediate CA recebem o cert público via **trust-manager** (PS08-06) — `Bundle` distribui ConfigMap em namespaces marcados com `app.io/mtls=enabled`. Não montar Secret manualmente.

---

## Configuração no .NET (AspNetCore)

```csharp
// Program.cs — configurar Kestrel para aceitar e exigir certificado do cliente
builder.WebHost.ConfigureKestrel(options =>
{
    options.ConfigureHttpsDefaults(https =>
    {
        https.ClientCertificateMode = ClientCertificateMode.RequireCertificate;
        https.ClientCertificateValidation = (cert, chain, errors) =>
        {
            // Validar que o certificado foi emitido pela CA interna
            return cert.Issuer.Contains("internal-ca");
        };
    });
});
```

```csharp
// HttpClient configurado com certificado do serviço cliente
var handler = new HttpClientHandler();
handler.ClientCertificates.Add(LoadCertificateFromSecret("internal-tls-secret"));
var httpClient = new HttpClient(handler);
```

---

## Exceção: gRPC Interno

Comunicação via gRPC (ver [`internal-grpc-communication.md`](./internal-grpc-communication.md)) já usa TLS como parte do protocolo HTTP/2. Para mTLS em gRPC:

```csharp
// gRPC client com certificado de cliente
var credentials = new SslCredentials(
    rootCertificates: File.ReadAllText("/etc/ssl/certs/ca.crt"),
    keyCertificatePair: new KeyCertificatePair(
        certificateChain: File.ReadAllText("/etc/ssl/certs/client.crt"),
        privateKey: File.ReadAllText("/etc/ssl/certs/client.key")
    )
);
var channel = GrpcChannel.ForAddress("https://<service>:5001", new GrpcChannelOptions
{
    Credentials = credentials
});
```

---

## Relação com JWT

| Protocolo | Propósito | Quem verifica |
|-----------|-----------|---------------|
| mTLS | Autenticação de serviço (qual serviço está chamando) | TLS layer do servidor |
| JWT | Autorização (quem é o usuário, quais scopes) | Application layer |

mTLS **não substitui** JWT — ambos coexistem:
- mTLS garante que apenas serviços autorizados podem se conectar
- JWT garante que apenas usuários/tenants com permissão podem executar a operação

Ver `.forge/rules/architecture/jwt-authentication.md` para detalhes de JWT.

---

## Rotação de Certificados

- cert-manager renova automaticamente (`renewBefore: 360h`)
- Secrets K8s são atualizados automaticamente pelo cert-manager
- Pods precisam fazer hot-reload do certificado ou reiniciar ao renovar
  - Recomendação: configurar volume mount do secret + liveness probe sensível ao cert

---

## Anti-Patterns Proibidos

| Anti-pattern | Por quê é proibido |
|---|---|
| Comunicação interna HTTP sem TLS | Dados em trânsito não criptografados — risco de sniffing interno |
| `InsecureSkipVerify: true` | Elimina a proteção do mTLS — PROIBIDO em produção |
| Certificados hardcoded em código ou imagem | Cert deve ser montado via K8s Secret/Volume |
| Usar cert de produção em dev/stg | Ambientes devem ter CAs separadas |

---

## Istio (Decisão Adiada — Service Mesh)

Istio foi avaliado e adiado. _(Decisão de service mesh: ADR a criar — sem equivalente aprovado no catálogo atual; reaponte DD-005.)_ Se o volume de serviços crescer e a complexidade de gerenciar mTLS manualmente se tornar inviável, revisar. Critérios para adotar Istio:
- Mais de 15 serviços com comunicação bidirecional
- Necessidade de políticas de tráfego complexas (circuit breaker mesh-level, canary)
- Operações com mais de 2 devs dedicados à plataforma

---

## Cross-Refs

- Service Mesh Strategy: _ADR a criar — sem equivalente aprovado (DD-005)._
- Certificate Management Strategy / PKI interna: _ADR a criar — cf. [ADR-0012 — Ciclo de vida do certificado mTLS do trilho PIX](../../../docs/product/adr/0012-pix-mtls-certificate-lifecycle.md) (cert-lifecycle aprovado mais próximo, porém específico do PIX); reaponte DD-005._
- Certificate Management (spec de módulo): _módulo `certificate-management` a definir._
- [internal-grpc-communication.md](./internal-grpc-communication.md) — gRPC interno + TLS
- [jwt-authentication.md](./jwt-authentication.md)
