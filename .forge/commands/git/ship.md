---
description: Fluxo completo commit -> PR -> revisão por stack → merge em develop → cleanup, num único comando. Exige code-evaluator APPROVED para o SHA atual e confirmação humana antes do merge.
argument-hint: ""
---

# /forge:ship — commit, PR, revisão e merge num comando

Argumentos: nenhum.

> **Este comando É o gate humano (§20.4).** O protocolo `/forge:prepare-pr` existe para
> apresentar a descrição do PR e aguardar aprovação explícita porque, historicamente, abrir PR
> era uma ação separada demais para pedir em linguagem natural toda vez. `/forge:ship`
> automatiza a costura entre as etapas — mas cada etapa (commit, abrir PR, merge) só roda
> porque um humano invocou `/forge:ship` de propósito. Não abrevie isso para "sempre rodar ship
> sem pedir" em automações não supervisionadas.
>
> **Na org vellus-tech o alvo é SEMPRE `develop`** — nunca `main` diretamente (§20.1). Se o
> repositório não seguir essa convenção, pare e pergunte antes de prosseguir.

## Pré-checagens

1. **Working tree tem mudanças?** `git status --porcelain`. Vazio → nada a shippar, pare e informe.
2. **Branch atual.** `git branch --show-current`.
   - Se for `develop` ou `main`: **não commite aqui**. Crie uma branch a partir do diff atual:
     - `git diff --stat` para entender o escopo e sugerir um nome `<tipo>/<escopo>/<descricao-kebab>`
       (rule `.forge/rules/conventions/git-worktree.md`).
     - `git checkout -b <branch-sugerida>` (preserva as mudanças não commitadas).
   - Caso contrário, siga na branch atual.
