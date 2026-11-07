---
title: Revisão de migration por especialista
applies_to:
  - relational-database
  - migrations
priority: high
last_reviewed: 2026-10-31
based_on: []
---

# Revisão de migration por especialista

Esta rule complementa `schema-evolution.md` (como migrar: expand/migrate/contract) e `data-config-sql.md` (RLS obrigatório, `tenant_id`, exceção só por ADR/registro formal) — não repete o "como migrar", exige **revisão** antes do merge.

## Quando se aplica

Todo PR que tocar arquivo de migration, identificado por convenção de path: `db/migrate/**`, `db/migrations/**`, `migrations/**` (dbmate, Rails, node-pg-migrate), `**/Migrations/*.cs` (EF Core), `src/main/resources/db/migration/**` (Flyway), `alembic/versions/**` (Alembic).

## Quem revisa

A revisão especializada é feita pelo agente `data-engineer` ou pelo especialista `data-relational`, executada sobre um **clone da head do PR** — nunca sobre a branch local do autor. Como o gate do `pre-push` exige a evidência no mesmo push que publica a migration, antes do primeiro push a "head do PR" é o commit head da branch, materializado num clone limpo (ex.: `git clone --no-local <repo> <dir> && git -C <dir> checkout <sha>`), nunca a árvore de trabalho do autor; a linha de evidência entra num commit da própria branch e sobe junto com a migration. **Quem clona a head do PR e entrega o path ao especialista é o orquestrador/pipeline que conduz o PR**, nunca o próprio agente especialista: `data-relational` só tem `Bash` liberado para `scan.sh` e `check-data-governance.sh --path` (`data-agent-bash-guard.sh`), não para `git clone`/`gh pr checkout`. O especialista revisa por `Read`/`Grep`/`Glob` sobre o path já materializado; rodar `check-migration-review.sh` não é responsabilidade dele — é um gate separado, rodado pelo orquestrador/CI.

A revisão de código geral (code review padrão do PR) **não substitui** esta revisão especializada.

## Checklist (13 itens)

1. Cabeçalho da migration com fase (`expand`\|`contract`\|`data`), referência de issue, role de dono e `lock_timeout`/`statement_timeout` declarados.
2. RLS com `ENABLE` e `FORCE` em toda tabela com chave de tenant, política restrita à role do serviço, `NULLIF(current_setting(...), '')` no predicado, ou exceção formal com prazo — a exceção de RLS segue o mecanismo de `data-config-sql.md` (ADR ou registro formal), não o mecanismo mais leve da seção "Exceção" abaixo; o PR referencia esse ADR/registro.
3. Nenhuma política para `PUBLIC`; o serviço fixa o GUC de tenant dentro da transação (`SET LOCAL`/`set_config(..., true)`), nunca GUC de sessão com pool.
4. Privilégio mínimo: `GRANT` por tabela à role do dono, sem `BYPASSRLS`, sem `ON ALL TABLES` e sem `ALTER DEFAULT PRIVILEGES` de grupo.
5. Chave única de negócio sempre prefixada pelo `tenant_id` (nunca índice único global sobre CPF/CNPJ/e-mail).
6. Índice em tabela existente com `CREATE INDEX CONCURRENTLY` em arquivo de migration próprio (nunca junto de outro DDL transacional); constraint com `NOT VALID` seguido de `VALIDATE CONSTRAINT` em migrations separadas.
7. Nenhuma FK entre tabelas de donos/serviços diferentes; nenhum `ON DELETE CASCADE` sobre dado financeiro ou de identidade.
8. Dinheiro em inteiro de centavos — referencia `rules/domain/money-as-cents.md` (não redige a regra de novo).
9. Coluna sensível classificada no mesmo PR: quando existir `data-classification.json` no projeto, é a autoridade sobre quais colunas são PAN/PII (mesma convenção do `data-relational`); hash de identificador só com HMAC chaveado (chave em KMS), nunca hash sem chave.
10. Backfill e expurgo com commit por lote, idempotentes e com retomada após falha — referencia `rules/data/schema-evolution.md` §"Migrate/backfill" (não redige a regra de novo); proíbe expurgo em bloco único (`DO $$` sem lotes) sobre tabela grande.
11. Contract só depois do expand promovido (todos os produtores/consumidores migrados); `down` que destruiria dado recusa execução, exigindo exceção explícita.
12. Tabela append-only revoga `UPDATE`, `DELETE` e `TRUNCATE` da role de aplicação e usa trigger de proteção com `ENABLE ALWAYS` (não desativável por `SET session_replication_role`).
13. Suíte de integração com RLS ligado provando três casos: (a) positivo — tenant correto lê suas linhas; (b) outro tenant — zero linhas; (c) GUC de tenant vazio/ausente — zero linhas e escrita recusada.

## Evidência

O parecer é registrado em `migration-review.md` na raiz do repositório (ou `--evidence <path>` quando ad-hoc), uma linha por migration: `- [x] <path-da-migration>` (revisada, com texto livre opcional depois do path, ex.: o sha revisado) ou a linha de exceção descrita abaixo. A evidência vale para o conteúdo revisado, não para o path para sempre: o gate só aceita a linha que foi **adicionada ou alterada no próprio push** que toca a migration. Uma linha deixada por um PR anterior não cobre uma edição nova da mesma migration — migration alterada exige parecer novo, registrado atualizando a linha (por exemplo, trocando o sha revisado). Remoção, rename ou revert de migration também conta como toque: o push que remove ou move a migration traz uma linha adicionada para o path antigo (ex.: `- [x] <path> removida, revisada`).

## Exceção

Quando um item do checklist não puder ser atendido, a exceção é registrada **por item**, no arquivo de evidência (`migration-review.md` na raiz do repositório, ou `--evidence <path>` quando ad-hoc), com o id/link do backlog que resolve a pendência — nunca uma exceção genérica para o PR todo. Exceção tácita (sem registro) e exceção de PR inteiro sem apontar o item específico (1 a 13) são proibidas.

O prazo da exceção é o do próprio item de backlog referenciado (`backlog=<ref>`) — sem campo de prazo redundante na linha de evidência. A linha de evidência segue o formato `- [exception] <path-da-migration> item=<1-13> backlog=<ref>`, **nesta ordem exata** (`item=` antes de `backlog=` antes de `adr=`) — a ordem é rígida porque o parser do gate mecânico casa a linha por regex posicional; uma linha com `backlog=`/`adr=` antes de `item=` não casa e é tratada como evidência ausente, não como erro explícito.

Para o item 2 (RLS), a exceção exige também citar o ADR/registro formal que `data-config-sql.md` já cobra, além do backlog, na forma `item=2 backlog=<ref> adr=<ref>`.

## Gate mecânico (opcional, recomendado)

Um gate mecânico (`check-migration-review.sh`) chega junto com `npx forge-harness update` (script + bloco dedicado no `pre-push`) e reporta ausência de evidência de parecer de revisão. Esta rule vale **como norma** mesmo em projeto com harness mais antigo, sem o gate — a ausência do script não dispensa a revisão especializada nem o registro de exceção descritos acima.
