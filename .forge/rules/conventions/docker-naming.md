---
title: Convenções de Nomenclatura Docker
applies_to:
  - platform
  - docker
  - all
priority: high
last_reviewed: 2026-05-08
---

# Convenções de Nomenclatura Docker

## Regras Globais

- Todos os recursos Docker **DEVEM** ser nomeados explicitamente
- Nomes gerados automaticamente por hash são **PROIBIDOS**
- Nomes em **lowercase** com **hífen** como separador
- O nome explícito (sem prefixo de marca — parametrizável no white-label) DEVE estar presente em todos os recursos

---

## Containers

**Formato:** `<service-name>`

```yaml
container_name: auth-service
container_name: postgres
container_name: redis
container_name: rabbitmq
container_name: grafana
```

- Um nome por serviço; determinístico
- Ambiente **não** deve ser codificado no nome do container
- Separação de ambientes feita pelo `docker compose project name`, namespace K8s ou camada de infra

---

## Imagens

**Formato:** `<service-name>:<tag>`

```
auth-service:dev
<service>:v1.0.0
backoffice:stg
portal-usuario:dev
```

Tags permitidas: `dev`, `stg`, `prd`, versões semânticas (`v1.2.3`)

**`latest` é PROIBIDA** em qualquer ambiente (local, dev, stg, prd).

---

## Volumes

**Formato:** `<service>-<purpose>-<YYYY.MM.DD-HH.mm>`

```
postgres-data-2026.05.06-10.00
dynamo-local-data-2026.05.06-10.00
redis-cache-2026.05.06-10.00
rabbitmq-data-2026.05.06-10.00
minio-datalake-2026.05.06-10.00
```

- Todo volume persistente **DEVE** incluir timestamp de criação
- O segmento `<purpose>` é obrigatório para bancos e brokers
- Volumes sem timestamp são PROIBIDOS

**Rationale:** timestamp permite identificar volumes órfãos e auditar limpezas operacionais.

---

## Redes

**Formato:** `net` ou `net-<purpose>`

```
net
net-observability
net-core
```

---

## Localização dos Arquivos Compose

Compose principal de desenvolvimento local: `platform/docker/compose/docker-compose.yml`

Subdiretórios:
- `platform/docker/compose/postgres/`
- `platform/docker/compose/rabbitmq/`
- `platform/docker/compose/grafana/`
- `platform/docker/compose/prometheus/`
- `platform/docker/compose/loki/`
- `platform/docker/compose/promtail/`
- `platform/docker/compose/alertmanager/`
- `platform/docker/compose/jwt/`

---

## Anti-Patterns Proibidos

- Nomes baseados em hash Docker (e.g. `inspiring_payne_fbc72d`)
- Volumes sem identificação de serviço
- Volumes sem timestamp
- Imagens sem prefixo ``
- Tag `latest` em qualquer ambiente
- Reutilização de volumes persistentes entre ambientes sem rotação

## Princípio Final

Se um recurso Docker não pode ser identificado em 5 segundos por um engenheiro que não conhece o projeto, o nome está errado.
