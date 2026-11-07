---
description: Registra uma pendência no ledger do change ativo (§17.4). O change não pode concluir enquanto houver deferral open. Operado por script determinista.
argument-hint: "[<change-id>] --reason \"<motivo>\" [--blocks \"<item,...>\"]"
---

# /forge:defer — registrar pendência

Argumentos: `$ARGUMENTS` (change-id opcional + --reason obrigatório + --blocks opcional).

## Protocolo

```bash
bash .forge/scripts/deferral-ops.sh raise <change-id> \
  --reason "<descrição concisa da pendência>" \
  [--blocks "<STORY-NN,TASK-NN,...>"]
```

O script atribui o ID (`DEFER-NN`), registra em `deferrals.json` e atualiza `progress.json.open_deferrals`.

## Quando usar

- Decisão técnica inconclusiva que bloqueia uma story mas que pode ser resolvida sem refazer o work já feito.
- Descoberta de risco fora do escopo do change que precisa ser rastreada.
- Dependência externa não disponível no momento da implementação.

## Regras

- Todo deferral `open` **bloqueia `/forge:close`** — o change não pode ser archivado com pendências abertas.
- O deferral deve ser resolvido (`/forge:resolve-deferrals`) e testado antes do encerramento.
- Não use deferral para adiar decisões de design que deveriam ser tomadas antes de `tasks-ready` — use `/forge:analyze` e corrija nos artefatos.
- Emita one-line de confirmação com o ID atribuído (`DEFER-NN registrado`).
