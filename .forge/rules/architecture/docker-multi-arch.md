---
title: Imagens Docker Multi-Arch (linux/amd64 + linux/arm64)
applies_to:
  - platform
  - docker
  - ci
priority: high
last_reviewed: 2026-05-08
---

# Imagens Docker Multi-Arch

## Princípio

Toda imagem de container publicada no registry da <project_name> **DEVE** ser multi-arch contendo **`linux/amd64` E `linux/arm64`** numa **manifest list OCI** única. Não há exceção sem ADR específico que substitua esta política (ancorada em [ADR-0013](../../../docs/product/adr/0013-deploy-topology-monorepo-containers-helm-umbrella.md): imagem multi-arch amd64+arm64).

A frota de produção EKS roda em **Graviton3 (ARM64)** conforme `docs/capacity-plan.md`. Imagem amd64-only deployada em Graviton causa `exec format error` (falha hard) ou execução sob emulação QEMU (falha silenciosa de performance — 5–10× pior). Ambas anulam o ROI da estratégia ARM-first.

Esta rule operacionaliza a política de imagem multi-arch de **[ADR-0013](../../../docs/product/adr/0013-deploy-topology-monorepo-containers-helm-umbrella.md)**. _(Um ADR dedicado de multi-arch pode ser criado no futuro; até lá, ADR-0013 é a fonte da decisão — reaponte DD-005.)_

---

## Plataformas Suportadas

| Plataforma | Obrigatório | Caso de uso |
|------------|-------------|-------------|
| `linux/amd64` | **Sim** | Runners CI, dev local Mac Intel, fallback |
| `linux/arm64` | **Sim** | Produção EKS Graviton3, dev local Apple Silicon, terminais ARM on-prem |
| `linux/arm/v7`, `linux/386`, demais | **Proibido** | Sem ADR adicional autorizando |

---

## Padrão de Dockerfile (obrigatório)

### Diretiva `# syntax`

Toda primeira linha deve declarar BuildKit moderno:

```dockerfile
# syntax=docker/dockerfile:1.7
```

### Argumentos multi-arch

Estágios de build devem usar `--platform=$BUILDPLATFORM` (build na arch do runner — mais rápido) e cross-compilar para `$TARGETARCH`:

```dockerfile
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
ARG TARGETARCH         # amd64 | arm64 — vem do --platform do buildx
ARG TARGETOS           # linux
ARG BUILDPLATFORM      # plataforma do runner
ARG TARGETPLATFORM     # plataforma final da imagem
WORKDIR /src

COPY *.sln ./
COPY src/ ./src/

RUN --mount=type=cache,target=/root/.nuget/packages,id=nuget-${TARGETARCH} \
    dotnet restore -a $TARGETARCH

RUN --mount=type=cache,target=/root/.nuget/packages,id=nuget-${TARGETARCH} \
    dotnet publish src/<Service>.Api/<Service>.Api.csproj \
        -c Release \
        -a $TARGETARCH \
        -o /app/publish \
        --no-restore
```

**Estágio runtime** roda na arch alvo (sem `--platform=$BUILDPLATFORM`):

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS runtime
RUN apk update && apk upgrade --no-cache && \
    addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 --ingroup appgroup appuser
WORKDIR /app
COPY --from=build /app/publish .
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --tries=1 -T 5 -O /dev/null http://127.0.0.1:8080/health/live || exit 1
ENTRYPOINT ["dotnet", "<Service>.Api.dll"]
```

### Cache por arquitetura

`--mount=type=cache,id=<tool>-${TARGETARCH}` é **obrigatório** quando usar gerenciador de pacotes (NuGet, npm, pip, Gradle, Maven). Sem `id=...-${TARGETARCH}`, builds amd64 e arm64 contaminam o mesmo cache e quebram.

### Equivalentes por stack

| Stack | Sintaxe de cross-compile |
|-------|--------------------------|
| .NET 8 | `dotnet publish -a $TARGETARCH` |
| Node.js | `npm rebuild` no estágio final é suficiente; preferir imagens que tenham binários nativos para arm64 |
| Go | `GOOS=$TARGETOS GOARCH=$TARGETARCH go build` |
| Rust | `cargo build --target ${TARGETARCH}-unknown-linux-musl` (ajustar mapeamento) |
| Python | usar wheels binários multi-arch (PEP 656); preferir `python:3.12-slim-bookworm` (multi-arch oficial) |
| Java/Kotlin | byte-code é multi-arch nativamente; verificar JRE base image |

---

## Build Local (Dev)

### Setup do builder (uma vez por máquina)

```bash
docker buildx create --name builder --use --bootstrap
docker buildx inspect --bootstrap
```

### Build local single-arch (rápido, dev iterativo)

```bash
docker buildx build --platform linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
    --load -t auth-service:dev .
