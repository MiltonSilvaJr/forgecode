---
title: Política de Idioma
applies_to:
  - all
priority: high
last_reviewed: 2026-05-08
---

# Política de Idioma

## Princípio

O `<project_name>` adota política de dois idiomas: **inglês para identificadores e código**, **português brasileiro para documentação e conteúdo textual**. A separação garante que o código seja acessível a ferramentas internacionais (IDEs, linters, analisadores estáticos) enquanto a documentação permanece natural para o time brasileiro.

Mistura de idiomas dentro de uma mesma camada (código bilíngue ou documentação em inglês) é um anti-pattern bloqueado por hooks automáticos.

## Diretrizes

1. **Em inglês obrigatoriamente:** nomes de classes, interfaces, métodos, propriedades, variáveis, constantes, namespaces, parâmetros, tipos genéricos, nomes de arquivos de código, nomes de diretórios, mensagens de commit, nomes de branches, labels de métricas e eventos.

2. **Em português brasileiro obrigatoriamente:** READMEs, CHANGELOGs, ADRs, comentários explicativos, mensagens de erro exibidas ao usuário, documentação de API (campo `description` em OpenAPI), nomes de campos em formulários de UI, conteúdo de e-mails e notificações, docs em `.forge/rules/`, `.forge/agents/`, `.forge/commands/`, `docs/product/modules/`.

3. **Termos técnicos consagrados em inglês** podem ser usados em documentação sem tradução forçada: *Clean Architecture*, *Domain-Driven Design*, *value object*, *aggregate root*, *bounded context*, *idempotency key*, *tenant*, *merchant*, *settlement*, *acquirer*, *transaction*, *ledger*.

4. **Nunca** criar identificadores em português: `public void ProcessarPagamento()`, `string nomeDoCliente`, `var valorEmReais`.

5. **Mensagens de log:** identificadores estruturados em inglês; mensagem humana em inglês (logs são consumidos por ferramentas internacionais como CloudWatch, Loki, Datadog).

6. **Testes:** nomes de classe e método em inglês; `DisplayName` pode ser em pt-BR para clareza no relatório.

## Exemplos Positivos

```csharp
// Correto: identificador em inglês, comentário em pt-BR
/// <summary>
/// Processa a transação e emite evento de confirmação.
/// Lança InvalidOperationException se o tenant não estiver ativo.
/// </summary>
public async Task<TransactionResult> ProcessAsync(TransactionCommand command)
```

```markdown
<!-- Correto: documentação em pt-BR -->
## Como Executar Localmente
Execute `dotnet run` na pasta `src/Server`.
```

## Anti-Patterns

```csharp
// ERRADO: identificador em pt-BR
public async Task<ResultadoTransacao> ProcessarAsync(ComandoTransacao comando)

// ERRADO: mistura de idiomas
public async Task<TransactionResult> ProcessarTransacaoAsync(TransactionCommand command)
```

## Verificação

- Hook `.forge/hooks/pre-tool-use/check-language-policy.sh` detecta identificadores PT-BR em `.cs`
- Revisão manual amostral em PRs por CODEOWNERS

## Referências

- [Convenções de Nomenclatura](./naming.md)
- [AGENTS.md](../../../AGENTS.md)
