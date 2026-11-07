---
description: Mini-report curto do progresso do change ativo (§17.3). Lê apenas progress.json e deferrals.json — sem reler artefatos completos. Resposta em ≤15 linhas.
argument-hint: "[<change-id>]"
---

# /forge:progress — mini-report de progresso

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, use o único change ativo).

## Protocolo

Leia **apenas**:

1. `$FORGE_ROOT/.forge/specs/active/<change-id>/progress.json`
2. `$FORGE_ROOT/.forge/specs/active/<change-id>/deferrals.json`

Não leia tasks.md, design.md, requirements.md nem qualquer outro artefato (§17.3 — custo de contexto proibido).

## Saída esperada (≤15 linhas)

```
## Progress — <change-id>

Wave atual: W1 (open)
Stories: 3/9 done (33%)
Tasks: 12/30 done (40%)
Deferrals: 1 open (DEFER-01)

Próximo passo: concluir STORY-04 e fechar W1.
```

Se `progress.json` não existir (wave plan não rodado): `No progress data — rode /forge:wave plan primeiro.`

Se houver deferrals `open`: liste os IDs e sinalize que o change não pode concluir até que estejam `tested`.

## Regras

- Resposta ≤15 linhas no chat — sem dump de JSON, sem resumo de artefatos.
- Percentuais calculados diretamente dos campos de `progress.json` (`done/total`).
- Sem inferência de estado: o que está no JSON é o que reporta.
