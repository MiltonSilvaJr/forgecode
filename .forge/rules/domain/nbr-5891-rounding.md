---
title: Arredondamento NBR 5891
applies_to:
  - backend-dotnet
priority: high
last_reviewed: 2026-05-08
---

# Arredondamento NBR 5891

## Princípio

A NBR 5891 ("Regras para Arredondamento Numérico") define o arredondamento padrão para operações financeiras no Brasil. O método é "arredondamento bancário" (também chamado de *round half to even* ou *Banker's Rounding*): quando o dígito a descartar é exatamente 5, arredonda-se para o inteiro par mais próximo — não sempre para cima.

Este comportamento difere do arredondamento comum do cotidiano (sempre para cima) e deve ser aplicado em todas as operações de divisão monetária, split de pagamentos e cálculo de tarifas.

## Diretrizes

1. **Usar `MidpointRounding.ToEven`** em C# para qualquer arredondamento de valor monetário. Nunca `MidpointRounding.AwayFromZero`.

2. **Operações de split:** ao dividir um valor entre N partes, a soma das partes deve ser exatamente igual ao total original. O centavo residual é atribuído à primeira parcela (estratégia "first party gets remainder").

3. **Cálculo de porcentagem/taxa:** multiplicar em centavos, arredondar ao centavo mais próximo com `ToEven`.

4. **Nunca arredondar em cascata:** aplicar arredondamento uma única vez ao final da cadeia de cálculo — não em cada passo intermediário.

5. **Testes obrigatórios com PBT (Property-Based Testing):** a propriedade `sum(split(total, n)) == total` deve ser verificada para qualquer `total` e `n`.

## Exemplos Numéricos

### Arredondamento ToEven

| Valor intermediário | Resultado ToEven | Resultado AwayFromZero |
|---|---|---|
| 1,5 centavos | 2 centavos | 2 centavos |
| 2,5 centavos | **2 centavos** | 3 centavos |
| 3,5 centavos | 4 centavos | 4 centavos |
| 4,5 centavos | **4 centavos** | 5 centavos |

### Split de Pagamento

Dividir R$ 10,00 (1000 centavos) em 3 partes:
- Divisão exata: 333,33... → cada parte = 333 centavos
- Residual: 1000 - (333 × 3) = 1 centavo
- Resultado: `[334, 333, 333]` (primeiro recebe o residual)
- Verificação: 334 + 333 + 333 = **1000** ✓

Dividir R$ 10,01 (1001 centavos) em 3 partes:
- Divisão exata: 333,66... → base = 333 centavos
- Residual: 1001 - (333 × 3) = 2 centavos
- Resultado: `[335, 333, 333]`
- Verificação: 335 + 333 + 333 = **1001** ✓

### Taxa de 2,5% sobre R$ 100,00

- 1,025 × 10000 centavos intermediário = 250,0 centavos exatos
- Resultado: 250 centavos = R$ 2,50 ✓

### Taxa de 1,5% sobre R$ 33,33

- 0,015 × 3333 centavos = 49,995 centavos
- ToEven: 49,995 → 50 centavos (49 é ímpar → arredonda para cima)
- Verificação: 50 centavos = R$ 0,50

## Exemplos Positivos

```csharp
// Cálculo de taxa com ToEven
public static long CalculateFee(long amountInCents, decimal feeRatePercent)
{
    var feeExact = amountInCents * feeRatePercent / 100m;
    return (long)Math.Round(feeExact, MidpointRounding.ToEven);
}

// Split que garante soma == total
public static long[] Split(long totalInCents, int parts)
{
    if (parts <= 0) throw new ArgumentException("parts must be positive");
    var baseAmount = totalInCents / parts;
    var remainder = totalInCents % parts;
    var result = Enumerable.Repeat(baseAmount, parts).ToArray();
    result[0] += remainder;  // primeiro recebe o residual
    return result;
}
```

```csharp
// Teste PBT com FsCheck
[Property]
public Property Split_SumAlwaysEqualTotal(long total, PositiveInt n)
{
    total = Math.Abs(total);
    var parts = n.Get;
    return (Split(total, parts).Sum() == total)
        .ToProperty()
        .Label($"total={total}, parts={parts}");
}
```

## Anti-Patterns

```csharp
// ERRADO: arredondamento AwayFromZero
Math.Round(value, MidpointRounding.AwayFromZero)

// ERRADO: arredondamento intermediário
var step1 = Math.Round(amount * rate1, MidpointRounding.ToEven);  // arredonda no meio
var step2 = Math.Round(step1 * rate2, MidpointRounding.ToEven);  // acumula erro

// ERRADO: split sem verificação de soma
var parts = total / n;  // perde o residual!
```

## Verificação

- Grep por `MidpointRounding.AwayFromZero` — deve retornar 0 em código de domínio financeiro
- Testes PBT para `Split` e `CalculateFee` obrigatórios em `core-money`

## Referências

- [Money como centavos](./money-as-cents.md)
- NBR 5891:2014 — Associação Brasileira de Normas Técnicas
- Money como inteiro em centavos: _ADR a criar — sem equivalente aprovado no catálogo atual; ver rule [`money-as-cents.md`](./money-as-cents.md) (DD-005)._
