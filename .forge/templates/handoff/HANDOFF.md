# Handoff — {{CHANGE_ID}}

> Artefato de passagem de contexto entre sessões e entre code agents (Codex ↔ Claude Code ↔ …).
> Gerado por `/forge:handoff` (ou pelo hook opt-in de sessão). Seções 1-3 e 5 são determinísticas
> (montadas a partir do estado do change); a seção 4 é o único texto narrativo. **Não é fonte da
> verdade** — o estado canônico vive em `.forge/specs/active/{{CHANGE_ID}}/`.

## 1. Header

- **Change:** `{{CHANGE_ID}}` · type `{{TYPE}}` · scale `{{SCALE}}` · fase `{{PHASE}}`
- **Branch:** `{{BRANCH}}` · HEAD `{{SHA}}` ({{DATE}})

## 2. Estado

- **Wave atual:** {{WAVE}}
- **Stories:** {{STORIES_DONE}}/{{STORIES_TOTAL}} · **Tasks:** {{TASKS_DONE}}/{{TASKS_TOTAL}}
- **Deferrals abertos:** {{OPEN_DEFERRALS}}
- **Runtime:** test=`{{RUNTIME_TEST}}` · typecheck=`{{RUNTIME_TYPECHECK}}` · lint=`{{RUNTIME_LINT}}`

## 3. Regras fixas da sessão

1. Subagente SEMPRE com `model` explícito: haiku (bite-sized/paralelizar), sonnet
   (onda/módulo/integração/debugging), opus effort medium (design de agregados, ADRs, code-review
   crítico). Nunca herdar o modelo do orquestrador.
2. Subagente NUNCA roda `docker build`/`docker compose up --build`. O orquestrador dispara em
   `run_in_background` e segue com outra TASK enquanto aguarda.
3. Toda operação git em worktree usa `git -C <worktree>` explícito — nunca `cd` implícito que se
   perde entre chamadas de subagente.
4. Validação real (build/teste) antes de marcar qualquer TASK concluída — o relatório do subagente
   não é a verdade até o orquestrador conferir.
5. Checkpoint + encerrar a sessão por módulo/PR — não acumule múltiplos módulos numa sessão só;
   `/forge:ship` fecha o ciclo antes de abrir o próximo.
6. **TDD estrito em todo código — Vermelho → Verde → Refactor.** Teste que falha primeiro (pelo
   motivo certo, não erro de build), implementar o mínimo para passar, só então refatorar. Vale
   para features/bugfixes do produto E para mudanças na maquinaria do harness (scripts,
   validadores) — não só onde o pipeline já exige Red-first formal.

## 4. Delta narrativo

<!-- FORGE:NARRATIVE-DELTA:START -->
_(A preencher: o que mudou desde o último handoff, foco atual, decisões/perguntas abertas, próximo
passo lógico, gotchas. Rule-based/hook deixa esta seção como está; `/forge:handoff` a preenche.)_
<!-- FORGE:NARRATIVE-DELTA:END -->

## 5. Como retomar

- **Claude Code:** rode `/forge:resume {{CHANGE_ID}}` (lê o estado + ingere esta seção 4).
- **Outro agente (Codex/Cursor/Gemini):** leia este arquivo inteiro; o estado detalhado está em
  `.forge/specs/active/{{CHANGE_ID}}/` (`manifest.yaml`, `progress.json`, `deferrals.json`,
  `tasks.md`). Siga as regras da seção 3.

<!-- FORGE:HANDOFF-DIGEST -->
<!-- Hash do conteúdo fora deste bloco, gravado pelo próprio gerador — não edite à mão (#120). -->
