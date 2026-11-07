---
title: Convenções de Nomenclatura
applies_to:
  - all
priority: high
last_reviewed: 2026-05-08
---

# Convenções de Nomenclatura

## Princípio

Nomes são contratos. Um nome ruim cria ambiguidade, força o leitor a abrir o arquivo para entender o que está lendo e torna buscas no repositório imprecisas. Nomes seguem convenções estritas para que qualquer membro do time (ou agente de IA) possa prever onde encontrar qualquer artefato.

A regra mais importante: **nunca prefixar com tecnologia**. O nome deve revelar a intenção de negócio, não o mecanismo de implementação.

---

## Glossário Ubíquo e Vocabulário de Domínio

### Fonte primária dos termos de domínio

O glossário do `<project_name>` está em `docs/product/glossary/domain-glossary.md`. Esse documento é a fonte canônica para os termos de domínio (transação, settlement, reconciliação, merchant, acquirer, terminal, etc.) e deve ser consultado antes de nomear qualquer novo artefato.

Quando aparecer um termo novo no código, design ou evento, o autor deve:
1. Verificar se o termo já tem entrada no glossário
2. Se não, propor inclusão (PR no glossário) ANTES de adotar o termo
3. Documentar o par (termo pt-BR canônico ↔ identificador EN) na entrada do glossário

### Regra de idioma por artefato

| Artefato | Idioma obrigatório |
|---------|-------------------|
| Documentação (ADR, README, specs `docs/product/modules/`) | Português Brasileiro |
| Comentários explicativos no código | Português Brasileiro |
| Nomes de módulo, serviço, pacote | **Inglês** (contexto transacional/financeiro) |
| Nomes de classe, record, struct, interface | **Inglês** |
| Nomes de método, função, propriedade, campo | **Inglês** |
| Nomes de variável, parâmetro, constante, enum | **Inglês** |
| Namespaces, tipos genéricos | **Inglês** |
| Nomes de arquivo de código-fonte | **Inglês** (PascalCase para `.cs`) |
| Nomes de diretório técnico (`src/`, `tests/`) | **Inglês**, kebab-case (exceto pastas .NET canônicas em PascalCase) |
| Nomes de evento de domínio e de mensageria | **Inglês**, no passado (`TransactionApproved`) |
| Tabelas/itens de banco | **Inglês** com snake_case |
| Métricas e labels de observabilidade | **Inglês** com snake_case |

### Restrição de contexto para nomes em inglês

**Identificadores em inglês devem ser escolhidos dentro do contexto semântico de transações financeiras / processamento de pagamentos.** Nomes genéricos de e-commerce, ride-hailing ou hotel são desaconselhados quando há alternativa com semântica transacional clara.

| Genérico/desaconselhado | Motivo | Preferir |
|---------|--------|---------|
| `Item` (para linha de transação) | Genérico demais | `TransactionLineItem` |
| `Order` (para autorização) | Semântica de e-commerce | `Authorization` ou `TransactionRequest` |
| `Booking` | Semântica de hotel/aéreo | depende — geralmente não aplicável |
| `User` (sem qualificação) | Ambíguo | `Merchant` / `Operator` / `Customer` conforme persona |
| `Device` (sem qualificação) | Ambíguo | `Terminal` / `Acquirer` conforme contexto |

---

## Processo para Nomes de Módulo / Serviço

Ao escolher o nome de um novo módulo, serviço ou pacote:

1. **Propor 3 candidatos** em inglês alinhados ao domínio transacional
2. **Avaliar cada candidato** contra os 5 critérios abaixo
3. **Selecionar o melhor** com justificativa explícita no ADR ou PR
4. **Registrar no glossário** o par `(termo pt-BR ↔ nome técnico)` em `docs/product/glossary/domain-glossary.md`

### Critérios (0–2 por critério, máximo 10)

| # | Critério | Pergunta |
|---|----------|----------|
| 1 | **Clareza semântica** | O nome comunica inequivocamente o módulo sem precisar de documentação? |
| 2 | **Alinhamento ao domínio** | Usa vocabulário transacional (não genérico)? |
| 3 | **Não-ambiguidade** | Poderia ser confundido com outro módulo existente ou futuro? |
| 4 | **Buscabilidade** | É distinto o suficiente para `grep` sem ruído? |
| 5 | **Consistência** | Segue kebab-case e sufixos aceitos (`-service`, `-gateway`, `-worker`)? |

---

## Diretrizes

### Diretórios e Repositórios
1. Sempre `kebab-case`: `payment-processing/`, `core-money/`, `<another-service>/`
2. Sem sufixo de tecnologia: `payment-processing/` (não `payment-processing-svc/` ou `dotnet-payment/`)
3. Singular para bounded contexts, plural para coleções: `services/`, `packages/`, mas `payment-processing/` (não `payment-processings/`)

### Arquivos de Documentação (`.md`)

Aplica-se a tudo em `docs/`, `docs/product/modules/<modulo>/` e demais artefatos de documentação versionada.

