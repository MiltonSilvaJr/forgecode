---
id: backend-node-postgres
version: 1
applies_to:
  - node-ts
  - postgres
status: experimental
---

# Backend Node/TypeScript com Postgres

Use em áreas Node/TypeScript que usam Postgres. Prefira o padrão existente de framework, validação, ORM e testes. Para código novo, TypeScript estrito, validação runtime na borda, configuração validada no boot e queries parametrizadas são defaults condicionais.

Não deixe tipos do ORM definirem o domínio quando a arquitetura separa domínio e infraestrutura. Mudanças de schema seguem `data/schema-evolution.md`; contratos HTTP e autorização por ownership seguem as rules transversais. Rode os scripts definidos em `FORGE.md` e nunca substitua o package manager do projeto.

## Enforcement mecânico — a primeira camada

Regra escrita em prosa compete com todo o contexto lido depois dela e perde. Regra convertida em erro/aviso de lint não degrada: o ESLint reporta, e o agente vê antes de devolver a tarefa. O que o ESLint pode provar em AST sai do prompt e vira configuração; o que sobra para julgamento está na segunda camada (`skills/node-quality-scan/`).

Um arquivo na raiz faz essa conversão. Audite com `bash .forge/scripts/node-baseline.sh --check` e materialize com `--apply` (nunca sobrescreve arquivo existente sem `--force`); o modelo vive em `assets/eslint.config.mjs` deste pack, e as regras que ele registra vivem em `assets/eslint-rules/`.

**As três regras `forge-quality/*`.** Vendorizadas de `soumatheusgomes/vibe-coding-toolkit` (MIT; aviso de copyright preservado em cada arquivo de `assets/eslint-rules/`) — cópia própria do harness, não dependência de upstream. São AST via ESLint, não regex: pegam o que `grep` não pega, como alias de import (`import { db as database }` continua sendo pego pelo nome importado, não pelo nome local) e import default/namespace de um módulo de banco (que sempre conta como alcançar o cliente, mesmo sem citar o binding pelo nome).

- **`forge-quality/no-direct-console`** — `console.log`/`error`/`warn`/... fora de um adaptador de log. Regra load-bearing: o `--check` reprova se estiver ausente ou `"off"`.
- **`forge-quality/no-direct-data-access`** — mantém o cliente de banco fora da camada de apresentação. Precisa de `modules`/`layers` do PRÓPRIO projeto (o harness não adivinha alias de import nem estrutura de pasta); vem `"off"` no baseline materializado, com o formato pronto em comentário para o projeto preencher.
- **`forge-quality/max-lines`** — orçamento de tamanho de arquivo. **Decisão que NÃO é herdada do material de origem** (ledger `LDG-0061`/`LDG-0130`): esta regra **nunca** é `"error"` no baseline deste harness, só `"warn"`. Ela conflita com `rules/conventions/code-style.md` (tamanho de arquivo é *smell*, não portão), e o próprio material de origem documenta o efeito de fatiamento cosmético perto do limite sem resolvê-lo no desenho do gate — um arquivo com 399 de 400 linhas, e a extração feita só para calar o aviso empurra o arquivo de destino para além do próprio teto. O `--check` reprova um `eslint.config.*` que declare esta regra como `"error"`.

**Adoção.** `no-direct-console` em `"error"` numa base com centenas de `console.log` já escritos reprova o primeiro lint e a adoção morre ali — mesmo efeito que `AnalysisMode All` produz do lado .NET. O `--apply` decide a severidade pelo estado do repositório: `"error"` direto em greenfield (nenhum arquivo `.ts`/`.tsx`/`.js`/`.jsx` ainda), `"warn"` em brownfield, para o time promover a `"error"` quando o inventário estiver limpo.

**Pré-requisito que este baseline não resolve.** Se o projeto tem `.ts`/`.tsx`, ele precisa de um parser TypeScript já configurado (`typescript-eslint` ou `@typescript-eslint/parser`) para esses arquivos — as regras `forge-quality/*` não usam informação de tipo, mas dependem do arquivo já ter sido parseado, e o `espree` padrão não entende sintaxe TS. Mesma relação que o dotnet SDK tem com o baseline .NET: pré-condição do projeto, não algo que este script materializa. O `--check` emite `WARN` (não `FAIL`) quando detecta `.ts`/`.tsx` sem sinal de parser TS.

## Verificação

Comece pela camada barata e determinística, nesta ordem: `bash .forge/scripts/node-baseline.sh --check` (a configuração está no lugar?), `bash .forge/skills/node-quality-scan/scripts/scan.sh` (o que o lint não pega), e só então o lint/build/test reais do projeto. Revisar `console.log` e import direto de banco à mão num repositório sem `forge-quality/*` cableado é gastar julgamento onde faltava lint.

Persistência relacional: o catálogo de antipatterns e a varredura estática da skill `data-relational-practices` (`bash .forge/skills/data-relational-practices/scripts/scan.sh --root <path>`, uma linha por regra, achado com `arquivo:linha`) cobrem migração bloqueante, tipos, OFFSET profundo, NOLOCK, dinheiro em `NUMERIC` e tabela multi-tenant sem RLS; decisão de desenho de dados (modelo, store, chave, isolamento) vai ao agente `data-engineer`, que delega ao `data-relational`.
