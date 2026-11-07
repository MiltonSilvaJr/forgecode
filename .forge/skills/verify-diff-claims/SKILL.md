---
name: verify-diff-claims
description: |
  Skill determinística usada pelo `code-evaluator` na Fase 1.2 para detectar alucinação textual: confronta o que o coder agent afirmou no commit message / PR description com o que o `git diff` realmente contém. Emite findings `CLAIM-NNN` quando há claim sem evidência (ex.: "adicionei IPaymentRepository" mas o símbolo não existe no diff).
---

# Skill: verify-diff-claims

## Quando Usar

Invocada pelo `code-evaluator` na **Fase 1.2**, após `verify-build` passar. Determinística (grep/AST/diff stat), barata, executa em segundos. Detecta alucinação textual antes de qualquer reviewer LLM.

## Inputs

```yaml
branch: feat/...
base: main
diff_sha: <sha>
```

## Comportamento

### 1. Coletar claims do coder

O "coder" pode ter deixado declarações em 3 lugares:

```bash
# Commit messages do branch
git log $base..HEAD --pretty=format:"%h%n%B%n---"

# PR description (se variável GITHUB_PR_BODY estiver setada em CI)
echo "$GITHUB_PR_BODY"

# Comentário inline `// AGENT-CLAIM:` no código
git diff $base..HEAD | grep -E "^\+.*AGENT-CLAIM:"
```

Consolidar em `/tmp/claims-raw.txt`.

### 2. Extrair claims acionáveis

Padrões reconhecidos (parsing por regex):

| Padrão | Interpretação |
|---|---|
| `add(ed|ei|cionei)?\s+([\w.]+Repository\|Service\|Handler\|Controller)` | Espera símbolo nomeado no diff |
| `cria(do|ei)?\s+endpoint\s+(GET\|POST\|PUT\|DELETE)\s+(/[^\s]+)` | Espera rota correspondente |
| `add(ed|cionei)?\s+test(s|es)?\s+(?:cover(ing|indo)?)?\s+([\w]+)` | Espera arquivo `*Tests.cs` ou `*.test.ts` tocando o símbolo |
| `migration\s+([\w]+)` | Espera arquivo de migration |
| `event\s+([\w]+(?:\.v\d+)?)` | Espera evento publicado |

Comandos sugeridos:

```bash
# Claim: "adicionei IPaymentRepository"
grep -arE "interface IPaymentRepository" --include="*.cs" $(git diff $base..HEAD --name-only)

# Claim: "endpoint POST /api/v1/payments"
grep -arE "\[HttpPost\(\"v1/payments|MapPost\(\"v1/payments|@PostMapping.*payments" \
  $(git diff $base..HEAD --name-only)

# Claim: "teste cobrindo Split"
git diff $base..HEAD --name-only | grep -iE "Tests\.cs$|\.test\.tsx?$|\.spec\.tsx?$" | \
  xargs grep -lE "Split|split"

# Claim: "migration AddPaymentTable"
git diff $base..HEAD --name-only | grep -iE "Migrations.*AddPaymentTable"
```

### 3. Cross-check de stubs/TODOs

Detectar implementação prometida mas vazia:

```bash
# Métodos novos com corpo trivial
git diff $base..HEAD --unified=0 | grep -BE "(public|private|internal).*\b\w+\s*\(.*\)\s*=>\s*throw\s+new\s+NotImplementedException"

# TODO/FIXME no diff
git diff $base..HEAD | grep -E "^\+.*//\s*(TODO|FIXME|XXX|HACK)"
```

Stub sem TODO documentado + claim "implementei X" → CLAIM-NNN severidade `HIGH`.

### 4. Verificar consistência commit message ↔ scope

Para cada commit:

```bash
# Extrair scope do commit message: "feat(payment): ..."
SCOPE=$(git log -1 --format=%s <sha> | grep -oE "^[a-z]+\(([a-z-]+)\)" | sed 's/[^(]*(//;s/)//')

# Arquivos tocados pelo commit
FILES=$(git show --name-only --pretty="" <sha>)

