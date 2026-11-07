---
description: Gera/atualiza o plugin Claude Code "forge" (slash commands /forge:*) a partir de .forge/commands/**. Necessario porque o Claude Code (>= 2.x) descontinuou o namespace via subdiretorio em .claude/commands/ — /forge:* so funciona via plugin. Use apos adicionar/editar comandos, ou para instalar/atualizar o plugin.
argument-hint: "[--out <dir>] [--version <x>]"
---

# /forge:build-plugin — materializa o plugin /forge:*

Por que: o Claude Code reserva o namespace `:` para PLUGINS — comandos soltos em
`.claude/commands/` viram apenas `/<arquivo>` (sem `forge:`). Este comando empacota os
mesmos `.md` de `.forge/commands/**` num plugin cujo `name` e `forge`, restaurando `/forge:*`.

Execute de forma determinista e reporte curto:

1. Rode o gerador (default: instala como skills-dir plugin, auto-load na proxima sessao):
   ```bash
   bash .forge/scripts/build-plugin.sh $ARGUMENTS
   ```
   - Sem `--out`, gera em `~/.claude/skills/forge/` → carrega como `forge@skills-dir`.
   - Para testar sem instalar global: `--out .forge/dist/plugin/forge` e depois
     `claude --plugin-dir .forge/dist/plugin/forge`.

2. Reporte o numero de comandos e o destino (a saida do script ja traz `OK plugin 'forge' vX → <dir> (N comandos)`).

3. Avise o usuario que o plugin so aparece na **proxima sessao** (ou apos `/reload-plugins`),
   e que ele e **global** (vale para todos os projetos). O engine que os comandos chamam
   (`.forge/scripts/...`) continua vindo do `.forge/` de cada projeto.

Notas:
- Determinista: rodar 2x e byte-identico. Valide o manifesto com `claude plugin validate <dir>`.
- Distribuicao alternativa (sem regenerar local): marketplace git do forge-harness
  (`/plugin marketplace add vellus-tech/forge-harness` + `/plugin install forge`).
