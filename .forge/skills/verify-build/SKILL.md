---
name: verify-build
description: |
  Skill determinística usada pelo `code-evaluator` antes de gastar tokens com reviewers LLM. Detecta a stack do diff (`.cs` → .NET, `.ts/.tsx` → Node, `.java` → Java, `.py` → Python, `.kt/.kts` → Gradle) e roda compilação + testes. Retorna JSON com `passed: true/false`, lista de erros estruturada e métricas (coverage por camada quando disponível). Falha aqui = `REJECTED` imediato, sem chamar reviewers.
---

# Skill: verify-build

## Quando Usar

Invocada pelo `code-evaluator` na **Fase 1.1** do pipeline de review, antes de qualquer reviewer LLM. Determinística: o resultado é o veredito do compilador/test runner, não opinião de modelo.

## Inputs

```yaml
branch: feat/...
base: main
diff_sha: <sha>
strict_mode: true     # se true, warnings de compilação contam como erro
```

## Princípios de leitura de veredito

Antes de aceitar qualquer "suíte verde" como prova, aplicar:

- **Verde local só vale para os gates que de fato rodaram na mesma configuração do CI.** Para .NET, rodar na config que o workflow usa (normalmente Release) — um teste dependente de ordem de execução pode passar 100% em Debug e falhar em Release porque a ordem dos casos muda entre builds; quando um teste diverge entre execuções, extrair a ordem real do relatório (`.trx` ou equivalente) antes de chamar de "flaky" ou "pré-existente". Verde fora da configuração do CI não é evidência sobre o CI. Vale também para catraca de warnings do CI: suíte 100% verde não impede reprovação por warning novo (ex. `xUnit1051`, `CS8602`) num arquivo tocado pelo diff — depois de build e teste, `grep` os arquivos do diff na saída do build (com `--no-incremental`, para não esconder warning por cache incremental) e tratar warning novo como falha quando o projeto tiver catraca no CI.
- **Suíte de caracterização/golden/snapshot alterada pelo mesmo diff que ela deveria travar não é prova.** Se o diff sob verificação também edita o arquivo de expectativas que a suíte de caracterização compara, extrair cada expectativa alterada (antes → depois) e exigir que bata com uma entrada do registro de aprovação externo do projeto — expectativa alterada sem aprovação é achado, independentemente de a suíte estar verde; rebaixar "suíte verde" para "suíte verde sobre expectativas não alteradas pelo mesmo diff" quando esse for o caso.
- **"Teste de integração contra a dependência real" só prova o comportamento de produção se herdar as restrições de produção.** Checar: (a) a identidade/privilégio usado pelo teste é o de produção (role, permissões, sem bypass de RLS/superusuário), não o de bootstrap do container; (b) o teste percorre o caminho real de execução (worker/host sem contexto pré-montado), não o método interno já com contexto definido; (c) o teste não depende de serviço externo não declarado que por acaso está no ar (porta/endpoint default). Dependência "real" com privilégio de administrador testa um sistema que não existe, e o verde é mais perigoso que a ausência de teste porque encerra a investigação.
- **Suíte paralela pode disputar um artefato gerado por ela mesma** em diretório ignorado pelo versionamento (ex.: dependências baixadas por um teste e lidas por outro); mais de um produtor sem dono único/exclusão mútua produz "intermitência" que na verdade é determinística — ver gate-runner para o diagnóstico.
- **Ao estender o pipeline a uma stack nova, a prova é um alvo real da stack nova atravessando build+test+lint até o veredito, não a detecção de arquivo aceitando o padrão novo.**
- **Relatório de coverage presente não é relatório com conteúdo**: ao extrair `line-rate`/`branch-rate` de `coverage.cobertura.xml` ou equivalente, confirmar que o arquivo tem entradas reais (não um relatório vazio de uma stack que não rodou nenhum teste) antes de reportar a métrica como aprovada.
- Quando a verificação precisar rodar só um subconjunto da suíte (recorte por módulo/projeto tocado), derive o recorte do CONTEÚDO (import, invocação, literal de saída assertado) — nunca de semelhança de nome de arquivo, que é convenção e não dependência; se o recorte não puder ser derivado com confiança, rodar a suíte inteira.

