# Análise de Impacto e Navegação por Símbolos (LSP)

## Princípio

Antes de renomear símbolos, alterar assinaturas ou mudar contratos públicos, **entenda o raio de impacto**. Edição às cegas — especialmente find/replace textual — quebra em cascata: renomeia string literal, atinge símbolo homônimo de outro escopo, ou deixa call sites órfãos. O custo de mapear referências antes é baixo; o de uma quebra silenciosa em base multi-stack é alto.

Navegação semântica (LSP/IDE) é a ferramenta ideal para isso. Quando ela não está disponível, `grep` por referências + o compilador/typechecker da stack cobrem a maior parte do valor de correção.

## Quando aplicar

Obrigatório para edições de **impacto**:
- Renomear símbolo (classe, função, tipo, interface, variável/constante exportada).
- Mudar assinatura (parâmetros, tipo de retorno, genéricos, nullability).
- Alterar contrato público (interface, endpoint, evento, schema, `.proto`, DTO).
- Mover ou remover símbolo público.

Não obrigatório para edições locais triviais que não mudam a superfície pública (corpo de função sem mudar assinatura, ajuste de texto, comentário).

## Procedimento (3 passos)

1. **Localizar** — todas as referências e implementações do símbolo:
   - **Preferir LSP/IDE quando disponível**: *find all references*, *go to definition*, *find implementations*, *rename simbólico* (entende escopo, overloads e namespace; não toca strings nem homônimos não relacionados).
   - **Caso contrário**, `grep`/Grep por todas as ocorrências — atento a overloads, homônimos em escopos diferentes e usos parciais (ex.: nome em string de log, atributo, reflexão).
   - **Complementar, quando `graph.enabled: true`**: `bash .forge/scripts/graph.sh query <termo>` / `path <de> <para>` (grafo nativo do harness, custo zero) — não substitui o LSP nem o grep, mas enxerga fan-in/fan-out **cross-arquivo e cross-linguagem** que o LSP de uma única stack não alcança (ver "CodeGraph nativo" abaixo). Para o raio de impacto completo do conjunto de arquivos afetados, `bash .forge/scripts/impact.sh --files <paths>`.
2. **Editar** — com o impacto já mapeado; atualizar todos os call sites na mesma mudança.
3. **Validar** — rodar o diagnóstico da stack (compilador / typechecker / linter) **antes de declarar concluído**. Em projetos com *warnings tratados como erros*, o build já é o diagnóstico autoritativo.

## Por stack

| Stack | Navegação semântica (LSP/IDE) | Diagnóstico — fallback obrigatório |
|-------|-------------------------------|------------------------------------|
| C# / .NET | Roslyn LSP · C# Dev Kit · OmniSharp | `dotnet build` (TreatWarningsAsErrors) + analisadores Roslyn |
| React / TypeScript | `typescript-language-server` (tsserver) · IDE | `tsc --noEmit` + ESLint |
| Python | Pyright / Pylance · `python-lsp-server` | `pyright` (ou `mypy`) + `ruff` |
| Kotlin / JVM | `kotlin-language-server` · IntelliJ | `./gradlew compileKotlin` + detekt / ktlint |

> Regra prática: **prefira LSP/IDE quando disponível; senão, `grep` de referências + o diagnóstico da stack acima.** Não declare "use LSP" como obrigação quando o agente/ambiente não tem a ferramenta — o fallback é o que precisa rodar de fato.

> **Pré-requisito de ambiente:** o passo de validação depende de que o **diagnóstico da stack** (coluna direita) esteja instalado — é ele, não o LSP, que valida a edição. O LSP server é desejável para navegação, mas secundário. Rode `bash .forge/scripts/doctor.sh` para verificar o que falta por stack detectada no repo (e `--install` para instalar os faltantes, opt-in). O `doctor.sh` apenas reporta por padrão e nunca instala sozinho.

## Limites do LSP — não substitui revisão cross-artefato

O LSP entende o grafo de símbolos de **uma** linguagem. Ele **não** enxerga divergências entre artefatos heterogêneos, que costumam ser a fonte dos bugs mais caros:

- Migração SQL ↔ mapeamento ORM ↔ SQL dos testes.
- `.proto` / OpenAPI / AsyncAPI ↔ stubs gerados ↔ DTOs.
- Schema / YAML / JSON ↔ código que consome.
- Strings (queries, nomes de coluna, chaves de config, valores de enum em CHECK) que não são símbolos da linguagem.

