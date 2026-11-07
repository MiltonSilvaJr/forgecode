---
id: backend-java-relational
version: 1
applies_to:
  - java
  - relational-database
status: experimental
---

# Backend Java relacional

Use em áreas Java com banco relacional. Maven ou Gradle, framework web, JPA e ferramenta de migration são decisões do projeto; não introduza Spring, Flyway ou Hibernate apenas por este pack. Para mudanças novas, prefira injeção por construtor, validação na borda, transação na camada de aplicação e erro HTTP padronizado quando isso for compatível com o código existente.

Migrations seguem `data/schema-evolution.md`. Testes de integração exercitam a migration e o banco real quando houver infraestrutura autorizada; não substitua esse teste por mock que esconda o SQL.

Persistência relacional: o catálogo de antipatterns e a varredura estática da skill `data-relational-practices` (`bash .forge/skills/data-relational-practices/scripts/scan.sh --root <path>`, uma linha por regra, achado com `arquivo:linha`) cobrem migração bloqueante, tipos, OFFSET profundo, NOLOCK, dinheiro em `NUMERIC` e tabela multi-tenant sem RLS; decisão de desenho de dados (modelo, store, chave, isolamento) vai ao agente `data-engineer`, que delega ao `data-relational`.
