# Regras verificadas — o porquê e a exceção legítima

Cada regra abaixo existe porque nem o ESLint com `forge-quality/*` a cobre. Cada uma tem uma exceção real: um relatório que trata todo achado como defeito treina o time a ignorar o relatório.

## empty-catch `[HIGH]`

`catch { }` (ou o que só loga e segue) apaga a evidência do erro. Ele some do log e reaparece depois como corrupção de dado ou bug fantasma, longe da causa. Capturou e não pode tratar: relance preservando a causa (`throw new DomainError(..., { cause: err })`) ou propague.

**Exceção legítima:** rara e sempre comentada — cleanup que não pode falhar, ou uma falha genuinamente irrelevante (fechar um socket já fechado). Sem o comentário explicando, não é exceção.

## floating-promise `[HIGH]`

`.then()` sem `.catch()` correspondente deixa a rejeição sem handler. Em Node, isso dispara `unhandledRejection` — que em versões recentes derruba o processo por padrão — e mesmo quando não derruba, o erro nunca chega a quem deveria decidir o que fazer com ele.

**Exceção legítima:** a promise é retornada para o chamador (`return foo().then(...)`), que é quem trata; ou existe um `try/await` envolvendo a chamada, e o scanner só não viu o `await` porque a cadeia atravessa mais de uma linha (limitação de regex sobre texto, ver `detection-commands.md`).

## sync-fs-blocking `[BLOCKER]`

`fs.readFileSync`, `writeFileSync`, `existsSync` e as demais variantes `*Sync` bloqueiam a *thread* única do event loop até a operação de disco terminar. Numa API HTTP, isso significa que **todo** request concorrente espera, não só o que disparou a leitura.

**Exceção legítima:** código de bootstrap que roda uma vez antes do servidor aceitar conexões (ler `.env`, carregar config no boot), script de CLI de execução única, ou teste.

## sql-interpolation `[BLOCKER]`

Template literal interpolado (`` `SELECT * FROM x WHERE id = ${id}` ``) passado direto para `.query()`/`.execute()` é injeção de SQL. Todo driver Postgres para Node (`pg`, `postgres`, `slonik`, o `sql` tag do Postgres.js) oferece parâmetro posicional (`$1`, `$2`, …) ou tagged template que escapa sozinho — a diferença é literalmente não montar a string à mão.

**Exceção legítima:** nenhuma para valor vindo de entrada. Identificador de tabela/coluna dinâmico (que não pode ser parametrizado) exige allowlist explícita, nunca concatenação direta.

## new-pg-client `[HIGH]`

`new Pool()`/`new Client()` (do `pg`) fora do módulo que é o próprio bootstrap de conexão cria um pool novo a cada instanciação — cada um com seu próprio conjunto de sockets, nenhum reaproveitado entre requests. É o análogo Node do `new HttpClient()` por requisição em .NET.

**Exceção legítima:** o arquivo declarado como bootstrap de banco (o único lugar onde `new Pool()` deveria aparecer), ou teste que injeta um cliente fake.

## process-env-direct `[MEDIUM]`

`process.env.X` lido em qualquer lugar do código funciona, mas espalha a superfície de configuração: não há um ponto único que valide "essa variável existe e tem o formato esperado" antes do resto do sistema rodar, e o erro de variável ausente aparece tarde, no meio de um request, em vez de no boot.

**Exceção legítima:** o próprio módulo de configuração/env que valida e reexporta (o scanner já exclui arquivos chamados `config.*`/`env.*`), ou script de bootstrap que roda antes do módulo de config existir.

## date-now `[MEDIUM]`

`new Date()` sem argumento amarra o domínio ao relógio real da máquina. O teste vira dependente de quando rodou, e comparações de tempo ficam difíceis de reproduzir. Injete um clock (`() => Date` ou `Date.now` passado como dependência) onde a lógica precisa de "agora".

**Exceção legítima:** formatação para exibição na borda de UI, ou timestamp de log/auditoria onde o valor real é exatamente o que se quer.

## explicit-any `[MEDIUM]`

`: any` e `as any` desligam a checagem de tipo exatamente no lugar em que ela existiria para pegar o erro — um `any` propaga para tudo que toca o valor depois, silenciosamente.

**Exceção legítima:** fronteira de biblioteca de terceiros sem tipos (e mesmo aí, `unknown` + narrowing é preferível), ou teste que precisa forçar um tipo inválido de propósito para verificar validação em runtime.

## generic-name `[MEDIUM]`

`Manager`, `Helper`, `Utils` e `Utility` não nomeiam responsabilidade — sinalizam que ninguém decidiu qual é. O efeito prático é o ímã: tudo que não tem lugar óbvio acaba ali, e a classe/módulo cresce sem que nenhuma revisão consiga apontar o que exatamente não pertence a ele.

**Exceção legítima:** nome consagrado de framework/biblioteca já presente na base, ou tipo de terceiro reexportado. Renomear export público é mudança de contrato — vale a nota, não a exigência.

## mutable-module-state `[HIGH]`

`export let x = ...` no topo do módulo é estado mutável compartilhado por **todo** importador — em Node, o módulo é carregado uma vez e cacheado, então todo request concorrente lê e escreve a mesma variável. É o análogo Node do `public static` mutável em .NET, e o efeito é o mesmo: corrida de dados sob carga concorrente.

**Exceção legítima:** cache com sincronização explícita e documentada, ou `export const` de um objeto cujo *conteúdo* é mutado de forma controlada (o scanner só olha para `export let`, não para mutação de propriedade — que é outro nível de escrutínio, deliberadamente fora deste scanner).

## single-impl-interface `[MEDIUM]`

Interface com uma única implementação (`class X implements Foo`) e nenhum outro consumidor costuma ser abstração especulativa — criada "para poder trocar depois" ou "para poder mockar". O custo é indireção permanente por um benefício hipotético.

**Exceção legítima:** porta de arquitetura hexagonal deliberada (o domínio declara a interface, a infraestrutura implementa — a segunda implementação é o teste/mock), ou fronteira de módulo onde a interface é o contrato publicado. Essa distinção é de julgamento; o scanner só aponta.

## O que fica de fora do scanner

Herança/composição mal decidida, tipo de retorno permissivo (`Promise<any>` sobre um resultado já tipado), nome que mente sobre o que a função faz, invariante de domínio ausente e teste sem asserção. Nenhum grep decide isso com precisão aceitável — é leitura do diff, e é por isso que a skill não substitui o reviewer. `no-direct-console` e `no-direct-data-access` também ficam fora **deste** scanner de propósito: são AST, cobertas pela camada de lint (`forge-quality/*`), não por regex sobre texto.