4. **Sempre `kebab-case`** — inclusive arquivos cujo conteúdo é referenciado por sigla (PRD, FRD, NFRD, TRD, UXD): `prd.md`, `frd.md`, `nfrd.md`, `trd.md`, `uxd.md`, `prd-validation.md`, `frd-nfrd-validation-report.md`, `ddd-segmentation.md`, `data-model.md`.
5. **Exceções**: apenas a meta-trinca universalmente reconhecida em qualquer repositório — `README.md`, `CHANGELOG.md`, `LICENSE`/`LICENSE.md`, `CONTRIBUTING.md`. Nenhuma outra exceção.
6. **Documentos com sigla no conteúdo** (PRD, FRD, NFRD, ADR, TRD, UXD) não justificam UPPERCASE no nome do arquivo. A sigla aparece naturalmente no título Markdown (`# PRD — <project_display>`) e nas referências do corpo do texto. O nome do arquivo segue a convenção do projeto.
7. **ADRs**: `NNNN-titulo-em-kebab-case.md` em `docs/product/adr/` (ex.: `0036-multi-arch-container-images.md`). O índice mestre é `README.md`.
8. **Razão técnica**: macOS e Windows são case-insensitive por padrão; CI Linux é case-sensitive. Misturar UPPERCASE e kebab-case cria ambiguidade silenciosa (ex.: `prd.md` vs `PRD.md` parecem coexistir em macOS mas quebram no CI). Padronizar em kebab-case elimina o problema.
9. **Razão de coerência**: arquivos auxiliares já são kebab-case (`prd-validation.md`, `frd-nfrd-validation-report.md`). Manter os "documentos pais" em UPPERCASE produz híbridos esquisitos (`PRD-VALIDATION.md`) ou inconsistência visível.

### Projetos .NET (`.csproj`)
10. `PascalCase` com prefixo de domínio: `PaymentProcessing.Api`, `PaymentProcessing.Domain`, `Ledger.Application`
11. Camadas obrigatórias: `.Api`, `.Application`, `.Domain`, `.Infrastructure`, `.Contracts`
12. Sem prefixo de tecnologia na camada de domínio: `SellerRepository` (não `SqlSellerRepository`), `PaymentPublisher` (não `KafkaPaymentPublisher`)

### Interfaces e Classes C#
13. Interfaces: prefixo `I` + PascalCase: `IPaymentRepository`, `ISettlementService`
14. Implementações: sem sufixo de tecnologia: `PaymentRepository` (não `EfCorePaymentRepository`)
15. Exceção: quando coexistem múltiplas implementações ativas, usar sufixo de contexto de negócio — não de tecnologia: `CachedPaymentRepository`, `AuditedPaymentRepository`

### Pacotes NPM
16. Escopo obrigatório: `@<project_name>/<nome-em-kebab-case>`
17. Exemplos: `@<project_name>/ui-components`, `@<project_name>/api-client`, `@<project_name>/design-tokens`

### Helm Charts
18. `kebab-case`, igual ao nome do serviço correspondente: `payment-processing`, `<another-service>`

### Eventos de Domínio (AsyncAPI / mensageria)
19. Padrão: `<Domínio>.<Entidade><PassadoDoVerbo>` em PascalCase: `Transaction.Authorized`, `Settlement.Completed`
20. Tópicos: `<domínio>.<entidade>.<evento>` em kebab-case: `transaction.authorized`

### Métricas (Prometheus / OpenTelemetry)
21. Padrão: `<domínio>_<métrica>_<unidade>`: `transaction_processing_duration_seconds`, `settlement_total`

### Variáveis de Ambiente
22. `SCREAMING_SNAKE_CASE`, prefixo do serviço: `TRANSACTION_DB_CONNECTION_STRING`, `DYNAMO_SERVICE_URL`

### Testes
23. Classe de teste: `<ClasseTestada>Tests`: `MoneyTests`, `PaymentCommandHandlerTests`
24. Método de teste: `<Método>_<Cenário>_<Resultado>`: `Add_PositiveAmounts_ReturnsSum`, `Process_InactiveTenant_ThrowsException`

## Exemplos Positivos

```
services/payment-processing/
  src/
    PaymentProcessing.Api/
    PaymentProcessing.Application/
    PaymentProcessing.Domain/
      Repositories/
        IPaymentRepository.cs     ✓ interface sem tecnologia
        ISettlementRepository.cs
      ValueObjects/
        Money.cs                  ✓ nome de negócio
    PaymentProcessing.Infrastructure/
      Repositories/
        PaymentRepository.cs      ✓ implementação sem prefixo de tecnologia
```

## Anti-Patterns

| Errado | Correto | Motivo |
|---|---|---|
| `SqlSellerRepository` | `SellerRepository` | Prefixo de tecnologia |
| `KafkaPaymentPublisher` | `PaymentPublisher` | Prefixo de tecnologia |
| `payment-processing-svc` | `payment-processing` | Sufixo de tecnologia |
| `dotnet-payment-gateway` | `payment-gateway` | Prefixo de tecnologia |
| `RedisCache` (classe de domínio) | `PaymentCache` | Expõe mecanismo no domínio |
| `@<project_name>/react-components` | `@<project_name>/ui-components` | Prefixo de tecnologia em pacote |

## Verificação

- Hook `.forge/hooks/pre-tool-use/validate-naming-conventions.sh` verifica regex blocklist de prefixos de tecnologia em classes
- Revisão de nomenclatura incluída no checklist do PR template

## Referências

- [Política de Idioma](./language-policy.md)
- [Clean Architecture](../architecture/clean-architecture.md)
- [DDD](../architecture/ddd.md)