3. **Testes/gates do FORGE.md.** Rode os comandos declarados em `runtime:` (test/typecheck/lint)
   do `.forge/FORGE.md` (ou `AGENTS.md` gerado) mais os gates deterministas relevantes
   (`.forge/scripts/validate-*.sh`, `npm test`/equivalente do stack). **Falha aqui interrompe o
   comando** — corrija antes de continuar; não shippe quebrado. Se a branch corresponde a um
   change `type: bugfix`, confira `bash .forge/scripts/check-red-first.sh check <change-id>`
   (rule `testing/regression-red-first.md`) — evidência de Red não resolvida também interrompe
   o comando aqui, antes do commit. **Supressão sem referência (REQ-03/REQ-04):** depois de
   `git add` (staged, ainda antes do commit do passo 4), rode
   `bash .forge/scripts/check-suppression-reference.sh --staged` (recipe "Supressão sem
   referência" em `.forge/skills/gate-runner/SKILL.md`) — reprovado, corrija a supressão
   (adicione `LDG-NNNN`/`ADR-NNNN`/`ISSUE-NNN`/`issue #NNN` etc. ao comentário) antes de
   continuar; não shippe com supressão suja.

## Commit(s)

4. Agrupe as mudanças em commits atômicos (Conventional Commits, assunto no imperativo,
   **pt-BR**, **sem trailer de co-autoria de IA** — constitution #8). Se o diff já mistura
   assuntos não relacionados, separe em múltiplos commits por `git add -p`/paths explícitos em
   vez de um commit único genérico.

## Descrição do PR

5. **Reuse o protocolo do `/forge:prepare-pr`** para montar título + corpo: objetivo (2-3
   linhas), o que mudou (bullets), como foi verificado (gates/testes executados no passo 3),
   pendências. Com lifecycle ativo, puxe de `requirements.md`/`tasks.md`/`verification.yaml` do
   change; sem lifecycle, do diff + commits da branch.

## Abrir o PR

6. `git push -u origin <branch>` e:

   ```bash
   gh pr create --base develop --title "<título>" --body "$(cat <<'EOF'
   <corpo montado no passo 5>
   EOF
   )"
   ```

## Revisão

7. Rode o `code-evaluator` canônico sobre `base=develop` e `diff_sha=$(git rev-parse HEAD)` antes do merge. Ele executa gates determinísticos e seleciona os reviewers transversais e de stack aplicáveis ao diff (C#/.NET, Node, Java, Python). Um veredito só vale para esse SHA: se qualquer correção alterar o diff, reexecute o evaluator.
8. **Só prossiga com `APPROVED` ou `APPROVED_WITH_COMMENTS` sem findings BLOCKER/HIGH abertos.** Se o ambiente não puder executar o `code-evaluator`, não substitua por revisão manual e não faça merge; registre a indisponibilidade como bloqueio para o humano decidir.
9. **Todo achado precisa ser corrigido (ou explicitamente descartado com justificativa) antes do
   merge.** Não faça merge com findings abertos "para depois" — se for genuinamente fora de
   escopo, registre um deferral (`/forge:defer`) em vez de ignorar silenciosamente.
10. Se corrigiu algo no passo 9, commit adicional + `git push` (atualiza o PR automaticamente) e volte ao passo 7.

## Mudanças de contenção da mensageria nativa (REQ-12, design §2.7)

10b. **Antes da decisão de merge**, rode `bash .forge/scripts/liaison-ops.sh native containment
    --range develop..HEAD --format markdown`. Se a saída não for vazia, inclua-a como seção
    `## Mudanças de contenção` no corpo do PR (ou atualize o PR já aberto). **Qualquer achado, ou
    rc 2 (detector indisponível), faz o merge cair para confirmação humana explícita — mesmo em
    modo `--yolo`.** Não é uma recusa do comando: é a decisão de merge que deixa de ser
    autônoma. Sem achado e rc 0 ("nenhuma mudança de contenção detectada"), o merge segue o fluxo
    normal do passo 11 (humano em modo padrão, `yolo-gate` em `--yolo`).

## Merge + cleanup

11. Após revisão limpa, confirme com o usuário em uma linha (a menos que ele já tenha
    pré-aprovado o fluxo completo desta sessão) e então:

    ```bash
    gh pr merge <numero-ou-branch> --squash --delete-branch
    git checkout develop
    git pull
    ```

12. Se havia um worktree dedicado para esta branch (`.forge/worktrees/<...>`), remova-o
    (`git worktree remove ...`) — o hook `post-merge` já tenta isso automaticamente; confirme que
    rodou.

## Fechar o loop de lifecycle (pós-merge)

13. **Se o merge fechou um change SDD**, o status dele não avança sozinho — reconcilie. Rode
    `node .forge/scripts/lib/orphan-changes.mjs .` (determinista, zero-LLM; pule se ausente) e, para
    o change correspondente a esta branch, **ofereça em uma linha** (nunca execute automaticamente —
    a incorporação ao baseline é decisão humana):
    - `verified` → `/forge:archive <id>` (incorpora ao baseline; o gate `human_archive_approval`
      permanece HITL humano — domínio financeiro). O archive roda fim a fim na hora: o
      `spec-delta.yaml` já nasceu autorado na fase verify (§2.5) e o pré-flight auto-recupera
      `impact.json` stale (o merge que acabou de acontecer mudou o grafo — o script re-roda
      `graph update` → `impact --change` sozinho).
    - `implemented` → `/forge:verify` antes do archive.
    - `tasks-ready`/`implementing` com TASKs 100% → `bash .forge/scripts/spec-transition.sh <id>
      implementing` / `... implemented` para destravar, depois `/forge:verify`.

    Não pule etapas da chain do `spec-transition.sh` nem arquive fora do `/forge:archive`. Se o
    change não for mapeável à branch (sem órfão correspondente), não invente — apenas siga.

## Resumo final

Reporte em poucas linhas: branch shippada, número/link do PR, gates que passaram, achados de
revisão corrigidos (se houver), e confirmação de que `develop` está atualizado localmente.

## Regras

- Sem co-autoria de IA em nenhum commit ou PR (título/corpo) — constitution #8.
- Alvo do PR é sempre `develop` (§20.1) — nunca `main`.
- Não pule o passo de testes/gates (3) nem o de avaliação canônica (7-10) "para ganhar tempo" — são o que
  torna `/forge:ship` seguro para ser um comando único em vez de um checklist manual.
- Não há flag para pular o `code-evaluator`; revisão manual é complemento, não substituto.

## Modo autônomo (--yolo)

`--yolo` (ou `autonomy.mode: yolo`) delega a decisão de revisão/merge ao agent `yolo-gate` (Opus, effort high), que analisa o diff e decide seguir ou segurar. `ship` **não** é um gate de lifecycle de spec (não há entrada em `approvals.yaml` para ele) — a decisão autônoma é o próprio prosseguir com o merge, não um registro em approvals. Merge para `develop` **é** yolo-able (integração contínua de baixo custo). **`promote_staging` e `deploy_prd` são `irreversible_hard_stops`** — permanecem humanos mesmo em yolo. Achados de revisão ainda precisam ser corrigidos/deferidos antes do merge (yolo não faz merge com finding aberto). **Merge com mudança de contenção da mensageria nativa (passo 10b) cai para confirmação humana mesmo em yolo** — o `yolo-gate` decide `block` com o motivo "mudança de contenção exige humano" em vez de aprovar o merge sozinho. Ver `.forge/rules/conventions/autonomy-yolo.md`.