## Comportamento

### 1. Detectar stacks afetadas

```bash
git diff --name-only $base..HEAD | tee /tmp/changed-files.txt
```

Classifica:

| Padrão de arquivo | Stack |
|---|---|
| `*.cs`, `*.csproj`, `*.sln` | dotnet |
| `*.ts`, `*.tsx`, `package.json`, `*.config.ts` | node |
| `*.java`, `pom.xml` | java |
| `*.py`, `pyproject.toml`, `requirements*.txt` | python |
| `*.kt`, `*.kts`, `build.gradle*` | gradle |
| `Dockerfile`, `*.yaml` (K8s), `.github/workflows/*.yml` | infra (build a partir do contexto) |

Para cada stack detectada, executa o pipeline correspondente. Múltiplas stacks → executar em **paralelo** (jobs independentes do shell).

### 2. Pipeline .NET

O rigor deve vir do **repositório**, não deste flag. `-p:TreatWarningsAsErrors=true` na linha de comando vale só para esta execução: o `dotnet build` que o humano roda na máquina dele, e o que roda em qualquer outro pipeline, continuam ignorando o aviso. O lugar da propriedade é o `Directory.Build.props` — auditado por `bash .forge/scripts/dotnet-baseline.sh --check`, que roda antes do build e emite `DOTNET-BASELINE` como finding `HIGH` quando o repositório não a declara. O `strict_mode` aqui é rede de segurança para o repositório que ainda não adotou o baseline, nunca o mecanismo principal.

```bash
# Baseline de enforcement (barato, determinístico, roda antes de compilar)
bash .forge/scripts/dotnet-baseline.sh --check 2>&1
BASELINE_EXIT=$?

# Restaurar — NUGET_PACKAGES isolado evita que o cache global compartilhado entre sessões da
# mesma máquina grave, no lockfile, o hash de um pacote empacotado localmente por outra sessão
# (o restore não revalida contra o feed quando a versão já está no cache, mesmo com
# --force-evaluate); se o lockfile for commitado ou servir de prova de versão publicada,
# confira .nupkg.metadata -> source do pacote antes de aceitar o resultado.
NUGET_PACKAGES="${NUGET_PACKAGES:-/tmp/nuget-verify-build-$$}" dotnet restore --nologo --verbosity quiet

# Compilar — sem warnings em strict_mode
if [ "$strict_mode" = "true" ]; then
  dotnet build --no-restore --nologo -warnaserror -p:TreatWarningsAsErrors=true 2>&1
else
  dotnet build --no-restore --nologo 2>&1
fi
BUILD_EXIT=$?

# Formato — `quality-gates.md` declara este gate bloqueante em CI; sem --verify-no-changes o
# comando REESCREVE os arquivos e sai 0, o que transforma um gate em formatação silenciosa.
dotnet format --verify-no-changes --no-restore 2>&1
FORMAT_EXIT=$?

# Testar com coverage
dotnet test --no-build --nologo \
  --collect:"XPlat Code Coverage" \
  --results-directory /tmp/coverage-dotnet \
  --logger "trx;LogFileName=test-results.trx" 2>&1
TEST_EXIT=$?

# Extrair coverage por projeto
find /tmp/coverage-dotnet -name "coverage.cobertura.xml" -exec \
  grep -oE "line-rate=\"[0-9.]+\".*branch-rate=\"[0-9.]+\"" {} \;
```

### 3. Pipeline Node/TypeScript

