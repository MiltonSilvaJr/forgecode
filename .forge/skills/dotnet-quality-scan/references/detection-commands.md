# Comandos de detecção

O `scripts/scan.sh` roda tudo isto de uma vez e formata a saída. Esta página existe para auditar o que ele faz e para uso pontual quando você quer uma regra só.

Dois motores, o mesmo padrão: `rg` quando está instalado, `grep -arnE` quando não. Nenhum padrão usa `\b`, porque o `grep` BSD do macOS não o reconhece e o scanner passaria a achar menos na máquina de quem revisa — falso verde silencioso. `[[:space:]]` e `([^A-Za-z0-9_]|$)` fazem o mesmo trabalho nos dois.

**Universo visto pelo motor, não só pela sintaxe do padrão:** por padrão o `rg` respeita `.gitignore` e trata arquivo não-UTF-8 como binário, pulando os dois em silêncio — um caso real chegou a ter arquivos de texto inteiros invisíveis ao `rg` (parte em ISO-8859-1, um `.env` versionado casado por `.gitignore`), e "zero ocorrências" só vale para o que o motor efetivamente abriu, não para o universo real. Por isso todo comando `rg` abaixo (e o que `scripts/scan.sh` roda) leva `--no-ignore --text` — o equivalente ao `-a` que o `grep` já usa. Ao escrever um comando pontual fora do script, replique as duas flags; sem elas, um "0 ocorrências" manual não tem a mesma garantia que o scanner dá.

```bash
# async void
rg -n --no-ignore --text --glob '*.cs' 'async[[:space:]]+void[[:space:]]'

# bloqueio de Task
rg -n --no-ignore --text --glob '*.cs' '([.]Result([^A-Za-z0-9_]|$)|[.]Wait\(\)|GetAwaiter\(\)[.]GetResult\(\))'

# HttpClient instanciado direto
rg -n --no-ignore --text --glob '*.cs' 'new[[:space:]]+HttpClient[[:space:]]*\('

# region
rg -n --no-ignore --text --glob '*.cs' '^[[:space:]]*#region'

# nomes que não nomeiam
rg -n --no-ignore --text --glob '*.cs' '(class|record|struct|interface)[[:space:]]+[A-Za-z0-9_]*(Manager|Helper|Utils|Utility)([^A-Za-z0-9_]|$)'

# parâmetro booleano de modo
rg -n --no-ignore --text --glob '*.cs' '(public|internal|protected)[^;]*\([^)]*bool[[:space:]]+[A-Za-z_]'

# catch vazio
rg -n --no-ignore --text --glob '*.cs' 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}'

# relógio local no domínio
rg -n --no-ignore --text --glob '*.cs' 'DateTime[.]Now([^A-Za-z0-9_]|$)'

# SQL interpolado
rg -n --no-ignore --text --glob '*.cs' '(FromSqlRaw|ExecuteSqlRaw|CommandText[[:space:]]*=|new[[:space:]]+SqlCommand)[^"]*\$"'

# estado estático mutável (o filtro remove readonly/const e assinaturas de método)
rg -n --no-ignore --text --glob '*.cs' '(public|internal)[[:space:]]+static[[:space:]]' | grep -vE '(readonly|const|\(|class|record|struct|interface|enum)'

# interface com implementação única (duas passadas: declara IX, depois conta ": IX" / ", IX")
rg -n --no-ignore --text --glob '*.cs' '(public|internal)[[:space:]]+(partial[[:space:]]+)?interface[[:space:]]+I[A-Z]'
rg -n --no-ignore --text --glob '*.cs' '(:|,)[[:space:]]*IFoo([^A-Za-z0-9_]|$)'   # IFoo = cada nome achado no passo anterior

# transação manual sob execution strategy com retry (só vale a pena rodar a segunda busca se a primeira achar algo)
rg -n --no-ignore --text --glob '*.cs' 'EnableRetryOnFailure'
rg -n --no-ignore --text --glob '*.cs' 'BeginTransaction(Async)?\(' | grep -v CreateExecutionStrategy
```

Equivalente sem `rg`: troque `rg -n --no-ignore --text --glob '*.cs'` por `grep -arnE --include='*.cs'` e acrescente o diretório alvo no fim — o `grep` já lê binário com `-a` e nunca aplicou `.gitignore`, então não precisa de flag equivalente ao `--no-ignore`.

## Limites destes comandos

São regex sobre texto, não análise sintática. Eles não sabem o que é comentário, o que é string literal e o que atravessa mais de uma linha — uma assinatura quebrada em várias linhas escapa do `bool-param`, e `// new HttpClient()` num comentário aparece como achado. É o preço de ser barato e portátil; a triagem é de quem lê.

`single-impl-interface` é o caso onde isso mais custa, porque o achado é uma conclusão sobre arquitetura, não um estilo pontual (LDG-0062). Os dois erros são silenciosos e em direções opostas: uma implementação **comentada** (`// class Old : IFoo`) conta como ocorrência real e pode esconder uma interface que hoje tem exatamente uma implementação de verdade (falso negativo — a regra não acha o que devia); e uma declaração `interface IFoo` dentro de comentário ou string literal é tratada como interface existente, cuja única "implementação" real infla a contagem para uma conclusão que não existe no código compilável (falso positivo). Declaração de base partida em mais de uma linha (`class Foo :\n    IFoo`) tampouco é contada, na mesma direção do falso negativo. Nenhum desses três casos é raro em base grande — são exatamente o "comentário, string literal, declaração multi-linha" que esta seção já nomeia para as outras nove regras.

Quando a precisão importar mais que o custo, a ferramenta certa é um analisador Roslyn de verdade: uma regra customizada em `Microsoft.CodeAnalysis.CSharp` opera sobre a árvore sintática, entra no build e reprova o PR — que é a primeira camada, não esta.
