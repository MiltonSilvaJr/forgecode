---
name: data-relational-practices
description: |
  Boas práticas e catálogo de antipatterns de banco relacional OLTP (PostgreSQL, SQL Server, MySQL), com varredura determinística em scripts/scan.sh: migração bloqueante (índice sem CONCURRENTLY, rename in-place, troca de tipo, SET NOT NULL), tipos problemáticos, paginação por OFFSET, NOLOCK, sessão incompatível com PgBouncer, SELECT * em código, banco exposto à internet, dinheiro em NUMERIC (a regra da casa é BIGINT na menor unidade) e tabela multi-tenant sem RLS. Use ao modelar tabela, revisar migração, escolher isolamento ou lock, investigar N+1, deadlock ou paginação, e quando o data-engineer delegar o domínio relacional. Não use para escolher o store do transacional de negócio sem ADR (a data-governance.md manda MongoDB, e isso é CONFLITO), nem para NoSQL, cache, bucket, analítico ou mensageria.
---

# data-relational-practices

Referência do especialista `data-relational`. O conhecimento está em `references/` e foi julgado contra fonte primária (base consolidada do change `data-engineer-agent`, 2026-09-26); cada afirmação carrega a marca de evidência da base: [J] reconferido na fonte primária, [2F] duas fontes, [1F] documentação oficial do produto, [Interp.] interpretação técnica, [Heurística] limiar de partida.

## Escopo

Relacional OLTP: parâmetros, configurações, relacional paramétrico e integridade referencial forte, que é o que a `rules/data/data-governance.md` atribui ao PostgreSQL; migrações, isolamento, locks, N+1, paginação e pool em qualquer banco relacional. O transacional de negócio (pedido, pagamento, dinheiro, estoque, ledger, cobrança) só entra aqui quando um ADR do projeto escolheu SQL para ele (decisão H-01 (a) do dono, 2026-09-26); sem esse ADR, pedido de relacional para transacional de negócio é conflito com a `data-governance.md` e a resposta é o bloco `CONFLITO` do protocolo do agente, não um DDL.

## Protocolo

Ordem fixa. É a ordem que torna a resposta auditável.

1. **Escopo.** Liste os paths afetados (migrações, repositórios, IaC do banco). Não varra o monorepo quando o pedido tocou um serviço.
2. **Rules do projeto.** Leia `.forge/rules/data/*`, `.forge/rules/domain/money-as-cents.md`, `.forge/rules/data/schema-evolution.md`, os ADRs e o baseline. Rule e ADR vencem esta skill (ordem de autoridade do `FORGE.md`); divergência relevante para e vira `CONFLITO` (`.forge/rules/conventions/conflict-handling.md`).
3. **Detecção.** `bash .forge/scripts/check-data-governance.sh --path <path>` para PAN/PII (interprete pela linha emitida: `CONFLICT` é achado; `universo-vazio` e `node >= 20` são "não verificado") e `bash .forge/skills/data-relational-practices/scripts/scan.sh --root <path> [--root <path>...]`, um `--root` por path afetado. Em zsh, não monte os `--root` a partir de uma variável string única (`"$ROOTS"`) e a expanda sem aspas — sem word splitting, todos os caminhos chegam concatenados num só argumento e o script reprova com "argumento desconhecido"; use um array (`roots=(--root a --root b)`, depois `scan.sh "${roots[@]}"`) ou escreva um `--root` por linha.
4. **Julgamento.** Cada `FOUND` é candidato: leia o arquivo e a linha e decida com `references/antipatterns.md`. Severidade `aviso` é heurística e pode ser exceção legítima; `alto` é detector preciso de prática inequívoca.
5. **Relatório.** Uma linha por regra, inclusive as limpas; todo antipattern apontado cita o id (`R-03`) e, quando o scanner o achou, `arquivo:linha`. Recomendação cita a marca de evidência quando a decisão depende dela.

## Regras da casa que esta skill aplica

