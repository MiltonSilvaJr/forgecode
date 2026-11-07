---
id: backend-dotnet-relational
version: 1
applies_to:
  - dotnet
  - relational-database
status: experimental
---

# Backend C#/.NET relacional

Use para áreas C#/.NET que persistem em banco relacional. Antes de aplicar, leia os ADRs e o código vizinho; a solução existente vence qualquer preferência deste pack.

## Enforcement mecânico — a primeira camada

Regra escrita em prosa compete com todo o contexto lido depois dela e perde. Regra convertida em erro de compilação não degrada: o build para, e o agente corrige antes de devolver a tarefa. Tudo neste pack que o compilador pode provar **sai do prompt e vira configuração**; o que sobra para julgamento está na segunda camada (`skills/dotnet-quality-scan/`).

Três arquivos na raiz fazem essa conversão. Audite com `bash .forge/scripts/dotnet-baseline.sh --check` e materialize com `--apply` (nunca sobrescreve arquivo existente sem `--force`); os modelos vivem em `assets/` deste pack.

**`Directory.Build.props`** — o MSBuild o importa automaticamente em todo projeto abaixo dele na árvore, e a localização do `.sln` é irrelevante. Só o primeiro arquivo encontrado subindo a partir do `.csproj` é importado: para combinar níveis, importe o superior explicitamente. As propriedades load-bearing são `TreatWarningsAsErrors` (sem ela o aviso é lido e ignorado), `AnalysisLevel`/`AnalysisMode` (qual conjunto de analisadores e com que agressividade) e `EnforceCodeStyleInBuild` (sem ela as regras `IDExxxx` valem só dentro da IDE).

**`.editorconfig`** — e a armadilha que custa mais caro aqui: a severidade declarada dentro de uma regra de nomenclatura (`dotnet_naming_rule.<x>.severity`) é respeitada **apenas por IDEs**. Em build ela é ignorada. O squiggle aparece no editor, o CI passa verde, e o enforcement de nomenclatura simplesmente não existe — ninguém percebe, porque a evidência visível diz o contrário. Quem liga nomenclatura em build é `dotnet_diagnostic.IDE1006.severity = warning|error`. O `--check` reprova um `.editorconfig` que tenha `dotnet_naming_rule` sem esse par.

**`Directory.Packages.props`** — Central Package Management (`ManagePackageVersionsCentrally`). Com ele ligado, o `.csproj` declara apenas `<PackageReference Include="..." />` e a versão vive num ponto único; um `Version=` remanescente no projeto vira erro de restore (NU1008), e o `--check` os lista antes que a adoção quebre o build. Em monorepo, divergência de versão entre projetos é o default silencioso — CPM é o que a torna impossível.

**Adoção.** `AnalysisMode All` numa base existente produz centenas de erros no primeiro build e a adoção morre ali; comece em `Recommended` (o que o `--apply` faz sozinho quando detecta código) e suba quando o inventário estiver limpo, registrando a decisão. Analisadores de terceiros (Meziantou, SonarAnalyzer.CSharp, Roslynator) entram com `IncludeAssets` restringindo ao tempo de compilação — assim não vazam para o pacote publicado nem viram dependência transitiva de quem consome a biblioteca.

## Defaults condicionais

- Para projetos novos, use versão LTS do SDK disponível, nullable reference types, injeção por construtor, `CancellationToken` propagado e `ProblemDetails` para erros HTTP. Não introduza esses padrões em brownfield sem task/ADR que os justifique.
- EF Core migrations devem ser revisadas como parte do diff. Em arquitetura hexagonal, entidade de domínio, modelo de persistência e mapper podem ser separados; em monólito em camadas, não crie a separação sem benefício demonstrável.
- Valide payloads na borda. O tipo C# não substitui validação de entrada. Autorização de recurso exige checagem de ownership quando aplicável e teste negativo contra acesso alheio.
- Para dinheiro, `money-as-cents.md` prevalece: `long` em centavos e `BIGINT`, nunca `decimal` como regra de domínio. `decimal` em mapeamento de coluna só é permitido por ADR que documente unidade, precisão e arredondamento.

## Verificação

Comece pela camada barata e determinística, nesta ordem: `bash .forge/scripts/dotnet-baseline.sh --check` (a configuração está no lugar?), `bash .forge/skills/dotnet-quality-scan/scripts/scan.sh` (o que o compilador não pega), e só então `dotnet build` + `dotnet test`. Revisar estilo à mão num repositório sem `TreatWarningsAsErrors` é gastar julgamento onde faltava um interruptor.

Rode os comandos declarados em `FORGE.md`; na ausência deles, proponha `dotnet build` e `dotnet test` sem executá-los se o ambiente não estiver preparado. Para mudança de schema, aplique `data/schema-evolution.md`. Para API, teste contrato HTTP e autorização. Para domínio, aplique TDD e PBT quando houver propriedades matemáticas.

Persistência relacional: o catálogo de antipatterns e a varredura estática da skill `data-relational-practices` (`bash .forge/skills/data-relational-practices/scripts/scan.sh --root <path>`, uma linha por regra, achado com `arquivo:linha`) cobrem migração bloqueante, tipos, OFFSET profundo, NOLOCK, dinheiro em `NUMERIC` e tabela multi-tenant sem RLS; decisão de desenho de dados (modelo, store, chave, isolamento) vai ao agente `data-engineer`, que delega ao `data-relational`.

## Não fazer

- Não usar `latest` como versão de pacote ou imagem.
- Não ativar Docker, banco, migration ou instalação de ferramenta sem autorização operacional.
- Não bloquear uma mudança somente porque ela não usa EF Core, `ProblemDetails` ou uma arquitetura específica; o contrato existente governa.
