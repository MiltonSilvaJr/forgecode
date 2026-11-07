---
title: APIs e Contratos
applies_to:
  - backend
  - frontend
priority: high
last_reviewed: 2026-05-08
---

# APIs e Contratos

## Filosofia

- **API-first:** o contrato é definido antes da implementação
- **Contract-first:** OpenAPI/AsyncAPI/Protobuf são a fonte da verdade
- **Retrocompatibilidade por padrão:** mudanças que quebram contrato exigem nova versão

## Versionamento

- Toda API DEVE ser versionada: `/api/v1/`, `/api/v2/`
- Breaking changes criam nova versão — **nunca** modificam a versão existente
- Versões antigas são mantidas até deprecação formal com período de aviso

## Schemas e Validação

- Schemas DEVEM ser validados por máquina (OpenAPI, Zod, FluentValidation)
- Validação de input ocorre **antes** de qualquer processamento
- Requests inválidos **NUNCA** produzem efeitos colaterais (nada persiste, nada é publicado)

## Estrutura de Erro Padrão

```json
{
  "error": "Descrição legível do erro",
  "code": "ERROR_CODE_SNAKE_UPPER",
  "correlationId": "uuid-v4"
}
```

- `correlationId` obrigatório em toda resposta de erro
- Detalhes internos (stack trace) **nunca** expostos em respostas de produção
- Códigos de erro documentados no OpenAPI do serviço

## Nomenclatura de Endpoints

- Resources: **kebab-case** — `/api/v1/voyage-slots`
- Query parameters: **camelCase** — `?startDate=...&pageSize=20`
- URLs frontend e backend **devem coincidir exatamente** (sem diferenças de case)

```
GET    /api/v1/voyage-slots
GET    /api/v1/voyage-slots/{id}
POST   /api/v1/voyage-slots
PUT    /api/v1/voyage-slots/{id}
DELETE /api/v1/voyage-slots/{id}
```

## Eventos (Async)

- Eventos são **fatos imutáveis** — não comandos
- Nome em `PastTense`: `VoyageSlotBooked`, `PaymentProcessed`
- Contratos AsyncAPI em `contracts/asyncapi/`
- Eventos publicados não podem ser retroativamente alterados

## Documentação

- Todo endpoint documentado com OpenAPI (Swagger)
- Contratos OpenAPI em `contracts/openapi/`
- Contratos de sistemas externos em `contracts/openapi/external/`

## Testes de Contrato

- Testes de contrato (Pact ou similar) são **obrigatórios** para integrações consumer/provider
- Contratos em `contracts/pact/`
- PR sem contrato para nova integração é bloqueado

## Fonte da verdade e comparação gerado × versionado

Onde o contrato VERSIONADO é a fonte da verdade (ver Filosofia acima), nenhum teste de comparação tem como remediação sobrescrevê-lo com o artefato GERADO — uma divergência pode ser o gerador mudando legitimamente, ou o versionado tendo sido editado de propósito (inclusive para corrigir uma exposição de superfície que o gerador produzia). Regras da mensagem de falha e das asserções de propriedade: `testing/quality-gates.md` § Comparação gerado × versionado.

## Monitoramento

- Erros 4xx → alertas de warning
- Erros 5xx → alertas críticos
- Todos os erros HTTP logados com: `correlationId`, endpoint, status code, mensagem

## Proibições Explícitas

- URLs hardcoded sem variável de ambiente
- Endpoints sem documentação OpenAPI
- Breaking changes sem nova versão
- Stack trace em respostas de produção
- Validação de input após efeitos colaterais
