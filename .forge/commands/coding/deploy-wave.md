---
name: deploy-wave
description: |
  Promove um módulo para um ambiente (`dev` | `stg` | `prd`) via `deploy-orchestrator`. Dispara build multi-arch, valida Trivy/Cosign/SBOM por digest, executa `helm upgrade --install`, verifica `kubectl rollout status` + smoke test em pod arm64 nativo e Kyverno admission. Em `prd`, exige dupla confirmação e move issues Jira `In Review → Done`.
arguments:
  - name: modulo
    description: "Slug do módulo (ex. payment-processing). Obrigatório."
    required: true
  - name: env
    description: "Ambiente alvo. Valores válidos: dev, stg, prd. Obrigatório."
    required: true
  - name: --sha
    description: "Commit alvo. Default = HEAD do main."
    required: false
  - name: --strategy
    description: "Estratégia de deploy. rolling (default), blue-green, canary."
    required: false
  - name: --approved-by
    description: "Nome do aprovador (obrigatório em env=prd)."
    required: false
---

# /forge:deploy-wave

Promove um módulo para um ambiente Kubernetes deste projeto.

## Pré-requisitos

1. **Branch `main`** sincronizada com `origin/main`. O deploy só roda do `main`.
2. **Commit alvo** já passou pelo `code-evaluator` no PR (status `APPROVED`).
3. **Helm chart** existe em `platform/helm/<modulo>/` com `values-<env>.yaml`.
4. **Kube context** ativo é o correto para `<env>` (verificar com `kubectl config current-context`).
5. **Credenciais de registry** (ghcr.io) e Cosign configurados no shell.
6. Em `env=prd`: **dupla confirmação** via variável `APPROVED_BY` ou flag `--approved-by`.

## Gates obrigatórios (ordem)

1. Build multi-arch via `gh workflow run build-image.yml` (linux/amd64 + linux/arm64)
2. **Trivy** `0C0H0M0L` por digest (cada arch separadamente)
3. **Cosign** signature verificada (keyless OIDC)
4. **SBOM CycloneDX** presente no registry
5. `helm upgrade --install --atomic` (rollback automático em falha)
6. `kubectl rollout status` (timeout 5min)
7. Verificação de pod **arm64** nativo (Graviton frota)
8. **Smoke test** `/health/ready` em pod arm64
9. **Kyverno admission** sem `PolicyViolation` recente
10. Tag `deploy-<env>-<YYYYMMDD-HHMM>-<sha7>` criada e empurrada

Falha em qualquer gate → **rollback automático** (via `--atomic`) ou manual.

## Exemplos

```bash
# Deploy do payment-processing em dev (HEAD do main)
/forge:deploy-wave payment-processing dev

# Deploy específico (SHA do PR merged)
/forge:deploy-wave payment-processing stg --sha abc1234

# Deploy em produção (exige aprovador)
/forge:deploy-wave payment-processing prd --approved-by "Milton Antonio da Silva Jr"

# Canary em stg
/forge:deploy-wave payment-processing stg --strategy canary
```

## Saída esperada

```
🚀 deploy-orchestrator: payment-processing → dev

📦 Fase 1 — Build multi-arch
    Workflow build-image.yml run #4521
    ✅ amd64: ghcr.io/payment-processing@sha256:aaa...
    ✅ arm64: ghcr.io/payment-processing@sha256:bbb...
    ✅ manifest list: ghcr.io/payment-processing:abc1234

🔒 Fase 2 — Gates de segurança
    ✅ Trivy amd64: 0C0H0M0L
    ✅ Trivy arm64: 0C0H0M0L
    ✅ Cosign: keyless verified
    ✅ SBOM CycloneDX: 142 packages

⚙️  Fase 3 — Helm
    helm upgrade --install payment-processing ./charts/payment-processing -n dev
    ✅ Revision 7, --atomic, timeout 10m
    ✅ Rollout completou em 47s

🟢 Fase 4 — Verificação
    ✅ Pod arm64 ativo: payment-processing-7c8d-xy2 (node ip-10-0-3-15)
    ✅ Smoke /health/ready: 200 OK
    ✅ Kyverno: nenhum PolicyViolation nos últimos 5min

🏷️  Fase 5 — Tag
    deploy-dev-20260510-2340-abc1234 → empurrado

✅ Deploy concluído em 412s.
   Próximos passos:
   - Monitorar Grafana: payment-processing-dashboard
   - Promover para stg: /forge:deploy-wave payment-processing stg
```

Em caso de falha:

```
❌ Fase 2 — Trivy amd64 detectou:
   CVE-2024-XXXX (CRITICAL) em libssl3 — fix disponível em 3.1.4-1
   Rollback automático ativado (--atomic).

⚠️  Operador: atualizar base image e re-buildar antes de re-deploy.
```

## Referências

- `.forge/agents/coding/deploy-orchestrator.md` (agent invocado)
- `.forge/rules/architecture/docker-multi-arch.md`
- `.forge/rules/architecture/docker-image-security.md` (zero tolerance CVE)
- ADRs de plataforma em `docs/product/adr/` (ex.: supply-chain security, imagens multi-arch), quando existirem
- `platform/helm/<modulo>/` (charts)
- `.github/workflows/build-image.yml` (build CI)
