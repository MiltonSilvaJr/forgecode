---
title: Sem assinatura de IA em commits, PRs e issues
applies_to:
  - all
priority: high
last_reviewed: 2026-07-29
---

# Sem assinatura de IA

O commit pertence a quem decidiu a mudança, revisou o resultado e assume a consequência. A ferramenta usada para escrevê-lo — Claude Code, Codex, Copilot, Cursor, o que for — não é coautora, pelo mesmo motivo que o editor de texto, o compilador e o autocompletar não são. Atribuir autoria a ela corrompe o registro de responsabilidade: `git blame` deixa de responder "quem responde por esta linha" e passa a responder "que ferramenta estava aberta naquele dia".

Rule própria, e não uma seção da [conventional-commits](./conventional-commits.md), porque o eixo é outro: aquela responde *como a mensagem é formatada*, esta responde *a quem o trabalho é atribuído*, e vale igualmente para o corpo de um PR, de uma issue e de uma release note, onde formato de commit não se aplica.

## O que é proibido

Qualquer marca que atribua o trabalho a uma ferramenta de IA, em mensagem de commit, descrição de PR, comentário de issue ou release notes:

- **Trailers de sessão ou ferramenta** — `Claude-Session: https://claude.ai/code/...`, `Copilot-Session:`, `Generated-By: Cursor`, e qualquer chave `<ferramenta>-session`.
- **Coautoria atribuída a IA** — `Co-Authored-By: Claude <noreply@anthropic.com>`, `Co-authored-by: Codex <...>`, em qualquer capitalização.
- **Marcadores de geração** — `🤖 Generated with [Claude Code]`, "Generated with Claude", e variantes.

## O que continua livre

Mencionar ferramentas de IA em **prosa** é normal e não viola nada: `feat(adapters): materializar o adapter claude a partir de .forge` é uma descrição correta do trabalho, e um link para `claude.ai/code` no corpo, citado como referência de ferramenta, também é. A proibição é sobre **atribuição de autoria**, que em git mora nos trailers e nos rodapés de geração — não sobre o vocabulário do projeto.

Essa distinção não é cosmética: é o que torna a regra sustentável. Um detector textual solto (`grep -i claude`) reprovaria metade dos commits legítimos de um repositório que documenta ferramentas de IA, e um gate que atrapalha o trabalho honesto vira `--no-verify` por hábito em duas semanas — o que é pior do que não ter gate nenhum.

## Como é verificado

`scripts/check-ai-attribution.sh`, em três modos:

| modo | onde roda | o que cobre |
|---|---|---|
| `msg-file <path>` | hook `commit-msg` | a mensagem antes de virar commit — o único momento em que remover a marca é grátis |
| `range <rev-range>` | hook `pre-push`, CI | todos os commits a publicar; pega o que nasceu com `--no-verify` ou por ferramenta que ignore o hook |
| `text <path>` | manual, antes de abrir PR/issue | corpo de PR, issue, release notes |

A detecção é **estrutural**: só violam um trailer cuja chave ou valor identifica uma ferramenta de IA, e os marcadores de geração inequívocos. A lógica pura vive em `scripts/lib/ai-attribution.mjs`.

## Configurar a origem também

O gate é a rede de segurança, não a correção. Desligue a atribuição na ferramenta, senão você vai brigar com o hook a cada commit — no Claude Code, em `settings.json`:

```json
{ "attribution": { "commit": "", "pr": "" } }
```

E note por que a configuração **não substitui** a verificação: ela é por máquina e por conta, não viaja num clone novo, não existe num runner de CI, e uma sessão que a ignore produz o trailer assim mesmo. Quando alguém percebe, a marca já está no histórico e removê-la custa reescrever commits — publicados, se já houve push. Configuração previne; o repositório é quem verifica.

## Quando a marca já entrou no histórico

Não reescreva histórico publicado por conta própria. Registre a limpeza como item de ledger, combine a janela com quem tem clone do repositório, e só então reescreva (`git rebase -i` para poucos commits, `git filter-repo` para muitos). Reescrita de branch compartilhada invalida o clone de todo mundo — o custo é do time, então a decisão é do time.
