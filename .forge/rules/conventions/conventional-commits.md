---
title: Conventional Commits
applies_to:
  - all
priority: high
last_reviewed: 2026-05-08
---

# Conventional Commits

## Formato Obrigatório

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

## Types

| Type | Changelog | SemVer |
|------|-----------|--------|
| `feat` | [Feature] | MINOR |
| `fix` | [Fix] | PATCH |
| `perf` | [Fix] | PATCH |
| `docs` | — | — |
| `style` | — | — |
| `refactor` | — | — |
| `test` | — | — |
| `build` | — | — |
| `ci` | — | — |
| `chore` | — | — |
| `revert` | — | — |

Apenas `feat`, `fix` e `perf` geram entradas no changelog público.

## Scopes (alinhados aos projetos do `.sln` + áreas transversais)

| Scope | Área |
|-------|------|
| `domain` | `Domain.csproj` |
| `application` | `Application.csproj` |
| `infrastructure` | `Infrastructure.csproj` |
| `server` | `Server.csproj` / `Internal.Server.csproj` |
| `client` | `Client.csproj` |
| `data` | `Data.csproj` |
| `dataimport` | `DataImport.csproj` |
| `lambdas` | `Lambda.csproj`, `CieloParameters.Lambda`, `CieloSchedule.Lambda` |
| `tests` | qualquer projeto sob `tests/` |
| `deploy` | `deploy/`, buildspecs, IaC |
| `docs` | docs gerais |
| `adr` | mudanças em `docs/product/adr/` |
| `glossary` | mudanças em `docs/product/glossary/` |
| `specs` | mudanças em `docs/product/modules/` |
| `ci` | GitHub Actions, hooks |
| `deps` | bumps de pacotes |
| `infra` | infraestrutura geral (Dockerfile, scripts) |
| `security` | hardening, fixes de vulnerabilidade |
| `release` | releases, CHANGELOG |
| `baseline` | PRs de governance/setup inicial cobrindo várias áreas |
| `plans` | mudanças em `plans/` |
| `polish` | PRs de refinamento/correção pós-PR cobrindo várias áreas |
| `design-system` | mudanças transversais em `packages/{design-tokens,icons,ui-components}` ou docs do design system |
| `design-tokens` | mudanças em `packages/design-tokens/` (cores, tipografia, espaçamento, motion, fontes) |
| `ui-components` | mudanças em `packages/ui-components/` (componentes React, Storybook, testes) |
| `icons` | mudanças em `packages/icons/` (Lucide wrapper, brand mark, assets de logo) |

A lista canônica vive em `.commitlintrc.json` — atualizar os dois arquivos juntos quando houver mudança.

Scope em lowercase, sem espaços.

## Subject

- Máximo 72 caracteres
- Lowercase
- Sem ponto final
- Modo imperativo em **pt-BR**: "adicionar", não "adicionado"; "corrigir", não "corrigido"

## Body (Opcional)

- Separado do subject por linha em branco
- Máximo 100 caracteres por linha
- Explica o *porquê* e o *como*, não o *o quê*

## Breaking Changes

Indicar de **duas** formas:

```
feat(server)!: remover suporte a TLS 1.2

BREAKING CHANGE: TLS 1.2 descontinuado. Clientes devem migrar para TLS 1.3.
```

Breaking changes incrementam versão MAJOR.

## Exemplos Corretos

```
feat(domain): adicionar aggregate Transaction
fix(infrastructure): corrigir timeout no DynamoDB
docs(adr): adicionar ADR 0001 sobre adoção de .NET 10
chore(deps): atualizar AWSSDK.Core para 3.7.400
ci(ci): adicionar cache de NuGet no workflow de build
```

## Exemplos Incorretos

```
feat(auth): Add new endpoint    # inglês
fix: corrigir bug.              # ponto final; scope ausente
Update code                     # sem type; inglês; genérico
feat(backend): adicionar rota   # scope genérico (use lista canônica)
```

## Commits Atômicos

Cada commit representa **uma** mudança lógica. Não misturar types diferentes no mesmo commit.

## Validação

- `commitlint` valida em pre-commit hook e em CI
- Configuração em `.commitlintrc.json` na raiz do monorepo
- Branch malformada bloqueada pelo workflow `guardrail-naming.yml`

## Proibições Explícitas

- Subject em inglês
- Subject > 72 caracteres ou com ponto final
- Breaking change sem footer `BREAKING CHANGE:`
- Mensagens genéricas ("fix bug", "update", "wip")
- Múltiplos tipos de mudança no mesmo commit
- **Qualquer trailer que atribua o trabalho a uma ferramenta de IA** (`Claude-Session:`, `Co-Authored-By: Claude`, `🤖 Generated with`) — ver [no-ai-attribution](./no-ai-attribution.md), que é a rule canônica do tema e vale também para PR, issue e release notes. Verificado por `check-ai-attribution.sh` nos hooks `commit-msg` e `pre-push`.
