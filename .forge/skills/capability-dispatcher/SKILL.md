---
name: capability-dispatcher
description: Carrega somente os capability packs Forge aplicáveis à área afetada de uma mudança. Use ao planejar, implementar, revisar ou verificar código quando `.forge/forge.yaml` tiver `capabilities.active`, quando o doctor sugerir um pack de stack, ou quando a tarefa tocar C#/.NET, Node/TypeScript, Java, Python ou migrations relacionais.
---

# Capability Dispatcher

Capability packs são orientação opt-in por stack. Eles não substituem `FORGE.md`, constitution, baseline, ADRs, rules ou o código brownfield.

## Protocolo

1. Leia `capabilities.active` em `.forge/forge.yaml` e determine a área afetada pelo manifest, grafo ou diff.
2. Para cada pack ativo e aplicável, leia somente `.forge/capabilities/<id>/PROFILE.md`.
3. Carregue as rules transversais indicadas pelo trabalho, especialmente `rules/data/schema-evolution.md` e `rules/testing/change-test-contract.md` quando houver migration, endpoint, persistência ou UI.
4. Se um ADR, baseline, rule customizada ou código existente divergir do pack, registre a divergência e siga a fonte de maior precedência. Não refatore para o pack automaticamente.
5. No verify, reporte quais critérios do pack foram aplicados, não aplicáveis ou pendentes por infraestrutura.

## Limites

- Não ative nem instale pack automaticamente.
- Não leia todos os packs em monorepo; selecione por área afetada.
- Não converta sugestão de stack em obrigação de framework, ORM, Docker ou dependência.
