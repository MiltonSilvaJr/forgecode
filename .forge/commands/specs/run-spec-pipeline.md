---
name: run-spec-pipeline
description: |
  Executa o pipeline completo de especificação (Discovery → PRD → FRD/NFRD → DDD → Modules → TRD → req/design/tasks por módulo) de forma autônoma, do zero até o **primeiro HITL gate**: validação humana dos `tasks.md` de todos os módulos especificados. Backlog + Jira só após aprovação humana. Idempotente — pode ser re-executado sem duplicar artefatos. Auto-aprova correções dos validators que sejam derivadas dos insumos. Sequencializa Fase 7 para evitar alucinação de path em paralelismo.
arguments:
  - name: --mode
    description: Modo de iniciativa. Valores aceitos `greenfield`, `brownfield`, `feature`, `refactor`. Default `brownfield` se workspace tem `docs/product/`, senão `greenfield`.
    required: false
  - name: --strategy
    description: Estratégia de regeneração. `incremental` (pula fases cujos artefatos já estão aprovados) ou `full-rerun` (re-executa tudo, bumpa versões). Default `incremental`.
    required: false
  - name: --modules
    description: "Lista de módulos para Fase 7 separada por vírgula (ex.: `identity-access,transaction-processor`). Se omitido, especifica TODOS os módulos do `module-generator`. Para smoke test use 3-5 módulos do Tier 1."
    required: false
  - name: --discovery-mode
    description: "`interactive` (Q1-Q11 com humano) ou `auto-extract` (sessão principal extrai do workspace). Default `auto-extract` se Brownfield, `interactive` se Greenfield."
    required: false
---

# /forge:run-spec-pipeline

Pipeline autônomo de especificação ponta-a-ponta. Para no `tasks.md` de cada módulo aguardando validação humana — primeiro e único HITL gate antes de virar Jira/código.

> **Regra inviolável:** documentos gerados por IA SEMPRE saem em status `Rascunho para revisão`. Promoção para `Aprovado para desenvolvimento` é decisão humana. Pipeline NÃO toca Jira sem aprovação humana dos tasks.md.

> **Conflito de fontes é bloqueante (`conflict-handling.md` G1):** se durante o pipeline dois módulos divergirem numa decisão transversal (ex.: isolamento multi-tenant), ou uma rule contradisser um ADR aceito, **PARE** — não "registre e siga para tasks". Resolva pela precedência (FORGE.md §2.1: ADR vence rule em drift) e escale via HITL. Seguir com a inconsistência aberta é o anti-padrão que originou este guardrail.

---

## Change ativo (scale 4) — operação dentro do change

Se existir um change ativo em `.forge/specs/active/<change-id>/` com `scale: 4` no manifest, o pipeline amplo opera **dentro do change**, não mais em `docs/product/` direto:

Antes de uma rodada longa, emita o budget preflight:

```bash
bash .forge/scripts/budget-preflight.sh --stage run-spec-pipeline --change <change-id> --profile regulated --outputs proposal.md,requirements.md,design.md,tasks.md
```

Ao concluir uma rodada automatizada dentro de um change ativo, grave `run-manifest/v1` em `evidence/runs/*/run-manifest.json`.

1. Os artefatos desta execução vão para `.forge/specs/active/<change-id>/product/` (mesma subestrutura: `prd/`, `frd-nfrd/`, `ddd/`, `trd/`, `modules/`...). Ao invocar cada agent, **declare explicitamente no payload** o path-base do change como destino de escrita.
2. **Verificação pós-fase (obrigatória):** os agents legados têm `docs/product/` arraigado — após cada fase, confira onde o artefato foi gravado; se caiu em `docs/product/`, **mova** para o path do change e registre o desvio em uma linha. (Os agents passam a operar o baseline corretamente no MVP3.)
3. `docs/product/` permanece como **estado vigente para leitura** (baseline provisório até o MVP3); a incorporação dos artefatos do change ao baseline acontece via `/forge:archive` (MVP3) — nunca manualmente.
4. Sem change ativo (ou scale < 4), siga o caminho canônico legado abaixo.

## Caminho canônico

Todos os artefatos vão em `docs/product/`:

