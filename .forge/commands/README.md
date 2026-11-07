# Commands — Índice de Slash Commands

Slash commands que automatizam tarefas recorrentes neste repositório (o nome do projeto vem do bloco YAML do `AGENTS.md` raiz — ver `.forge/agents/README.md#bootstrap-de-identidade`).

## Como Usar

No Claude Code, digite `/` seguido do nome do command. Argumentos são passados na mesma linha.

## Catálogo

| Command | Argumentos | Descrição |
|---|---|---|
| `/forge:new-adr` | `<title>` | Cria novo ADR com numeração sequencial em `docs/product/adr/` |
| `/forge:red` | `init\|record\|replay\|waive\|status <change-id> [flags]` | Protocolo Red-first de correção de defeito — declara o teste que reproduz o bug, roda o motor de replay real e observa a falha, ou dispensa com motivo tipado (só `type: bugfix`) |
| `/forge:scaffold-tdd` | `<test-name>` | Gera esqueleto de teste xUnit Red-Green-Refactor com AAA |
| `/forge:update-changelog` | `<component> <type> <description>` | Atualiza CHANGELOG seguindo Keep a Changelog |
| `/forge:specs-loop` | `[--skip-approved]` | Loop autônomo de especificação de módulos em `docs/product/modules/`, orquestrando os 3 agents (`requirements-writer`, `design-writer`, `tasks-writer`); idempotente |
| `/forge:run-spec-pipeline` | `[--mode] [--strategy] [--modules] [--discovery-mode]` | Pipeline ponta-a-ponta (Discovery → PRD → FRD/NFRD → DDD → Modules → TRD → req/design/tasks por módulo) executado de forma autônoma até o **primeiro HITL gate** (validação humana dos `tasks.md`). Backlog/Jira só após aprovação |

## Adiados (Wave 2 ou contexto-específico)

| Command | Motivo |
|---|---|
| `/new-service` | Wave 2.6 do plano — presupõe estrutura nova de microsserviço (Clean Arch + tests + runbook) que ainda não existe |
| `/new-subchart` | Não aplicável — <project_name> não usa Helm atualmente |

## Detalhes

- [new-adr](./docs/new-adr.md)
- [red](./testing/red.md)
- [scaffold-tdd](./testing/scaffold-tdd.md)
- [update-changelog](./docs/update-changelog.md)
- [specs-loop](./specs/specs-loop.md)
- [run-spec-pipeline](./specs/run-spec-pipeline.md)
