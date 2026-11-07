---
description: Lista e orienta a ativação de capability packs opt-in por stack. Use quando o doctor sugerir um pack, quando o usuário quiser aplicar playbook C#/.NET, Node, Java ou Python, ou para conferir precedência e compatibilidade antes de ativar um preset.
argument-hint: "list|show <pack>|activate <pack>"
---

# /forge:capabilities

Packs são orientação adicional e nunca substituem constitution, baseline, ADRs, customizações ou o padrão brownfield. Eles não instalam dependências, não sobem Docker e não refatoram o projeto.

## list

Liste os diretórios em `.forge/capabilities/` e mostre `id`, `status` e `applies_to` do frontmatter de cada `PROFILE.md`.

## show

Leia somente `.forge/capabilities/<pack>/PROFILE.md`; confirme a área afetada, ADRs relacionados e conflitos antes de sugerir ativação.

## assets (quando o pack traz enforcement da stack)

`backend-dotnet-relational` traz `assets/` com `Directory.Build.props`, `Directory.Packages.props` e `editorconfig` — a camada que transforma convenção em erro de compilação. Audite com `bash .forge/scripts/dotnet-baseline.sh --check` e materialize com `--apply`. Em brownfield, apresente o relatório do check e obtenha decisão humana antes de aplicar: são três arquivos na raiz, e ligar analisadores numa base existente costuma acusar violações preexistentes em volume (por isso o apply usa `AnalysisMode Recommended`, não `All`). O script nunca sobrescreve arquivo existente sem `--force`.

## activate

Antes de editar, confirme que a decisão é desejada para o projeto e não apenas para uma task. Adicione o id sem duplicação à lista `capabilities.active` de `.forge/forge.yaml`, rode `bash .forge/scripts/doctor.sh --report` e registre a decisão em ADR quando ela altera a arquitetura, ferramenta ou política de dados. Se houver conflito com baseline, ADR ou `custom/`, não ative até a decisão humana resolver a precedência.

Os packs iniciais são `backend-dotnet-relational`, `backend-node-postgres`, `backend-java-relational` e `backend-python-relational`.