- **Dinheiro:** `BIGINT NOT NULL` na menor unidade (centavos), nunca `NUMERIC`, `DECIMAL`, `FLOAT` nem o tipo `money`, pela `rules/domain/money-as-cents.md` §4. A rule declara `applies_to` para .NET, React e Kotlin; pela decisão H-03 (a) do dono, esta skill estende a mesma recomendação a toda stack e a qualquer `*.sql`, por conta própria, sem mudar o `applies_to` da rule, e diz isso na resposta. `numeric` continua certo para decimal exato que não é dinheiro (taxa de juros, quantidade fracionária).
- **Multi-tenant:** RLS obrigatório em tabela multi-tenant de domínio no PostgreSQL, dispensa só por exceção formal (`data-governance.md`, `data-config-sql.md`); `tenant_id` à frente do índice composto é complemento de desempenho, nunca alternativa ao RLS. Precedente só conta depois de provado no caminho de execução real: antes de citar uma tabela com `ENABLE`/`FORCE ROW LEVEL SECURITY` como modelo para uma tabela nova, procure quem define a GUC (`set_config`/`SET LOCAL`) no serviço dono — zero ocorrências é RLS decorativa ou quebrada, não um precedente válido; e teste de RLS só vale conectado com a role real da aplicação (`NOBYPASSRLS`), nunca com o usuário padrão do Testcontainers, que normalmente é superusuário e ignora toda policy em silêncio.
- **Evolução de schema:** expand → migrate → contract (`schema-evolution.md`), com engine, impacto, compatibilidade e rollback declarados na task.

## Evidência de schema vem do dono do DDL

Antes de usar migration ou snapshot de ORM como prova de constraint, tipo ou ausência de coluna, confirme quem é o dono do DDL. Um serviço consumidor pode marcar a tabela como `ExcludeFromMigrations`/`ToView` (ou equivalente) e seu `ModelSnapshot`/`Designer.cs` deixa de descrever o banco real — nesse caso o DDL vive noutro repositório (migrations dbmate, Flyway, outro serviço dono) e é essa migração que precisa ser lida, não o modelo do consumidor. Registre no achado o arquivo do dono. Uma afirmação sobre o schema só vale se a fonte lida é a que cria o schema; o modelo de um consumidor descreve o que ele espera encontrar, não o que existe.

## O que o scanner não faz

Ele lê texto, não o banco: não vê FK sem índice (R-01), tabela sem PK (R-02), N+1 (R-05), transação ociosa (R-09) nem banco compartilhado (R-16) — esses têm consulta de runtime ou ferramenta documentada no catálogo, que quem tem acesso roda. Ele também não entende SQL: `CREATE INDEX` sobre tabela criada no mesmo arquivo e `SET NOT NULL` precedido de `VALIDATE CONSTRAINT` no mesmo arquivo ficam fora do R-03, mas índice sobre tabela criada noutra migração ainda sem tráfego aparece; migração MySQL (marcada por `ENGINE=`, `AUTO_INCREMENT`, `ALGORITHM=` ou identificador entre crases) sai do trecho de índice do R-03 e cai no R-22; `SET search_path` só é defeito atrás de PgBouncer em modo transaction; o RLS pode estar noutra migração (R-20). A maquinaria do harness (`.forge/agents`, `.forge/scripts`, `.forge/schemas`, `.forge/skills`, `.forge/rules` e afins) e os diretórios de adapter (`.claude` e `.agents`) ficam fora do universo, como os worktrees aninhados: numa instalação nova `--root .` só varre o projeto; `.forge/specs` e `.forge/product` entram. O scanner localiza; quem revisa decide. Um relatório que trata todo `FOUND` como defeito treina o time a ignorar o relatório.

## Referências

- `references/best-practices.md` — modelagem, chaves e índices, migrações reversíveis, transações e isolamento, locks, N+1, paginação e pool, com fonte e marca de evidência.
- `references/antipatterns.md` — catálogo R-01 a R-22: sintoma, por quê, correção, detecção e evidência.
- `scripts/scan.sh` — detecção estática de R-03, R-04, R-06, R-10, R-12, R-13, R-14, R-17, R-18, R-19, R-20, R-21 e R-22; contrato em `--help`.
- Ferramentas externas que o projeto pode rodar e o catálogo cita: squawk, strong_migrations, SQLFluff.
