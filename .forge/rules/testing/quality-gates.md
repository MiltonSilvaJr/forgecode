---
title: Quality Gates e Níveis de Teste
applies_to:
  - all
priority: high
last_reviewed: 2026-05-08
---

# Quality Gates e Níveis de Teste

## Níveis Obrigatórios

| Nível | Escopo | Obrigatório para |
|-------|--------|-----------------|
| **Unit** | Domain + Application isolados | Todo código com lógica de negócio |
| **Integration** | Application + Infrastructure + DB real | Repositórios, handlers, eventos |
| **Contract** | Consumer/Provider via Pact | Toda integração frontend–backend |
| **E2E** | Fluxo completo via API real | Fluxos críticos de negócio |

Nenhuma feature sem testes. Nenhuma lógica financeira sem testes determinísticos.

## Ferramentas por Stack

| Stack | Unit/Integration | Mocks | PBT |
|-------|-----------------|-------|-----|
| .NET | xUnit 2.x + FluentAssertions | NSubstitute | FsCheck |
| React/TypeScript | Jest 30 + @testing-library/react | vi (built-in) | fast-check |
| Android/Kotlin | JUnit 5 + Kotest | MockK | Kotest Property |

## Coverage — Thresholds Mínimos por Camada

| Camada | Threshold Linha | Threshold Branch |
|--------|----------------|-----------------|
| Domain | 95% | 90% |
| Application | 85% | 80% |
| Infrastructure | 70% | — |
| Frontend (features/) | 80% | 75% |

Coverage de linhas é proxy — o objetivo é cobertura de **comportamentos**. Todo caminho de código com lógica de negócio deve ter teste correspondente.

## Property-Based Testing (PBT)

**Obrigatório** quando há propriedades matemáticas verificáveis:

- `Money.Add/Subtract/Split/CalculateFee` — toda operação monetária
- Arredondamento NBR 5891
- Operações sobre coleções com invariantes
- Geração de hashes (ledger chain)

Propriedades típicas: comutatividade, associatividade, idempotência, invariantes de soma.

Ver `tdd.md` para exemplos de FsCheck e fast-check.

## Testes de Dados Financeiros

- Dados de teste reproduzíveis (seed ou fixtures versionados)
- Valores monetários em centavos (inteiros) — nunca float/decimal
- Testar limites: zero, máximo de `long`, overflow

## Análise Estática

| Ferramenta | Stack | Gate |
|------------|-------|------|
| `dotnet format --verify-no-changes` + Roslyn analyzers | .NET | Bloqueante em CI (executado pela skill `verify-build`) |
| `dotnet-baseline.sh --check` | .NET | Bloqueante em CI — `TreatWarningsAsErrors`, severidade por ID de regra e CPM presentes no repositório |
| ESLint | TypeScript/React | Bloqueante em CI |
| commitlint | Todos | Bloqueante em hook |

## Portão de decisão para burndown de lint

Passivo de avisos herdado — regra existente virando obrigatória, ou lint novo habilitado sobre código já grande — não se resolve por decreto silencioso. Antes de implementar a correção, meça o trecho mais caro/arriscado com números reais (contagem de violações por regra, por arquivo) e apresente três opções ao dono do repositório:

- **(A) Corrigir tudo.** Padrão na ausência de resposta.
- **(B) Corrigir a maioria barata e rastrear o resto como dívida VISÍVEL.** Supressão pontual com comentário e referência de issue (`// eslint-disable-next-line <regra> -- ver ISSUE-123`, ou equivalente da stack) — nunca supressão silenciosa sem essa referência.
- **(C) Reescopar ou afrouxar a própria regra.** Marcado explicitamente como **MUDANÇA DE CONFIG** — nunca apresentado como se o código tivesse ficado mais limpo.

**Severidade derivada de contagem medida:** regra sem nenhuma violação existente nasce `error`; regra com violações nasce `warn`, com a contagem anotada como linha de base no commit que a introduziu. O critério de parada é essa contagem voltar a zero — só então a regra sobe para `error`.

**`ignore` curto e nomeado, nunca a regra inteira rebaixada:** silenciar uma linha/arquivo específico com o motivo e a referência de issue, em vez de desligar a regra para o projeto inteiro — a mesma disciplina do `TODO`/`FIXME` de `code-style.md` §8.

Fonte: portão de decisão adaptado do prompt 02 do `vibe-coding-toolkit` (MIT).

