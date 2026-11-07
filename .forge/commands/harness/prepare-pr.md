---
description: Prepara a descricao de um PR da branch de trabalho para develop a partir dos artefatos da mudanca. Nao abre o PR sozinho - apresenta para confirmacao (§20.4).
---

# /forge:prepare-pr

Direcionador `prepare-pr` (§20.4). **Não abre o PR sem confirmação do usuário.**

1. Identifique a branch atual (`feature/<change-id>`) e o diff contra `develop` (`git log develop..HEAD --oneline`; `git diff develop --stat | tail -5`).
2. Monte a descrição do PR a partir dos artefatos disponíveis da mudança:
   - Com lifecycle (MVP2+): `requirements.md`/`tasks.md` do change ativo + evidências de `verification.yaml`.
   - Sem lifecycle ainda: commits da branch + resumo do diff.
3. **Mudanças de contenção da mensageria nativa (REQ-12, design §2.7).** Rode `bash .forge/scripts/liaison-ops.sh native containment --range develop..HEAD --format markdown`. Se a saída não for vazia, inclua-a como seção `## Mudanças de contenção` no corpo do PR — é informação para o humano decidir o merge, não motivo para recusar este comando. Se o comando sair com rc 2 (detector indisponível), registre na mesma seção "detector indisponível — ver `native containment`" em vez de omitir a seção.
4. Estrutura da descrição: objetivo (2-3 linhas), o que mudou (bullets), como foi verificado (gates/testes executados), mudanças de contenção (passo 3, se houver), pendências. Alvo do PR: **sempre `develop`** (§20.1).
5. Apresente título + corpo para revisão. Só após aprovação explícita: `gh pr create --base develop ...`.
6. Lembrete: sem co-autoria de IA no título/corpo (constitution #8).
