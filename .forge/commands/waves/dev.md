---
description: Ambiente de desenvolvimento local — up (sobe stack), sync (migrations + seeds), smoke (validação pré-PR), rebuild (derruba + rebuild --no-cache + cleanup opcional de branches). Lê configuração do FORGE.md runtime. Todos os subcomandos com timeout explícito.
argument-hint: "up|sync|smoke|rebuild [--env <dev|test>] [--clean-branches]"
---

# /forge:dev — ambiente local de desenvolvimento

Argumentos: `$ARGUMENTS` (subcomando obrigatório + --env opcional, default: `dev`).

## Subcomandos

### up

Sobe a stack de desenvolvimento declarada em `FORGE.md runtime.dev`.

```bash
# Lê FORGE.md para extrair o compose canônico
COMPOSE_FILE="$(grep -A2 'compose:' .forge/FORGE.md | grep 'file:' | awk '{print $2}')"
perl -e 'alarm 120; exec @ARGV' -- docker compose -f "${COMPOSE_FILE:-docker-compose.yml}" up -d >/tmp/forge-dev-up.log 2>&1
[ $? -eq 0 ] && echo "OK dev:up" || { echo "FAIL dev:up (tail -20 /tmp/forge-dev-up.log)"; exit 1; }
```

### sync

Aplica migrations pendentes e seeds de desenvolvimento.

```bash
# Migrations
perl -e 'alarm 120; exec @ARGV' -- <migration-tool> migrate >/tmp/forge-dev-sync.log 2>&1
[ $? -eq 0 ] && echo "OK sync:migrations" || echo "FAIL sync:migrations"
# Seeds (opcional — só se runtime.seeds declarado)
perl -e 'alarm 60; exec @ARGV' -- <seed-tool> >/tmp/forge-dev-seed.log 2>&1
[ $? -eq 0 ] && echo "OK sync:seeds" || echo "FAIL sync:seeds"
```

As ferramentas de migration/seeds são lidas de `FORGE.md runtime.sync`. Se não declaradas: skip com aviso.

### smoke

Validação rápida pré-PR: build + testes de fumaça + healthcheck da stack.

```bash
# Build
perl -e 'alarm 180; exec @ARGV' -- <build-cmd> >/tmp/forge-dev-smoke.log 2>&1
[ $? -eq 0 ] && echo "OK smoke:build" || echo "FAIL smoke:build"
# Smoke tests (subconjunto rápido: tag @smoke ou equivalente)
perl -e 'alarm 120; exec @ARGV' -- <test-cmd> --filter smoke >/tmp/forge-dev-smoke-test.log 2>&1
[ $? -eq 0 ] && echo "OK smoke:tests" || echo "FAIL smoke:tests"
# Healthcheck
curl -sf http://localhost:${PORT:-8080}/health >/tmp/forge-dev-health.log 2>&1
[ $? -eq 0 ] && echo "OK smoke:health" || echo "FAIL smoke:health"
```

Comandos lidos de `FORGE.md runtime.smoke`. Se não declarados: skip com aviso, não falha.

### rebuild

Derruba a stack e rebuilda **sem cache** — para quando um rebuild incremental deixou a stack em
estado suspeito (imagem obsoleta, dependência não atualizada).

```bash
COMPOSE_FILE="$(grep -A2 'compose:' .forge/FORGE.md | grep 'file:' | awk '{print $2}')"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

perl -e 'alarm 60; exec @ARGV' -- docker compose -f "$COMPOSE_FILE" down >/tmp/forge-dev-rebuild-down.log 2>&1
[ $? -eq 0 ] && echo "OK rebuild:down" || echo "WARN rebuild:down (stack já estava parada?)"
```

**Regra crítica — builds .NET com cache mount NuGet compartilhado são SEQUENCIAIS, nunca
paralelos.** Serviços que declaram `--mount=type=cache,id=nuget-*` (cache mount do BuildKit)
corrompem o cache compartilhado quando dois builds tocam o mesmo `id` ao mesmo tempo — já
observado em produção como `Could not find file .../mediatr.contracts/...` num build paralelo.
Identifique esses serviços (`grep -l 'nuget-' **/Dockerfile`) e rebuilde-os **um de cada vez**:

```bash
# Serviços .NET com cache mount NuGet compartilhado: SEQUENCIAL
for svc in $NUGET_CACHE_SERVICES; do
  perl -e 'alarm 300; exec @ARGV' -- docker compose -f "$COMPOSE_FILE" build --no-cache "$svc" \
    >/tmp/forge-dev-rebuild-"$svc".log 2>&1
  [ $? -eq 0 ] && echo "OK rebuild:build:$svc" || { echo "FAIL rebuild:build:$svc"; exit 1; }
done

# Demais serviços (sem cache mount compartilhado): pode paralelizar
perl -e 'alarm 300; exec @ARGV' -- docker compose -f "$COMPOSE_FILE" build --no-cache --parallel \
  $OTHER_SERVICES >/tmp/forge-dev-rebuild-others.log 2>&1
[ $? -eq 0 ] && echo "OK rebuild:build:others" || echo "FAIL rebuild:build:others"

perl -e 'alarm 120; exec @ARGV' -- docker compose -f "$COMPOSE_FILE" up -d \
  >/tmp/forge-dev-rebuild-up.log 2>&1
[ $? -eq 0 ] && echo "OK rebuild:up" || echo "FAIL rebuild:up"
```

**Este comando roda em background pelo orquestrador (`run_in_background`) — nunca dentro de um
subagente.** Rebuild `--no-cache` é longo o suficiente para travar um subagente e para tornar a
regra de sequenciamento acima fácil de violar por acidente sob paralelismo de subagentes.

**Limpeza opcional de branches merged** (`--clean-branches`): após confirmar que a stack subiu,
ofereça remover branches locais já mergeadas em `develop`:

```bash
git fetch origin develop >/dev/null 2>&1 || true
merged="$(git branch --merged develop | grep -vE '^\*|  (develop|main)$' || true)"
[ -n "$merged" ] || { echo "Nenhuma branch local merged (fora develop/main) para limpar."; }
```

Liste as branches candidatas e **peça confirmação explícita** antes de `git branch -d <branch>`
para cada uma — nunca delete em lote sem o usuário ver a lista primeiro.

## Configuração em FORGE.md

```yaml
runtime:
  dev:
    compose:
      file: docker-compose.yml
  sync:
    migrate: dotnet ef database update
    seed: dotnet run --project tools/Seeder
  smoke:
    build: dotnet build
    test: dotnet test --filter Category=Smoke
    port: 8080
```

## Regras

- Todo comando roda com `perl -e 'alarm N; exec @ARGV'` — sem comandos pendurados.
- Output bruto em `/tmp/forge-dev-*.log`; reporte apenas `OK`/`FAIL <gate>` no chat.
- `dev up` não é obrigatório em CI (stack já existe); `smoke` é obrigatório antes de `/forge:wave close`.
- `dev rebuild` roda no orquestrador (`run_in_background`), nunca dentro de um subagente.
- Builds .NET com cache mount NuGet compartilhado (`--mount=type=cache,id=nuget-*`) são
  **sequenciais**; demais serviços podem paralelizar — ver seção `rebuild` acima.
- `--clean-branches` nunca deleta sem mostrar a lista de candidatas e pedir confirmação.
