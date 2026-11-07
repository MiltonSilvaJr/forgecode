# CHANNEL — {{CHANNEL}}

> Canal de mensagens ORDENADAS do subsistema **liaison** — troca entre agentes de repositórios
> distintos (ex.: dono de `.proto`/contrato e app cliente), sem drift de handoff manual. **Gerado**
> deterministicamente dos logs `log/*.jsonl` por `liaison-ops.sh render` — **não edite as seções
> abaixo à mão**; só o bloco "Notas" ao final é preservado entre gerações.
>
> **Visibilidade:** a lista de participantes de cada thread organiza e roteia (quem é cobrado por
> ack, para quem a thread se dirige) — **não confina leitura**. Com hub compartilhado, quem alcança
> o transporte lê tudo; isolamento real de thread seria falsa sensação de segurança. Confidencialidade
> de verdade exige canal separado, não uma lista de participantes.
>
> Réplica local vista como `{{SELF}}`.

{{SUMMARY}}

## Threads

{{THREAD_INDEX}}

## Mensagens por thread

{{THREAD_VIEWS}}

## Bastões (dono único de uma unidade de trabalho)

> Estado calculado pela dobra (REQ-04), só a partir do que está gravado nas mensagens — nunca do
> relógio de quem lê. Sem rótulo `expired`: ele depende do instante de leitura e por isso só
> aparece em `liaison-ops.sh status`/`baton status`, nunca aqui.

{{BATONS}}

## Quarentena (thread-open ainda não recebido)

{{QUARANTINE}}

## Posições retidas por divergência (reescrita de história)

> Cada linha é uma POSIÇÃO (`seq`) de um remetente cuja versão vinda do hub conflita com a versão já conhecida aqui. As demais mensagens do mesmo remetente continuam sendo aplicadas normalmente. A saída legítima é a origem restaurar a linha ou republicar o conteúdo com `seq` novo — o log é append-only e não reescreve história.

{{DIVERGENCES}}

## Diagnósticos (não bloqueantes)

{{DIAGNOSTICS}}

## Notas

<!-- FORGE:NARRATIVE:START -->
_(Espaço livre para contexto curado — prioridade de resposta, decisões de coordenação entre
repositórios. Preservado entre gerações do render; a captura automática nunca sobrescreve esta
seção.)_
<!-- FORGE:NARRATIVE:END -->
