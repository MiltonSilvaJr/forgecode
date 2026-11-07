---
description: Cria, avalia (A/B) e otimiza skills do harness. create (entrevista de intenção → SKILL.md com frontmatter validado), eval (with-skill vs baseline por caso → grading → agregação mean±stddev + deltas), optimize (holdout train/test 60/40 da description, seleção pela pontuação de teste). Toda a camada é opt-in (quality.evals_enabled).
argument-hint: "create|eval|optimize <skill-name> [--runner claude-code] [--iterations N]"
---

# /forge:skill-lifecycle — ciclo de vida de skills (§17.8)

Argumentos: `$ARGUMENTS` (subcomando + nome da skill + flags).

> **Opt-in.** `eval` e `optimize` só operam com `quality.evals_enabled: true` em `.forge/FORGE.md`. Se estiver `false`, pare e avise: `Quality layer desabilitada — ative quality.evals_enabled em FORGE.md (§17.9).` O `create` funciona sempre.

Toda estatística é feita por scripts deterministas (`eval-aggregate.sh`, `eval-holdout.sh`) — o modelo nunca recalcula médias nem decide o vencedor "no olho" (§10.11).

Antes de `eval` ou `optimize`, emita o budget preflight:

```bash
bash .forge/scripts/budget-preflight.sh --stage skill-lifecycle-eval --profile standard --outputs aggregate.json
```

O agregador determinístico grava `aggregate.json` e `evidence/runs/*/run-manifest.json`; a ausência desses arquivos bloqueia o contrato `skill-lifecycle-eval`.

---

## create

Entrevista de intenção curta e gera `SKILL.md` com frontmatter validado.

1. Pergunte (uma vez, conciso): o que a skill faz, quando deve disparar, entradas/saídas, o que é proibido.
2. Gere `.forge/skills/<skill-name>/SKILL.md`:
   - `name`: kebab-case, **≤64 chars**, igual ao diretório.
   - `description`: terceira pessoa, "quando usar" explícito, **≤1024 chars, sem tags XML** (restrições do spec Agent Skills — a description é o que decide o triggering).
   - Corpo com progressive disclosure: missão, protocolo (entrada/leitura/saída), regras.
3. Valide o frontmatter:
   ```bash
   bash .forge/scripts/validate-frontmatter.sh .forge/skills/<skill-name>/SKILL.md
   ```
4. Sugira criar `evals.json` (casos de teste) para poder rodar `/forge:skill-lifecycle eval` depois.

---

## eval

Roda A/B **with-skill vs baseline** para cada caso de teste e agrega.

Pré-condição: existe `.forge/evals/skills/<skill>/evals.json` válido contra `schemas/evals.schema.json`. Se não houver, crie via entrevista (2–3 casos bastam — o custo de tokens é real, §17.9; o objetivo é validar o mecanismo).

Fluxo por iteração (`--iterations N`, default 1):

1. **Executor** (`agents/quality/executor.md`) — para cada caso, roda baseline e variant via runner de `runners.yaml`, grava `eval-K/results.json`. Sem paralelismo, executa serial (degradação graciosa).
2. **Grader** (`agents/quality/grader.md`) — avalia cada expectation com `text/passed/evidence`, grava `eval-K/grading.json` (valida contra `schemas/grading.schema.json`).
3. **Comparator** (opcional, cego) — julgamento A/B anonimizado por caso → `comparison.json`.
4. **Agregação determinista**:
   ```bash
   bash .forge/scripts/eval-aggregate.sh .forge/evals/skills/<skill>/workspace/iteration-N
   ```
   → `aggregate.json` com `mean ± stddev` e deltas de pass-rate, duração e tokens.
5. **Analyzer** (`agents/quality/analyzer.md`) — interpreta o `aggregate.json` (regressões locais, variância alta, trade-offs) → `analysis.json`. Não recalcula números.

Estrutura (§17.8.4):

```text
.forge/evals/skills/<skill>/
├── evals.json
└── workspace/iteration-N/
    ├── eval-K/{results.json,grading.json,timing.json}
    ├── aggregate.json
    └── analysis.json
```

Reporte no chat **apenas** a linha do `aggregate.json` + o `verdict`/recomendação do analyzer — sem dump de JSON.

---

## optimize

Otimiza a **description** (o gatilho da skill) por holdout, anti-overfitting.

1. Gere candidatas de description (variações de fraseado/cobertura), respeitando **≤1024 chars**.
2. Inclua casos positivos (`trigger_expected: true`) e negativos (`false`) no `evals.json`; execute cada candidata em repetições suficientes para expor variância. O resultado de triggering por repetição usa `eval-trigger-metrics.sh`, que mede precision, recall e F1 sem julgamento do modelo.
3. Pontue cada candidata em todos os casos (reuso do executor+grader por candidata). Quando houver `train` e `test`, mantenha a proporção de positivos/negativos nos dois conjuntos; não selecione por F1 de treino.
4. Seleção determinista por holdout:
   ```bash
   bash .forge/scripts/eval-holdout.sh .forge/evals/skills/<skill>/workspace/iteration-N/candidates.json
   ```
   - split 60/40 (train/test) determinista por ordenação dos ids;
   - **vencedora escolhida pela pontuação de TESTE**, nunca de treino;
   - `holdout.json` reporta `train_score` e `test_score` de cada candidata.
5. Aplique a description vencedora ao `SKILL.md` **só** se o score de teste e as métricas de triggering não regredirem em relação à atual; senão, mantenha e avise.

Reporte train e test scores **separados** e qual venceu — a transparência do holdout é a feature (§17.8.3).

---

## Regras

- `quality.evals_enabled: false` ⇒ `eval`/`optimize` não rodam (opt-in, §17.9).
- Nenhuma decisão estatística no modelo: agregação e seleção saem dos scripts.
- `grading.json` sempre validado contra `schemas/grading.schema.json`; `evals.json` contra `schemas/evals.schema.json`.
- Output bruto de runner em `/tmp`; nos artefatos só tail. No chat, só o resumo de uma linha.
- Custo de tokens é real — poucos casos por eval nesta fase (validar mecanismo, não maximizar skill).
