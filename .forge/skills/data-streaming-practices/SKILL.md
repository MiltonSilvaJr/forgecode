---
name: data-streaming-practices
description: |
  Boas práticas e catálogo de antipatterns de mensageria, com especialização profunda em RabbitMQ 4.x (exchanges e roteamento, filas quorum, DLX, ack e prefetch, publisher confirms, retry nativo do 4.3, idempotência, ordem, streams, operação e migrações), Kafka e padrões de integração (inbox, outbox, CDC com Debezium, saga, schema de evento com AsyncAPI e schema registry), e varredura determinística em scripts/scan.sh: auto-ack, requeue infinito, filas espelhadas, plugin delayed exchange, publish sem confirms, auto-commit, acks fracos, durabilidade fraca, dedupe em memória, gRPC exposto, permissão total para parceiro e PAN em schema de evento. Use ao desenhar fila, retry, DLQ, evento de domínio, outbox ou CDC, escolher transporte interno × externo, revisar consumidor e produtor, ou quando o data-engineer delegar o domínio de mensageria. Não use para cache, banco ou analítico.
---

# data-streaming-practices

Referência do especialista `data-streaming`. O conhecimento está em `references/` e foi julgado contra fonte primária (base consolidada do change `data-engineer-agent`, 2026-09-26); cada afirmação carrega a marca de evidência da base: [J] reconferido na fonte primária, [2F] duas fontes, [1F] documentação oficial do produto, [Interp.] interpretação técnica, [Heurística] limiar de partida, [Incerto] fora das regras duras.

## Escopo

Trabalho assíncrono, desacoplamento de cadência, evento de domínio, fan-out, replay, outbox, CDC, saga, idempotência de consumidor e schema de evento. RabbitMQ é o broker da stack: a seção `## RabbitMQ` de `references/best-practices.md` é a fonte de resposta, alinhada à plataforma 4.x (espelhamento clássico removido no 4.0, Mnesia removido e retry atrasado nativo no 4.3, plugin de delayed exchange arquivado). Kafka entra quando o requisito é log durável reprocessável, muitos grupos consumidores ou ecossistema Connect/CDC. Fila nunca mora em cache com eviction (desempate 2 do orquestrador). No CDC para invalidação de cache, o mecanismo é daqui e a política de invalidação é do `data-cache`.

A escolha de transporte segue a regra do dono e a `rules/architecture/internal-grpc-communication.md`: interno síncrono é gRPC com `.proto` versionado, evento interno é mensageria com AsyncAPI e schema registrado, externo é REST ou fila dedicada, e gRPC nunca é exposto a terceiro. A tabela de escolha, com a coluna de contrato, está em `## Escolha de transporte`.

## Protocolo

Ordem fixa. É a ordem que torna a resposta auditável.

1. **Escopo.** Liste os paths afetados (produtores, consumidores, definições de topologia, `rabbitmq.conf`, `server.properties`, schemas `.proto`/`.avsc`, manifests). Para cada fluxo: interno ou externo, síncrono ou assíncrono, entrega exigida e ordem exigida.
2. **Rules do projeto.** Leia `.forge/rules/architecture/internal-grpc-communication.md`, `.forge/rules/data/*`, `.forge/rules/domain/money-as-cents.md` (dinheiro no payload como `int64` em centavos), ADRs e baseline. Divergência relevante para e vira `CONFLITO` (`.forge/rules/conventions/conflict-handling.md`).
3. **Detecção.** `bash .forge/scripts/check-data-governance.sh --path <path>` (interprete pela linha: `CONFLICT` é achado; `universo-vazio` e `node >= 20` são "não verificado"; T-02 é complemento `aviso`) e `bash .forge/skills/data-streaming-practices/scripts/scan.sh --root <path> [--root <path>...]`.
4. **Julgamento.** Cada `FOUND` é candidato. `BlockingConnection(` no bootstrap é o lugar certo (RMQ-AP-03); `publisher-confirm-type` em `application.yml` cobre o publicador Spring de outro arquivo (RMQ-AP-08).
5. **Relatório.** Uma linha por regra, inclusive as limpas; todo antipattern apontado cita o id (`RMQ-AP-10`) e, quando o scanner o achou, `arquivo:linha`. Fato de plataforma com versão e marca de evidência; nunca recomende o que a seção "Refutado" da base derrubou.

## O que o scanner não faz

Ele lê texto: não vê fila sem limite, fila longa, DLQ sem consumidor, `delivery-limit` sem DLX, `consumer_timeout` curto para o job, publicador sem handler de `connection.blocked`, lag de consumidor, canal compartilhado entre threads, slot de replicação retendo WAL, subject em modo NONE nem consumidor de fora do domínio num tópico de CDC — isso é runtime (`rabbitmqctl`, API HTTP de gestão, `pg_replication_slots`, Schema Registry) ou revisão, documentado no catálogo. Os padrões de API de cliente são heurísticos por linguagem (amqplib e Spring confirmados; Java, pika, Go e .NET por conhecimento prévio). A maquinaria do harness (`.forge/agents`, `.forge/scripts`, `.forge/schemas`, `.forge/skills`, `.forge/rules` e afins) e os diretórios de adapter (`.claude` e `.agents`) ficam fora do universo, como os worktrees aninhados: numa instalação nova `--root .` só varre o projeto; `.forge/specs` e `.forge/product` entram. O scanner localiza; quem revisa decide.

## Referências

- `references/best-practices.md` — `## RabbitMQ` (13 subseções, RMQ-BP-01 a RMQ-BP-24, receita de referência), `## Kafka` (KFK-BP-01 a KFK-BP-13), `## Padrões de integração`, `## Escolha de transporte` e dado sensível, com fonte e marca de evidência.
- `references/antipatterns.md` — catálogo RMQ-AP, KFK-AP, D-AP, T-02, SCH-AP, INB-AP, OBX-AP e CDC-AP.
- `scripts/scan.sh` — detecção estática das 32 regras com `Detecção: scan.sh <ID>`; contrato em `--help`.