```
docs/product/
├── prd/                            prd.md + prd-validation.md
├── frd-nfrd/                       frd.md + nfrd.md + frd-nfrd-validation-report.md
├── ddd/                            ddd-segmentation.md + bounded-contexts/ + subdomains/{core,supporting,generic}/ + context-map/{README,relations,patterns,diagram}.md + diagrams/c4-level-{1,2,3}-*.md + ddd-validation-report.md
├── data-model/data-model.md
├── modules/                        <modulo>/{README,requirements,design,tasks}.md + diagrams/ (com index.html) + modules-validation-report.md
├── trd/trd.md                      trd.md + trd-validation-report.md
├── glossary/{domain-glossary,ubiquitous-language}.md
├── adr/                            ADRs MADR
└── backlog/                        ⚠️ vazio até HITL aprovar
```

Discovery vai em `docs/discovery/discovery-notes.md` (um `discovery-notes.md` legado na raiz é lido como fallback).

⚠️ **NUNCA** use `.kiro/specs/` ou `docs/specs/`. Caminho canônico é `docs/product/modules/<modulo>/`. Se encontrar referências antigas, purgar via sed antes de iniciar pipeline.

---

## Pré-requisitos

- Branch dedicada: `git checkout -b test/pipeline-full-spec` (não trabalhe em main/master)
- `.forge/agents/` populado com 16 agentes: discovery-agent, prd-generator, prd-validator, frd-generator, nfrd-generator, frd-nfrd-validator, ddd-architect, ddd-validator, module-generator, module-validator, trd-generator, trd-validator, requirements-writer, design-writer, tasks-writer, adr-writer
- `.forge/rules/` populado com conventions/architecture/domain/testing rules
- MCP Atlassian autenticado (somente para Fase 8 pós-HITL — não bloqueia o pipeline em si)

---

## Fluxo

```
Fase 0 — Pré-setup (branch + TaskList)
   ↓
Fase 1 — Discovery (auto-extract OU interativo Q1-Q11)
   ↓
Fase 2 — PRD (generator + validator com auto-aprovar derivados)
   ↓
Fase 3 — FRD + NFRD (generators em paralelo) + frd-nfrd-validator
   ↓
Fase 4 — DDD (architect + validator)
   ↓
Fase 5 — Modules (generator + validator)
   ↓
Fase 6 — TRD (generator + validator)
   ↓
Fase 7 — Specs por módulo (SEQUENCIAL com verificação ls)
        Para cada módulo (ordem por dependência: Generic → Supporting → Core):
            requirements-writer → ls → design-writer → ls → tasks-writer → ls
   ↓
🛑 HITL #1 — Aprovação humana dos tasks.md
   ↓
[bloqueado até "tasks aprovadas, prossiga para backlog + Jira"]
   ↓
Fase 8 — product-backlog + sincronização Jira (executada em /run-backlog separado)
```

---

## Configuração padrão de execução

