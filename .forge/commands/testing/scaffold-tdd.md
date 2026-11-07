---
name: scaffold-tdd
description: Gera o esqueleto de um teste seguindo o ciclo Red-Green-Refactor, com estrutura AAA (Arrange-Act-Assert) e placeholder de PBT quando aplicável. Modo --bugfix nomeia o teste pelo defeito (rule testing/regression-red-first.md, item 4) para uso com /forge:red.
arguments:
  - name: test-name
    description: "Nome da classe testada em PascalCase (ex: Money, PaymentCommandHandler)"
    required: true
  - name: --bugfix
    description: "Modo regressão (rule testing/regression-red-first.md): pede change-id/slug do defeito e nomeia o teste por ele — nunca genérico."
    required: false
---

# /forge:scaffold-tdd

Gera o esqueleto de uma classe de teste xUnit seguindo TDD (Red-Green-Refactor) com estrutura AAA.

## Modo `--bugfix` (regressão)

Para `type: bugfix`, o teste **não é um `[Fact]` genérico** — é o Red que reproduz o defeito
(rule `testing/regression-red-first.md`, itens 1 e 4). Diferenças em relação ao modo padrão:

1. Pergunte (ou derive do change-id ativo) o **slug do defeito** — ex.: `bug-123`, `pix-timeout`.
2. Nomeie a classe/método pelo defeito, não pela unidade genérica: `Regression_<Slug>_Tests`
   com método `<Method>_<CenárioDoDefeito>_<ComportamentoEsperado>`. Um teste chamado
   `SumTests.Test1` é candidato a ser apagado no próximo refactor por parecer redundante; um
   teste chamado `Regression_Bug123_SumWithNegativeSecondArg_ReturnsSum` não é.
3. **Não implemente a correção junto.** O teste nasce falhando contra o código atual (bug
   presente) — esse é o Red que `/forge:red replay` vai observar. Pare aqui; a task de correção
   é outra (ver `.forge/commands/specs/tasks.md` — TASK do Red precede TASK de correção).
4. Depois de escrito e rodando vermelho (localmente, sanity check — não substitui o replay
   real): `bash .forge/scripts/red-evidence.sh record <change-id> --test-path <path> --command
   "<comando>" --fix-files <arquivos previstos> --failure-pattern "<padrão esperado>"`, seguido
   de `/forge:red replay`.

## Passos a Executar (modo padrão)

1. **Inferir projeto de teste**
   - Se `test-name` contém `CommandHandler` ou `QueryHandler` → `Application.Tests`
   - Se `test-name` é objeto de valor ou entidade → `Domain.Tests`
   - Se `test-name` contém `Repository` → `Integration.Tests`
   - Perguntar ao usuário se não for possível inferir

2. **Gerar classe de teste**

```csharp
using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using Xunit;

namespace <Namespace>.Tests;

public class {{TEST_NAME}}Tests
{
    // ─── Testes de exemplo (Red → Green → Refactor) ────────────────────────

    [Fact]
    public void <Method>_<Scenario>_<ExpectedResult>()
    {
        // Arrange
        // TODO: configurar estado inicial

        // Act
        // TODO: invocar o comportamento sob teste

        // Assert
        // TODO: verificar resultado esperado
    }

    [Theory]
    [InlineData(/* caso 1 */)]
    [InlineData(/* caso 2 */)]
    public void <Method>_MultipleScenarios_<ExpectedResult>(/* parâmetros */)
    {
        // TODO: implementar
    }

    // ─── Property-Based Tests (quando há propriedades matemáticas) ─────────

    // Descomente se aplicável (ex: para objetos de valor com operações aritméticas):
    // [Property]
    // public Property <Operation>_IsSomeMathProperty(/* geradores */)
    // {
    //     return (/* propriedade */).ToProperty();
    // }
}
```

3. **Adicionar ao projeto de teste correto** (criar arquivo no diretório certo)

4. **Verificar que o teste compila mas falha** (Red confirmado)

## Validações Pós-Execução

- [ ] Arquivo de teste criado no projeto correto
- [ ] Classe com sufixo `Tests`
- [ ] Pelo menos um `[Fact]` placeholder
- [ ] Estrutura AAA presente (comentários Arrange/Act/Assert)
- [ ] Placeholder de PBT incluído se `test-name` é objeto de valor numérico
