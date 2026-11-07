# Agents — Índice de Subagents

Subagents especializados por domínio ou função. Use o agent correto para o contexto da sua tarefa — cada um tem conhecimento profundo de sua área.

## Como Usar

Em Claude Code, subagents são invocados automaticamente quando o contexto da tarefa corresponde à descrição do agent, ou manualmente via `@<nome-do-agent>`.

## Regra transversal — disciplina de ferramenta (agents que escrevem código/arquivos)

Todo agent com `Write`/`Edit` no `tools:` do front-matter carrega a seção **"Disciplina de ferramenta"** (idêntica, 4-6 linhas) logo no início do corpo: (a) sempre `Read` no arquivo imediatamente antes de `Edit`/`Write` — o estado "já li" não sobrevive a compactação de contexto nem a um subagente novo; (b) nunca rodar `docker build`/`docker compose up --build` — devolver ao orquestrador pedindo o build em background; (c) autoverificar com build/teste real antes de retornar. Ao criar um novo agent com essas ferramentas, copie a seção de um agent existente (ex.: `engineering/frontend-engineer.md`) em vez de reescrever.

## Regra transversal — conflito de fontes é bloqueante (todos os agents)

Vale para **todos** os agents (specification, architecture, review, coding, engineering): ao detectar um **conflito arquitetural relevante** entre fontes normativas (rule↔ADR, módulo↔módulo, change↔baseline), **pare e sinalize** — não "registre e siga". Resolva pela ordem de autoridade (`constitution > baseline/ADRs > rules > context`, FORGE.md §2.1) e escale via HITL quando a decisão for humana. Detalhe e exemplos em `.forge/rules/conventions/conflict-handling.md`. Esta é a mesma disciplina que os agents de engineering já adotam ("Pare e sinalize em conflito explícito"), agora obrigatória em todo o catálogo.

## Catálogo

### Arquitetura (`architecture/`)

| Agent | Quando Usar |
|---|---|
| [clean-architecture-reviewer](./architecture/clean-architecture-reviewer.md) | Revisar se um serviço/módulo segue Clean Architecture corretamente |
| [ddd-architect](./architecture/ddd-architect.md) | Segmentar domínios DDD a partir de PRD/FRD/NFRD/TRD: subdomínios, bounded contexts, ownership, módulos, deployables, diagramas C4 |
| [ddd-validator](./architecture/ddd-validator.md) | Validar criticamente artefatos DDD após o `ddd-architect`: subdomínios (Core/Supporting/Generic), bounded contexts, context map, linguagem ubíqua, ownership de dados, módulos, deployables, C4 e DDD tático (entidades, objetos de valor, agregados, eventos). Corrige diretamente quando seguro; emite parecer em `docs/product/ddd/ddd-validation-report.md` |
| [adr-writer](./architecture/adr-writer.md) | Criar ou revisar um ADR no formato MADR |
| [module-generator](./architecture/module-generator.md) | Gerar a estrutura `docs/product/modules/` a partir do DDD: README por módulo, diagramas de arquitetura, dependências, integrações e compliance (PCI DSS, LGPD) |
| [module-validator](./architecture/module-validator.md) | Validar criticamente `docs/product/modules/` após o `module-generator`: cobertura BC ↔ módulo, ownership de dados, grafo de dependências (sem ciclos, respeito a Context Map), integrações declaradas, mapeamento módulo ↔ deployable do TRD, compliance (PCI DSS, LGPD) e diagramas obrigatórios. Corrige diretamente quando seguro; emite parecer em `docs/product/modules/modules-validation-report.md` |

### Revisão de Código (`code-review/`)

| Agent | Quando Usar |
|---|---|
| [dotnet-reviewer](./code-review/dotnet-reviewer.md) | Revisar paths C#/.NET: roda antes o baseline de build (`dotnet-baseline.sh`) e a skill `dotnet-quality-scan`, e gasta julgamento só no que elas não decidem — domínio, EF Core, ciclo de vida de dependência, fronteira de camada |
| [node-reviewer](./code-review/node-reviewer.md) | Revisar paths Node/TypeScript: validação runtime, erros assíncronos, dependências e persistência |
| [java-reviewer](./code-review/java-reviewer.md) | Revisar paths Java: build existente, transações, persistência e contratos |
| [python-reviewer](./code-review/python-reviewer.md) | Revisar paths Python: tipos, concorrência, ambiente e persistência |

### Dados (`data/`)

Um orquestrador e seis especialistas consultivos, cada especialista com a skill `data-<domínio>-practices` pré-carregada (boas práticas com marca de evidência, catálogo de antipatterns e `scripts/scan.sh` determinístico). Os especialistas não têm `Write`, `Edit` nem `Agent`, e o `Bash` deles só roda o `scan.sh` da skill e o `check-data-governance.sh`, pelo hook `data-agent-bash-guard.sh` do frontmatter; o orquestrador só cria os seis, pelo hook `data-agent-allowlist.sh`. Em conflito com rule ou ADR do projeto, todos param e devolvem o bloco `CONFLITO` para decisão humana.

