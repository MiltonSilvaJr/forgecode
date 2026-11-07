---
title: Maquinaria versionada na árvore não se propaga sozinha
applies_to:
  - all
priority: high
last_reviewed: 2026-08-19
---

# Maquinaria versionada na árvore não se propaga sozinha

O harness vive **dentro** da árvore de trabalho: `.forge/scripts/`, `.forge/rules/`, `.forge/schemas/`, `.forge/templates/`, `.forge/hooks/`, `.forge/agents/` e o plugin são arquivos versionados como qualquer outro. A consequência é fácil de esquecer e cara de descobrir: um gate, um script ou uma rule corrigidos no tronco continuam sendo a **versão antiga** em todo worktree ativo, e quem trabalha ali recebe verde de um gate que não está rodando.

Não é hipótese. Medido no `axis-go-cloud`: cinco dos oito worktrees ativos estavam com 86 a 103 arquivos divergentes de `develop` em `.forge/{scripts,rules,schemas,templates}`. Regras escritas no dia anterior não existiam em nenhum deles, e qualquer `verify`, `red-first` ou validador executado dali rodava a versão da branch.

## O que a regra exige

**Quem atualiza maquinaria atualiza a partir do tronco.** `npx forge-harness update` **recusa** rodar de dentro de um worktree linkado, e a recusa não tem flag de escape: aplicar o overlay num worktree escreve a maquinaria nova apenas naquela branch, e o tronco mais os demais worktrees ficam para trás. A mensagem de recusa diz o caminho do checkout principal.

**Estado de projeto mora no tronco, não na branch.** O ledger é o caso canônico: `ledger-ops.sh` resolve seu `ROOT` pelo `--git-common-dir` (o `.git` compartilhado), nunca pelo `--show-toplevel` (que dentro de um worktree devolve o próprio worktree). Registro feito de dentro de uma branch que nasce no `ledger.json` daquela branch faz toda branch que toca o ledger colidir por construção no merge. Qualquer maquinaria nova que escreva estado durável de projeto — e não estado do change em curso — segue o mesmo idioma.

**Config local que aponta para maquinaria aponta para o tronco, em caminho absoluto.** `core.hooksPath` vive no `.git/config` **comum**, compartilhado por todos os worktrees, e um valor relativo é resolvido por cada worktree contra a própria árvore. Um hook novo, versionado e já mergeado, então não bloqueia nada em nenhum worktree ativo — e a única evidência disso é o commit proibido passando em silêncio. `init` e `update` gravam o caminho absoluto do tronco; o `doctor` verifica e acusa quando o apontamento quebrou.

**Comando que atualiza maquinaria reporta a divergência dos worktrees.** Não basta escrever no tronco: o `doctor` lista, por worktree linkado, quantos arquivos de maquinaria divergem e quantos commits aquele worktree está à frente. É informativo e nunca reprova — sincronizar é decisão de quem tem o contexto da branch, e um worktree legitimamente à frente do tronco também aparece ali —, mas a divergência deixa de ser invisível.

## Por que config local não versionada não basta

`core.hooksPath` é config de máquina: some num clone novo, some num runner de CI, some quando alguém troca de laptop. Gravá-lo corretamente no `init`/`update` cobre o caminho feliz, e o `doctor` cobre a deriva — mas nenhum dos dois cobre quem nunca rodou nenhum dos dois. Por isso o backstop independente de máquina é o **CI**: um check que reprove PR cujo diff toque arquivos que só deveriam mudar no tronco não depende de configuração local de ninguém.

Ver também: [git-worktree](./git-worktree.md), [ledger-consultation](./ledger-consultation.md), e a rule de prova de gate em [testing/gate-delivery-channel](../testing/gate-delivery-channel.md).
