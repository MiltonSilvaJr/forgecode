---
description: Cria ou atualiza a constituição do projeto (.forge/constitution.md) — princípios inegociáveis que governam agentes e humanos. Mudanças exigem confirmação explícita do usuário.
argument-hint: ""
---

# /forge:constitution — princípios do projeto

## Protocolo

1. **Leia** `.forge/constitution.md` (se existir) e resuma em 3-4 linhas o que está vigente.
2. **Elicitação:** pergunte (AskUserQuestion, uma por vez) o que o usuário quer: adicionar princípio, ajustar, remover, ou apenas revisar. Para princípios novos, capture: o princípio (uma frase imperativa), o porquê (uma frase) e se é **inegociável** (viola = bloqueia) ou **forte** (viola = exige justificativa registrada).
3. **Aplicação:** edite `.forge/constitution.md` preservando a estrutura existente e o histórico de versões do documento (entrada `NOME - DATA - DESCRIÇÃO`). Princípios em linguagem direta, verificáveis quando possível.
4. **Propagação:** rode `bash .forge/scripts/sync-adapters.sh --adapter all` para refletir nas projeções; lembre que `/forge:analyze` e os validators usam a constituição como referência cruzada.

## Regras

- Nunca remova ou enfraqueça um princípio sem confirmação explícita (AskUserQuestion com o texto atual vs proposto).
- A constituição é curta por design — princípios, não procedimentos (procedimentos vivem em rules).