| Agent | Quando Usar |
|---|---|
| [data-engineer](./data/data-engineer.md) | Porta de entrada para qualquer decisão ou revisão de dados: classifica pelo padrão de acesso, delega aos especialistas e sintetiza; sem a ferramenta `Agent`, devolve um `PLANO DE ROTEAMENTO` |
| [data-relational](./data/data-relational.md) | Relacional OLTP: modelagem, índices, migração reversível, isolamento, locks, N+1, paginação, RLS e dinheiro em `BIGINT`; transacional de negócio só com ADR que escolheu SQL |
| [data-nosql](./data/data-nosql.md) | Documento, chave-valor persistente, coluna larga e grafo: padrão de acesso, chave de partição, consistência; o transacional de negócio da casa em MongoDB (`majority`, P-S-S) |
| [data-cache](./data/data-cache.md) | Cache: cache-aside, TTL, invalidação, stampede, eviction, segurança e namespace por tenant (Redis nunca é fonte de verdade) |
| [data-object-storage](./data/data-object-storage.md) | Object storage: layout de chaves, ciclo de vida, versionamento, WORM, criptografia, bucket público e URL pré-assinada nas restrições da regra do dono |
| [data-analytical](./data/data-analytical.md) | Analítico: modelagem dimensional, SCD, warehouse × lakehouse, particionamento e clustering de tabela, dbt e contratos |
| [data-streaming](./data/data-streaming.md) | Mensageria: RabbitMQ 4.x em profundidade, Kafka, outbox, CDC, saga, schema de evento com AsyncAPI e escolha de transporte interno × externo |

Projeção fora do Claude Code: no Claude Code os agentes e as skills chegam pelo adapter `claude`; fora dele, as skills `data-*-practices` só chegam a `.agents/skills/` com o adapter `agents-skills` ou `forge-cli`, e o adapter `codex` puro recebe só o `AGENTS.md`. Nessas ferramentas a porta de entrada é a seção de especialistas de dados do `AGENTS.md`: ler o orquestrador, produzir o `PLANO DE ROTEAMENTO`, ler o especialista e a skill em `.forge/skills/data-<domínio>-practices/`.

### Especificações de Módulo (`specifications/`)

> Aplicáveis a `docs/product/modules/<modulo>/` (convenção viva do <project_name>) e a `docs/spec/` quando aprovado por ADR.

| Agent | Quando Usar |
|---|---|
| [discovery-agent](./specifications/discovery-agent.md) | Conduzir discovery (greenfield, brownfield, nova feature ou refatoração): inspecionar workspace, conversar com o usuário em blocos estruturados (Visão → Funcionalidades → Monetização → Técnico → Contexto), registrar decisões e pontos a validar e gerar `discovery-notes.md` como insumo para o `prd-generator` |
| [prd-generator](./specifications/prd-generator.md) | Gerar `docs/product/prd/prd.md` a partir de jornadas, entrevistas e discovery notes (contexto + personas + escopo + RF/RNF + riscos + métricas) |
| [prd-validator](./specifications/prd-validator.md) | Validar criticamente `docs/product/prd/prd.md` contra `discovery-notes.md`, registrar achados em `docs/product/prd/prd-validation.md` e aplicar correções cirúrgicas mediante aprovação |
| [frd-generator](./specifications/frd-generator.md) | Gerar `docs/product/frd-nfrd/frd.md` a partir de `docs/product/prd/prd.md`: requisitos funcionais detalhados, casos de uso, regras, fluxos, mensagens, permissões, critérios de aceite e matriz de rastreabilidade PRD→FRD |
| [nfrd-generator](./specifications/nfrd-generator.md) | Gerar `docs/product/frd-nfrd/nfrd.md` a partir de `docs/product/prd/prd.md`: requisitos não funcionais (performance, disponibilidade, segurança, privacidade, compliance, observabilidade, escalabilidade, resiliência, operação) com rastreabilidade PRD→NFRD |
| [frd-nfrd-validator](./specifications/frd-nfrd-validator.md) | Validar criticamente FRD e NFRD contra o PRD: cobertura, rastreabilidade, qualidade dos requisitos, separação FRD/NFRD/TRD, atributos de qualidade, achados classificados por severidade e parecer final em `docs/product/frd-nfrd/frd-nfrd-validation-report.md` |
| [trd-validator](./specifications/trd-validator.md) | Validar criticamente `docs/product/trd/trd.md` contra PRD/FRD/NFRD/ADR/DDD/Modules/Data Model, **corrigir diretamente o TRD** quando o ajuste for seguro e derivado dos insumos, e registrar achados/ajustes em `docs/product/trd/trd-validation-report.md` |
| [requirements-writer](./specifications/requirements-writer.md) | Escrever ou revisar `requirements.md` de um módulo (Reqs numerados + PBTs + glossário) |
| [design-writer](./specifications/design-writer.md) | Escrever ou revisar `design.md` de um módulo (Clean Arch + DDD + DDL + endpoints + diagramas) |
| [tasks-writer](./specifications/tasks-writer.md) | Escrever ou revisar `tasks.md` de um módulo (TDD-first + PBT + bite-sized + ondas + tracker [ ]/[-]/[X]) |
| [product-backlog](./specifications/product-backlog.md) | Após o pipeline de especificação, ler todos os módulos e materializar Product Backlog em duas camadas: (a) markdown em `docs/product/backlog/` (product-backlog.md, sprints-planning.md, sprint-N-<slug>.md, progress-tracking.md) e (b) Jira Software via MCP Atlassian (projeto Scrum, épicos = módulos, user stories, tasks, bugs, sprints com objetivo de valor explícito, board kanban com 4 colunas TO DO / IN PROGRESS / IN REVIEW / DONE). Idempotente; markdown sempre primeiro; falhas de sync com Jira registradas em `progress-tracking.md` |

