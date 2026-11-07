---
title: Permissões JWT — Checklist e Lição Aprendida
applies_to:
  - backend
  - frontend
priority: high
last_reviewed: 2026-07-20
---

# Permissões JWT — Checklist e Lição Aprendida

## Claims são insumo do PEP, nunca o mecanismo de decisão

A claim `permissions` do JWT é **dado de contexto** — o PEP a extrai e repassa ao PDP como parte do
`input` da avaliação de autorização; ela **não é** o veredito. Ver `authz-pdp-pep.md` para o padrão
completo (PDP/PEP, deny-by-default, fail-closed). Duas consequências práticas para este checklist:

- Checar a claim diretamente no handler/componente (`if claims.permissions.includes(...)`) para
  decidir acesso é o mesmo anti-padrão de decisão imperativa fora do PDP — mesmo quando a claim
  está corretamente populada. A claim alimenta o PDP; quem decide é a política.
- Claim `permissions` ausente/vazia (o problema descrito abaixo) é uma falha de **insumo**: o PEP
  fica sem contexto suficiente para montar a decisão e deve falhar fechado (deny), nunca degradar
  para uma checagem alternativa ad hoc no código de negócio.

## Problema Recorrente

Toda vez que uma feature depende de RBAC, o mesmo problema reaparece: o JWT não inclui as claims de `permissions`, causando falhas em cascata no frontend e nos testes E2E.

### Causa Raiz

O `RoleRepository` busca roles do usuário durante o login. As permissões dos roles ficam em tabela separada (`role_permissions`) e precisam ser carregadas explicitamente via `LoadPermissionsAsync()`. Quando não carregadas, `role.Permissions` retorna coleção vazia — o JWT é emitido sem nenhuma claim `permissions`.

**Impacto:** o hook `usePermissions()` no frontend extrai `permissions` do JWT. Com array vazio, `hasPermission('voyages:write')` retorna `false` para todos os roles, inclusive admin. Botões de ação somem, funcionalidades de escrita ficam inacessíveis.

## Checklist Obrigatório para Features com RBAC

Antes de considerar a feature funcional:

- [ ] `RoleRepository` chama `LoadPermissionsAsync()` antes de gerar o token
- [ ] JWT decodificado (jwt.io) contém a claim `permissions` com valores esperados
- [ ] Endpoint de sessão retorna `permissions` no payload
- [ ] `usePermissions()` retorna as permissões esperadas no console do browser
- [ ] Após qualquer alteração no auth-service: rebuild do container Docker
- [ ] Health check do auth-service passando antes de testar
- [ ] StorageState dos testes E2E regenerados (sessões antigas têm JWT sem permissões)

## Como Diagnosticar

Se botões de ação não aparecem na UI:

1. DevTools → Network → request para o endpoint de sessão
2. Verificar se a resposta contém `"permissions": [...]` com valores
3. Se `permissions` está vazio ou ausente → problema no JWT, não no componente React
4. Decodificar o cookie de sessão em jwt.io para confirmar

## Arquivos Relevantes (Monorepo Definitivo)

- `services/auth-service/src/Infrastructure/Repositories/RoleRepository.cs` — `LoadPermissionsAsync()`
- `services/auth-service/src/Infrastructure/Services/JwtService.cs` — `GenerateTokenWithDetails()`
- `services/auth-service/src/Application/UseCases/Auth/LoginUseCase.cs`
- Hooks de permissão em cada app frontend — `use-permissions.ts`

## Princípio

Se o frontend não mostra um botão que deveria estar visível, o primeiro lugar para investigar é o JWT — não o componente React.

Permissões ausentes no JWT são a causa #1 de features "quebradas" após deploy.
