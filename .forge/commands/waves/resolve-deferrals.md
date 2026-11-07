---
description: Marca deferrals do change como resolved (e depois tested). O change não pode concluir com deferral open — use resolve + test para cada pendência antes de /forge:close.
argument-hint: "[<change-id>] <deferral-id> resolve|test [--note \"<resolução>\"]"
---

# /forge:resolve-deferrals — resolver pendências

Argumentos: `$ARGUMENTS` (change-id opcional + deferral-id + subcomando + --note).

## Fluxo de resolução

### Passo 1 — Resolver

```bash
bash .forge/scripts/deferral-ops.sh resolve <change-id> DEFER-NN \
  --note "<o que foi feito para resolver>"
```

Marca o deferral como `resolved`. A resolução deve ser verificável — não é "marcou como feito".

### Passo 2 — Testar

```bash
bash .forge/scripts/deferral-ops.sh test <change-id> DEFER-NN
```

Marca como `tested`. Só pode testar um deferral `resolved`.

### Verificar status

```bash
bash .forge/scripts/deferral-ops.sh status <change-id>
```

Output: `OK (N tested, M resolved, 0 open)` ou `OPEN (K/N open: DEFER-01, DEFER-03)`.

## Critério de encerramento

O change só pode avançar para `/forge:close` quando:

```bash
bash .forge/scripts/deferral-ops.sh status <change-id>
# saída deve começar com "OK"
```

Se houver deferrals `open` ou `resolved` (não `tested`): bloqueado.

## Regras

- `resolved` sem `tested` não desbloqueia: a resolução deve ser verificada, não apenas declarada.
- Se a resolução alterar código: commit atômico como qualquer task, depois marque `tested`.
- Deferral `wont-fix`: use apenas quando o HITL (humano) decide explicitamente não resolver. Requer aprovação registrada no `approvals.yaml` do change.
