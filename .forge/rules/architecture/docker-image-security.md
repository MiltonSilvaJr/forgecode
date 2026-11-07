---
title: Segurança de Imagens Docker
applies_to:
  - platform
  - docker
priority: high
last_reviewed: 2026-05-08
---

# Segurança de Imagens Docker

## Política Zero Tolerance

**CVE com fix disponível = imagem bloqueada, sem exceção.**

Não importa a severidade ("baixa"), o ambiente ou a justificativa de que "o pacote não é usado em runtime". Se o fix existe, ele deve ser aplicado.

### Fluxo Obrigatório

```
docker build → docker scout cves → corrigir CVEs fixáveis → docker build → docker scout cves → ✅ usar
```

**Condição de aprovação:** `0C 0H 0M 0L — No vulnerable packages detected`

Qualquer saída diferente disso significa que a imagem **não está aprovada**.

### CVE sem fix disponível

1. Confirmar com `docker scout cves <image>:<tag>` que "Fixed version: not fixed"
2. Registrar entrada em `.security-waivers.yml` com: ID do CVE, severidade, pacote, análise de impacto, `owner`, `reapproveBy`
3. Imagem só pode ser usada **após** esse registro

## Dockerfile Hardening (Obrigatório)

### Multi-stage Build

```dockerfile
FROM node:22-alpine3.21 AS base
RUN apk update && apk upgrade --no-cache   # patches do Alpine
WORKDIR /app

FROM base AS builder
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts && npm cache clean --force
COPY . .
RUN npm run build

FROM base AS runner                         # parte do base, não do builder
ENV NODE_ENV=production
# Remover npm — não é necessário em runtime
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm /usr/local/bin/npx \
    && rm -rf /root/.npm /tmp/npm* 2>/dev/null || true
# ... usuário não-root, COPY --from=builder ...
```

### apk upgrade

Obrigatório no estágio base para aplicar patches do Alpine disponíveis após o release da imagem base.

### Remover npm do runner (Node.js / Next.js)

O npm da imagem base inclui `cacache → tar@6.x`, `node-gyp → tar@7.x`, `minimatch`, `glob`, `picomatch` — ~200 pacotes extras no SBOM. Se o processo de runtime não executa `npm`, remover o npm é obrigatório.

### Usuário não-root

```dockerfile
RUN addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --ingroup appgroup appuser
USER appuser
```

### Healthcheck

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --tries=1 -T 5 -O /dev/null http://127.0.0.1:8080/health || exit 1
```

## Onde CVEs se Escondem

1. **Dependências diretas** — `npm audit` / `dotnet list package --vulnerable`
2. **Overrides desatualizados** no `package.json` — ranges antigas propagam versões vulneráveis
3. **npm instalado na imagem base** — `node:XX-alpine` inclui npm com suas próprias deps
4. **Pacotes vendorizados pelo framework** — Next.js compila deps internas em `dist/compiled/`; inatingíveis por `overrides`; corrigir atualizando o framework

## Overrides npm — Sintaxe Correta

Usar `">=X.Y.Z"` (sem `^`) para garantir versão mínima sem criar teto:

```json
"overrides": {
  "tar": ">=7.5.11",
  "minimatch": ">=9.0.7",
  "glob": ">=11.1.0"
}
```

Após atualizar overrides: sempre rodar `npm install` para regenerar o lock file antes do build Docker.

## Verificação de Superfície de Ataque

```bash
docker scout sbom <image>:<tag> --format list | wc -l
```

| Tipo de imagem | Pacotes esperados |
|---|---|
| Next.js standalone com npm | ~350 |
| Next.js standalone sem npm | ≤ 200 |
| Go binary (scratch/distroless) | < 30 |

## Anti-Patterns Proibidos

- Usar container sem executar `docker scout cves` após build
- Push para registry sem scan aprovado
- Ignorar CVE com fix disponível por "não afetar este serviço"
- `^X.Y.Z` em overrides de segurança
- Editar `package-lock.json` manualmente
- Manter npm no runner quando não necessário em runtime
- Imagem base sem `apk upgrade`
- Tag `latest` (proibida — ver `docker-naming.md`)
- Imagem **single-arch** (apenas `linux/amd64` ou apenas `linux/arm64`) — viola a política multi-arch de [ADR-0013](../../../docs/product/adr/0013-deploy-topology-monorepo-containers-helm-umbrella.md); ver `docker-multi-arch.md`

## Cross-Refs

- [`docker-multi-arch.md`](./docker-multi-arch.md) — multi-arch obrigatório (linux/amd64 + linux/arm64), buildx matriz nativa, Graviton3 ready
- [`docker-naming.md`](../conventions/docker-naming.md) — convenções de nomenclatura
- Supply Chain Security (Trivy + Cosign + SBOM): coberto por esta rule e por [`docker-multi-arch.md`](./docker-multi-arch.md) §SBOM e §Vulnerability Scanning. _ADR dedicado a criar — não existe equivalente aprovado (reaponte DD-005)._
- Multi-Arch Container Images: política em [`docker-multi-arch.md`](./docker-multi-arch.md) + [ADR-0013](../../../docs/product/adr/0013-deploy-topology-monorepo-containers-helm-umbrella.md) (imagem multi-arch amd64+arm64).
