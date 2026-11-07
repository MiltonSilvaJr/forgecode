# .forge/evals/meta — meta-avaliação do harness (§18, diferencial estratégico)

Diretório de **primeira classe**. Aqui o eval harness avalia os **próprios templates,
commands e rules do Forge** — não skills do usuário. Nenhum concorrente SDD (BMAD,
Spec Kit, OpenSpec, Kiro) faz benchmark quantitativo dos próprios artefatos.

A ideia: rodar um command do Forge **com e sem** um artefato (ex.: o template de
`requirements.md`) e medir, com números, se o artefato melhora o resultado — via o
**relatório do validador** (`[MISS]`/`[CONFLICT]`/`[CLARIFY]`), não opinião.

Transforma a evolução do harness de "opinião" em "evidência": prova que uma mudança
de template ajuda (ou não) **antes** de propagá-la ao time.

## Estrutura

```text
.forge/evals/meta/<case>/
├── case.json                       # artefato sob teste + prompts + braços
├── runs/
│   ├── with-template/run-K/
│   │   ├── output.md               # requirements gerado COM o template
│   │   ├── validator-report.txt    # relatório do requirements-validator
│   │   └── counts.json             # meta-count.sh: {status,passed,miss,conflict,clarify}
│   └── without-template/run-K/...  # mesma proposal, SEM o template
└── meta-aggregate.json             # meta-aggregate.sh: delta + mean±stddev + verdict
```

## Fluxo

| Etapa | Quem | Saída | Determinista? |
|-------|------|-------|---------------|
| gerar artefato (2 braços) | executor/runner | `output.md` | via runner |
| validar | `requirements-validator` | `validator-report.txt` | modelo (adversarial) |
| contar achados | `scripts/meta-count.sh` | `counts.json` | **sim** |
| agregar A/B | `scripts/meta-aggregate.sh` | `meta-aggregate.json` | **sim** |

Variável isolada: os dois braços usam a **mesma** proposal e o **mesmo** validador —
só varia a presença do template.

## Comando

`/forge:eval harness <case>` — orquestra o fluxo acima. Opt-in (`quality.evals_enabled`).

## Leitura do delta

- `delta.miss` / `delta.conflict` **negativo** ⇒ o template reduz achados ⇒ ajuda.
- `delta.pass_rate` **positivo** ⇒ mais runs passam no validador com o template.
- `verdict: template_helps` com magnitude relevante ⇒ candidato a propagar ao time.

Caso de uso concreto: padronizar FRD/épicos em Markdown estrito e **medir** se reduz
`[MISS]`/`[CONFLICT]`, em vez de assumir (§18).
