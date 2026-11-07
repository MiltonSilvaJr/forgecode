---
description: Gera um handoff portátil e agente-agnóstico em .forge/HANDOFF.md a partir do estado do change ativo — para passar contexto entre sessões ou entre code agents (Codex, Cursor, Gemini). Núcleo determinístico via script; só o delta narrativo é escrito pelo modelo.
argument-hint: "[<change-id>]"
---

# /forge:handoff — handoff portátil entre sessões/agentes

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, usa o único change ativo).

> Objetivo: persistir, num único arquivo markdown que qualquer agente lê, o estado + as regras
> operacionais fixas + um delta narrativo curto — eliminando o "prepare um hand-off" manual e o
> atrito de trocar de code agent (ex.: Codex → Claude Code). Diferente do `/forge:resume` (mandato
> efêmero, só no Claude), o handoff é um artefato versionado em git e agente-agnóstico.

## Protocolo (híbrido: script determinístico → delta narrativo)

1. **Scaffold determinístico** — rode o gerador, que monta as seções 1-3 e 5 de `.forge/HANDOFF.md`
   a partir do estado (`manifest.yaml`/`progress.json`/`deferrals.json` + runtime + git HEAD):

   ```bash
   bash .forge/scripts/handoff-gen.sh <change-id>
   ```

   (No repo-fonte do harness, onde `.forge/` não é materializado, use
   `FORGE_ROOT="$(pwd)" bash template/.forge/scripts/handoff-gen.sh <change-id>`.)

2. **Delta narrativo (seção 4)** — leia o estado barato (como `/forge:progress`) e substitua o
   conteúdo entre `<!-- FORGE:NARRATIVE-DELTA:START -->` e `<!-- ...:END -->` por 4-8 linhas:
   o que mudou desde o último handoff, foco atual, decisões/perguntas abertas, próximo passo lógico
   e gotchas. **Não** reescreva as seções determinísticas (o script é a fonte delas).

3. **Confirme** — informe o caminho gravado (`.forge/HANDOFF.md`) em uma linha.

## Regras

- O delta narrativo é a única parte escrita por modelo; não é fonte da verdade (o estado canônico
  vive em `.forge/specs/active/<change-id>/`).
- Não releia artefatos completos (`requirements.md`/`design.md`/`tasks.md`) para montar o delta —
  disciplina de custo de contexto (§17.3), igual a `/forge:progress`/`/forge:resume`.
- O hook opt-in de sessão (`forge.yaml > handoff.auto: true`) roda o passo 1 automaticamente ao
  fim da sessão (rule-based, sem delta) e injeta o arquivo no início da próxima — este comando é a
  versão on-demand e enriquecida.
- Se `.forge/forge.yaml` não existir (repo sem Forge materializado), rode via `FORGE_ROOT` como no
  passo 1.

## Transferência de posse

**O snapshot gerado aqui não tem dono.** `.forge/HANDOFF.md` é um retrato do estado — qualquer
sessão, deste repositório ou de outro participante do liaison, pode lê-lo, e nada neste comando
reivindica uma unidade de trabalho em nome de ninguém. Quando o que se quer é efetivamente
TRANSFERIR a posse de um trabalho a outra sessão ou a outro repositório — não só deixar um
retrato para quem vier depois —, o caminho é `liaison-ops.sh baton offer <channel> --thread <id>
--subject "<txt>" --from-handoff`: ele usa este mesmo `HANDOFF.md` como corpo da oferta
(gerando-o na hora se ainda não existir), e a partir daí qualquer participante elegível pode
`baton claim` a unidade de trabalho com um dono único e rastreável. Ver `/forge:liaison` (seção
"Bastão de dono único") e a rule
[liaison-protocol](../../rules/conventions/liaison-protocol.md#bastão-de-dono-único).
