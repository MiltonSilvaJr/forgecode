---
name: specs-loop
description: |
  Conduz loop autônomo de especificação de módulos em `docs/product/modules/<modulo>/`, guiado por `<modulo>/PROGRESS-TRACKING.md`, usando os agents requirements-writer, design-writer e tasks-writer. Idempotente — retoma de onde parou. Por padrão, aguarda aprovação humana de cada `requirements.md` antes de prosseguir para `design.md` e `tasks.md` no mesmo módulo.
arguments:
  - name: --skip-approved
    description: Pula a confirmação na Fase 1 e o gate de aguardar humano aprovar `requirements.md` antes de gerar `design.md`/`tasks.md` do mesmo módulo. Documentos continuam saindo em status "Rascunho para revisão".
    required: false
---

# /forge:specs-loop

Loop autônomo de especificação de módulos deste projeto, guiado por Progress Tracking, com orquestração dos 3 agents (`requirements-writer`, `design-writer`, `tasks-writer`).

> **Regra inviolável:** documentos gerados por IA SEMPRE saem em status `Rascunho para revisão`. A promoção para `Aprovado para desenvolvimento` é decisão humana após ciclo multi-persona — vide `.forge/rules/conventions/document-versioning.md`.

## Convenção de Tracker

> **Change ativo (scale 4):** se existir um change ativo com `scale: 4` (`.forge/specs/active/<change-id>/manifest.yaml`), os módulos desta execução vivem em `.forge/specs/active/<change-id>/product/modules/<modulo>/` — declare o path-base no payload de cada agent e **verifique após cada módulo** se o artefato não caiu em `docs/product/` (se caiu, mova para o change e registre o desvio em uma linha). `docs/product/` segue como estado vigente de leitura até o archive (MVP3). Sem change ativo scale 4, use o caminho legado abaixo.

Cada módulo em `docs/product/modules/<modulo>/` mantém um tracker `PROGRESS-TRACKING.md` (ou `tasks.progress.md`) com a convenção idempotente do projeto:

- `[ ]` — não iniciado
- `[-]` — em progresso (ou retomada após falha)
- `[X]` — concluído

## Pré-requisitos

- Repositório limpo (sem mudanças não commitadas em `docs/product/modules/`)
- Agents disponíveis em `.forge/agents/specifications/` (requirements-writer, design-writer, tasks-writer)
- ADRs principais aceitos
- `docs/product/glossary/domain-glossary.md` populado

## Comportamento dos flags

| Flag | Sem flag (padrão) | Com `--skip-approved` |
|------|-------------------|------------------------|
| Árvore proposta na Fase 1 | Pausa e espera aprovação | Grava direto e reporta |
| Gate `requirements → design` no mesmo módulo | Para e aguarda humano marcar `Aprovado` | Prossegue em cascata |
| Status final dos documentos | Sempre `Rascunho para revisão` | Sempre `Rascunho para revisão` |
| Marcadores | `[ ] → [-] → [X]` | `[ ] → [-] → [X]` |
| Falha de agent | Para o loop e reporta | Para o loop e reporta |

## Quando NÃO usar `--skip-approved`

- Módulos com **PCI DSS** ou tratamento de dados de cartão
- Módulos com **LGPD** sensitive (PII, dados financeiros)
- Primeira execução em um módulo novo (validar estilo do agent antes)

## Fluxo

### FASE 0 — Descoberta

1. Ler em paralelo:
   - `docs/product/glossary/domain-glossary.md`
   - `docs/product/adr/README.md`
   - `.forge/rules/conventions/document-versioning.md`

2. Listar com Glob:
   - `docs/product/modules/*/`

3. Para cada módulo, registrar estado dos 3 documentos (`requirements.md`, `design.md`, `tasks.md`) — existe? versão? status?

### FASE 1 — Plano

1. Propor árvore de execução: módulos a processar, em qual ordem, quais documentos por módulo
2. Sem flag: pausar e aguardar aprovação humana
3. Com flag: gravar `PROGRESS-TRACKING.md` na raiz do `docs/product/modules/` listando todos os módulos

### FASE 2 — Loop por módulo

Para cada módulo (ordem do tracker):

1. Marcar item como `[-]` em `PROGRESS-TRACKING.md`
2. Invocar `requirements-writer` se não existir ou estiver em `Rascunho`
3. **Gate humano (default):** se `requirements.md` continua em `Rascunho para revisão`, parar e prosseguir para o próximo módulo
4. **Gate humano (com `--skip-approved`):** prosseguir
5. Invocar `design-writer` (depende de `requirements.md`)
6. Invocar `tasks-writer` (depende de `requirements.md` + `design.md`)
7. Marcar item como `[X]` e o próximo como `[-]`

### FASE 3 — Encerramento

1. Reportar status final de cada módulo
2. Sumarizar artefatos criados/atualizados
3. Listar módulos pendentes de revisão humana

## Validações Pós-Execução

- [ ] `PROGRESS-TRACKING.md` reflete estado real (sem `[-]` órfão)
- [ ] Documentos com versão SemVer e status corretos
- [ ] Sem documento promovido a "Aprovado" sem revisão humana
- [ ] README de cada módulo sincronizado com tabela "Status dos artefatos"

## Falha e retomada

- Se o loop falhar no meio, o item permanece `[-]` no tracker
- Próxima execução de `/forge:specs-loop` retoma desse ponto (idempotente)

## Modo autônomo (--yolo)

Com `--yolo` ou `autonomy.mode: yolo`, o loop não pausa para aprovar a árvore de execução nem cada `requirements.md`: o agent `yolo-gate` (Opus, effort high) decide cada gate e **auto-promove** o artefato de "Rascunho para revisão" para aprovado, registrando `autonomous: true`. Sem yolo, o `--skip-approved` apenas pula a pausa mas mantém os docs em rascunho — o yolo, ao contrário, decide de fato. Falhas continuam parando. Ver `.forge/rules/conventions/autonomy-yolo.md`.
