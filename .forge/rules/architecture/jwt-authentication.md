---
title: Autenticação JWT
applies_to:
  - backend
priority: high
last_reviewed: 2026-05-08
---

# Autenticação JWT

## Arquitetura Centralizada

O **`auth-service`** é o **único serviço autorizado** a:
- Emitir tokens JWT (signing com chave privada)
- Gerenciar chaves privadas RSA
- Autenticar usuários
- Gerenciar refresh tokens

Todos os demais serviços são **consumidores** — apenas validam tokens com a chave pública. A chave privada **NUNCA** sai do auth-service.

## Parâmetros JWT Obrigatórios

| Parâmetro | Valor |
|-----------|-------|
| `Issuer` | `example.com` (a definir) |
| `Audience` | `api` |
| `ValidateIssuer` | `true` |
| `ValidateAudience` | `true` |
| `ValidateLifetime` | `true` |
| `ClockSkew` | `TimeSpan.Zero` |

```csharp
options.TokenValidationParameters = new TokenValidationParameters
{
    ValidateIssuerSigningKey = true,
    IssuerSigningKey = new RsaSecurityKey(rsa),
    ValidateIssuer = true,
    ValidIssuer = "example.com",
    ValidateAudience = true,
    ValidAudience = "api",
    ValidateLifetime = true,
    ClockSkew = TimeSpan.Zero
};
```

## Carregamento da Chave Pública (Serviços Consumidores)

Ordem de precedência obrigatória:

1. **Variável de ambiente `JWT_PUBLIC_KEY`** (containers Docker/Kubernetes)
2. **Arquivo via `Jwt:PublicKeyPath`** (desenvolvimento local)
3. **Fallback gerado** — **APENAS** em ambiente de teste (`EnvironmentName == "Test"`)

```csharp
RSA LoadPublicKey(IConfiguration config, IWebHostEnvironment env)
{
    var keyEnv = Environment.GetEnvironmentVariable("JWT_PUBLIC_KEY");
    if (!string.IsNullOrEmpty(keyEnv))
    {
        var rsa = RSA.Create();
        rsa.ImportFromPem(keyEnv);
        return rsa;
    }

    var keyPath = config["Jwt:PublicKeyPath"];
    if (!string.IsNullOrEmpty(keyPath) && File.Exists(keyPath))
    {
        var rsa = RSA.Create();
        rsa.ImportFromPem(File.ReadAllText(keyPath));
        return rsa;
    }

    if (env.EnvironmentName is "Test" or "Testing")
        return RSA.Create(2048);

    throw new InvalidOperationException(
        "JWT public key not configured. Set JWT_PUBLIC_KEY env var or Jwt:PublicKeyPath.");
}
```

## Gestão de Chaves

- Chaves `.pem` em `.gitignore` — **nunca commitadas**
- Templates `.pem.example` podem ser commitados
- Templates em `platform/docker/compose/jwt/`
- Stg/Prd: Kubernetes Secrets injetados via External Secrets Operator

### Rotação de Chaves

| Ambiente | Frequência |
|----------|-----------|
| Produção | 90 dias |
| Staging | 30 dias |
| Dev | Sob demanda |

Procedimento: gerar novo par → atualizar K8s Secret → reiniciar auth-service → reiniciar demais serviços → tokens antigos expiram naturalmente.

## Checklist para Novos Serviços

- [ ] Carregamento de chave pública conforme ordem de precedência
- [ ] `JWT_PUBLIC_KEY` configurado no docker-compose.yml
- [ ] Mesmos parâmetros de validação (Issuer, Audience, ClockSkew)
- [ ] Log informativo sobre fonte da chave no startup
- [ ] Teste com token válido do auth-service

## Proibições Explícitas

- Chave privada em qualquer serviço exceto `auth-service`
- Chaves hardcoded em código ou `appsettings.json`
- Arquivos `.pem` commitados
- `ClockSkew > TimeSpan.Zero` sem justificativa documentada em ADR
- `EnvironmentName == "Test"` fallback em builds de produção
