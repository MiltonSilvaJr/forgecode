# .forge/evals — eval harness (Layer 5, opt-in §17.8)

Avaliação quantitativa A/B de **skills, commands e templates** do harness. Toda esta
camada é **opt-in**: só opera com `quality.evals_enabled: true` em `.forge/FORGE.md`.

## Estrutura

```text
.forge/evals/
├── skills/
│   └── <skill>/
│       ├── evals.json              # casos de teste (prompt + expectations) — schema: evals.schema.json
│       └── workspace/
│           └── iteration-N/
│               ├── eval-K/
│               │   ├── results.json    # executor: outputs baseline+variant, duração, tokens
│               │   ├── grading.json    # grader: expectations text/passed/evidence — schema: grading.schema.json
│               │   └── timing.json
│               ├── candidates.json     # optimize: descriptions candidatas + scores por caso
│               ├── aggregate.json      # eval-aggregate.sh: mean±stddev + deltas (determinista)
│               ├── holdout.json        # eval-holdout.sh: split 60/40 + winner por test_score
│               ├── comparison.json     # comparator (opcional, julgamento cego)
│               └── analysis.json       # analyzer: interpretação pós-hoc
├── commands/
│   └── <command>/...               # mesma mecânica aplicada a commands
└── meta/                           # meta-avaliação do próprio harness (§18, W5.3)
```

## Fluxo

| Etapa | Quem | Saída | Determinista? |
|-------|------|-------|---------------|
| executar A/B | `agents/quality/executor.md` | `results.json` | via runner |
| avaliar expectations | `agents/quality/grader.md` | `grading.json` | modelo (cético) |
| julgamento cego (opt.) | `agents/quality/comparator.md` | `comparison.json` | modelo (blind) |
| agregar | `scripts/eval-aggregate.sh` | `aggregate.json` | **sim** |
| selecionar description | `scripts/eval-holdout.sh` | `holdout.json` | **sim** |
| interpretar | `agents/quality/analyzer.md` | `analysis.json` | modelo (não recalcula) |

Estatística (`mean ± stddev`, deltas) e seleção do vencedor saem **sempre** dos scripts —
o modelo nunca decide isso "no olho" (§10.11).

## Comandos

- `/forge:skill-lifecycle create` — entrevista → SKILL.md validado.
- `/forge:skill-lifecycle eval` — A/B with-skill vs baseline → grading → agregação.
- `/forge:skill-lifecycle optimize` — holdout train/test da description (anti-overfitting).

## Custo

O eval rigoroso é caro (tokens e tempo). Use poucos casos (2–3) — o objetivo é validar o
mecanismo, não maximizar a skill (§17.9).
