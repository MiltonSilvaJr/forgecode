---
name: story-context
description: Carrega o contexto mínimo de uma story específica do change ativo — lê apenas STORY-NN.md e epic_context.md. Proibido ler fora do escopo da story (sem tasks.md completo, sem design.md completo). Retorna contexto compacto para uso no /forge:implement story a story.
---

# Story Context (§17.7)

Skill de contexto estrito — entrada e saída estreitas, zero desvio de escopo.

## Protocolo

### Entrada

Receba: `change_id` + `story_id` (ex.: `epic-auth` + `STORY-02`).

### Leitura (estritamente limitada)

Leia **apenas**:

1. `.forge/specs/active/<change-id>/stories/<story-id>.md`
2. `.forge/specs/active/<change-id>/epic_context.md` (se existir)

**Proibido** ler: `tasks.md` completo, `design.md`, `requirements.md`, outros changes, base de código.

### Saída

```markdown
## Context — <story-id>

**Goal:** <linha do frontmatter>
**Status:** <status do frontmatter>
**Depends on:** <depends_on do frontmatter>

**Tasks desta story:**
- TASK-NN — <título> (paths: `<path>`)

**Invariantes críticas do épico:**
- <da seção relevante do epic_context.md>

**Próxima ação:** <primeira task com status [ ]>
```

Máximo 30 linhas. Sem dump de artefatos. Se a story estiver `done` ou `blocked`, informe e pare.

## Regras

- Nunca leia fora do escopo declarado — é o anti-padrão de Classe G (degrada sessão longa).
- Se epic_context.md não existir: avise que o contexto épico não foi compilado (sugira `/forge:shard`).
- Não faça inferências além do que está na story + epic_context.
