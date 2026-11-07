---
story_id: STORY-NN
epic: <change-id>
title: <título curto da story>
depends_on: []
status: todo
---

# STORY-NN — <título curto da story>

> Story auto-contida derivada de `<change-id>`. Toda informação necessária para implementar
> esta story está aqui — sem precisar reler o change completo (§17.1).

## Goal

<Descrição objetiva do que esta story entrega: 1-2 frases. Escopo estritamente delimitado.>

## Embedded context

> Excertos relevantes dos artefatos do change. Não copie tudo — só o que esta story precisa.

### Requirements

- REQ-NN: <descrição resumida do requisito que esta story atende>

### Design

> §<seção>: <trecho ou decisão técnica relevante>

### Contratos / interfaces

> <Contrato de API, evento ou interface que esta story produz ou consome — se aplicável.>

### Rules aplicáveis

- `.forge/rules/<categoria>/<rule>.md` — <por quê é relevante>

### ADRs

- ADR-NNNN — <decisão e impacto nesta story — se aplicável>

## Tasks

Tasks desta story (extraídas de `tasks.md`):

- [ ] TASK-NN — <título> (paths: `<path>`)
- [ ] TASK-NN — <título> (paths: `<path>`; depende: TASK-NN)

## Acceptance criteria

- [ ] <Critério verificável 1 — comportamento concreto e testável>
- [ ] <Critério verificável 2>
- [ ] Nenhum achado de gate aberto (gate-runner verde antes de `/forge:verify`)
- [ ] Commit atômico por task; nenhum `TODO`/`FIXME` residual

## Out of scope

- <Item explicitamente fora desta story — evita scope creep>
