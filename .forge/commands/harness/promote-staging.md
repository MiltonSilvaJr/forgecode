---
description: Direcionador de promocao develop para staging (decisao humana). Dispara a unica pipeline cara do fluxo (§20.2). Use quando develop estiver estavel e verificado localmente.
---

# /forge:promote-staging

Promoção é **decisão humana** (HITL). Nunca execute sem aprovação explícita nesta sessão.

1. Pré-checagens locais (custo zero de Actions):
   - `git fetch` e confirme que `develop` está à frente de `staging` (`git log staging..develop --oneline | head -20`).
   - Rode `bash .forge/scripts/doctor.sh --report` (exit 0) e os checks de `runtime:` (test/typecheck) se definidos.
   - Para mudanças de contrato ou scale ≥ 3, recomende disparo manual prévio do workflow (`workflow_dispatch`) antes da promoção.
2. Apresente ao usuário um resumo de 2-3 linhas (commits a promover, riscos) e as opções: **Promote** / **Abort**.
3. Com aprovação: `git checkout staging && git merge --no-ff develop && git push origin staging` — o push dispara a `staging-pipeline` (única execução cara).
4. Reporte o resultado e retorne para `develop`.
