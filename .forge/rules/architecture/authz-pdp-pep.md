---
title: Autorização — PDP/PEP, deny-by-default, fail-closed
applies_to:
  - backend
  - platform
priority: high
last_reviewed: 2026-07-20
based_on: []
pack: authz
opt_in: true
---

# Autorização — PDP/PEP, deny-by-default, fail-closed

## Padrão PDP/PEP

Toda decisão de autorização (RBAC/ABAC) é separada em dois papéis explícitos:

- **PDP (Policy Decision Point)** — avalia a política e decide `permit`/`deny`. É o único lugar
  onde a regra de negócio de autorização existe. Não fica espalhado em `if`s pelo código de domínio.
- **PEP (Policy Enforcement Point)** — intercepta a requisição, monta o contexto da decisão
  (subject, action, resource, environment), consulta o PDP e **aplica** o resultado. O PEP nunca
  decide sozinho; ele delega ao PDP e apenas executa o veredito.

Um handler/controller que embute a lógica de permissão (`if user.role == "admin"`) fora do PEP é
**decisão imperativa fora do PDP** — o anti-padrão que esta rule existe para banir. A decisão de
autorização precisa ser centralizável, testável e auditável fora do código de negócio.

## Substrato recomendado

> Decisão de referência do harness registrada no **ADR-0002** (`authz-observability-substrate`) do repositório forge-harness. Esta rule é uma convenção do template (`based_on: []`, guardrail G3 — o template não traz ADRs); ao adotar a capability, o projeto ancora esta decisão num ADR próprio via `/forge:adr` e passa a usar `based_on: [ADR-NNNN]`.

- **OPA/Rego** é o substrato principal de PDP para RBAC/ABAC — política declarativa, deny-by-default
  expressável de forma literal, padrão de mercado para PDP externo ao código de negócio.
- **OpenFGA** é o **runner-up**, reservado a cenários de **ReBAC** (compartilhamento por objeto —
  ex.: "usuário X vê a fatura Y porque pertence ao mesmo tenant"), quando RBAC/ABAC puro não modela
  bem a relação. OpenFGA **complementa** o OPA num boundary específico; não o substitui como PDP
  principal.
- Ver `.forge/product/current/adr/0002-authz-observability-substrate.md` para o contexto completo
  da decisão, as alternativas descartadas (Cedar, enforcement imperativo) e a fronteira PCI.

## Deny-by-default / fail-closed (sempre enforce)

- Toda política Rego começa com `default allow = false` (ou equivalente `deny`) — a ausência de
  regra que autorize explicitamente **é** a negação. Nunca o inverso (`default allow = true` com
  exceções).
- Falha do PDP (timeout, erro, indisponibilidade) **é negação**, nunca liberação — fail-closed, não
  fail-open. Um PEP que trata erro de avaliação como "permitir e seguir" é uma falha de segurança
  crítica.
- Este é um invariante **inegociável**: o gate estático correspondente (`check-authz.sh`) trata
  deny-by-default como violação sempre em `mode: enforce`, independentemente do `mode: warn` global
  de adoção do repositório (coerente com a constitution, item 7).

## Claims JWT são insumo, nunca o mecanismo de decisão

O `auth-service` (ver `jwt-authentication.md`) emite o JWT e é responsável por **autenticação**
(PCI DSS Req 8 — fora do escopo desta rule). O que o PEP faz com o JWT é distinto:

- As claims do JWT (`sub`, `roles`, `permissions`, `tenant_id`, etc.) são **dado de contexto** que
  o PEP extrai e repassa ao PDP como parte do input da avaliação — nunca o veredito em si.
- **Nunca** decidir autorização checando a claim diretamente no handler (`if claims.role ==
  "admin"`) — isso é o mesmo anti-padrão de decisão imperativa fora do PDP, apenas com um insumo
  diferente. A claim entra no `input` do Rego; a política Rego decide.
- Ver `jwt-permissions.md` — claims ausentes/incompletas no JWT são um problema de **insumo** (o
  PEP não tem contexto suficiente para montar a decisão) e devem falhar fechado (deny), nunca
  degradar para uma checagem alternativa no código de negócio.

## A tríade anti-falso-negativo (import ≠ aplicação)

Um gate estático que prova que um boundary **importa** o PEP não prova que a rota está de fato
**protegida** — o falso-negativo estrutural mais perigoso deste domínio (import ≠ aplicação). Por
isso a garantia nunca depende de um único mecanismo:

1. **Gate estático** — prova alcançabilidade (reachability) do boundary `layer:api` até um node
   `roles:pep` no grafo de código.
2. **Teste de contrato negativo** — cada endpoint declarado em `authz-map` exige
   `negative_contract_test: {unauthenticated_401, forbidden_403}` — prova em runtime que o veredito
   `deny` é de fato aplicado, não só importado.
3. **Evidência de decision-log** — o CI do consumidor produz evidência de que o PDP foi
   efetivamente consultado (decision-log do OPA), sujeita ao mesmo regime anti-PII/PAN do
   `check-data-governance` (nunca logar o `input` bruto sem mascaramento).

Nenhuma dessas três pernas, isolada, é suficiente. A ausência de qualquer uma é lacuna de cobertura,
não conformidade parcial.

## Limitação conhecida

O gate `check-authz.sh` detecta deny-by-default e decisão imperativa fora do PEP por **regex sobre
o padrão estrutural do texto** (`.rego`, `.go`, `.kt`, `.ts`), não por parsing semântico real de
Rego (AST). Cobre o anti-padrão literal; não substitui `opa test`/`opa eval` do consumidor para
correção semântica da política.

## Anti-padrões (bloqueantes)

- Checagem de permissão (`if`/`switch` sobre role ou claim) dentro de handler/controller/use case,
  fora do PEP.
- `default allow = true` (ou equivalente) em qualquer política Rego.
- PEP que trata erro/timeout do PDP como "permitir e seguir" (fail-open).
- Endpoint em `authz-map` sem `negative_contract_test`.
- Log do `input`/decision-log do PDP sem mascaramento de PAN/PII.

## Cross-reference

- `jwt-authentication.md` — como o JWT é emitido e validado (Req 8, fora de escopo desta rule).
- `jwt-permissions.md` — claims de `permissions` como insumo do PEP; checklist de diagnóstico.
- `security-and-compliance.md` — RBAC como controle obrigatório; fronteira LGPD/PCI.
- `domain/audit-immutability.md` — imutabilidade do audit trail que sustenta a evidência de
  decision-log.
