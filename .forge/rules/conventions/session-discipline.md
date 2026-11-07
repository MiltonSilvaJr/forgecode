---
title: Disciplina de Sessão Longa (Autopilot §17.6)
applies_to:
  - agents
  - commands
  - workflows
priority: high
last_reviewed: 2026-06-11
---

# Disciplina de Sessão Longa (Autopilot §17.6)

Regras de economia de contexto para implementações que duram horas ou dias. Anti Classe G (degrada sessão por acúmulo de contexto desnecessário).

## Regras de output

- **Uma linha por gate**: `OK <gate>` ou `FAIL <gate> (<pista>)`. Nunca despejar log no chat.
- **Output bruto em `/tmp`**: todo comando externo redireciona para `/tmp/forge-<nome>.log`; você lê apenas `tail -20` do log quando precisar diagnosticar.
- **Sem resumo entre tasks**: ao concluir uma task, emita uma linha de progresso (`TASK-NN ✓ <título> (<sha>)`) e avance. Sem "o que foi feito", sem "próximos passos" por task.
- **Sem resumo de wave**: ao fechar uma wave, emita uma linha de confirmação. O `/forge:progress` é o canal de status — não o chat.
- **Orçamento de contexto**: antes de ler um arquivo, pergunte-se se a story/task realmente precisa dele. Em modo story-by-story, leia apenas os artefatos da story atual (skill `story-context`).

## Regras de execução

- **Todo comando externo com timeout**: use `perl -e 'alarm N; exec @ARGV' -- <cmd>`. N razoável por tipo: smoke ≤120s, build ≤180s, test suite ≤300s, query de banco ≤30s.
- **Falha irrecuperável**: marque `[!]` na task, emita uma linha descrevendo o bloqueio e pare. Nunca pule para outra task de wave diferente. **Premissa nomeada (REQ-01/REQ-02):** quando a causa é "gate falha após 2 tentativas de correção", o bloco de falha (`tasks.md`/`PROGRESS-TRACKING.md`) ganha os campos `Gate:`, `Premissa:` e `Ator(es) com o desequilíbrio:` no formato descrito em `.forge/commands/specs/implement.md` e `.forge/agents/coding/task-coder.md` §3.7 — a retomada que repete a forma da tentativa anterior sob a mesma premissa não atende ao requisito, mesmo que autorizada.
- **Retomada idempotente**: ao reiniciar após interrupção, leia `progress.json` para saber onde parar — nunca releia todos os artefatos.

## Anti-padrões explicitamente proibidos

- `cat design.md` inteiro para extrair um campo — use `grep`/`awk`.
- Resumo narrativo de vários parágrafos ao final de cada wave.
- "Vou fazer X porque Y e Z" antes de cada task — aja diretamente.
- Comando sem timeout que pode pendurar a sessão.
- Reler `tasks.md` completo para descobrir a próxima task — use `progress.json`.

## Referência

§17.6 do FORGE.md — Disciplina de Autopilot. Ver também: skill `gate-runner` (gates em uma linha), `/forge:progress` (status sem reler artefatos).
