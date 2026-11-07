---
description: Valida o harness Forge e a tooling do projeto (stacks, adapters, symlinks, drift de lockfile, placeholders orfaos). Use apos init/sync, ao suspeitar de drift, ou antes de abrir PR.
---

# /forge:doctor

> **Pré-checagem (repo sem Forge).** Se `.forge/forge.yaml` **não existe** no diretório atual, este repositório ainda não tem o engine Forge — o `.forge/scripts/doctor.sh` nem está presente. **Não tente rodar scripts.** Responda exatamente isto e pare:
> *"Este repositório não tem o engine Forge (`.forge/` ausente). Os comandos `/forge:*` aparecem em todo projeto (o plugin é global), mas precisam do engine por projeto. Rode `npx forge-harness@latest init` na raiz e depois `/forge:doctor` de novo. (Não existe `/forge:init` por design — o bootstrap é uma operação do instalador.)"*

Execute o validador determinista e reporte o resultado de forma compacta:

1. Rode `bash .forge/scripts/doctor.sh --report` (saída completa em `/tmp/forge-doctor.log` se longa; leia só o necessário).
2. Se exit code = 0: responda em 1-3 linhas confirmando harness e diagnósticos OK.
3. Se exit code = 1: liste APENAS os itens `✗` (miss) com a ação sugerida de cada um (ex.: "rode `.forge/scripts/sync-adapters.sh`"). Não despeje a saída inteira.
4. Se o usuário pedir correção automática (`--install` para tooling de stack), confirme antes — o doctor nunca instala nada sozinho.

Checks de harness cobertos (§19.1): FORGE.md/forge.yaml presentes, AGENTS.md é projeção gerada, symlinks CLAUDE/QWEN/GEMINI.md → AGENTS.md (ou cópia gerada), fonte canônica sem refs legadas ao diretório do adapter Claude, sem placeholders `<PROJECT_*>` órfãos, lockfile do adapter sem drift, e (best-effort, puramente informativo) se o plugin `/forge:*` está instalado/habilitado no Claude Code do operador quando a CLI `claude` está disponível — sintoma clássico sem esse check: usuário colando o corpo dos comandos como texto porque `/forge:*` não existia silenciosamente. Sem `claude` no PATH, o check é pulado (não quebra CI); com `claude` presente mas sem o plugin, aparece como aviso `·` (nunca como falha — é estado global do operador, não do projeto) sugerindo `npx forge-harness install-plugin`.

**Mensageria nativa entre sessões (REQ-12, design §2.7, informativo, nunca `MISSING_DIAG`):** quando o harness tem o módulo `native-containment.mjs`, o doctor roda o detector `native containment` no estado atual e soma avisos de cruzamento de participantes de canal (`peer-path` em workspace não cadastrado, participante sem `peer-path` — "não verificável", cadastro ativo sem participante correspondente) e avisos extras (gancho de saída `guard-cross-session-send.sh` inativo, `self_identity` ausente, `disableAllHooks`/sobreposição de `PreToolUse` em `settings.local.json`/`~/.claude/settings.json`, edição não commitada do cadastro, cadastro do `HEAD` do tronco diferente do upstream). É sinalização para decisão humana — a contenção por workspace é proteção contra liberação induzida, não fronteira de segurança.
