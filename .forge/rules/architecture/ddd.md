---
title: Domain-Driven Design (DDD)
applies_to:
  - backend-dotnet
priority: high
last_reviewed: 2026-05-08
---

# Domain-Driven Design (DDD)

## Princípio

O design de cada serviço é guiado pelo modelo de domínio, não pela conveniência técnica. Bounded contexts têm fronteiras explícitas e se comunicam via contratos publicados — nunca por acesso direto a banco ou importação de tipos internos. O modelo ubíquo (glossário em `docs/product/glossary/`) deve ser refletido fielmente no código.

## Diretrizes

### Entidades

1. Têm identidade única (`Id`) que persiste ao longo do tempo — dois objetos com mesmo `Id` são a mesma entidade, independente de seus atributos.
2. Construtores são privados ou `internal`; criação via factory estática (`Create`) que valida invariantes.
3. Reconstitução a partir de persistência via factory separada (`Reconstitute`) — sem validação de invariantes (dados já foram validados na escrita).
4. Mutações expostas apenas via métodos com nomes de negócio: `Approve()`, `Cancel(reason)`, `Dispatch()` — nunca setters públicos.

### Objetos de Valor

5. Imutáveis: todos os campos `private readonly`, sem setters.
6. Igualdade por valor: dois objetos de valor com os mesmos atributos são iguais.
7. Implementam `IEquatable<T>` e sobrescrevem `GetHashCode()`.
8. Encapsulam validação: nunca criam instância inválida. Lançar `DomainException` se inválido.
9. Em documentação pt-BR: sempre escrever por extenso "objeto de valor" — nunca "VO".

### Agregados

10. Cada agregado tem uma raiz (`AggregateRoot`) que é a única entrada para modificações.
11. Outros objetos dentro do agregado são acessados apenas pela raiz — sem referências diretas externas.
12. Referências entre agregados são por `Id` — nunca por navegação de objeto.
13. Persistência por agregado: o repositório salva e carrega o agregado inteiro.
14. Agregados pequenos: se um agregado cresce demais, dividir em dois com referência por `Id`.

### Eventos de Domínio

15. Eventos nomeados no passado: `PaymentApproved`, `BoardingValidated`, `SettlementCompleted`.
16. Emitidos pela raiz do agregado via `AddDomainEvent(new PaymentApproved(...))`.
17. Publicados para infraestrutura após persistência bem-sucedida (outbox pattern recomendado).
18. Eventos são imutáveis e contêm apenas dados necessários para consumidores reagirem.

### Bounded Contexts

19. Cada serviço em `services/` é um bounded context com modelo ubíquo próprio.
20. Comunicação entre contexts via eventos (AsyncAPI) ou APIs (OpenAPI) — nunca banco compartilhado.
21. O mesmo termo pode ter significados diferentes em contexts distintos — isso é esperado e correto.
22. Anti-Corruption Layer (ACL) para integrar com sistemas externos em `Infrastructure`.

## Exemplos Positivos

```csharp
// Objeto de valor correto — imutável, validação no construtor
public sealed class Money : IEquatable<Money>
{
    public long AmountInCents { get; }
    public string Currency { get; }

    private Money(long amountInCents, string currency)
    {
        AmountInCents = amountInCents;
        Currency = currency;
    }

    public static Money Of(long amountInCents, string currency = "BRL")
    {
        if (amountInCents < 0) throw new DomainException("Valor monetário não pode ser negativo.");
        if (string.IsNullOrWhiteSpace(currency)) throw new DomainException("Moeda é obrigatória.");
        return new Money(amountInCents, currency);
    }

    public bool Equals(Money? other) => other is not null
        && AmountInCents == other.AmountInCents
        && Currency == other.Currency;

    public override int GetHashCode() => HashCode.Combine(AmountInCents, Currency);
}

// Entidade com factory e mutação semântica
public class Payment : AggregateRoot
{
    private Payment() { }

    public static Payment Create(Money amount, string merchantId, string tenantId)
    {
        ArgumentException.ThrowIfNullOrEmpty(merchantId);
        var payment = new Payment { Id = Guid.NewGuid(), Amount = amount, ... };
        payment.AddDomainEvent(new PaymentCreated(payment.Id, amount, tenantId));
        return payment;
    }

    public void Approve()
    {
        if (Status != PaymentStatus.Pending)
            throw new PaymentAlreadyProcessedException(Id);
        Status = PaymentStatus.Approved;
        AddDomainEvent(new PaymentApproved(Id, Amount, TenantId));
    }
}
```

## Anti-Patterns

```csharp
// ERRADO: objeto de valor mutável com setter
public class Money { public decimal Value { get; set; } }

// ERRADO: referência entre agregados por navegação
public class Payment { public Seller Seller { get; set; } }  // deveria ser SellerId

// ERRADO: lógica de domínio fora do agregado
payment.Status = PaymentStatus.Approved;  // mutação direta

// ERRADO: "VO" em documentação pt-BR
// "O VO Money representa..." → correto: "O objeto de valor Money representa..."
```

## Verificação

- Agent `.forge/agents/architecture/ddd-validator.md` valida modelagem
- Nenhuma classe de domínio com setters públicos em propriedades de estado
- Eventos com nomes no passado

## Referências

- [Clean Architecture](./clean-architecture.md)
- [Money como centavos](../domain/money-as-cents.md)
- [Glossário ubíquo](../../docs/product/glossary/)
- Domain-Driven Design — Eric Evans
- Implementing Domain-Driven Design — Vaughn Vernon