| Aspecto | Padrão | Override |
|---|---|---|
| Auto-aprovar correções derivadas dos validators | SIM | sem flag |
| Validators param para HITL | NÃO | sem flag |
| Discovery interativo | só se Greenfield | `--discovery-mode interactive` |
| Pipeline para no tasks.md | SIM (HITL #1) | sem override — é a especificação do comando |
| Sequencializar Fase 7 | SIM (evita alucinação de path) | sem override |
| Toca Jira | NÃO (cabe ao `/run-backlog` pós-HITL) | sem override |

---

## Pré-flight checks (executar antes da Fase 0)

1. `git status` — branch atual e mudanças pendentes
2. `git branch --show-current` — confirmar não está em main/master
3. `ls .forge/agents/specifications/ .forge/agents/architecture/` — confirmar agentes
4. `find . -path ./node_modules -prune -o -name "discovery-notes.md" -print` — checar se discovery já existe
5. `ls docs/product/ 2>/dev/null` — detectar baseline existente (Brownfield vs Greenfield)
6. `grep -rln -E "\.kiro/specs|docs/specs" .forge/ docs/ 2>/dev/null` — purgar referências antigas se encontrar

Se workspace tem 152MB+ de material untracked (PDFs/manuais de fornecedor), NÃO faça `git add -A`. Stage apenas `.forge/`, `docs/product/`, `docs/discovery/`.

---

## Anti-patterns bloqueados

- ❌ Disparar 2+ agentes da Fase 7 em paralelo entre módulos diferentes (causa alucinação de path comprovada — agentes reportam criação que não acontece)
- ❌ Confiar no reporte do agente sem `Bash("ls -la docs/product/modules/<modulo>/")` para verificar arquivo
- ❌ Usar `.kiro/specs/` ou `docs/specs/` como caminho de output (canônico é `docs/product/modules/<modulo>/`)
- ❌ Avançar para Fase 8 (backlog/Jira) sem aprovação humana dos tasks.md
- ❌ Pausar entre fases 2-7 esperando aprovação humana (auto-aprovar derivados é o padrão acordado)
- ❌ Esquecer de criar branch dedicada (não trabalhe em main/master)
- ❌ Commit com `git add -A` quando há diretórios untracked grandes (pode incluir secrets em PDFs/CSVs de fornecedor)

---

## Reporte ao final de cada fase

Status conciso (≤15 linhas): artefatos criados (caminho relativo), versão final, achados aplicados pelos validators, pendências detectadas, próxima fase.

---

## Output do HITL gate

Ao concluir Fase 7, NÃO dispare backlog/Jira. Apresente ao humano:

```markdown
# Pipeline de Specs Concluído — 🛑 Aguardando Validação Humana

## Tasks geradas para revisão

| Módulo | Subdomínio | requirements.md | design.md | tasks.md | TASKs | PBTs |
|---|---|---|---|---|---|---|
| <modulo> | Core/Supp/Generic | ✅ N REQs + N RNFs | ✅ N seções + N DDs | ✅ N TASKs em N ondas | N | N |

## Caminhos completos

- `docs/product/modules/<modulo>/{requirements,design,tasks}.md` para cada módulo
- `docs/product/modules/modules-validation-report.md`
- `docs/product/trd/trd-validation-report.md`

## Pendências bloqueantes registradas

- Conflitos arquiteturais (CA-NNN) que requerem decisão humana
- Lacunas de produto (LAC-NN) com responsável e prazo
- Pontos a validar (VAL-NNN)

## Próximos passos para o humano

1. Revise os `docs/product/modules/<modulo>/tasks.md` de cada módulo:
   - Ordem das ondas respeita dependências?
   - TASKs estão bite-sized (< 2h)?
   - PBTs cobrem propriedades críticas?
   - Coverage gates por camada (Domain ≥95%, App ≥85%, Infra ≥70%)?
   - Branches em git worktree e commit Conventional?
2. Quando aprovar, responda: **"tasks aprovadas, prossiga para backlog + Jira"**
3. Se quiser ajustar algo, indique:
   - Módulo
   - TASK ou onda
   - Ajuste desejado
   Eu re-disparo apenas o `tasks-writer` daquele módulo (idempotente)

Pipeline NÃO tocará o Jira sem sua aprovação explícita.
```

---

## Cross-refs

- Agente `discovery-agent`: `.forge/agents/specifications/discovery-agent.md`
- Agente `prd-generator` / `prd-validator`: idem
- Agentes `frd-*` / `nfrd-*`: idem
- Agentes `ddd-architect` / `ddd-validator`: `.forge/agents/architecture/`
- Agentes `module-*`: idem
- Agente `trd-*`: `.forge/agents/specifications/`
- Agentes `requirements-writer` / `design-writer` / `tasks-writer`: idem
- Versionamento de documentos: `.forge/rules/conventions/document-versioning.md`
- Rule de naming kebab-case: `.forge/rules/conventions/naming.md`
- Skill complementar: `/specs:specs-loop` (loop por módulo com HITL no requirements antes do design)
- Comando complementar pós-HITL: `/run-backlog` (a definir — popula backlog + Jira após aprovação humana dos tasks.md)

## Modo autônomo (--yolo)

Com `--yolo` ou `autonomy.mode: yolo`, o pipeline **não para** no HITL declarado (validação humana dos `tasks.md`): cada gate de aprovação de spec (requirements/design/tasks/verify) é delegado ao agent `yolo-gate` (Opus, effort high), que decide e registra `autonomous: true` em `approvals.yaml`. **O gate humano do `/forge:backlog` (§14.4) não é auto-decidido por default** — o pipeline autônomo entrega os `tasks.md` aprovados e ainda para antes de popular backlog/Jira, salvo você fiar o backlog no yolo explicitamente. Hard-stops (`human_archive_approval`, deploy prd) seguem humanos e são **impostos deterministicamente** pelo `approval-log.sh`; **falhas de execução (`[!]`, blockers, conflito de fontes — guardrail G1) continuam parando** — yolo decide gates, não mascara falhas. Ver `.forge/rules/conventions/autonomy-yolo.md`.
