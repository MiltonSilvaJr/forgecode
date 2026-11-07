---
name: coding-status
description: |
  Resumo do progresso de codificação de um ou todos os módulos deste projeto. Lê `docs/product/modules/<modulo>/PROGRESS-TRACKING.md`, calcula contadores `[ ]/[-]/[X]/[!]` por onda, status do PR no GitHub (via `gh`) e — quando MCP atlassian disponível — estado das issues Jira correspondentes. Sem flags = agrega todos os módulos. Apenas leitura.
arguments:
  - name: modulo
    description: "Slug do módulo (ex. payment-processing). Se omitido, agrega todos os módulos em `docs/product/modules/`."
    required: false
  - name: --jira-sync
    description: "Força re-sincronização do estado Jira para o módulo via MCP atlassian (corrige drift). Não-destrutivo no tracker — apenas reporta divergências."
    required: false
---

# /forge:coding-status

Reporta o estado do harness de codificação por módulo.

## Sem flags — visão agregada

Quando invocado sem argumento, lê **todos** os `docs/product/modules/*/PROGRESS-TRACKING.md` e produz tabela executiva:

```
Coding Status — ${project_name} (2026-05-10 23:55)

| Módulo                 | Waves | Concluídas | Em progresso | Bloqueado | PR ativo |
|------------------------|-------|------------|--------------|-----------|----------|
| payment-processing     | 4     | 2 ✅       | 1 🔄         | 0 ⚠️       | #1234    |
| billing-engine         | 3     | 3 ✅       | 0            | 0         | -        |
| transaction-processing | 5     | 4 ✅       | 0            | 1 ⚠️       | -        |
| device-management      | 3     | 0          | 1 🔄         | 0         | -        |

✅ Concluídas: 9 ondas (5 módulos)
🔄 Em progresso: 2 ondas
⚠️ Bloqueadas (TASKs `[!]`): 1 onda
📝 PRs abertos com `auto-review`: 1
```

## Com `<modulo>` — visão detalhada

```bash
/forge:coding-status payment-processing
```

```
Coding Status — payment-processing (2026-05-10 23:55)

Status: Wave 3 em revisão; Wave 4 pendente

╔═══════════════════════════════════════════════════════════════╗
║  Wave 1 — Domain bootstrap            ✅ DONE   (TASK-01..08) ║
║  Wave 2 — Money & arithmetic          ✅ DONE   (TASK-09..30) ║
║  Wave 3 — Money & Split               🔄 REVIEW (TASK-31..37) ║
║  Wave 4 — Payment aggregate           ⏳ PENDING                ║
╚═══════════════════════════════════════════════════════════════╝

Wave 3 — Money & Split

- [X] TASK-31 — Money.Of factory                    [backend-dotnet]  abc1234
- [X] TASK-32 — Money.Add property test             [backend-dotnet]  def5678
- [X] TASK-33 — Money.Subtract property test        [backend-dotnet]  ghi9012
- [X] TASK-34 — Money.Split                         [backend-dotnet]  jkl3456
- [X] TASK-35 — Money.CalculateFee                  [backend-dotnet]  mno7890
- [X] TASK-36 — Repository<Money> tests             [backend-dotnet]  pqr1234
- [X] TASK-37 — Money.Split PBT FsCheck             [backend-dotnet]  stu5678

PR: https://github.com/${repo_slug}/pull/1234
   Status: code-evaluator REJECTED (round 2/3, 1 BLOCKER SEC-001)
   Aguardando: correção do FSE em round 3

Jira sync:
   ✅ <JIRA_KEY>-450..<JIRA_KEY>-456 — In Review (7 issues)

Deploy log:
   dev: pendente (aguardando PR mergeado)
   stg: pendente
   prd: pendente

Próximas ações:
   1. Aguardar code-evaluator round 3 (FSE corrigindo SEC-001)
   2. Após APPROVED, mergear PR
   3. /forge:deploy-wave payment-processing dev
```

## Com `--jira-sync`

Cruza o tracker local com o Jira via MCP atlassian e reporta divergências:

```
/forge:coding-status payment-processing --jira-sync

Sincronizando com Jira via MCP atlassian...

✅ <JIRA_KEY>-450 (TASK-31): tracker=[X] · Jira=In Review · sincronizado
✅ <JIRA_KEY>-451 (TASK-32): tracker=[X] · Jira=In Review · sincronizado
...
⚠️ <JIRA_KEY>-456 (TASK-37): tracker=[X] · Jira=Done · divergência (Jira já em Done? deploy prd?)

7/7 issues encontradas no Jira.
1 divergência detectada — investigue manualmente.
```

Apenas reporta. **Não modifica** estado em Jira nem no tracker (use `sprint-orchestrator` ou `deploy-orchestrator` para mutar).

## Quando usar

- **Diariamente**: visão agregada do estado do projeto.
- **Antes de invocar `/forge:coding-loop`**: confirmar qual módulo/onda está pronto.
- **Após falha**: ver o bloco "Última falha" estruturado — agora acumulativo (uma entrada por ocorrência, nunca sobrescrita), com `Premissa:`/`Ator(es) com o desequilíbrio:` a partir da 2ª ocorrência consecutiva do mesmo par (TASK, Gate) desde a última retomada informada (receita "Premissa nomeada" em `.forge/skills/gate-runner/SKILL.md`).
- **Auditoria de sprint**: cruzar com Jira via `--jira-sync`.

## Saída em formato JSON

Use `--format json` para output programático:

```bash
/forge:coding-status payment-processing --format json
```

Retorna estrutura serializada para consumo por outros agentes/scripts.

## Referências

- `.forge/agents/coding/task-coder.md` (gera o tracker)
- `.forge/agents/coding/sprint-orchestrator.md` (atualiza tracker quando PR abre)
- `.forge/agents/coding/deploy-orchestrator.md` (atualiza tracker pós-deploy)
- `.forge/commands/coding/coding-loop.md`
- `.forge/commands/coding/deploy-wave.md`
