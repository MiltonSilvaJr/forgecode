---
title: Money como Inteiro em Centavos
applies_to:
  - backend-dotnet
  - frontend-react
  - android-kotlin
priority: high
last_reviewed: 2026-05-08
---

# Money como Inteiro em Centavos

## Princípio

Valores monetários são representados exclusivamente como inteiros em centavos em todo código de domínio. O tipo `decimal` e `float` nunca aparecem em lógica financeira: operações de ponto flutuante introduzem erros de representação que são inaceitáveis em sistemas de pagamento. Um centavo é a menor unidade indivisível para BRL.

A conversão para exibição (R$ 15,90) ocorre apenas na camada de apresentação — nunca no domínio ou aplicação.

## Diretrizes

1. **Tipo de armazenamento:** `long` (Int64) em C#, `Long` em Kotlin, `number` (inteiro) em TypeScript. Nunca `decimal`, `double`, `float`, `BigDecimal` para valores monetários.

2. **Nomenclatura:** `amountInCents`, `totalAmountInCents`, `feeInCents` — o sufixo `InCents` é obrigatório para deixar a unidade explícita.

3. **Objeto de valor `Money`:** todo código de domínio manipula `Money` (objeto de valor), nunca `long` diretamente. O objeto de valor encapsula a unidade e previne comparações entre moedas diferentes.

4. **Banco de dados:** coluna `BIGINT NOT NULL` para valores monetários. Nunca `DECIMAL`, `NUMERIC` ou `FLOAT`.

5. **Contratos (OpenAPI/AsyncAPI):** campos monetários são `integer` com `format: int64` e `description` indicando "valor em centavos (BRL)".

6. **Aritmética:** todas as operações sobre `Money` respeitam NBR 5891. Ver `.forge/rules/domain/nbr-5891-rounding.md`.

7. **Entrada de usuário:** converter de string formatada (R$ 15,90) para centavos (1590) imediatamente na borda do sistema — frontend ou API controller. Nunca propagar `decimal` de entrada.

8. **Exibição:** formatar para o usuário apenas na camada de apresentação: `(amountInCents / 100.0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })`.

## Exemplos Positivos

```csharp
// Correto: objeto de valor Money em centavos
var price = Money.Of(1590L, "BRL");  // R$ 15,90
var total = price.Add(Money.Of(310L, "BRL"));  // R$ 19,00

// Correto: coluna de banco
// amountInCents BIGINT NOT NULL

// Correto: OpenAPI
// amount_in_cents:
//   type: integer
//   format: int64
//   description: "Valor da transação em centavos (BRL). Ex: 1590 = R$ 15,90"
```

```kotlin
// Correto: Kotlin
data class Money(val amountInCents: Long, val currency: String = "BRL")
```

```typescript
// Correto: TypeScript
interface PaymentRequest {
  amountInCents: number; // inteiro, ex: 1590 = R$ 15,90
}
```

## Anti-Patterns

```csharp
// ERRADO: decimal no domínio
decimal amount = 15.90m;

// ERRADO: float
double price = 15.9;

// ERRADO: sem sufixo InCents — unidade ambígua
long amount = 1590;  // reais ou centavos?

// ERRADO: BigDecimal em Kotlin
BigDecimal amount = BigDecimal("15.90")
```

## Verificação

- Grep por `decimal` em `*.Domain/*.cs` — deve retornar 0 ocorrências (exceto em configurações de mapeamento de DB)
- Grep por `float` e `double` em arquivos de domínio — deve retornar 0 ocorrências
- Colunas de banco com tipo `DECIMAL/NUMERIC` em tabelas financeiras são regressões a investigar

## Referências

- [NBR 5891 — Arredondamento](./nbr-5891-rounding.md)
- [DDD — Objetos de Valor](../architecture/ddd.md)
- Money como inteiro em centavos: _ADR a criar — sem equivalente aprovado no catálogo atual; esta rule é a fonte vigente (DD-005)._
