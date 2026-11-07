# Comunicação Interna entre Módulos — gRPC por Padrão

## Princípio

Toda comunicação **síncrona** entre módulos/serviços internos da mesma aplicação usa **gRPC sobre HTTP/2** como protocolo padrão. REST/JSON fica reservado a fronteiras externas (clientes públicos, integrações third-party, BFF para frontend).

Motivos:
- Contrato forte via Protobuf — gera client/server tipado em qualquer linguagem
- HTTP/2 com multiplexação e streaming bidirecional
- Latência e payload menores (binário) que JSON
- Suporte nativo a deadlines, cancellation e propagação de metadata (correlationId, trace)
- Integra com mTLS interno quando aplicável

## Diretrizes

1. **Contratos `.proto` em `contracts/proto/`** versionados via git. São a fonte da verdade.
2. **Versionamento explícito** no package: `package <module>.v1;`. Breaking changes criam `v2` — nunca alteram `v1`.
3. **Geração de stubs em build-time**, nunca commitar código gerado em diretório versionado de fonte (gerar em `gen/`, no `.gitignore`).
4. **Erros via `google.rpc.Status`** com `code` e `message`. Não usar status HTTP mapeado naive.
5. **Deadlines obrigatórias** em todo client call. Default: 5s para chamadas síncronas internas, 30s para batch.
6. **Metadata padrão propagada**: `x-correlation-id`, `x-tenant-id`, `authorization`. Server valida presença em interceptor.
7. **Health checking** via `grpc.health.v1.Health` em todo serviço gRPC.
8. **Reflection habilitado apenas em dev/staging** — desativado em produção.

## Exceções permitidas (não usar gRPC)

| Cenário | Protocolo |
|---|---|
| Cliente público (web/mobile) ↔ backend | REST/JSON ou GraphQL (BFF) |
| Eventos assíncronos entre módulos | Mensageria (Kafka/RabbitMQ/SNS) com AsyncAPI |
| Webhooks recebidos de third-party | REST/JSON |
| Browser ↔ backend direto | gRPC-Web ou REST |
| Comunicação one-shot CLI ↔ daemon local | Domain socket / REST simples |

Toda exceção deve ser justificada em ADR.

## Exemplos Positivos

```proto
// contracts/proto/payment/v1/payment_service.proto
syntax = "proto3";
package payment.v1;

service PaymentService {
  rpc Authorize(AuthorizeRequest) returns (AuthorizeResponse);
  rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
}

message AuthorizeRequest {
  string idempotency_key = 1;
  int64 amount_in_cents = 2;
  string currency = 3;
}
```

```csharp
// Cliente com deadline obrigatória
var deadline = DateTime.UtcNow.AddSeconds(5);
var response = await client.AuthorizeAsync(request, deadline: deadline);
```

## Anti-Patterns

- REST/JSON entre microsserviços internos sem justificativa em ADR
- gRPC sem deadline (chamada pode pendurar indefinidamente)
- Breaking change em `.proto` sem incrementar package version
- Código gerado commitado em `src/`
- Reflection habilitado em produção
- Erros como string livre — sempre `google.rpc.Status`

## Verificação

- Grep por `HttpClient` / `fetch(` / `axios` em código de domínio → suspeita de violação
- `.proto` files devem ter `package <module>.vN;` válido
- CI deve falhar build se gerar arquivos `.pb.cs` / `.pb.go` em `src/`

## Referências

- [gRPC.io](https://grpc.io/docs/)
- [API Design Guide (Google)](https://cloud.google.com/apis/design)