```

### Build local multi-arch (validação antes de PR)

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
    --output type=oci,dest=/tmp/auth-service.tar \
    -t auth-service:dev .

# Inspecionar:
docker buildx imagetools inspect --raw /tmp/auth-service.tar | jq '.manifests[].platform'
```

> **Não use** `--load` com 2+ plataformas — o daemon Docker local só suporta 1 plataforma na imagem store.

### Mac Apple Silicon (M1/M2/M3)

`docker buildx` já está pré-configurado. Build single-arch padrão produz `linux/arm64` nativo. Para validar amd64 antes de PR, use o comando multi-arch acima — QEMU é aceitável **localmente**, **proibido em CI**.

---

## CI/CD (workflow padrão)

### Estrutura — matriz de runners nativos

```yaml
name: build-image

on:
  push:
    branches: [main]
  pull_request:
    paths: ['services/<service>/**', 'Dockerfile', 'platform/docker/**']

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: <service>

jobs:
  build-per-arch:
    strategy:
      fail-fast: true
      matrix:
        include:
          - { arch: amd64, runner: ubuntu-24.04 }
          - { arch: arm64, runner: ubuntu-24.04-arm }
    runs-on: ${{ matrix.runner }}
    permissions:
      contents: read
      packages: write
      id-token: write
    outputs:
      digest-amd64: ${{ steps.export.outputs.digest-amd64 }}
      digest-arm64: ${{ steps.export.outputs.digest-arm64 }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & push (per-arch)
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/${{ matrix.arch }}
          push: true
          provenance: mode=max
          sbom: true
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}-${{ matrix.arch }}
          cache-from: type=gha,scope=${{ matrix.arch }}
          cache-to: type=gha,mode=max,scope=${{ matrix.arch }}

      - name: Trivy scan (per-arch digest)
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}
          severity: CRITICAL,HIGH
          exit-code: 1
          ignore-unfixed: false
          trivyignores: .trivyignore

      - name: Generate SBOM (CycloneDX)
        uses: anchore/syft-action@v0
        with:
          image: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}
          format: cyclonedx-json
          output-file: sbom-${{ matrix.arch }}.cdx.json

      - name: Cosign sign (per-arch digest)
        run: |
          cosign sign --yes \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}

      - name: Upload SBOM
        uses: actions/upload-artifact@v4
        with:
          name: sbom-${{ matrix.arch }}
          path: sbom-${{ matrix.arch }}.cdx.json

  manifest-list:
    needs: build-per-arch
    runs-on: ubuntu-24.04
    permissions:
      packages: write
      id-token: write
    steps:
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Create manifest list
        run: |
          docker buildx imagetools create \
            -t ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -t ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest-dev \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}-amd64 \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}-arm64

      - name: Verify manifest list has both platforms
        run: |
          PLATFORMS=$(docker buildx imagetools inspect \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            --format '{{range .Manifest.Manifests}}{{.Platform.OS}}/{{.Platform.Architecture}} {{end}}')
          echo "Platforms: $PLATFORMS"
          [[ "$PLATFORMS" == *"linux/amd64"* ]] || { echo "amd64 missing"; exit 1; }
          [[ "$PLATFORMS" == *"linux/arm64"* ]] || { echo "arm64 missing"; exit 1; }

      - name: Cosign sign (manifest list)
        run: |
          cosign sign --yes \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

  smoke-arm64:
    needs: manifest-list
    runs-on: ubuntu-24.04-arm
    steps:
      - name: Pull and run on real arm64 host
        run: |
          docker pull ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          docker run --rm -d --name smoke-test \
            -p 8080:8080 \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          for i in {1..30}; do
            if curl -fsS http://localhost:8080/health/live; then exit 0; fi
            sleep 2
          done
          echo "Healthcheck failed on arm64"; docker logs smoke-test; exit 1
```