## Como Adicionar um Novo Agent

1. Crie o arquivo em `.forge/agents/<categoria>/<nome-em-kebab-case>.md`
2. Inclua o front-matter YAML: `name`, `description`, `tools`, `model`
3. Siga a estrutura: Missão → Checklist → Anti-Patterns Bloqueados → Quando Escalar
4. Atualize este índice
5. Se o agent depender de identidade do projeto (nome, repo, Jira key…), siga o protocolo na seção *Bootstrap de identidade* abaixo

---

## Bootstrap de identidade

Os agentes deste diretório são **portáveis**: o mesmo conjunto pode ser copiado para qualquer projeto sem edição. Em vez de hardcodar o nome do projeto, slug do GitHub, project key do Jira etc., usam **placeholders** resolvidos a partir de um bloco YAML canônico no `AGENTS.md` raiz do repositório.

### Placeholders convencionais

| Placeholder | Significado | Origem |
|---|---|---|
| `<project_name>` | Slug kebab-case do projeto | `AGENTS.md` YAML `project_name` |
| `<project_display>` | Nome para humanos | `AGENTS.md` YAML `project_display` |
| `<repo_slug>` | `owner/repo` no GitHub | `AGENTS.md` YAML `repo_slug` ou `gh repo view --json nameWithOwner -q .nameWithOwner` |
| `<default_branch>` | Branch principal | `AGENTS.md` YAML `default_branch` ou `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` |
| `<JIRA_KEY>` | Project key do Jira | `AGENTS.md` YAML `jira_key` ou `mcp__atlassian__getVisibleJiraProjects` |
| `<jira_site>` | Subdomínio Atlassian | `AGENTS.md` YAML `jira_site` |
| `<issuer>` | Issuer JWT exemplo | `AGENTS.md` YAML `issuer` |

### Protocolo obrigatório do agente

Antes de qualquer ação que use um desses placeholders, o agente deve executar:

1. **Ler o front-matter YAML do `AGENTS.md`** raiz do repositório (caminho: `./AGENTS.md`).
2. **Para cada campo necessário** que esteja **ausente ou vazio** no YAML:
   - Tentar **derivar automaticamente** via comando shell ou MCP (ver tabela acima).
   - Se a derivação automática falhar ou não for aplicável (ex.: `project_display`), usar **`AskUserQuestion`** para coletar o valor do usuário.
   - **Validar via teste de conectividade** quando aplicável:
     - `repo_slug` → `gh repo view <repo_slug>` (deve retornar 0)
     - `jira_key` → `mcp__atlassian__searchJiraIssuesUsingJql` com JQL `project = <jira_key>` (deve retornar lista, mesmo vazia)
   - **Persistir** o valor no YAML do `AGENTS.md` via `Edit` (preservando o resto do arquivo).
3. **Substituir todos os `<placeholder>`** no contexto da execução por `${campo}` lido do YAML.

### Idempotência

- Se todos os campos necessários já estão preenchidos, o passo (2) é skip.
- Se o usuário aprovou um valor anteriormente, não re-perguntar (já está no YAML).
- O bootstrap só dispara perguntas em projetos novos ou quando faltar metadata.

### Quem precisa do bootstrap

Apenas agentes que **realmente consomem** algum placeholder. Agentes de revisão pura (logic-reviewer, security-reviewer apenas em código, etc.) que só leem código não precisam.

A lista atual de agentes que executam bootstrap:

- `architecture/adr-writer`, `architecture/clean-architecture-reviewer`, `architecture/ddd-architect`
- `code-review/dotnet-reviewer`
- `coding/task-coder`, `coding/sprint-orchestrator`, `coding/deploy-orchestrator`
- `review/code-evaluator`, `review/security-reviewer`
- `specifications/product-backlog`, `specifications/requirements-validator`, `specifications/trd-generator`
