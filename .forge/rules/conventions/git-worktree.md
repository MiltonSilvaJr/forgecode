---
title: Workflow com Git Worktree
applies_to:
  - all
priority: high
last_reviewed: 2026-05-31
---

# Workflow com Git Worktree

## Princípio

O <project_name> adota git worktree como estratégia padrão de desenvolvimento. Isso permite que desenvolvedores humanos e agentes de IA trabalhem em branches paralelas ao mesmo tempo, sem bloquear uns aos outros e sem risco de interferência entre árvores de trabalho.

Cada tarefa — seja executada por humano ou por agente — ocorre em seu próprio worktree isolado. O branch `main` nunca é o alvo de trabalho direto.

## Diretrizes

1. **Nunca trabalhar diretamente no `main`.** Toda mudança começa em um branch criado via `git worktree add`.

2. **Um worktree por tarefa.** Não reutilizar um worktree de feature concluída para uma nova tarefa — criar um novo.

2.1. **A worktree nasce com branch, sempre.** `git worktree add <dir> HEAD` e `git worktree add --detach <dir>` produzem HEAD destacado, e worktree destacada não tem o que empurrar, não admite PR e perde o rastro do trabalho no instante em que é removida. O jeito certo continua sendo passar `-b <tipo>/<escopo>/<descricao>` na criação. Quem esquecer é atendido pelo hook `post-checkout` do harness, que dá à worktree um nome de partida `wt/<slug>` e imprime o comando de rename — o prefixo `wt/` é legítimo como ponto de partida e é o sinal legível de que ninguém nomeou a branch direito. Renomear depois é seguro: `git branch -m` leva a worktree junto, porque o HEAD de uma worktree atacada é uma ref simbólica e o git a atualiza no rename. E o namespace `wt/` é isento da limpeza automática do `post-merge`: uma worktree que teria nascido destacada era imune por estrutura àquela limpeza, e ganhar nome não pode transformá-la em candidata à remoção. Ao renomear para fora de `wt/`, ela volta a essa população — que é exatamente o que já valia para toda branch nomeada à mão.

3. **Localização canônica: `.forge/worktrees/`.** Todos os worktrees ficam **dentro do repositório**, sob `.forge/worktrees/<escopo>-<descricao>` — ex.: `.forge/worktrees/feature-foo`, `.forge/worktrees/agent-bar`. Centralizar os worktrees ali mantém a organização e alinha com o diretório que a ferramenta de worktree nativa do harness já utiliza.

4. **`.forge/worktrees/` é ignorado pelo `.gitignore`.** Worktree dentro da árvore de trabalho não pode ser versionado; a entrada no `.gitignore` é obrigatória (já contemplada pelo template do projeto).

5. **Nomenclatura de worktrees locais:** `<escopo>-<descricao>` — ex.: `feature-foo`, `agent-bar`. (Sem prefixo de tecnologia.)

6. **Nomenclatura de branches:** `<tipo>/<escopo>/<descricao-em-kebab-case>` — ex.: `feat/payments/pix-qrcode-generation`, `fix/finance/ledger-split-rounding`.

7. **Agentes de IA sempre em worktree dedicado.** Uma sessão de Claude Code, Codex ou similar NUNCA opera no mesmo worktree que um humano. O worktree do agente deve ser criado antes de iniciar a sessão.

8. **Remover worktree após PR mergeado.** Worktrees acumulados consomem espaço e causam confusão. Limpar logo após o merge.

9. **Commits frequentes no worktree.** Worktrees não têm stash implícito — commitar o trabalho em progresso antes de qualquer operação potencialmente destrutiva.

## Exemplos Positivos

```bash
# Criar worktree para nova feature (a partir da raiz do repositório)
git worktree add .forge/worktrees/feature-foo -b feat/payments/pix-qrcode-generation

# Criar worktree para agente de IA
git worktree add .forge/worktrees/agent-bar -b feat/finance/ledger-split-fix

# Listar worktrees ativos
git worktree list

# Remover após merge
git worktree remove .forge/worktrees/feature-foo
git branch -d feat/payments/pix-qrcode-generation
```

```bash
# Iniciar Claude Code em worktree isolado
cd .forge/worktrees/agent-bar
claude  # agente opera neste diretório isolado
```

## Anti-Patterns

```bash
# ERRADO: trabalhar no main
cd ~/Documents/projects/<project_name>
git checkout main
# editar código direto no main...

# ERRADO: criar worktree como diretório irmão do repo (fora de .forge/worktrees/)
git worktree add ../feature-foo -b feat/...   # perde a organização central

# ERRADO: dois agentes no mesmo worktree
cd .forge/worktrees/agent-bar
# sessão 1 do Claude Code rodando...
claude  # sessão 2 — interferência garantida

# ERRADO: reutilizar worktree de feature antiga
git worktree add .forge/worktrees/feature-foo  # já existia de outra feature
```

## Verificação

- `git worktree list` deve mostrar apenas worktrees ativos sob `.forge/worktrees/`, com branch correspondente
- Nenhum commit diretamente em `main` por desenvolvedor ou agente
- `.forge/worktrees/` presente no `.gitignore`
- Worktrees sem PR aberto há mais de 5 dias são candidatos a limpeza

## Referências

- `CONTRIBUTING.md` — workflow completo de contribuição: _documento a criar na raiz do repositório — referência pendente._
- [git-worktree(1)](https://git-scm.com/docs/git-worktree)