### Reusable workflow

Workflow padrão deve viver em `.github/workflows/_template-ci-multiarch-image.yml` e ser chamado por cada serviço — não duplicar matriz em cada repo de imagem.

### QEMU em CI

**Proibido.** Não use `docker/setup-qemu-action` em workflow de CI da <project_name>. Build cross-arch via QEMU é aceitável só em dev local (Apple Silicon validando amd64 antes do PR). Em CI sempre runner nativo.

---

## Base Images

### Verificação obrigatória antes de adotar

```bash
docker manifest inspect <base-image:tag> | jq '.manifests[].platform'
# Deve listar linux/amd64 E linux/arm64
```

### Base images aprovadas (suportam multi-arch)

| Stack | Base image | Verificado em |
|-------|------------|---------------|
| .NET 8 SDK | `mcr.microsoft.com/dotnet/sdk:8.0-alpine` | 2026-05-07 |
| .NET 8 ASP.NET runtime | `mcr.microsoft.com/dotnet/aspnet:8.0-alpine` | 2026-05-07 |
| Node.js 22 | `node:22-alpine3.21` | 2026-05-07 |
| Python 3.12 | `python:3.12-slim-bookworm` | 2026-05-07 |
| Go 1.22 | `golang:1.22-alpine` | 2026-05-07 |
| Distroless static | `gcr.io/distroless/static-debian12:nonroot` | 2026-05-07 |

### Base image sem suporte a arm64

Se uma base image desejada **não** tem arm64, abrir spike de substituição **antes** de qualquer commit que dependa dela. Não é aceitável publicar imagem amd64-only "temporariamente".

---

## Vulnerability Scanning

### Trivy por digest

`docker scout` ou `trivy image` rodam **uma vez por digest** (amd64 e arm64 separadamente) — não no manifest list. CVEs podem ser específicos de uma arch (raro mas acontece em pacotes nativos).

```bash
trivy image --severity CRITICAL,HIGH --exit-code 1 \
  $REGISTRY/<image>@sha256:<digest-amd64>
trivy image --severity CRITICAL,HIGH --exit-code 1 \
  $REGISTRY/<image>@sha256:<digest-arm64>
```

`.trivyignore` é único e versionado — mesmas exceções para ambas as arch.

### Política Zero Tolerance (supply-chain)

Aplica-se **por digest**: CVE com fix disponível em qualquer arch bloqueia a manifest list. Waivers em `.security-waivers.yml` precisam declarar a arch afetada quando o CVE for arch-specific. _(Política de supply-chain Trivy/Cosign/SBOM: ver [`docker-image-security.md`](./docker-image-security.md) e [`security-and-compliance.md`](./security-and-compliance.md); ADR dedicado a criar — reaponte DD-005.)_

---

## SBOM e Cosign

### Por digest individual

Para cada digest gerado (amd64 e arm64):
- SBOM CycloneDX salvo em `contracts/sbom/<service>/<arch>/<sha>.cdx.json`
- Cosign signature por digest (keyless OIDC)

### Por manifest list

A manifest list em si também é assinada via Cosign após criação. Verificação:

```bash
cosign verify \
  --certificate-identity-regexp "https://github.com/Milton.*/.github/workflows/.*" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  $REGISTRY/<image>:<tag>
```

### Conformidade de supply-chain

Em runtime K8s, **Cosign Policy Controller** valida signature antes de admitir o pod — tanto a do manifest list quanto a do digest específico que será executado naquele node. _(Ver [`docker-image-security.md`](./docker-image-security.md); ADR dedicado de supply-chain a criar — reaponte DD-005.)_

---

## Admission Control (Produção)

### Kyverno policy obrigatória

Em namespaces `prd-*`:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-multiarch-images
spec:
  validationFailureAction: Enforce
  rules:
    - name: image-must-be-multiarch
      match:
        any:
        - resources:
            kinds: [Pod, Deployment, StatefulSet, DaemonSet]
            namespaces: ["prd-*"]
      validate:
        message: "Imagens em produção DEVEM ser multi-arch (linux/amd64 + linux/arm64)."
        foreach:
        - list: "request.object.spec.containers"
          deny:
            conditions:
              all:
              - key: "{{ images.containers.\"{{element.name}}\".manifest.architecture }}"
                operator: NotEquals
                value: "multi"