# Validar que o scope corresponde aos paths
# scope "payment" deve tocar services/payment/** ou similar
```

Scope inconsistente com paths → `CLAIM-NNN` severidade `MEDIUM`.

### 5.1 Verificar fechamento de achado citado em múltiplos locais

Mesmo mecanismo do "Grep de fechamento de achado" da skill `gate-runner` (seção de gates baratos), aplicado aqui à alegação de correção, não ao gate: tratar a lista de locais citados por um achado como checklist completa, buscar a frase antiga (não só reler a frase nova) e cobrir artefatos irmãos citados — ver `gate-runner/SKILL.md` para o comando e o motivo da âncora de substituição precisar englobar a frase inteira.

### 5.2 Verificar alcançabilidade do código corrigido

Para cada teste que prova a correção alegada, listar os colaboradores substituídos por dublê que ficam ENTRE a entrada pública e o código corrigido (portões, políticas, feature flags, validadores) e conferir, no código real (não no dublê), se algum deles curto-circuita o caminho antes de chegar à entrada que o teste exercita. Se curto-circuita, a alegação vira "lógica corrigida, caminho inalcançável em produção" e o achado sobe para o revisor — um dublê de um portão no caminho não isola o código sob teste, ele remove a pergunta "este código é alcançável".

### 5.3 Verificar paridade comportamental e tabelas de constantes

Alegações de paridade ("replica o comportamento de X", "compatível com", "expõe o mesmo campo que X expunha") são afirmações sobre comportamento, não sobre texto, e grep não as fecha. Verificar por comparação diferencial: ler a implementação de referência instalada (não a lembrança da documentação) e, quando possível, rodar sondas pareadas no runtime real que vai para produção. Quando o diff introduz ou altera uma tabela de constantes que alega espelhar um enum/header de outra biblioteca (códigos de erro, opcodes, flags), gerar a tabela de referência a partir da fonte canônica instalada e diffar entrada por entrada — ler a tabela ou confiar num teste que cobre um único valor deixa passar entradas trocadas (número certo com nome errado) e entradas mortas (número que não existe no header); o parser da fonte de referência precisa de controle de contagem (quantas definições foram extraídas) antes de qualquer veredito "sem divergência" significar algo.

### 5.4 Verificar justificativa de não-correção

Tratar cada item de "decisão consciente / não corrigido nesta rodada" como alegação a verificar, não como decisão a respeitar — separar no parecer a decisão (aceitável ou não para o merge) da premissa factual que a sustenta (verdadeira ou falsa), com evidência de cada uma. Para alegação de inexistência de opção/API/comportamento: ler a declaração de tipos ou a fonte instalada e, quando possível, sondar no runtime de produção passando um valor que só uma opção reconhecida validaria. A justificativa escrita de uma não-correção é o texto menos revisado de um ciclo de revisão — o autor a escreve depois do parecer e ninguém volta nela —, e uma premissa falsa transforma decisão consciente em omissão bem redigida.

### 5.5 Verificar escopo da alegação, leitura de campo e de saída de gate/laço

Ao citar a saída de um gate/laço mecânico como evidência de uma claim (ex.: "o gate confirmou N ocorrências de X"), o identificador e qualquer detalhe auxiliar entre parênteses raramente são a mesma propriedade: o detalhe costuma nomear onde o INSTRUMENTO parou, não um atributo do alvo. Antes de repassar a claim, localizar na fonte do gate a linha que monta a string e nomear de que grandeza o detalhe é propriedade; tabular por frequência antes de generalizar — concentração num único valor é sinal de causa comum no instrumento, não de dispersão real no alvo citado.

Alegação de ausência/contagem ("zero achados", "N ocorrências", "campo X vazio") só vale para o universo que o comando realmente leu. Antes de aceitar: (a) se a busca usou o `grep`/`rg` padrão do shell do agente, confirmar que não está pulando arquivo não UTF-8 nem respeitando `.gitignore` de arquivo versionado (`LC_ALL=C /usr/bin/grep -a` ou equivalente, comparando contra o shim); (b) se a alegação foi medida num escopo menor que o do gate/produção real (cópia filtrada de arquivos, subconjunto), exigir medição no mesmo escopo e comando que o gate real usa antes de aceitar "sem achado"; (c) ao interpretar um campo de um objeto/JSON, confirmar que o campo existe no esquema ou na escrita real antes de interpretar o valor — ausência de campo e valor vazio são indistinguíveis, e um acesso a campo inexistente raramente levanta erro, só devolve vazio travestido de medição.

### 5.6 Verificar remoção completa de conteúdo indevido

Ao verificar a correção de conteúdo que não deveria estar no repositório (segredo, identificador de infraestrutura, PII), grep na ponta da branch não basta: localizar os commits que ainda carregam o conteúdo (`git log -p <base>..<head>` com grep, ou pickaxe `-S`), conferir se já foram publicados (`git branch -r --contains <sha>`) e se já existe PR (`gh pr list --head <branch> --state all`). Remoção na ponta não é remoção do repositório — merge por merge-commit ou rebase leva o commit inteiro ao histórico da base, e abrir PR cria uma ref que retém o commit mesmo depois de a branch ser apagada. Recomendar a ação que fecha cada caminho (squash merge, reescrita do commit antes do PR existir, rotação do segredo independentemente do histórico) e nunca repetir o conteúdo vazado no próprio parecer.

### 5.7 Verificar suíte de caracterização alterada pelo mesmo diff

Quando o diff altera um arquivo de expectativas de caracterização, golden ou snapshot, extrair cada expectativa alterada (antes → depois) e exigir que cada uma case com uma entrada do registro de aprovação externo do projeto. Expectativa alterada sem aprovação é achado, independentemente de a suíte estar verde — um teste que trava comportamento só protege se quem muda o comportamento não puder mudar o teste sem aprovação de fora, e quando os dois estão no mesmo diff, o verde é autodeclarado.

### 5.8 Verificar privilégio real em alegação de "teste de integração real"

Quando o relatório afirmar "integração contra a dependência real" (banco, fila, serviço externo), exigir evidência além do verde: (a) a identidade/privilégio usado pelo teste é o de produção, não o de bootstrap/superusuário do container; (b) o teste percorre o caminho real de execução, não o método interno com contexto já montado; (c) o teste não depende de serviço externo não declarado que por acaso está no ar; (d) se o teste usa um bootstrap que concede privilégio "porque em produção outro artefato de deploy faz isso", conferir no artefato de deploy versionado (chart/IaC) que o mesmo grant existe, citando arquivo e linha — um bootstrap deve espelhar o ambiente de destino, não completá-lo.

### 6. Verificar `Co-Authored-By` proibido

```bash
git log $base..HEAD --pretty=%B | grep -iE "Co-Authored-By:\s*(Claude|Anthropic|GPT|Copilot)|Generated with.*Claude|🤖 Generated"
```

Match → finding `CLAIM-AUTHORSHIP` severidade **BLOCKER** (regra global de `.forge/constitution.md`).

## Output Obrigatório

Escrever em `/tmp/verify-diff-claims-output.json`:

```json
{
  "skill": "verify-diff-claims",
  "passed": false,
  "exit_code": 1,
  "claims_extracted": 12,
  "claims_verified": 10,
  "claims_unverified": 2,
  "findings_to_emit": [
    {
      "id": "CLAIM-001",
      "severity": "HIGH",
      "category": "anti-hallucination",
      "file": null,
      "line": null,
      "title": "Claim sem evidência: 'adicionei IPaymentRepository'",
      "description": "Commit message 'feat(payment): adicionei IPaymentRepository' afirma adição da interface, mas grep no diff não encontrou 'interface IPaymentRepository' em nenhum arquivo .cs novo/modificado.",
      "fix_suggested": "Verificar se o coder agente realmente criou a interface, ou se a claim está incorreta. Pode ser path errado (foi criado mas em local diferente), ou alucinação."
    },
    {
      "id": "CLAIM-AUTHORSHIP",
      "severity": "BLOCKER",
      "category": "compliance",
      "file": null,
      "line": null,
      "title": "Commit com co-autoria de IA",
      "description": "Commit abc123 contém 'Co-Authored-By: Claude <noreply@anthropic.com>'. Regra global proíbe atribuição de IA em commits.",
      "fix_suggested": "Rebase interativo removendo a linha Co-Authored-By dos commits afetados, ou amend + force-push.",
      "rule_violated": ".forge/constitution.md — Convenções de commit"
    }
  ],
  "matched_claims": [
    { "claim": "endpoint POST /api/v1/payments", "evidence_file": "services/payment/src/Payment.Api/Controllers/PaymentsController.cs:42" }
  ]
}
```

`exit_code`:
- `0` → todas as claims verificadas; segue para reviewers
- `1` → há claim BLOCKER (authorship); REJECTED imediato

Claims `HIGH` (sem evidência) **não** bloqueiam por si só — viram input para `logic-reviewer` e `quality-reviewer` decidirem.

## Findings que esta skill emite

| ID | Severidade | Quando |
|---|---|---|
| `CLAIM-NNN` | HIGH | Claim no commit message sem evidência grep/AST no diff |
| `CLAIM-NNN` | MEDIUM | Scope do commit inconsistente com paths tocados |
| `CLAIM-STUB-NNN` | HIGH | Método declarado "implementado" mas corpo é `throw new NotImplementedException` |
| `CLAIM-AUTHORSHIP` | BLOCKER | `Co-Authored-By: Claude` ou similar em commit |
| `CLAIM-PARTIAL-FIX-NNN` | HIGH | Achado citado em múltiplos locais corrigido em apenas parte deles, ou frase antiga sobrevivendo ao lado da nova |
| `CLAIM-UNREACHABLE-NNN` | HIGH | Teste prova a correção com dublê de um portão/política que, no código real, torna o caminho corrigido inalcançável pela entrada de produção |
| `CLAIM-PARITY-NNN` | HIGH | Alegação de paridade comportamental ou tabela de constantes não confere com a fonte canônica instalada |
| `CLAIM-DEFERRAL-NNN` | HIGH | Justificativa de "decisão consciente / não corrigido" com premissa factual falsa |
| `CLAIM-SCOPE-NNN` | MEDIUM | Alegação de ausência/contagem medida em escopo menor que o do gate real, ou por grep que pula arquivo não UTF-8/gitignorado versionado |
| `CLAIM-LEAK-NNN` | BLOCKER | Conteúdo indevido (segredo, PII, identificador de infra) removido só na ponta da branch, ainda alcançável por commit publicado ou ref de PR |
| `CLAIM-CHAR-NNN` | HIGH | Expectativa de suíte de caracterização/golden/snapshot alterada pelo mesmo diff sem entrada correspondente no registro de aprovação |
| `CLAIM-INTEGRATION-NNN` | HIGH | "Teste de integração real" roda com privilégio/contexto que produção não tem (bootstrap/superusuário, serviço externo não declarado) |

## Anti-Patterns

- Confiar no commit message sem cross-check no diff
- Pular esta skill "porque o build passou" — build não detecta alucinação textual
- Tratar todo claim sem match como BLOCKER (muitos são `MEDIUM`/`HIGH` por ambiguidade de regex)
- Não verificar `Co-Authored-By` em todos os commits do branch
- Aceitar "corrigido" na primeira ocorrência de um achado citado em múltiplos locais, sem auditar os demais
- Aceitar suíte verde como prova de alcançabilidade quando os testes substituem por dublê um portão/política que fica entre a entrada pública e o código corrigido
- Fechar alegação de paridade/tabela de constantes por leitura de documentação lembrada, em vez de comparação diferencial contra a fonte instalada
- Tratar item de "decisão consciente, não corrigida" como decisão já validada, sem checar a premissa factual que a sustenta
- Aceitar grep/contagem feito com o shim padrão do shell (que pode pular não-UTF-8 e respeitar `.gitignore` de arquivo versionado) ou medido num escopo menor que o do gate real como prova de ausência
- Considerar uma remoção de conteúdo indevido fechada só porque a ponta da branch está limpa, sem checar commits já publicados e refs de PR
- Aceitar suíte de caracterização verde quando o mesmo diff também editou o arquivo de expectativas que ela deveria travar, sem checar o registro de aprovação externo

## Referências

- `.forge/constitution.md` — proibição de co-autoria de IA
- `.forge/rules/conventions/conventional-commits.md` — scopes canônicos
