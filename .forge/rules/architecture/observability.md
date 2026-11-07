---
title: Observabilidade e Auditoria
applies_to:
  - backend
  - platform
priority: high
last_reviewed: 2026-07-20
based_on: []
---

# Observabilidade e Auditoria

## Os Três Pilares (Todos Obrigatórios)

**Métricas · Logs · Traces** — os três são mandatórios. Nenhum serviço vai para produção sem os três implementados.

## Correlation ID

- Todo request recebe um `correlationId` (UUID v4) na entrada — gerado pelo gateway ou pelo serviço se ausente
- `correlationId` propagado em todos os logs, eventos e chamadas downstream
- `correlationId` incluído em toda resposta de erro (`{ "error": "...", "code": "...", "correlationId": "..." }`)

## Métricas (Prometheus)

- Exposição via `/metrics` (prometheus-net)
- Métricas obrigatórias por serviço:
  - `http_requests_total` (por método, rota, status)
  - `http_request_duration_seconds` (histograma p50/p95/p99)
  - `domain_events_published_total` (por tipo de evento)
- ServiceMonitor configurado para coleta pelo Prometheus do cluster

## Logs (Loki via Promtail)

- Formato: JSON estruturado
- Campos obrigatórios em todos os logs: `correlationId`, `service`, `level`, `timestamp`
- Logs de ações sensíveis DEVEM incluir: quem (`userId`, `tenantId`), quando, origem (IP/serviço), o quê
- Logs **NUNCA** devem conter dados sensíveis: senhas, tokens, PAN, CPF, dados de pagamento
- Mascaramento obrigatório quando dados de log rozeiam PII

## Traces (OpenTelemetry → Tempo, com Jaeger como alternativa compatível)

- OpenTelemetry SDK configurado em todo serviço backend
- Spans criados para: handlers de comando/query, chamadas HTTP externas, operações de banco
- `correlationId` como atributo do trace root
- **Tempo é o backend de tracing padrão** para stacks OSS greenfield (decisão de referência: ADR-0002
  `authz-observability-substrate`) — recebe spans via OTel Collector, sem exigir armazenamento de índice
  próprio, e compõe nativamente com Loki/Prometheus/Grafana na mesma stack.
- **Jaeger permanece alternativa compatível** para quem já o roda em produção: como todo trace sai do
  serviço via OTLP (o protocolo do OpenTelemetry, não um SDK proprietário de backend), o mesmo
  instrumentador funciona contra Jaeger ou Tempo sem mudança de código — troca-se apenas o exportador/
  endpoint do OTel Collector. Nenhum serviço é obrigado a migrar de Jaeger para Tempo por causa desta
  rule; a rule apenas deixa de recomendar Jaeger como ponto de partida para stacks novas.

## Golden Signals e Alerts-as-Code

Todo boundary de serviço (rota HTTP, handler de fila, worker) emite os **golden signals** — os três
sinais desta rule (métrica, log, trace) por boundary é o mínimo obrigatório; a promoção desses sinais em
alerta acionável é o que fecha o ciclo:

- **Alertas são código versionado**, nunca configuração criada manualmente na UI do Grafana/Prometheus. A
  definição vive em um arquivo `alerts-as-code` por serviço (`alerts-as-code.schema.json`): `service` +
  lista de `alerts { name, expr, severity, for }`.
- `expr` é a expressão PromQL do alerta (latência p95/p99 acima de limiar, taxa de erro 4xx/5xx acima de
  limiar, saturação de fila, etc.) — os golden signals traduzidos em regra de alerta.
- `severity` (`critical` | `warning` | `info`) e `for` (janela mínima antes de disparar, ex.: `5m`)
  evitam alerta ruidoso por pico transitório.
- Um serviço com boundary declarado e **sem** artefato `alerts-as-code` correspondente é finding do gate
  `check-observability` (REQ-10) — o boundary existe, mas ninguém é avisado quando ele degrada.
- O arquivo `alerts-as-code` do serviço é a fonte que provisiona as regras no Prometheus/Grafana — o
  provisionamento automatizado (via job de CI ou operator) é responsabilidade do consumidor; esta rule
  exige que a definição exista como código revisável, não que um mecanismo de deploy específico seja
  usado.

## Audit Trail

- **Toda mudança de estado** deve ser auditável: quem, quando, por quê, de onde
- Dados de auditoria são **imutáveis** — tabelas `audit_*` são append-only
- Trigger de imutabilidade no banco (REVOKE UPDATE/DELETE + RAISE EXCEPTION)
- Retenção regulatória obrigatória (não usar TTL em tabelas de auditoria)
- Cross-ref: `domain/audit-immutability.md` (Fase 2.9)

## Stack Local

Stack OSS padrão (greenfield): **OTel Collector como ponto único de coleta**, com Tempo/Loki/Prometheus
como backends e Grafana como camada única de visualização (ADR-0002).

| Ferramenta | Porta | Propósito |
|------------|-------|-----------|
| OTel Collector | `localhost:4317`/`4318` (gRPC/HTTP OTLP) | Ponto único de coleta — recebe spans, logs e métricas via OTLP e roteia para os backends |
| Grafana | `localhost:3030` | Dashboards metrics + logs + traces (Tempo/Loki/Prometheus como datasources) |
| Prometheus | `localhost:9090` | Coleta e armazenamento de métricas |
| Loki | `localhost:3100` | Agregação de logs |
| Tempo | `localhost:3200` | Armazenamento e consulta de traces (backend padrão, recebe via OTLP do Collector) |
| Jaeger UI | `localhost:16686` | Alternativa compatível de visualização de traces — mesmo instrumentador OTel, troca só o exportador (ver seção Traces acima) |
| Promtail | — | Coleta e envio de logs ao Loki |

Configurações em `platform/docker/compose/`.

## Dashboards Grafana

Cada serviço em produção DEVE ter dashboard provisionado em `platform/docker/compose/grafana/dashboards/` cobrindo:
- Taxa de requisições e latência (p95/p99)
- Taxa de erros 4xx/5xx
- Eventos de domínio publicados
- Saúde dos health checks

## Proibições Explícitas

- Deploy sem métricas expostas
- Logs sem `correlationId`
- PII em logs (senhas, tokens, CPF, dados de pagamento)
- Audit trail mutável (UPDATE/DELETE em tabelas `audit_*`)
- Boundary de serviço sem artefato `alerts-as-code` correspondente
- Alerta criado manualmente na UI do Grafana/Prometheus sem definição versionada equivalente

## Cross-reference

- `domain/audit-immutability.md` — mecanismo de imposição da imutabilidade citada na seção Audit Trail.
- `architecture/pii-pci-classification.md` — mascaramento de PII/PAN em log com o mapa controle→PCI
  DSS 4.0.1 completo (Req 3/4/7/8/10).
- `architecture/authz-pdp-pep.md` — decision-log do PDP sujeito ao mesmo regime anti-PII desta rule.
- ADR-0002 (`authz-observability-substrate`, `.forge/product/current/adr/0002-authz-observability-substrate.md`)
  — decisão de referência da stack OSS OTel Collector→Tempo/Loki/Prometheus/Grafana e da posição de
  Jaeger como alternativa compatível.
