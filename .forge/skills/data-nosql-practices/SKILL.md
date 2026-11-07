---
name: data-nosql-practices
description: |
  Boas práticas e catálogo de antipatterns de NoSQL — documento (MongoDB, Cosmos DB), chave-valor persistente (DynamoDB), coluna larga (Cassandra) e grafo (Neo4j) — com varredura determinística em scripts/scan.sh: array sem teto, $lookup no caminho quente, chave de partição de baixa cardinalidade, write concern w:1, Scan no caminho da requisição, item que cresce, GSI com projeção ALL, leitura forte em GSI, ALLOW FILTERING, batch multi-partição, relacionamento genérico e banco exposto. Use ao modelar pelo padrão de acesso, escolher chave de partição e consistência, desenhar o transacional de negócio em MongoDB (regra da casa: transação multi-documento, write concern majority, P-S-S), e quando o data-engineer delegar o domínio NoSQL. Não use para cache efêmero (data-cache), fila (data-streaming), analítico (data-analytical) nem para busca vetorial dedicada.
---

# data-nosql-practices

Referência do especialista `data-nosql`. O conhecimento está em `references/` e foi julgado contra fonte primária (base consolidada do change `data-engineer-agent`, 2026-09-26); cada afirmação carrega a marca de evidência da base: [J] reconferido na fonte primária, [2F] duas fontes, [1F] documentação oficial do produto, [Interp.] interpretação técnica, [Heurística] limiar de partida.

## Escopo

Documento, chave-valor persistente, coluna larga e grafo. Pela `rules/data/data-governance.md` e pela decisão H-01 (a) do dono (2026-09-26), o transacional de negócio (pedido, pagamento, dinheiro, estoque, ledger, cobrança) é MongoDB com transação multi-documento, write concern `majority` e topologia P-S-S (N-07), salvo ADR do projeto que escolha SQL — aí o dono é o `data-relational`. Redis usado como armazenamento primário não é desenho válido no template (Redis nunca é fonte de verdade): é conflito com rule e volta ao orquestrador como `CONFLITO`.

## Protocolo

Ordem fixa. É a ordem que torna a resposta auditável.

1. **Escopo.** Liste os paths afetados (repositórios, IaC de tabela/coleção, CQL, Cypher). Inventarie os padrões de acesso antes de falar de chave: quem lê, por qual chave, com que frequência, volume por chave e latência alvo.
2. **Rules do projeto.** Leia `.forge/rules/data/*` (em especial `data-transactional-nosql.md`: campo `tenant`, filtro obrigatório de tenant no repositório, índice composto por `tenant`, `majority` para dado crítico), os ADRs e o baseline. Divergência relevante para e vira `CONFLITO` (`.forge/rules/conventions/conflict-handling.md`).
3. **Detecção.** `bash .forge/scripts/check-data-governance.sh --path <path>` (interprete pela linha: `CONFLICT` é achado; `universo-vazio` e `node >= 20` são "não verificado") e `bash .forge/skills/data-nosql-practices/scripts/scan.sh --root <path> [--root <path>...]`.
4. **Julgamento.** Cada `FOUND` é candidato; leia o trecho e decida com `references/antipatterns.md`. A consulta MongoDB sem filtro de tenant não tem detector estático confiável (o filtro é montado em runtime): é item de revisão obrigatório.
5. **Relatório.** Uma linha por regra, inclusive as limpas; todo antipattern apontado cita o id (`N-07`) e, quando o scanner o achou, `arquivo:linha`. Número de limite de produto sempre com a marca de evidência.

## O que o scanner não faz

Ele lê texto: não mede cardinalidade real de chave, partição quente, RU consumida, tombstones nem supernó — isso é runtime (`analyzeShardKey`, Contributor Insights, `nodetool tablehistograms`, consulta de grau no Neo4j), documentado no catálogo e executado por quem tem acesso. `w: 1` num script de teste não é defeito; `$lookup` num relatório noturno pode ser aceitável; `Scan` numa migração offline é o uso certo. Write skew entre documentos (N-22) e a idempotência do callback da transação não têm detector: são revisão obrigatória em todo transacional de negócio. A maquinaria do harness (`.forge/agents`, `.forge/scripts`, `.forge/schemas`, `.forge/skills`, `.forge/rules` e afins) e os diretórios de adapter (`.claude` e `.agents`) ficam fora do universo, como os worktrees aninhados: numa instalação nova `--root .` só varre o projeto; `.forge/specs` e `.forge/product` entram. O scanner localiza; quem revisa decide.

## Referências

- `references/best-practices.md` — modelagem por padrão de acesso, chave de partição, consistência, transacional de negócio no MongoDB (withTransaction, snapshot com majority, write skew, idempotência, `$jsonSchema`, outbox), documento, chave-valor, coluna larga e grafo, com fonte e marca de evidência.
- `references/antipatterns.md` — catálogo N-01 a N-23.
- `scripts/scan.sh` — detecção estática de N-01, N-04, N-06, N-07, N-08, N-09, N-10, N-11, N-13, N-15, N-17, N-18, N-19, N-20, N-21 e N-23; contrato em `--help`.
