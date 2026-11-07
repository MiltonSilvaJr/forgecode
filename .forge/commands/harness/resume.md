---
description: Emite o mandato de retomada de sessao (estado do change ativo + regras operacionais fixas) sem o usuario ter que reescreve-lo. Use no inicio de uma sessao nova ou apos compactacao/handoff.
argument-hint: "[<change-id>]"
---

# /forge:resume — mandato de retomada

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, use o único change ativo).

> Objetivo: eliminar a fricção recorrente de reescrever à mão, sessão após sessão, o mesmo
> conjunto de regras operacionais ("model explícito em subagente", "nunca docker build em
> subagente" etc.) junto do estado do change. Este comando lê o estado real (barato, como
> `/forge:status`/`/forge:progress` já fazem) e reafirma as regras fixas — sem reler artefatos
> completos.

## Protocolo

Leia **apenas** arquivos de estado, na mesma disciplina de custo do `/forge:status` e do
`/forge:progress` (§17.3) — nunca releia `requirements.md`/`design.md`/`tasks.md` inteiros aqui:

1. `.forge/FORGE.md` — bloco `runtime:` (stack, comandos test/typecheck/lint, compose) e
   `sdd:` (rigor/scale default).
2. `.forge/specs/active/<change-id>/manifest.yaml` — status do change (fase atual).
3. `.forge/specs/active/<change-id>/progress.json` — wave atual, contagem de stories/tasks
   (mesmos campos que `/forge:progress` reporta).
4. `.forge/specs/active/<change-id>/deferrals.json` — deferrals `open` (bloqueiam `/forge:close`).
5. **Ledger durável** — `bash .forge/scripts/ledger-ops.sh list --status open --by-priority --top 5`
   (ou leia o topo de `.forge/ledger/LEDGER.md`). São os itens de roadmap/dívida/bugs/ideias que
   sobrevivem entre changes; alimentam o "Próximo passo lógico" abaixo. Ver
   `rules/conventions/ledger-consultation.md`. Ausência = sem itens (nenhuma regressão). Item marcado
   `· sem reverificação há <idade>d` descreve o código de uma data antiga: reverifique-o
   (`ledger-ops.sh show`/`verify`) antes de sugeri-lo como próximo passo. A lista é só de `open`;
   itens `planned`/`in-progress` envelhecidos aparecem no `/forge:status`, no `/forge:doctor` e em
   `ledger-ops.sh stale`.
6. `.forge/HANDOFF.md` (se existir) — leia **apenas** a seção `## 4. Delta narrativo` (entre os
   marcadores `FORGE:NARRATIVE-DELTA`) e incorpore-a ao mandato. Ausência do arquivo = comportamento
   inalterado (nenhuma regressão).
7. **Changes órfãos (reconciliação):** `node .forge/scripts/lib/orphan-changes.mjs .` (JSON
   determinista, zero-LLM; pule se node/script ausente). Um `merged_unarchived` (verified ou
   branch mergeada) é forte candidato ao **próximo passo lógico** — `/forge:archive <id>` (verified)
   ou `/forge:verify` (implemented/mergeado) —, à frente de abrir trabalho novo. Um
   `done_not_advanced` (TASKs 100%, status defasado em `tasks-ready`/`implementing`) precisa
   **avançar a chain primeiro** (`spec-transition.sh <id> implementing`/`implemented`) e só então
   `/forge:verify` — `/forge:verify` sozinho falharia a pré-condição de `implemented`.
   Sem órfãos = nada a acrescentar (zero regressão).
8. Se nenhum change ativo existir: diga isso em uma linha, mostre os top itens do ledger (§5) e os
   órfãos do passo 7 como candidatos ao próximo trabalho, e siga para as regras fixas.

## Saída (≤30 linhas)

```
## Retomada — <change-id | "sem change ativo">

Fase: <status do manifest> · Wave: <N> (<open|closed>)
Stories: X/Y done · Tasks: X/Y done
Deferrals abertos: <IDs, ou "nenhum">
Runtime: <stack> · test=<cmd> · typecheck=<cmd> · lint=<cmd>
Ledger: <N open — top: LDG-NNNN título, ...; ou "vazio">

Órfãos: <IDs merged_unarchived/done_not_advanced do passo 7, ou "nenhum">
Próximo passo lógico: <uma linha objetiva — considere o change ativo, os órfãos E os top itens do ledger>
Handoff: <resumo do delta narrativo de .forge/HANDOFF.md, ou "sem handoff">

--- Regras fixas desta sessão ---
1. Subagente SEMPRE com `model` explícito: haiku (bite-sized/paralelizar),
   sonnet (onda/módulo/integração/debugging), opus effort medium (design de
   agregados, ADRs, code-review crítico). Nunca herdar o modelo do orquestrador.
2. Subagente NUNCA roda `docker build`/`docker compose up --build`. Orquestrador
   dispara em `run_in_background` e segue com outra TASK enquanto aguarda.
3. Toda operação git em worktree usa `git -C <worktree>` explícito — nunca `cd`
   implícito que se perde entre chamadas de subagente.
4. Validação real (build/teste) antes de marcar qualquer TASK concluída — o
   relatório do subagente não é a verdade até o orquestrador conferir.
5. Checkpoint + encerrar a sessão por módulo/PR — não acumule múltiplos módulos
   numa sessão só; `/forge:ship` fecha o ciclo antes de abrir o próximo.
6. TDD estrito em todo código — Vermelho → Verde → Refactor. Teste que falha
   primeiro (pelo motivo certo, não erro de build), implementar o mínimo para
   passar, só então refatorar. Vale para features/bugfixes do produto E para
   mudanças na maquinaria do harness (scripts, validadores) — não só onde o
   pipeline já exige Red-first formal.
```

## Regras

- Resposta ≤30 linhas no chat — sem dump de JSON, sem citar trechos de artefatos.
- As "regras fixas" da seção final são sempre as mesmas (não dependem do change) — não invente
  variações; se o usuário quiser mudar alguma, isso é uma decisão de constitution/rules, não
  deste comando.
- Se `.forge/forge.yaml` não existir, siga a mesma pré-checagem de repo-sem-Forge do
  `/forge:status`/`/forge:doctor` e pare.
