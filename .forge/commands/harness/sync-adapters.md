---
description: Regenera os adapters (.claude, AGENTS.md, symlinks) a partir da fonte canonica .forge. Use apos editar qualquer arquivo em .forge/ ou quando o doctor reportar drift.
---

# /forge:sync-adapters

Regenera os adapters a partir da fonte canônica `.forge/`. Os adapters **ativos** deste repo
ficam registrados em `forge.yaml` (`harness.adapters`); só eles são materializados.

- **Regenerar os ativos** (uso comum, após editar `.forge/**`): `bash .forge/scripts/sync-adapters.sh --adapter all` (acrescente `--copy-links` se o ambiente não suportar symlinks).
- **Mudar o conjunto ativo** (adicionar/remover um agente): `bash .forge/scripts/sync-adapters.sh --set <lista>` — ex.: `--set claude,codex`. Isso reescreve a lista em `forge.yaml`, gera os que faltam e **poda** os que saíram (remove pastas/símbolos do adapter desativado). Antes de remover um agente, confirme com o usuário (HITL).
- **Regenerar só um**: `--adapter <nome>` (não altera a lista nem poda).

Passos:
1. Rode o comando adequado acima.
2. Confirme a linha final `OK reconcile complete: ...` (ou `OK <nome> adapter synced`).
3. Rode `bash .forge/scripts/doctor.sh --report` e confirme os adapters ativos "sem drift".
4. Reporte em 1-2 linhas. Lembre: os alvos gerados (`.claude/`, `.cursor/`, `AGENTS.md`, symlinks…) **nunca** são editados à mão — toda edição acontece em `.forge/**` seguida de re-sync.

Adapters disponíveis: `claude`, `codex`, `gemini`, `qwen`, `forge-cli`, `agents-skills`, `kiro`, `cursor` (declarações em `.forge/adapters/*.yaml`).
