---
title: Test-Driven Development (TDD)
applies_to:
  - all
priority: high
last_reviewed: 2026-07-28
---

# Test-Driven Development (TDD)

## Princípio

TDD é obrigatório para toda lógica de domínio e de aplicação. O ciclo Red-Green-Refactor não é uma prática opcional — é o workflow de desenvolvimento. Testes escritos após o código não validam o design; validam apenas que o código existente se comporta de determinada forma. Testes escritos antes forçam APIs limpas e dependências injetáveis.

Property-Based Testing (PBT) complementa testes de exemplo quando há propriedades matemáticas verificáveis — especialmente em lógica monetária, arredondamento e operações sobre coleções.

## Diretrizes

### Ciclo Red-Green-Refactor

1. **Red:** escrever o menor teste que falhe. O teste deve compilar mas falhar por razão de comportamento — não de compilação.
2. **Green:** escrever o mínimo de código para o teste passar. Sem otimizações, sem código especulativo.
3. **Refactor:** melhorar o código mantendo todos os testes verdes. Extrair abstrações, remover duplicação.
4. Nunca pular para Refactor sem Green. Nunca escrever mais código que o necessário para o Green atual.

### Granularidade de Testes

5. **Unitários** (maioria): testam uma única classe/função em isolamento com dependências mockadas. Rápidos (<1ms cada). Ficam em `tests/Unit/` dentro do projeto de serviço.
6. **Integração** (minoria): testam colaboração entre múltiplas classes reais, incluindo banco (Testcontainers). Ficam em `tests/Integration/`. Mais lentos, rodam em CI separado.
7. **E2E** (poucos): testam fluxos completos através de APIs reais. Ficam em `tests/e2e/` na raiz do monorepo.
8. Proporção alvo: 80% unitários, 40% integração, 10% E2E.

### Nomenclatura de Testes

9. Classe de teste: `<ClasseTestada>Tests` — ex: `MoneyTests`, `PaymentCommandHandlerTests`
10. Método: `<Método>_<Cenário>_<ResultadoEsperado>` — ex: `Add_PositiveAmounts_ReturnsCorrectSum`
11. `[Fact]` para cenário único; `[Theory]` + `[InlineData]` para múltiplos cenários do mesmo comportamento

### Property-Based Testing

12. Onde a unidade tem propriedade algébrica ou estrutural verificável (invariância sob permutação, idempotência, round-trip, conservação, monotonicidade), o teste de propriedade é **obrigatório** e complementa — não substitui — os testes por exemplo
13. A norma completa, com as famílias de propriedade, as regras de escrita (seed fixa, shrinking, verificação do gerador) e as ferramentas por stack, vive em [property-based-testing.md](./property-based-testing.md)
14. Onde não há propriedade, não force: PBT sobre código sem propriedade reimplementa a função e não prova nada

### Ferramentas por Stack

| Stack | Framework de Teste | Mock | PBT |
|---|---|---|---|
| .NET | xUnit 2.x | NSubstitute | FsCheck |
| React / TypeScript | Vitest | vi (built-in) | fast-check |
| Android / Kotlin | JUnit 5 + Kotest | MockK | Kotest Property |

### Cobertura

15. Cobertura de linhas não é a métrica alvo — cobertura de **comportamentos** é
16. Todo caminho de código com lógica de negócio deve ter teste
17. Exceções de domínio devem ter testes explícitos

## Exemplos Positivos

```csharp
// Red: teste que falha porque Money.Add não existe ainda
[Fact]
public void Add_TwoMoneyValues_ReturnsSumInCents()
{
    var a = Money.Of(1000L);
    var b = Money.Of(590L);

    var result = a.Add(b);

    result.AmountInCents.Should().Be(1590L);
}

// PBT: propriedade de comutatividade
[Property]
public Property Add_IsCommutative(long a, long b)
{
    a = Math.Abs(a); b = Math.Abs(b);
    var m1 = Money.Of(a).Add(Money.Of(b));
    var m2 = Money.Of(b).Add(Money.Of(a));
    return (m1 == m2).ToProperty();
}
```

```typescript
// Vitest — React
describe('formatMoney', () => {
  it('formats_1590_cents_as_BRL_currency_string', () => {
    expect(formatMoney(1590)).toBe('R$ 15,90');
  });
});
```

## Anti-Patterns

```csharp
// ERRADO: teste escrito após o código (design não foi validado)
// ERRADO: teste sem asserção
public void DoesNotThrow() { new Money(1000); }  // sem Assert

// ERRADO: múltiplos comportamentos no mesmo teste
[Fact]
public void MoneyTests()  // nome genérico
{
    // testa Add, Subtract, Compare ao mesmo tempo
}

// ERRADO: lógica de negócio no teste
[Fact]
public void Split_Calculates()
{
    var result = total / parts;  // duplicando a implementação no teste
    Assert.Equal(result, Split(total, parts)[0]);
}
```

## Verificação

- PRs sem testes para lógica nova são bloqueados pelo checklist do PR template
- `dotnet test --collect:"XPlat Code Coverage"` reporta cobertura por linha
- Propriedades declaradas no `design.md` são conferidas no `/forge:verify` (ver [property-based-testing.md](./property-based-testing.md))

## Referências

- [Red-first em correção de defeito](./regression-red-first.md) — o mesmo ciclo aplicado a bugfix, onde o Red precisa ser observado e replicável, não presumido.
- [Money como centavos](../domain/money-as-cents.md)
- [NBR 5891](../domain/nbr-5891-rounding.md)
- Test-Driven Development — Kent Beck
- [FsCheck — documentação](https://fscheck.github.io/FsCheck/)
