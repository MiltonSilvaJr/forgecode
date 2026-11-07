---
id: backend-python-relational
version: 1
applies_to:
  - python
  - relational-database
status: experimental
---

# Backend Python relacional

Use em áreas Python com banco relacional. Preserve o gerenciador, framework e ORM já adotados. Para novos módulos, use type hints, validação runtime na borda e configuração por ambiente validada no boot. Não misture chamadas bloqueantes em rotas assíncronas sem tratar o modelo de concorrência do framework.

Migrations seguem `data/schema-evolution.md`. Testes de integração devem usar banco real quando o ambiente estiver disponível e autorizado; ausência de Docker ou de credencial de teste é evidência pendente, nunca aprovação implícita.

Persistência relacional: o catálogo de antipatterns e a varredura estática da skill `data-relational-practices` (`bash .forge/skills/data-relational-practices/scripts/scan.sh --root <path>`, uma linha por regra, achado com `arquivo:linha`) cobrem migração bloqueante, tipos, OFFSET profundo, NOLOCK, dinheiro em `NUMERIC` e tabela multi-tenant sem RLS; decisão de desenho de dados (modelo, store, chave, isolamento) vai ao agente `data-engineer`, que delega ao `data-relational`.
