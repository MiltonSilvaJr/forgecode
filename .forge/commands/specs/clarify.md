---
description: Resolve ambiguidades do change ativo por elicitação — uma pergunta por vez via AskUserQuestion, sem inferir respostas. Remove as marcações NEEDS CLARIFICATION dos artefatos.
argument-hint: "[<change-id>]"
---

# /forge:clarify — elicitação de ambiguidades

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, use o único change em `.forge/specs/active/` — se houver mais de um, pergunte qual).

## Protocolo

1. **Levantamento.** Leia os artefatos do change (`proposal.md`, `requirements.md`/`bugfix.md`/`refactor.md`, `design.md` se existir) e colete:
   - todas as marcações `NEEDS CLARIFICATION`;
   - ambiguidades implícitas (termos vagos, critérios não verificáveis, comportamentos não definidos para casos de erro/limite);
   - conflitos entre artefatos.
2. **Priorize**: bloqueadores de `requirements-ready` primeiro (a transição exige zero `NEEDS CLARIFICATION` — §12).
3. **Uma pergunta por vez**, via `AskUserQuestion`, com 2-4 opções concretas (a opção "Other" existe automaticamente). Contextualize em 1-2 linhas o porquê da pergunta. **Nunca** faça lista de perguntas em texto livre.
4. **Regra anti-inferência (absoluta):** não responda pergunta alguma por conta própria, não escolha defaults silenciosos, não trate "provavelmente X" como decisão. O que o usuário não decidir permanece marcado.
5. **Aplique cada resposta imediatamente** no artefato correspondente, como fato decidido (sem "talvez", "possivelmente", "a definir"). Remova a marcação `NEEDS CLARIFICATION` resolvida. Decisões com impacto em capacidades/paths → espelhe no `manifest.yaml`.
6. **Encerramento.** Quando não restar pendência: reporte em 2-3 linhas (quantas resolvidas, artefatos tocados) e indique o próximo comando (`/forge:requirements` para consolidar, ou `/forge:design`/`/forge:tasks` conforme o estágio). Se o usuário interromper, reporte o que ficou aberto.

## Regras

- Não altere escopo: clarify resolve ambiguidade, não adiciona requisito novo (requisito novo → registrar na `proposal.md` §2 com aprovação do usuário).
- Não transicione status — isso é dos comandos de fase.
- Economia de contexto: não despeje artefatos inteiros no chat; cite apenas o trecho ambíguo (§17.6).
