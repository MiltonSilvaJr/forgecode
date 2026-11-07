---
description: Meta-avaliação do próprio harness (§18) e benchmark registry canônico — mede com números se um template/command/rule do Forge melhora os artefatos gerados, antes de propagá-lo ao time. Modos: harness <case> e benchmark <case|suite>. Opt-in (quality.evals_enabled).
argument-hint: "harness <case-name> [--artifact requirements] [--runs N] | benchmark <case|suite> [--runner stub] [--runs N] [--set key=value]"
---

# /forge:eval — meta-avaliação do harness (§18)

Argumentos: `$ARGUMENTS` (`harness` ou `benchmark` + nome do caso/suite + flags).

> **Opt-in.** Só opera com `quality.evals_enabled: true` em `.forge/FORGE.md`. Senão, pare: `Quality layer desabilitada — ative quality.evals_enabled em FORGE.md (§17.9).`

Diferença para `/forge:skill-lifecycle eval`: aqui o artefato sob teste é **do próprio Forge** (template/command/rule), e o sinal de qualidade é o **relatório do validador** (`[MISS]`/`[CONFLICT]`/`[CLARIFY]`), não expectations escritas à mão. Transforma a evolução do harness de opinião em evidência.

A estatística (mean±stddev, deltas) sai de scripts deterministas — o modelo nunca decide o veredito "no olho" (§10.11).

Antes de rodadas caras, emita o budget preflight:

```bash
bash .forge/scripts/budget-preflight.sh --stage eval --profile standard --outputs aggregate.json
```

Toda execução concluída grava `run-manifest/v1` em `evidence/runs/*/run-manifest.json` (proveniência segura: hashes e metadados, nunca diff bruto).

---

## harness — caso canônico: template de requirements

Mede se o template de `requirements.md` reduz achados do `requirements-validator`.

### Estrutura (§17.8.4, ramo meta)

```text
.forge/evals/meta/<case>/
├── case.json                       # artefato sob teste + prompts + braços
└── runs/
    ├── with-template/run-K/{output.md, validator-report.txt, counts.json}
    └── without-template/run-K/{output.md, validator-report.txt, counts.json}
└── meta-aggregate.json             # delta quantitativo (determinista)
```

### Fluxo (`--runs N`, default 2; poucos runs — custo real, §17.9)

Para cada braço (`with-template`, `without-template`) e cada run `K`:

1. **Gerar o artefato** via executor/runner:
   - `with-template`: builder recebe o template instalado do change (estrutura completa).
   - `without-template`: builder recebe **apenas** a proposal, sem o template (estrutura livre).
   - Grave o `requirements.md` resultante em `run-K/output.md`.
2. **Validar** com o `requirements-validator` (subagent independente, §14.6) sobre o `output.md`. Capture o relatório no formato canônico em `run-K/validator-report.txt`:
   ```
   ## Status: PASS | FAIL
   [MISS]     <item da proposal sem requisito>
   [CONFLICT] <inconsistência entre artefatos>
   [CLARIFY]  <ambiguidade que exige decisão humana>
   ```
3. **Contar** (determinista):
   ```bash
   bash .forge/scripts/meta-count.sh <case>/runs/<arm>/run-K/validator-report.txt \
     --out <case>/runs/<arm>/run-K/counts.json
   ```

### Agregar (determinista)

```bash
bash .forge/scripts/meta-aggregate.sh .forge/evals/meta/<case>
```

→ `meta-aggregate.json` com `mean ± stddev` de MISS/CONFLICT/CLARIFY e pass-rate por braço, os **deltas** (with − without) e um `verdict` (`template_helps | template_hurts | neutral`). Valide contra `schemas/meta-eval.schema.json`.

### Reportar

No chat, **apenas** a linha do `meta-aggregate.sh` + o `verdict`. Exemplo:

```
MISS 3.0→1.0 (Δ-2.0); CONFLICT 1.0→0.0 (Δ-1.0); pass-rate 0.0→1.0 (Δ+1.0) → template_helps
```

Interpretação: delta de MISS/CONFLICT **negativo** = o template reduz achados (ajuda). Só promova uma mudança de template ao time quando o veredito for `template_helps` com magnitude relevante.

---

## benchmark — registry canônico

Executa casos versionados pequenos em `.forge/evals/benchmarks/<case>/case.json`, reutilizando `eval-aggregate.sh` e `grading.schema.json`.

Casos iniciais: `greenfield-small`, `brownfield-bugfix`, `refactor-invariant`, `docs-only`, `multi-module-scale3` e `suite`.

```bash
bash .forge/scripts/benchmark-eval.sh greenfield-small --runner stub --runs 1
bash .forge/scripts/benchmark-eval.sh suite --runner stub --runs 1
```

Overrides pontuais seguem o estilo DeepSpec apenas neste modo:

```bash
bash .forge/scripts/benchmark-eval.sh greenfield-small --set runs=2 --set runner=stub
```

---

## Regras

- `quality.evals_enabled: false` ⇒ não roda (opt-in, §17.9).
- Os dois braços usam a **mesma** proposal e o **mesmo** validador — só varia a presença do template (variável isolada).
- Contagem e agregação saem dos scripts; o modelo só gera artefato e roda o validador.
- `meta-aggregate.json` sempre validado contra `schemas/meta-eval.schema.json`.
- Benchmark cases sempre validam contra `schemas/benchmark-case.schema.json`.
- Run manifests sempre validam contra `schemas/run-manifest.schema.json` e nunca gravam diff bruto.
- Poucos runs por braço nesta fase (2–3) — o objetivo é provar o mecanismo, não otimizar o template.
- Output bruto em `/tmp`; nos artefatos só o relatório e os counts. No chat, só o resumo de uma linha.
