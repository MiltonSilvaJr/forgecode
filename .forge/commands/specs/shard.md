---
description: Fatia o tasks.md do change em stories auto-contidas (§17.1). Cada story embute o contexto mínimo necessário para implementar sem reler o change completo. Ativa o fluxo story-by-story no /forge:implement.
argument-hint: "[<change-id>]"
---

# /forge:shard — story sharding do change

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, use o único change ativo).

Pré-condição: status `tasks-ready` ou posterior. Não é executável com `quick_plan.skipped_phases` incluindo `story-sharding`.

## 1. Pré-flight

1. Leia o manifest do change; confirme `status` ∈ {`tasks-ready`,`implementing`}.
2. Se `dev_loop.sharded: true` já estiver marcado, pergunte ao usuário se deseja re-shardar (sobrescreve stories existentes).
3. Leia `tasks.md`, `design.md` e `requirements.md` do change.

## 2. Compilação de contexto épico (sub-agente)

Se `dev_loop.epic_context_compiled` for `false` ou ausente:

- Invoque o sub-agente `epic-context` (`.forge/agents/specifications/epic-context.md`) passando os artefatos do change.
- O sub-agente produz um **resumo compacto** (`epic_context.md` no change) com: objetivo do change, decisões-chave de design, contratos externos, ADRs e rules aplicáveis.
- Marque `dev_loop.epic_context_compiled: true` no manifest.

## 3. Derivação de stories

A partir de `tasks.md` (waves + tasks + dependências) e `epic_context.md`:

1. **Agrupe tasks** em stories de escopo coeso: cada story cobre tasks de uma mesma área funcional que possam ser implementadas de forma auto-contida. Uma story nunca corta no meio de uma dependência (tasks com `depende:` na mesma story devem ser da mesma wave ou waves consecutivas do change).
2. **Numere** as stories sequencialmente: `STORY-01`, `STORY-02`, etc.
3. **Calcule `depends_on`**: uma story S₂ depende de S₁ se qualquer task de S₂ depende de task em S₁.
4. Para cada story, instancie `STORY.md` a partir de `.forge/templates/story/STORY.md`:
   - Preencha frontmatter (`story_id`, `epic`, `title`, `depends_on`, `status: todo`).
   - Extraia os excertos mínimos de requirements/design relevantes para as tasks da story.
   - Liste as tasks da story com seus paths.
   - Escreva critérios de aceite verificáveis derivados dos REQs cobertos.
5. Salve cada story em `.forge/specs/active/<change-id>/stories/STORY-NN.md`.

## 4. Verificação interna (antes de gravar)

- [ ] Todas as tasks de `tasks.md` aparecem em exatamente uma story.
- [ ] Grafo `depends_on` das stories é **acíclico** (verifique topologicamente).
- [ ] Nenhuma story referencia task fora de sua lista.
- [ ] `story_id` único por story.

Se alguma verificação falhar, corrija antes de gravar.

## 5. Atualização do manifest

```yaml
dev_loop:
  sharded: true
  stories_path: stories/
  epic_context_compiled: true
```

## 6. Output

```
STORY-NN criadas: <N> stories, <M> tasks distribuídas em <K> waves.
Próximo: /forge:implement (executa story a story; use /forge:wave plan para orquestração por wave).
```

Não despeje a lista de stories no chat — apenas o resumo (§17.6).

## Regras

- Story sem contexto embutido é anti-padrão: o agente implementando a story não deve precisar reler o change inteiro.
- Nunca crie story com 0 tasks.
- Grafo acíclico é não-negociável: ciclos bloqueiam `implement`.
- Não inicie implementação neste comando.
