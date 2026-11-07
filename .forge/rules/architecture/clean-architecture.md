---
title: Clean Architecture
applies_to:
  - backend-dotnet
priority: high
last_reviewed: 2026-05-08
---

# Clean Architecture

## Princípio

Todo serviço backend do <project_name> segue Clean Architecture: camadas concêntricas com dependências apontando sempre para dentro (em direção ao domínio). O domínio não conhece infraestrutura, frameworks ou transporte HTTP. A regra de dependência é inviolável — violá-la introduz acoplamento que impede testes unitários, troca de tecnologia e evolução independente do domínio.

A separação em projetos .NET separados (não apenas pastas) é obrigatória: o compilador enforça a regra de dependência ao invés de depender de disciplina humana.

## Diretrizes

### Estrutura de Projetos

1. Cada serviço tem exatamente 5 projetos:
   - `<Serviço>.Domain` — entidades, objetos de valor, agregados, interfaces de repositório, eventos de domínio, exceções de domínio
   - `<Serviço>.Application` — casos de uso (Commands/Queries/Handlers), DTOs de aplicação, interfaces de serviços externos, validadores
   - `<Serviço>.Infrastructure` — implementações de repositório, mensageria, HTTP clients, acesso a banco, configuração de EF Core
   - `<Serviço>.Api` — controllers/endpoints, middleware, configuração de DI, startup
   - `<Serviço>.Contracts` — DTOs de contrato público (publicados em `contracts/openapi/` e `contracts/asyncapi/`)

2. Referências de projeto permitidas:
   - `Api` → `Application`, `Infrastructure` (apenas para DI)
   - `Application` → `Domain`, `Contracts`
   - `Infrastructure` → `Application`, `Domain`
   - `Domain` → **nenhum projeto interno**
   - `Contracts` → **nenhum projeto interno** (pode referenciar pacotes de tipos primitivos)

3. `Domain` **nunca** referencia: Entity Framework, MassTransit, HttpClient, ASP.NET Core, qualquer pacote de infraestrutura.

### Camada de Domínio

4. Toda lógica de negócio vive no `Domain` — incluindo invariantes, regras de validação e cálculos.
5. Entidades têm construtores privados e factories estáticas (`Create`, `Reconstitute`).
6. Objetos de valor são imutáveis e implementam igualdade por valor.
7. Repositórios são interfaces definidas no `Domain`, implementadas no `Infrastructure`.

### Camada de Aplicação

8. Casos de uso são Commands (escrita) ou Queries (leitura) com Handlers correspondentes.
9. Handlers orquestram — não contêm lógica de negócio. Lógica pertence ao domínio.
10. Usar MediatR ou padrão equivalente para desacoplar chamadores dos handlers.
11. Validação de input com FluentValidation antes do handler.

### Camada de Infraestrutura

12. EF Core DbContext configurado via `IEntityTypeConfiguration<T>` — nunca por atributos no domínio.
13. Mapeamento entre entidades de domínio e entidades de persistência é responsabilidade da infraestrutura.
14. Nunca vazar tipos de EF Core (`DbSet`, `IQueryable`) fora da camada de infraestrutura.

### Multi-tenancy

15. Filtro global de `tenant_id` aplicado no `DbContext` da infraestrutura.
16. `tenant_id` nunca é parâmetro explícito em repositórios de domínio — é transparente via contexto de execução.

## Exemplos Positivos

```
PaymentProcessing.Domain/
  Entities/
    Payment.cs                  ← entidade com lógica de negócio
  ValueObjects/
    Money.cs                    ← imutável, igualdade por valor
    PaymentStatus.cs
  Repositories/
    IPaymentRepository.cs       ← interface — sem EF Core
  Events/
    PaymentApproved.cs          ← evento de domínio
  Exceptions/
    PaymentAlreadyProcessedException.cs
```

```csharp
// Domain — lógica de negócio no lugar certo
public class Payment
{
    private Payment() { }

    public static Payment Create(Money amount, string merchantId, string tenantId) { ... }

    public void Approve()
    {
        if (_status != PaymentStatus.Pending)
            throw new PaymentAlreadyProcessedException(Id);
        _status = PaymentStatus.Approved;
        AddDomainEvent(new PaymentApproved(Id, _amount, _tenantId));
    }
}
```

## Anti-Patterns

```csharp
// ERRADO: domínio conhecendo EF Core
using Microsoft.EntityFrameworkCore;
public class Payment
{
    [Key] public Guid Id { get; set; }  // atributo de persistência no domínio
}

// ERRADO: lógica de negócio no handler (Application)
public async Task Handle(ApprovePaymentCommand command)
{
    var payment = await _repo.GetByIdAsync(command.PaymentId);
    if (payment.Status != "Pending") throw new Exception("...");  // lógica no handler
    payment.Status = "Approved";
}

// ERRADO: Application referenciando infraestrutura
using Microsoft.EntityFrameworkCore;  // em arquivo de Application
```

## Verificação

- Verificar referências de projeto: `dotnet list reference` em cada `.csproj`
- `Domain.csproj` não deve referenciar nenhum pacote de infraestrutura
- Agent `.forge/agents/architecture/clean-architecture-reviewer.md` valida estrutura

## Referências

- [DDD](./ddd.md)
- Clean Architecture em microsserviços .NET: _ADR a criar — sem equivalente aprovado no catálogo atual (`docs/product/adr/` 0001–0015); esta rule é a fonte vigente (DD-005)._
- Clean Architecture — Robert C. Martin