O rigor por regra vem do `eslint.config.*` do **repositório**, não deste comando. `bash .forge/scripts/node-baseline.sh --check` responde se as regras `forge-quality/*` (vendorizadas, AST via ESLint) estão registradas com a severidade certa — `no-direct-console` e `no-direct-data-access` load-bearing, `max-lines` deliberadamente **não bloqueante** (decisão registrada, ledger `LDG-0061`/`LDG-0130`: tamanho de arquivo é sinal, não portão). Se reprovar, emite `NODE-BASELINE` como finding `HIGH` antes mesmo de rodar o lint.

```bash
# Baseline de enforcement (barato, determinístico, roda antes do lint)
bash .forge/scripts/node-baseline.sh --check 2>&1
BASELINE_EXIT=$?

# Detectar package manager
if [ -f pnpm-lock.yaml ]; then PM=pnpm
elif [ -f yarn.lock ]; then PM=yarn
else PM=npm; fi

# Instalar
$PM install --frozen-lockfile 2>&1 || $PM ci 2>&1
INSTALL_EXIT=$?

# Type check
$PM exec tsc --noEmit 2>&1
TSC_EXIT=$?

# Lint (ESLint) — SEM --max-warnings=0. Essa flag conta TODO warning do projeto, sem exceção
# por regra, e `forge-quality/max-lines` é warning por decisão deliberada (não bloqueante);
# `--max-warnings=0` reprovaria o build por um sinal que o harness decidiu não ser portão.
# Erro de severidade "error" (inclusive forge-quality/no-direct-console e
# forge-quality/no-direct-data-access quando ligadas) já derruba o exit code sozinho — não
# precisa do --max-warnings para isso.
$PM exec eslint . 2>&1
LINT_EXIT=$?

# Test com coverage
$PM test -- --coverage --coverageReporters=json-summary 2>&1
TEST_EXIT=$?
```

### 4. Pipeline Kotlin/Gradle

```bash
./gradlew --no-daemon assembleDebug 2>&1
BUILD_EXIT=$?

./gradlew --no-daemon testDebugUnitTest jacocoTestReport 2>&1
TEST_EXIT=$?
```

### 5. Pipeline Java

Use o wrapper e o build tool existentes; nunca troque Maven por Gradle (ou vice-versa) durante a verificação.

```bash
if [ -x ./mvnw ]; then ./mvnw -B verify
elif [ -f pom.xml ]; then mvn -B verify
elif [ -x ./gradlew ]; then ./gradlew --no-daemon test
else echo "FAIL: Java sem Maven/Gradle wrapper ou ferramenta disponível"; exit 1
fi
```

### 6. Pipeline Python

Use o gerenciador e os comandos declarados no projeto. Para `pyproject.toml`, não instale globalmente; crie/consuma o ambiente virtual já definido pela ferramenta do repositório.

```bash
# Exemplos condicionais: o runtime do FORGE.md vence.
python -m pytest
ruff check .
```

Se o projeto declara mypy ou pyright no runtime, execute-o; caso contrário, reporte typecheck como não configurado, não como aprovado.

### 7. Pipeline Infra (validações estáticas)

Sem compilação real, mas valida sintaxe:

```bash
# Dockerfile lint
docker buildx build --check . 2>&1 || hadolint Dockerfile 2>&1

# K8s YAML
find . -path './platform/k8s/*.yaml' -exec kubectl --dry-run=client apply -f {} \; 2>&1

# GitHub Actions
find .github/workflows -name "*.yml" -exec actionlint {} \; 2>&1
```

## Output Obrigatório

Escrever em `/tmp/verify-build-output.json`:

