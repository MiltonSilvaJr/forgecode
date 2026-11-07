---
name: node-quality-scan
description: |
  Varre código Node/TypeScript em busca do que nem o ESLint com as regras `forge-quality/*` reprova — `.then()` sem `.catch()`, `fs.*Sync()` bloqueando o event loop, `new Pool()`/`new Client()` fora de bootstrap de banco, `process.env` lido direto fora de config central, `new Date()` sem argumento, `any` explícito, nomes genéricos (Manager/Helper/Utils), `let` mutável exportado do módulo, `catch` vazio, interpolação de SQL em template literal e interface com implementação única. Determinística: roda `scripts/scan.sh` e emite uma linha por regra, inclusive as que não acharam nada. Use antes de revisar Node/TS ("revisar minhas mudanças", "code review", "olhar a qualidade deste serviço"), no `node-reviewer` e no `/forge:verify` de change que toca `.ts`/`.tsx`/`.js`/`.jsx`. Não use para bug de correção, falha de segurança de infraestrutura, ou para stack que não seja Node/TypeScript.
---

# node-quality-scan

Duas camadas cobrem qualidade em Node/TypeScript, e elas não se substituem.

A **primeira** é o lint: três regras ESLint em AST — `forge-quality/no-direct-console`, `forge-quality/no-direct-data-access` e `forge-quality/max-lines` — vendorizadas de `soumatheusgomes/vibe-coding-toolkit` (MIT) e registradas pelo `eslint.config.mjs` que `.forge/scripts/node-baseline.sh` materializa. Elas pegam o que grep não pega porque leem a árvore sintática: alias de import (`db as database` continua sendo pego), import default vs namespace de um módulo de banco, e tamanho de arquivo medido por linha real de código-fonte (não comentário, config ou barrel). O que essa camada pega, ninguém precisa revisar à mão — o lint já reprovou. Ela é auditada por `bash .forge/scripts/node-baseline.sh --check` e materializada com `--apply`.

A **segunda** é esta skill: o que nenhuma regra AST vê porque depende de intenção ou de padrão que atravessa mais de uma expressão. Nenhuma regra dirá que `PedidoHelper` não nomeia nada, que `process.env.STRIPE_KEY` espalhado em dez arquivos é config sem validação central, ou que a interface criada "para poder mockar" tem uma implementação só e nenhum outro consumidor.

## Protocolo

Ordem fixa. A ordem é o que torna a revisão auditável — sem ela, o que foi verificado depende de quanto contexto sobrou.

1. **Escopo.** Defina os paths Node/TS afetados (diff da branch, ou o serviço em questão). Não varra o monorepo inteiro quando o change tocou um pacote.
2. **Baseline de lint.** `bash .forge/scripts/node-baseline.sh --root <path> --check`. Se ele reprovar, **diga isso primeiro**: revisar `console.log` e import direto de banco à mão num repositório sem `forge-quality/*` cableado é gastar julgamento onde faltava lint.
3. **Detecção.** `bash .forge/skills/node-quality-scan/scripts/scan.sh --root <path> [--json /tmp/node-scan.json]`. Saída: uma linha por regra. `OK` quer dizer verificado e limpo, não "não olhei".
4. **Julgamento.** Cada `FOUND` é candidato, não veredito — leia o arquivo:linha e decida. As exceções legítimas estão em `references/clean-code-rules.md`.
5. **Relatório.** Uma linha por regra, incluindo as que passaram. Achado sem `arquivo:linha` não entra.

## O que o scanner NÃO faz

Ele não julga. `.then()` sem `.catch()` numa promise cujo erro já é tratado pelo `unhandledRejection` global do processo pode ser aceitável; `new Pool()` dentro do próprio módulo de bootstrap de conexão é o lugar certo, não o defeito; uma interface com implementação única pode ser fronteira de porta hexagonal deliberada (o domínio declara, a infraestrutura implementa — a segunda "implementação" é o teste). O scanner localiza; quem revisa decide. Um relatório que trata todo `FOUND` como defeito treina o time a ignorar o relatório.

Ele também não substitui a leitura do diff: acoplamento, nome que mente sobre o que a função faz, invariante de domínio ausente e teste que não testa nada continuam sendo trabalho de leitura. E ele é regex sobre texto, não análise sintática — `floating-promise` e `sql-interpolation` em particular assumem o padrão comum de caber numa linha só; um `.then()`/`.catch()` quebrado em várias linhas ou uma query montada em múltiplas concatenações escapa (ver `references/detection-commands.md`).

## Sessão limpa

Rode esta revisão numa sessão **separada** daquela que escreveu o código. Um agente que revisa o próprio trabalho defende o código em vez de lê-lo — no pipeline do Forge isso já é estrutural (o `code-evaluator` invoca reviewers como agentes distintos), e vale manter quando a revisão for pedida à mão.

## Referências

- `references/clean-code-rules.md` — cada regra, por que ela existe e quando a exceção é legítima
- `references/detection-commands.md` — os comandos crus, para auditar o que o scanner faz
- `.forge/capabilities/backend-node-postgres/PROFILE.md` — a camada de lint e as regras `forge-quality/*`
- `.forge/rules/conventions/code-style.md` — a versão agnóstica de stack destas mesmas diretrizes