Para mudanças que cruzam artefatos, **confronte manualmente as fontes** — idealmente as três: contrato ↔ implementação ↔ teste. O LSP só fica confiável com o projeto compilando; no meio de uma edição que quebrou o build, suas referências/diagnósticos ficam degradados — nesse estado, recaia no `grep` + build.

## CodeGraph nativo — camada complementar (quando disponível)

O harness constrói um grafo de imports/refs determinista e zero-tokens (`/forge:codegraph`, ADR `0001-graph-engine`), independente de LSP instalado. Ele não entende semântica de símbolo dentro de uma linguagem — quem faz isso é o LSP/diagnóstico da coluna direita da tabela acima — mas cobre exatamente onde o LSP para: relações **entre arquivos e entre linguagens** (fan-in/fan-out, camada, caminho de import). Use-o como primeiro filtro, barato, antes de abrir arquivo cru ou de decidir o escopo de um `grep`:

- `bash .forge/scripts/graph.sh query <termo>` — localiza o nó, suas dependências e camada, a custo zero, antes de ler o arquivo (§16.2).
- `bash .forge/scripts/graph.sh path <de> <para>` — existe cadeia de import entre dois arquivos/módulos?
- `bash .forge/scripts/impact.sh --files <paths>` — conjunto de arquivos que dependem (transitivamente) dos arquivos-semente; é o mesmo mecanismo obrigatório em scale ≥3 antes de `/forge:tasks`/`/forge:implement` (`.forge/commands/graph/impact.md`).

Não dispensa o passo 3 (diagnóstico da stack) nem os limites descritos acima — SQL↔ORM, `.proto`↔stub, schema↔consumidor continuam exigindo confronto manual das fontes, porque o grafo mapeia imports/refs de código, não esses vínculos declarativos.

## Guardrail G5 — frescor de grafo/impacto é EXECUTADO, não lembrado (LDG-0036)

`impact-freshness.mjs` (fonte única da fórmula de fingerprint, `.forge/scripts/lib/`) julga o
`impact.json` de um change em quatro estados: `not-applicable` (change sem `affected_paths` de
código, ou sem grafo construído — nunca bloqueia), `missing` (grafo existe, o change toca código,
não há `impact.json`), `stale` (existe mas o fingerprint não bate com o grafo atual) e `fresh`.

`missing`/`stale` é **BLOQUEANTE** em dois pontos, com o mesmo julgamento:

- **`spec-transition.sh`**, na transição para `implementing` — chama `impact-freshness.mjs`
  diretamente e recusa a transição. É aqui que o guardrail vale de verdade: começar a
  implementar sem saber o raio de impacto é a mesma classe de risco que G1 (conflito não
  resolvido) e G4 (governança de dados divergente), e recebe o mesmo tratamento — bloqueio
  determinístico, não confiança em o agente lembrar de rodar `/forge:analyze` item 6.
- **`archive-spec.sh`**, no pré-flight do archive — mesma fórmula, mais tarde no ciclo (defesa em
  profundidade: cobre o caso do grafo mudar DEPOIS de `implementing`, sem novo `/forge:impact`).

Antes deste guardrail existir como gate, a única execução real era o pré-flight do archive —
tarde demais para mudar como a implementação foi feita — e `analyze.md` item 6 dependia do
agente rodar `node .forge/scripts/lib/impact-freshness.mjs` manualmente durante `/forge:analyze`.
Um achado escrito em `analysis.md` sem a checagem ter rodado é achado que não existe.

Para destravar: `/forge:update` (grafo atual) e depois `/forge:impact --change <id>` (grava
`impact.json` fresco) antes de `implementing`.

## Anti-patterns

- Renomear via find/replace textual cego (atinge string literal e homônimos de outro escopo).
- Mudar assinatura ou contrato público sem buscar todos os call sites.
- Declarar uma mudança concluída sem rodar o compilador/typechecker da stack.
- Confiar no LSP para validar consistência entre artefatos que ele não indexa (SQL, proto, YAML).
- Ignorar o CodeGraph nativo quando `graph.enabled: true` em mudança que cruza múltiplas linguagens/stacks — ele enxerga fan-in/fan-out entre arquivos que o LSP de uma stack isolada não vê.

## Verificação

- PR que renomeia ou altera símbolo público sem atualizar todos os call sites é regressão.
- Build / typecheck verde da stack é pré-requisito de conclusão de qualquer edição de impacto.