```

(Sintaxe simplificada — implementação real em `platform/k8s/kyverno/policies/`.)

### Cosign Policy Controller

Configurado em `platform/k8s/cosign-policy/` para exigir signature verificada antes de pull.

---

## Hooks de Validação

### Pre-commit

`.forge/hooks/pre-commit/check-dockerfile-multiarch.sh` valida que todo `Dockerfile` modificado:

- Declara `# syntax=docker/dockerfile:1.7+`
- Declara `ARG TARGETARCH` no estágio build
- Usa `--platform=$BUILDPLATFORM` em pelo menos um estágio
- Não tem `FROM --platform=linux/amd64` ou `FROM --platform=linux/arm64` hardcoded (deve ser variável)

### CI workflow shared

`.github/workflows/_validate-multiarch.yml` chamado por cada workflow de imagem:

- Valida que manifest list tem ≥ 2 platforms incluindo `linux/arm64`
- Falha se SBOM ausente para qualquer digest
- Falha se Cosign signature ausente

---

## Anti-Patterns Proibidos

| Anti-pattern | Por quê é proibido |
|---|---|
| `docker build` sem `buildx` em CI | Produz imagem single-arch (a do runner) |
| `--platform=linux/amd64,linux/arm64` em runner único + QEMU em CI | Lento (3–4× tempo), bugs intermitentes, SBOM não confiável |
| Base image sem suporte arm64 | Bloqueia o caminho |
| `FROM --platform=linux/amd64` hardcoded | Anula multi-arch — sempre usar `$BUILDPLATFORM` ou `$TARGETPLATFORM` |
| Cache de NuGet/npm sem `id=<tool>-${TARGETARCH}` | Cache contamina entre arch — builds quebram |
| `--load` com 2+ platforms | Daemon local só aceita 1 |
| Push de imagem que não passou Trivy em **ambas** as arch | Viola a política de supply-chain (`docker-image-security.md`) |
| Manifest list sem signature Cosign | Viola a política de supply-chain (`docker-image-security.md`) |
| Tag `prd-*` em imagem que não passou smoke test em arm64 real | Risco de CrashLoopBackOff em produção |
| Skip de smoke test "porque o build verde basta" | QEMU em build não detecta bugs runtime de arm64 |
| Imagem amd64-only em namespace `prd-*` | Bloqueado por Kyverno; tentativa = incident |
| `docker/setup-qemu-action` em workflow de CI | Use runners nativos `ubuntu-24.04-arm` |

---

## Referências

- [ADR-0013 — Topologia de deploy (monorepo + containers + Helm umbrella)](../../../docs/product/adr/0013-deploy-topology-monorepo-containers-helm-umbrella.md) — ancora a decisão de imagem multi-arch (amd64+arm64). _(ADR dedicado de multi-arch a criar — reaponte DD-005.)_
- Supply Chain Security (Trivy + Cosign + SBOM por digest): [`docker-image-security.md`](./docker-image-security.md). _(ADR dedicado a criar — reaponte DD-005.)_
- Android App Architecture (`arm64-v8a` no contexto mobile): _ADR a criar — sem equivalente aprovado no catálogo atual (DD-005)._
- Capacity Plan (Graviton3 EKS): _documento a criar em `docs/capacity-plan.md` — referência pendente._
- [Rule — Segurança de Imagens Docker](./docker-image-security.md) — multi-stage, non-root, Trivy
- [Rule — Convenções de Nomenclatura Docker](../conventions/docker-naming.md)
- [Docker buildx — multi-platform docs](https://docs.docker.com/build/building/multi-platform/)
- [GitHub — Linux ARM64 hosted runners](https://github.blog/changelog/2025-01-16-linux-arm64-hosted-runners-now-available-for-free-in-public-repositories-public-preview/)
- [.NET cross-compilation com `-a $TARGETARCH`](https://learn.microsoft.com/en-us/dotnet/core/docker/publish-as-container)
