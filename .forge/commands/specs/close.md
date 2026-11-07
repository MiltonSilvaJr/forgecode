---
description: Encerra o rastreamento de um change SEM atualizar o baseline — abandoned/rejected (antes de implementing), superseded (de qualquer estado, com sucessor) ou delivered-externally (de qualquer estado, quando a obra foi entregue fora do pipeline, ex.: PR direto). Move a pasta para specs/archived/ com registro auditável do motivo.
argument-hint: "<change-id> [--reason abandoned|rejected|superseded|delivered-externally]"
---

# /forge:close — encerramento sem baseline

Argumentos: `$ARGUMENTS`.

## 1. Coleta (AskUserQuestion quando faltar)

- **change-id**: qual change encerrar (liste os ativos se ambíguo).
- **reason** ausente → pergunte com as opções:
  - **Abandoned** — não será implementado (só vale antes de `implementing`);
  - **Rejected** — revisado e recusado (idem);
  - **Superseded** — substituído por outro change (vale de qualquer estado; peça o id substituto);
  - **Delivered-externally** — a obra **foi entregue**, mas fora do pipeline de spec (ex.: PR direto que nunca percorreu requirements→design→tasks→verify). Terminal *positivo*, de qualquer estado: o `status` fica honesto (`delivered-externally`), não `abandoned`. Baseline intocado pela máquina de spec (a entrega está no código real); reconcilie `product/current` à parte se precisar. Peça a evidência (ex.: link do PR) — ela vai na `--note` auditável.
- **Motivo por escrito é obrigatório** (§12.1) — peça uma frase objetiva; ela vira o registro auditável. Para `delivered-externally`, inclua a evidência da entrega (PR/commit).

Confirme em 2-3 linhas o efeito antes de executar: a pasta sai de `active/`, vai para `archived/YYYY-MM-DD-<id>/` com `archive.kind: closed_without_baseline_update`, e **nada fora dela é alterado** (baseline intocado — §13).

## 2. Execução (determinista)

```bash
bash .forge/scripts/spec-close.sh <change-id> --reason <reason> --note "<motivo>" [--superseded-by <id>] [--autonomous]
```

O script valida as regras de estado (abandoned/rejected só pré-`implementing`; de `implementing` em diante, ou o ciclo termina, ou o change é superseded, ou foi delivered-externally), registra a decisão em `approvals.yaml` (gate `close`) e move a pasta.

## 3. Relatório

Uma linha: destino em `archived/`, reason, e — se superseded — o change substituto. Se o usuário esperava aplicar as mudanças ao produto: explique que isso é o `/forge:archive` (MVP3), não o close.

## Modo autônomo (--yolo)

Em yolo, a disposição de close (abandoned/rejected/superseded/delivered-externally) e seu motivo são decididos pelo agent `yolo-gate` (Opus, effort high) e registrados com `autonomous: true`: chame o `spec-close.sh` com `--autonomous`, que o repassa ao `approval-log.sh` (sem a flag, o registro sai com o `git config user.name` como se a decisão fosse humana; com `close` em `autonomy.human_hard_stops`, o close autônomo é recusado e o change fica ativo). Se a evidência for ambígua (ex.: escolher entre superseded e delivered-externally sem sinal claro), o `yolo-gate` escala ao humano em vez de chutar. Ver `.forge/rules/conventions/autonomy-yolo.md`.