**Enforcement determinístico (REQ-03/REQ-04, `check-suppression-reference.sh`):** a referência exigida no item (B) acima deixa de ser só convenção em prosa — `.forge/scripts/check-suppression-reference.sh` reprova de forma determinista toda supressão (`@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`/`eslint-disable*` em JS/TS; `# noqa`/`# type: ignore` em Python) sem `LDG-NNNN`/`ADR-NNNN`/`ISSUE-NNN`/`issue #NNN`/`closes #NNN`/`fixes #NNN` nas linhas adicionadas do diff, chamado em `/forge:ship` e no hook `pre-push` (receita "Supressão sem referência" em `gate-runner/SKILL.md`). Cobertura nesta rodada: só JS/TS e Python — C#/.NET (`#pragma warning disable`) e Bash ficam fora de escopo explícito, sem lacuna silenciosa.

## Testes de Acessibilidade

- `jest-axe` obrigatório em componentes de UI (unit)
- `@axe-core/playwright` em testes E2E

## Comparação gerado × versionado

Um comparador que confere um artefato GERADO (código, contrato, snapshot) contra sua contraparte VERSIONADA no repositório não pode tratar toda divergência como defeito — a divergência tem duas causas possíveis, e só uma delas é regressão: o gerador mudou legitimamente, ou o artefato versionado foi editado deliberadamente (por exemplo, para corrigir uma exposição de superfície que o gerador produzia por padrão). Medido em produção: um comparador de contrato OpenAPI bloqueou pushes por três semanas mandando regenerar por cima de edições deliberadas, uma delas a correção de uma exposição de superfície interna real.

1. **Asserções de propriedade do artefato, independentes da comparação byte-a-byte.** Antes de comparar gerado × versionado, o teste verifica propriedades do artefato em si (schema válido, campos obrigatórios presentes, superfície não expõe o que não deveria) — essas asserções continuam valendo mesmo quando o versionado diverge do gerado por edição deliberada.
2. **Mensagem de falha que NUNCA prescreve "regenerar e commitar".** Ao detectar divergência, a mensagem nomeia as DUAS causas possíveis — o gerador mudou legitimamente, ou o versionado foi editado deliberadamente — e aponta `git log -p -- <arquivo>` como o próximo passo para decidir qual delas é o caso. Uma mensagem que instrui sobrescrever o versionado com o gerado descarta por decreto a possibilidade de que a edição deliberada esteja certa.
3. **Onde o contrato versionado é fonte da verdade, nenhum teste tem como remediação sobrescrevê-lo com o gerado** — ver `architecture/api-and-contracts.md` § Fonte da verdade e comparação gerado × versionado.

## Regressão Visual

- Playwright snapshots para componentes do design system
- Workflow `visual-regression.yml` ativado em PRs que tocam `apps/web/**` ou `packages/frontend/**`
- Falha se diff > 0.1%
- Snapshots gerados em CI com imagem Docker para diff determinístico de fonte

## Quality Gates em CI

| Gate | Trigger | Bloqueante |
|------|---------|-----------|
| Unit + Integration tests | Todo PR | Sim |
| Baseline de build .NET (`dotnet-baseline.sh --check`) | PR que toca `.cs`/`.csproj`/`.sln` | Sim |
| Contract tests | PR com mudança de contrato | Sim |
| ESLint / dotnet format | Todo PR | Sim |
| Coverage thresholds | Todo PR | Sim |
| Visual regression | PR em `apps/web/**` ou `packages/frontend/**` | Sim |
| Trivy (CVE) | Todo build de imagem | Sim |
| OWASP ZAP DAST | Schedule semanal | Sim (bloqueia deploy) |

## Ordinal de gate (`wNNN`) — derive do tronco remoto, nunca da própria árvore

Escolher o próximo ordinal olhando `ls tests/*-gate.sh` da árvore de trabalho é uma decisão global tomada a partir de estado local: duas branches paralelas escolhem o mesmo número e um dos dois arquivos perde a identidade no merge — o runner os executa em ordem de nome sem notar. Aconteceu duas vezes numa única rodada deste repositório.

Use `bash .forge/scripts/gate-ordinal.sh next`, que deriva do tronco **remoto** (`git ls-tree origin/develop`), contemplando o que outra branch já mergeou, e **declara** quando degradou para a árvore local por falta de remoto acessível. Um número devolvido em silêncio é indistinguível de um número que contemplou o tronco, e é por essa indistinção que os ordinais colidem.

`bash .forge/scripts/gate-ordinal.sh check` reprova quando dois arquivos compartilham o ordinal. É a peça que funciona sem rede, e é a que faz a colisão aparecer no push de quem a criou em vez de no merge de quem não tem contexto. Nada disto **impede** duas branches que nunca se viram de escolher o mesmo número — o que se ganha é o momento da descoberta.

## Proibições Explícitas

- Feature mergeada sem testes correspondentes
- Lógica financeira sem testes determinísticos
- `// @ts-ignore` ou `#pragma warning disable` sem justificativa em comentário
- Testes sem asserção (test que passa sem verificar nada)
- Mock de banco em testes de integração (usar Testcontainers)
