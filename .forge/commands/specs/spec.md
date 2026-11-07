---
description: Gerencia o ciclo de vida de changes SDD — `spec new` cria um change ativo em .forge/specs/active/<change-id>/ com manifest validado por schema e templates do tipo/scale.
argument-hint: new [<change-id>] [--type feature|bugfix|refactor|greenfield|brownfield] [--scale 0..4]
---

# /forge:spec — ciclo de vida de changes

Subcomandos disponíveis nesta versão:

| Subcomando | Efeito |
|---|---|
| `new` | Cria `.forge/specs/active/<change-id>/` (manifest + templates) via script determinista |

Argumentos recebidos: `$ARGUMENTS`

## `spec new`

### 1. Coleta de parâmetros (elicitação)

Extraia dos argumentos: `<change-id>`, `--type`, `--scale`, `--rigor`, `--mode`. Para o que faltar, **não invente** — pergunte via `AskUserQuestion`:

- **change-id** ausente: peça um id curto em kebab-case que descreva a mudança (ex.: `add-card-tokenization`). Valide: `^[a-z0-9][a-z0-9-]*[a-z0-9]$`.
- **--type** ausente: pergunte com as opções `feature` (mudança de comportamento em produto existente), `bugfix` (correção com risco de regressão), `refactor` (mudança interna sem alterar comportamento), `greenfield` (produto/módulo novo do zero), `brownfield` (adoção do Forge em código existente).
- **--scale** ausente: pergunte com as opções da tabela scale-adaptive (§10.3 do doc de projeto):
  - `0` — trivial (typo/cosmético): só tasks
  - `1` — feature pequena/spike: requirements curto + tasks
  - `2` — feature padrão (**default**): requirements + design + tasks
  - `3` — complexa/multi-módulo: + analyze + story sharding
  - `4` — regulada/alto risco: + FRD/NFRD/TRD/DDD + aprovação explícita

Se o usuário escolher um scale **abaixo** do que o risco aparente sugere, avise e registre depois no `manifest.yaml > quick_plan` (enabled, skipped_phases e justification — obrigatórios).

`3` de story sharding não é sugestão: `/forge:implement` reprova fechado (via `validate-spec.sh`, `lib/story-shard.mjs`) se `dev_loop.sharded`/`dev_loop.epic_context_compiled` não estiverem `true`, ou se `stories/` não cobrir cada TASK exatamente uma vez e sem ciclo — a única dispensa é `quick_plan.skipped_phases` incluindo `story-sharding` (com `justification`), nunca omissão silenciosa.

### 2. Criação (determinista)

```bash
bash .forge/scripts/spec-new.sh <change-id> --type <type> --scale <scale> [--from-ledger LDG-NNNN]
```

O script é a única fonte de criação — **não** crie a estrutura manualmente. Ele:
- recusa id existente (exit 3) e id não-kebab (exit 2);
- instala os templates das fases exigidas pelo type/scale;
- gera o `manifest.yaml` (§10.2) com `status: proposed`;
- auto-valida com `validate-spec.sh` e faz rollback se inválido.

**`--from-ledger LDG-NNNN`** (opt-in): quando este change nasce de um item do ledger durável,
passe o id da entrada. O script grava `ledger_origin` no manifest e marca a entrada como
`promoted` (link bidirecional). Isso **fecha o ciclo automaticamente**: no `/forge:archive` a
entrada vira `resolved` (entregue ao baseline); no `/forge:close` por `abandoned`/`rejected` ela é
**reaberta** (`open`, volta ao roadmap); por `delivered-externally` vira `resolved`. Se você puxou
um item do ledger para virar trabalho, use este flag — é o que mantém o roadmap honesto sem depender
de memória (ver `rules/conventions/ledger-consultation.md`).

### 3. Validação e relatório

```bash
bash .forge/scripts/validate-spec.sh <change-id>
```

Reporte em 2-3 linhas: id criado, type/scale/mode, artefatos instalados e o **próximo comando** do fluxo do tipo (§11):

| Tipo | Próximo passo |
|---|---|
| feature / greenfield / brownfield | `/forge:clarify` → `/forge:requirements` |
| bugfix | `/forge:root-cause` (até existir: preencher `bugfix.md`) → `/forge:tasks` |
| refactor | `/forge:design` → `/forge:tasks` |

Preencha a seguir a `proposal.md` com o usuário (por quê / o que muda / fora de escopo / impacto) e espelhe capacidades/paths afetados no `manifest.yaml`.

## Regras

- Nunca edite `manifest.yaml` para um estado que `validate-spec.sh` rejeite — rode a validação após qualquer edição.
- Um change por mudança lógica; ids são imutáveis após criação.
- Transições de status seguem a state machine (§12); avanços que exigem decisão humana usam `AskUserQuestion` com as opções canônicas (Approve/Review/Reject/Supersede/Abandon/Block) — toda opção exceto Approve exige motivo registrado.
