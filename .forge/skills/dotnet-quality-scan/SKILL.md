---
name: dotnet-quality-scan
description: |
  Varre código C#/.NET em busca do que o compilador e os analisadores Roslyn não reprovam — `async void`, `.Result`/`.Wait()` bloqueante, `new HttpClient()`, `#region`, nomes genéricos (Manager, Helper, Utils), parâmetro booleano de modo, `catch` vazio, `DateTime.Now`, SQL interpolado, estado estático mutável e interface com implementação única. Determinística: roda `scripts/scan.sh` e emite uma linha por regra, inclusive as que não acharam nada. Use antes de revisar C# ("revisar minhas mudanças", "code review", "olhar a qualidade deste serviço"), no `dotnet-reviewer` e no `/forge:verify` de change que toca `.cs`. Não use para bug de correção, falha de segurança de infraestrutura, ou para stack que não seja .NET.
---

# dotnet-quality-scan

Duas camadas cobrem qualidade em .NET, e elas não se substituem.

A **primeira** é o build: `TreatWarningsAsErrors`, `AnalysisMode`, `EnforceCodeStyleInBuild` e a severidade por ID de regra no `.editorconfig` transformam convenção em erro de compilação. O que essa camada pega, ninguém precisa revisar — o build já reprovou. Ela é auditada por `bash .forge/scripts/dotnet-baseline.sh --check` e materializada com `--apply`.

A **segunda** é esta skill: o que nenhum analisador vê porque depende de intenção. Nenhuma regra Roslyn dirá que `PedidoHelper` não nomeia nada, que `Process(order, true)` esconde duas funções numa só, ou que a interface criada "para poder mockar" tem uma implementação e nenhum outro consumidor.

## Protocolo

Ordem fixa. A ordem é o que torna a revisão auditável — sem ela, o que foi verificado depende de quanto contexto sobrou.

1. **Escopo.** Defina os paths .NET afetados (diff da branch, ou o serviço em questão). Não varra o monorepo inteiro quando o change tocou um projeto.
2. **Baseline de build.** `bash .forge/scripts/dotnet-baseline.sh --root <path> --check`. Se ele reprovar, **diga isso primeiro**: revisar estilo à mão num repositório sem `TreatWarningsAsErrors` é gastar julgamento onde faltava um interruptor. Se `dotnet build`/`dotnet test` falhar de um jeito que não é erro de compilação do código revisado (zero testes executados, "A especificação de uma solução deve ser feita por `--solution`", "VSTest target is no longer supported"), é armadilha de comando/ambiente, não achado de qualidade — ver `references/dotnet-test-pitfalls.md` antes de reportar como regressão.
3. **Detecção.** `bash .forge/skills/dotnet-quality-scan/scripts/scan.sh --root <path> [--json /tmp/dotnet-scan.json]`. Saída: uma linha por regra. `OK` quer dizer verificado e limpo, não "não olhei".
4. **Julgamento.** Cada `FOUND` é candidato, não veredito — leia o arquivo:linha e decida. As exceções legítimas estão em `references/clean-code-rules.md`.
5. **Relatório.** Uma linha por regra, incluindo as que passaram. Achado sem `arquivo:linha` não entra.

## O que o scanner NÃO faz

Ele não julga. `async void` num event handler do WinForms é correto; `.Result` num `Main` síncrono de ferramenta de linha de comando é aceitável; uma interface com implementação única pode ser fronteira de porta hexagonal deliberada. O scanner localiza; quem revisa decide. Um relatório que trata todo `FOUND` como defeito treina o time a ignorar o relatório.

Ele também não substitui a leitura do diff: acoplamento, nome que mente sobre o que a função faz, invariante de domínio ausente e teste que não testa nada continuam sendo trabalho de leitura.

## Sessão limpa

Rode esta revisão numa sessão **separada** daquela que escreveu o código. Um agente que revisa o próprio trabalho defende o código em vez de lê-lo — no pipeline do Forge isso já é estrutural (o `code-evaluator` invoca reviewers como agentes distintos), e vale manter quando a revisão for pedida à mão.

## Referências

- `references/clean-code-rules.md` — cada regra, por que ela existe e quando a exceção é legítima
- `references/detection-commands.md` — os comandos crus, para auditar o que o scanner faz
- `references/dotnet-test-pitfalls.md` — armadilhas de comando/ambiente ao rodar ou escrever teste .NET (`.slnx`, Microsoft.Testing.Platform, `DOTNET_ROOT`, Testcontainers, mock de gRPC, raw string literal, `MeterListener`) — não são achados do scanner, mas custam uma rodada perdida quando o baseline de build/teste falha por elas
- `.forge/capabilities/backend-dotnet-relational/PROFILE.md` — a camada de build e a armadilha do IDE1006
- `.forge/rules/conventions/code-style.md` — a versão agnóstica de stack destas mesmas diretrizes