```json
{
  "skill": "verify-build",
  "passed": false,
  "exit_code": 1,
  "stacks_detected": ["dotnet", "node"],
  "results": {
    "dotnet": {
      "build": { "passed": true, "warnings": 2, "errors": 0 },
      "test": {
        "passed": false,
        "total": 142,
        "failed": 3,
        "failures": [
          {
            "test": "PaymentTests.Split_Negative_Throws",
            "file": "services/payment/tests/Payment.Domain.Tests/PaymentTests.cs",
            "line": 87,
            "message": "Expected DomainException but got InvalidOperationException"
          }
        ]
      },
      "coverage": {
        "Payment.Domain": { "line": 0.94, "branch": 0.88 },
        "Payment.Application": { "line": 0.82, "branch": 0.79 }
      }
    },
    "node": {
      "typecheck": { "passed": true },
      "lint": { "passed": true, "warnings": 0 },
      "test": { "passed": true, "total": 87, "failed": 0 },
      "coverage": { "overall": { "lines": 0.81, "branches": 0.76 } }
    }
  },
  "duration_seconds": 142,
  "findings_to_emit": [
    {
      "id": "BUILD-001",
      "severity": "BLOCKER",
      "category": "build",
      "file": "services/payment/tests/Payment.Domain.Tests/PaymentTests.cs",
      "line": 87,
      "title": "Teste falhou: PaymentTests.Split_Negative_Throws",
      "description": "Expected DomainException but got InvalidOperationException",
      "fix_suggested": "Verificar tipo de exceção lançada por Payment.Split() com valor negativo. Provavelmente a guard clause foi removida ou o tipo de exceção mudou."
    }
  ]
}
```

`exit_code`:
- `0` → tudo passou; o `code-evaluator` segue para reviewers
- `1` → algo falhou; `code-evaluator` emite `REJECTED` imediato com os findings desta skill

## Findings que esta skill emite

| ID | Severidade | Quando |
|---|---|---|
| `BUILD-NNN` | BLOCKER | Compilação falhou |
| `TEST-NNN` | BLOCKER | Teste falhou |
| `COVERAGE-NNN` | BLOCKER | Domain < 95% linha ou < 90% branch |
| `COVERAGE-NNN` | HIGH | Application < 85%/80%, Infra < 70%, Frontend < 80%/75% |
| `LINT-NNN` | HIGH | ESLint error (não warning) ou `dotnet format --verify-no-changes` divergente |
| `DOTNET-BASELINE` | HIGH | `dotnet-baseline.sh --check` reprovou: enforcement de build ausente ou incompleto |
| `NODE-BASELINE` | HIGH | `node-baseline.sh --check` reprovou: `forge-quality/*` ausente, desligada ou `max-lines` declarada `"error"` |
| `TYPECHECK-NNN` | BLOCKER | `tsc --noEmit` falhou |

## Anti-Patterns

- Rodar testes sem compilação prévia
- Aceitar warnings em modo strict
- Ignorar coverage gates
- Continuar fluxo se uma stack falhou (todas as stacks devem passar)
- Mockar comando externo (compilador/runner é a verdade)
- Encadear verificação e publicação (push, force-push, retarget/edição de PR, merge, commit) com `;` ou em comandos soltos no mesmo shell — a ação publica mesmo com a verificação vermelha, porque `;` não lê o código de saída do passo anterior. Toda publicação fica condicionada ao exit code da verificação no mesmo comando (`&&` ou `|| exit`); isso vale também para gates que precedem uma escrita de histórico (commit, amend), não só o push.
- Aceitar `FAILURE`/vermelho de CI como prova de Red sem ler a mensagem do próprio gate no log. Um status FAILURE genérico pode vir de uma causa anterior no pipeline (fetch sem credencial, setup quebrado) que nunca chegou a executar o gate que se queria provar — exigir o marcador que só o gate emite, citado junto do status.
- Aceitar prova de correção baseada em bateria de mutação que só muta a lógica isolada: cobertura de mecanismo não é cobertura de fiação (invocador real), de fonte alternativa de dado, nem de cada chamador de um helper compartilhado — ver gate-runner, seção Mutação, para os conjuntos de mutante exigidos.

## Referências

- `.forge/rules/testing/quality-gates.md` (thresholds de coverage)
- `.forge/rules/testing/tdd.md`
