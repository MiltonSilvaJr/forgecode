---
name: frontend-ui-review
description: |
  Revisa implementação de frontend/UI contra o design system, caçando despadronização: tokens
  fantasma (var(--x) nunca definidos), cores/bordas/espaçamentos hardcoded, controles nativos do
  browser sem estilo, reimplementação de componentes que o DS já provê, e dado cru (GUID/enum)
  vazando na tela. Roda gates determinísticos (scan de token/cor/controle nativo, custo zero, sem
  LLM) ANTES da revisão semântica. Use ao revisar PRs de UI, ao migrar telas para o design system,
  ao investigar quebra de dark mode, ou antes de declarar uma padronização "concluída". Gatilhos:
  "revisar UI", "padronização", "dark mode quebrado", "buraco de cor", "token fantasma", "design
  system", "componente ad-hoc". As convenções de escrita que ela verifica vivem em
  rules/frontend/design-system.md (§ Contrato de tokens); esta skill é o lado de auditoria.
---

# Revisão de implementação de frontend/UI

## Princípio central (leia antes de qualquer checklist)

O design system é um **contrato**. Despadronização quase nunca é preguiça — é acoplamento a um
contrato que não existe, mascarado por um fallback. O caso arquetípico:
`background: var(--surface-1, #fff)` onde `--surface-1` **nunca foi definido**. O browser usa `#fff`
sempre; em light "funciona" por acidente, em dark vira buraco branco. **O fallback é o vilão:
transforma um contrato quebrado em "funciona na minha máquina".**

Regra de ouro: **o CSS/JS deve falhar barulhentamente quando o contrato é violado, não cair
silenciosamente num literal.** A convenção correspondente (não use fallback literal; referencie o
token nu) é `rules/frontend/design-system.md`. Esta skill audita; a rule previne.

Ordem de execução: **gates determinísticos primeiro** (scripts, custo zero, sem LLM), **revisão
semântica depois** (julgamento). O barato e infalível filtra antes do caro e opinativo.

---

## Fase A — Gates determinísticos (bloqueiam o merge)

> Rode sobre a **superfície inteira**, não só o diff (ver Gate A5). Emita **uma linha OK/FAIL por
> gate**. Qualquer FAIL bloqueia. Os scans usam `rg` (ripgrep); onde faltar, `grep -arn` equivalente.

### A0 — Estabeleça a fonte da verdade
Localize o arquivo de tokens (`tokens.css`/`colors-and-type.css` ou equivalente) e o catálogo de
componentes do DS. Sem a lista de tokens **definidos** e de componentes **existentes**, você não
julga nada — o token fantasma é invisível a olho nu (ele "funciona" em light).

### A1 — Scan de token fantasma  ⭐ (o gate mais importante)
Diferença de conjuntos: tokens **referenciados** (`var(--x)`) menos tokens **definidos**. O que sobra
nunca existiu. É como saímos de "achei 4 buracos" para "37 tokens fantasma em 9 features" — caça
visual tela-a-tela só acha os que você navegou, e só no tema que quebra. O scan acha o universo em
segundos e é reproduzível em CI.

```bash
python3 .forge/skills/frontend-ui-review/scripts/scan-phantom-tokens.py <tokens.css> <src_dir> [allowlist_csv]
```

Exit 1 se houver token referenciado e nunca definido. `allowlist` (CSV) só para tokens legitimamente
injetados em runtime via `style` inline (ex.: `--progress` de uma barra). Todo o resto é bug.

### A2 — Scan de cor hardcoded
Cor literal fora da camada de tokens = sem tema, sem dark mode, sem marca (viola
`design-system.md` regras 1-2). Escopo: código de UI (`features/`, `components/`, `pages/`),
excluindo o arquivo de tokens, testes e stories.

```bash
rg -n --glob '!**/tokens*.css' --glob '!**/*.test.*' --glob '!**/*.stories.*' \
   -e '#[0-9a-fA-F]{3,8}\b' -e 'rgb\(' -e 'hsl\(' <src_dir> \
   && echo "FAIL hardcoded-color" || echo "OK hardcoded-color"
```
> Curadoria: hex dentro de `data:`/SVG inline pode ser falso-positivo; mantenha uma allowlist curta
> e justificada, nunca um "ignore geral".

### A3 — Smell de fallback literal
`var(--token, #hex)` com literal é suspeito por definição: ou o token existe (fallback morto e
enganoso) ou não (fallback mascarando o bug do A1). Regra do time: **referencie o token sem
fallback**; se faltar, que quebre em dev e force a correção na origem (definir o token), não o
remendo no ponto de uso.

```bash
rg -n 'var\(\s*--[A-Za-z0-9_-]+\s*,\s*[#0-9rgbahsl]' <src_dir> \
   && echo "WARN fallback-literal (revisar)" || echo "OK fallback-literal"
```

### A4 — Scan de controle nativo do browser (advisory)
`<input type="file|color|date|range">`, `<select>` etc. têm **chrome próprio** que o CSS comum não
alcança (`::file-selector-button`, `::-webkit-color-swatch`, `::-webkit-slider-thumb`). Aplicar
`border:none` no input não toca o pseudo-elemento interno — o botão/borda default do SO permanece.
Todo controle nativo é ponto de fuga do DS até ser explicitamente domado **ou** encapsulado num
componente do DS.

A receita antiga (`rg 'type="color"...' | grep -v design-system`) casava o atributo sozinho, qualquer que fosse o CSS irmão — poder discriminante zero, sempre WARN, nunca reconhecia um controle já corretamente estilizado. O scanner abaixo distingue **domado** de **não domado** sobre a **árvore** do arquivo, nunca sobre o texto: JSX/TSX é lido pela AST do `@babel/parser` (via Node, pelo helper `scan-native-controls-ast.mjs` ao lado do script), `.vue`/`.svelte`/`.html` pelo `html.parser` da stdlib, e o CSS por um tokenizador que respeita comentários, strings e aninhamento SCSS. Em JSX/TSX, comentário e string não são nós da AST, então o texto deles não forma elemento, não domestica e não esconde um controle. O `html.parser` não tem essa garantia em `.vue`/`.svelte`: ele não entende interpolação de template, e uma tag dentro de `{{ '<DsBox>' }}` ou `{'<style>…</style>'}` seria lida como nó real — por isso todo `.vue` que contém `{{` e todo `.svelte` com `{` fora dos blocos `<script>`/`<style>` de topo (texto, atributo ou spread) sai inteiro como `WARN não-analisado`, sem nenhum OK, desde que o texto possa conter um controle; o mesmo vale para `<template lang="pug">` ou qualquer `lang` que não seja `html`, cujo corpo não é HTML. A seleção de arquivos candidatos não distingue caixa: `<INPUT TYPE="COLOR">`, `<SELECT>` e `<TEXTAREA>` entram na varredura. Em `.vue`/`.svelte`, só os blocos `<script>` e `<style>` de topo contam; `<style>` ou `<script>` dentro do template é ignorado. Controle nativo é `<input>` com `type` file/color/date/time/datetime-local/month/week/range/checkbox/radio, `<select>`, `<textarea>`, `<input type={dinâmico}>`, `<input>` com spread (`{...p}` ou `v-bind="obj"`) sem `type` ou depois dele, ou com `type` ligado no Vue (`:type`, `:type.prop`, `.type`, `:[k]`) — sai `WARN type-dinâmico`, porque a expressão pode trocar o tipo — e componente com `type` nativo literal; cada um só é **OK** por um dos dois escapes da regra 12 de `design-system.md`:

1. **Encapsulamento em componente do DS**: um elemento cujo nome vem de import de caminho com `design-system` é **ancestral** do controle na árvore e o contém pelos filhos, ou o próprio elemento é esse componente (`<ColorInput type="color" />`). Componente do DS irmão no mesmo bloco ou em atributo não envolve; tag do DS dentro de string ou template literal de JSX não é elemento e não envolve; tag do DS dentro de interpolação de `.vue`/`.svelte` torna o arquivo não analisado. Tag HTML (`<input>`, `<div>`) nunca é componente do DS, mesmo com import homônimo (`import { input } from '…design-system'`). Nome do DS sombreado por parâmetro, variável ou função local (`({ DsBox }) => <DsBox>…`) não é o componente, e DS sob `v-pre` no Vue não é compilado e não envolve.
2. **Escape de aparência real que alcança o controle**, numa regra incondicional e com ao menos uma declaração do CSS irmão com o nome do componente (`X.css`/`X.module.css`, ou `.scss`/`.less`, para `X.tsx`), de um `<style>` do próprio arquivo, ou no `style` inline do controle. Regra vazia (`.sw::-webkit-color-swatch {}`) ou dentro de `@media`/`@supports`/`@container`/`@scope` não domestica (dentro de `@layer`, sim). Pseudo-elemento do tipo (`::-webkit-color-swatch`, `::file-selector-button`, `::-webkit-file-upload-button`, `::-webkit-slider-thumb`, `::-webkit-calendar-picker-indicator`…) conta quando o composto-sujeito do seletor não tem outra tag, classe ausente do controle, id, atributo alheio nem pseudo-classe (`::x`, `input::x`, `.sw::x`, `[type=color]::x` e `&::x` resolvido contra o pai). Propriedade (`appearance`/`-webkit-appearance`/`-moz-appearance: none` para checkbox, radio, select e textarea; `accent-color` para checkbox e radio) conta numa declaração real de regra cujo sujeito é a tag do controle, classe usada nele ou `[type=<tipo>]`, sem pseudo-elemento nem pseudo-classe — `input::-webkit-appearance { appearance: none }` e `.card { -webkit-appearance: none }` com `.card` fora do controle não domesticam. Classe usada no controle é só a estática e casa **pela origem da regra**. Classe literal (`className="x"`, `{"x"}`, `` {`x`} ``, `class="x"`) só casa com CSS global — `X.css` não-module (ou `.scss`/`.less`), `<style>` JSX, `<style>` de SFC sem `module` — e nunca com regra de `X.module.css` ou de `<style module>`, porque o CSS Module renomeia a classe. Classe de módulo — `styles.x`/`styles["x"]` apenas quando `styles` é o default import do `./X.module.css` (ou `.scss`/`.less`) irmão do próprio componente e não é redeclarado no arquivo, ou `$style.x` (ou `<nome>.x`) do `<style module>` no Vue — só casa com as regras daquele módulo, nunca com CSS global. O acesso segue a sintaxe de JS: depois do ponto só vale identificador (`$style.sw`, `styles.sw`); `$style.color-swatch` ou `styles.color-swatch` é subtração (`$style.color - swatch`), não a classe `color-swatch`, que só se nomeia por colchete e string (`$style['color-swatch']`, `styles["color-swatch"]`). Seletor sem classe (tag, atributo, pseudo solto) de um módulo vale como global. Dentro de um CSS Module (`X.module.*` ou `<style module>`), seletor cujo composto-sujeito está sob `:global` — com parênteses (`:global(.sw)`), sem parênteses (`:global .sw`) ou herdado de bloco `:global { .sw { … } }` — é **global**: casa classe literal e nunca classe de módulo; composto-sujeito que mistura classe local e global não casa nenhuma das duas. `theme.sw` ou `styles` de `./Outro.module.css` não contam. Um spread depois de `className` ou `style` apaga a classe e o style conhecidos. Vale a cascata dentro da mesma origem: para o mesmo seletor, a última declaração de `appearance` (e dos aliases `-webkit-appearance`/`-moz-appearance`, que são a mesma propriedade) ou de `accent-color` vence — `.sw { appearance: none }` seguido de `.sw { appearance: auto }`, ou `none` e `auto` na mesma regra com `auto` por último, não domestica; sobrescrita dentro de `@media`/`@supports` com outro valor também não, porque fora da condição o controle fica cru.

Tudo o mais é **WARN**. Arquivo que o parser não lê (erro de sintaxe, interpolação de template em `.vue`/`.svelte`, Node, helper ou `@babel/parser` ausente) sai como `WARN não-analisado`, nunca OK, com o motivo legível (por exemplo `helper de AST ausente: <caminho>` ou `@babel/parser indisponível`).

```bash
python3 .forge/skills/frontend-ui-review/scripts/scan-native-controls.py <src_dir>
```

Imprime `OK` por instância domada/encapsulada e `WARN` por instância crua, mais um resumo. **É advisory — nunca bloqueia (exit sempre 0)**: o discriminante correto reduz ruído, mas a metade bloqueante (fazer o WARN reprovar o merge) é decisão do consumidor, opt-in, fora desta skill.

**Pré-requisito no consumidor:** Node e o pacote `@babel/parser`. O helper resolve o parser primeiro a partir de `<src_dir>` (subindo diretórios até achar um `node_modules`) e depois a partir do próprio `.forge/`, então basta instalá-lo como devDependency na raiz do projeto: `npm install --save-dev @babel/parser` (ou `pnpm add -D @babel/parser`, `yarn add -D @babel/parser`). Sem ele, todo arquivo candidato sai `WARN não-analisado` com o motivo `@babel/parser indisponível`. No próprio harness ele já é devDependency.

Limites conhecidos: JSX montado por função, variável ou string em outro ponto não é seguido (o controle fica sem envoltório e sai WARN); `clsx(...)` e template com expressão não domesticam; os compostos ancestrais do seletor (`.wrap` em `.wrap .sw`) não são confrontados com o DOM real; `.sass` (sintaxe indentada) não tem regras legíveis; em `.vue`/`.svelte` o envolvimento só conta com fechamento explícito da tag do DS, e um `.vue` com `{{` (quase todo template real), um `.vue` com template pug ou um `.svelte` com `{…}` sai não analisado por inteiro — revise esses à mão; em `.vue`/`.svelte`/`.html`, `X.module.css` irmão não tem objeto que o referencie, então só os seletores sem classe dele contam; a cascata só compara declarações do mesmo seletor textual — seletor de especificidade diferente (`input.sw` contra `.sw`) e `!important` não entram no cálculo, e entre arquivos de mesma origem a ordem considerada é a de leitura (CSS global irmão antes das regras `:global` do módulo), não a ordem real de import; `@layer` não entra na cascata (uma regra fora de camada que reverte `appearance` vence a regra em camada no navegador, mas o scanner ainda considera a da camada); utilitários Tailwind (`appearance-none`) e CSS-in-JS (styled-components, emotion `css={...}`) não são lidos como escape de aparência e saem WARN — confira à mão; controle cujo `type` vem de `styled.input.attrs({ type: … })` não é detectado (o resumo pode dizer "nenhum controle nativo encontrado").

### A5 — Gate de cobertura (superfície inteira, não o diff)
A1/A2 têm que dar **zero no app inteiro**, não só nos arquivos alterados. Padronização é propriedade
**global**: uma área não migrada quebra a experiência mesmo com o seu PR limpo (migrar 4/10 áreas
deixou pipeline/partners/inbox quebrados no dark). Consistência não é média, é mínimo — uma tela fora
do padrão contamina a percepção do produto todo. O gate é binário.

---

## Fase B — Verificação de tema (light E dark, nas duas direções)

Alterne o tema e percorra as telas do change; teste **light→dark e dark→light** (o toggle tem que
ganhar nos dois sentidos). Light esconde, dark revela — dark mode é um **forçador de qualidade**:
expõe todo uso de cor que não passou pelo tema. Uma UI perfeita nos dois temas é, por construção, uma
UI que respeitou os tokens. Onde der, automatize: assert sobre **valor computado de estilo**
(`getComputedStyle`) por tema, não sobre "a classe existe".

### B1 — Comparação tela a tela com a prancha aprovada
Passar em acessibilidade, contraste e nos gates da Fase A prova que a tela é usável — não que é a
tela aprovada. Quando existe um artefato de design aprovado pelo dono, o aceite exige uma captura por
tela **e por modo**, lado a lado com a prancha, antes de declarar pronto; olhar só um print no modo
claro esconde justamente as divergências que o framework introduz no outro (fundo errado no escuro,
barra fora de ordem, tamanho de fonte menor, menu diferente, favicon errado). Quando o produto roda
sobre um framework com tema próprio (Infima do Docusaurus, Chakra, MUI), confira que as variáveis do
tema do produto estão amarradas aos tokens em **todos** os seletores de modo que o framework usa (ex.:
`:root` e `html[data-theme="light"]`/`html[data-theme="dark"]` no Docusaurus) — esses frameworks
redefinem variáveis por modo com especificidade maior que `:root`, então o tema do framework sobrepõe
o token do produto justamente no modo que ninguém olhou; e confira a unidade `rem`, porque o framework
pode fixar a raiz num tamanho menor que o padrão do browser (14px em vez de 16px), encolhendo todo
texto em `rem` sem que nenhum valor do produto tenha mudado.

---

## Fase C — Revisão semântica (julgamento)

### C1 — Primitivo faltante ≠ improviso
Se a tela reimplementa algo que deveria ser do DS (ou improvisa por falta dele — ex.: não há
`Select`, então cada tela faz o seu), o achado **não** é "faça um bonito aqui", é "**o DS precisa
deste primitivo**, e N telas já pediram". Padronização é decisão de **plataforma**, não de tela.
Separe "corrige aqui" de "peça faltante do sistema" e encaminhe a segunda ao dono do DS.

### C2 — Dado cru vazando (dependência de contrato do backend)
GUID (`bbbbbbbb-...`), enum (`tenant_admin`), código na tela geralmente é **dado cru vazando**, não
falha de CSS. Muita "feiura" de UI é o backend não expor um rótulo humano (ex.: BU sem endpoint
id→nome). Pergunte: "esse identificador deveria virar um nome, e existe fonte?". Se não existe, o
achado é de **backend** e vira tarefa lá — nenhum capricho de front conserta.

### C3 — Borda, espaçamento, raio e sombra também são tokens
Consistência não é só paleta (ver `design-system.md` regras 3-8). Linha de 1px consistente, escala de
espaçamento, raio de canto e sombra vêm de tokens. A sensação de "padronizado" nasce tanto de um
`border` uniforme quanto de uma cor uniforme.

### C4 — Estados e acessibilidade
Cheque hover/focus-visible/disabled, vazio/carregando/erro, navegação por teclado e contraste WCAG AA
nos dois temas. Padronização inclui comportamento, não só aparência em repouso.

---

## Fase D — Auditoria da qualidade dos testes

Pergunte de cada teste: **o que ele realmente prova?** O change que originou esta skill tinha **2174
testes verdes** e mesmo assim buracos de dark mode e ordenação quebrada passaram — porque os testes
asseguravam **estrutura** ("renderiza", "classe existe"), não **comportamento real** ("a superfície
resolve a cor certa no tema dark", "clicar no header reordena via a API real"). Exija testes que
exercitem tema renderizado e caminho real de dados. No mínimo, os gates A1/A2 devem virar **CI gate**
— eles *são* o teste que faltava.

### D1 — E2E de cerimônia de autenticação: trocar o sujeito do teste, nunca abrir mão do teste
Fluxo de login/convite com WebAuthn (ou qualquer cerimônia equivalente) não se valida só com `curl`
contra o link — "carregou com 200" não é evidência de que um fluxo de várias etapas (servidor aceitar
o código, criar e verificar a credencial) funciona; a correção real pode estar numa etapa que o curl
nunca exercita (ex.: URL truncada na cópia, só visível no log de acesso da borda/balanceador). Depois
de um incidente em que um navegador automatizado completou sozinho a cerimônia numa conta real, a
resposta certa não é proibir o navegador automatizado e sobrar só o curl — é rodar o E2E sempre contra
uma **identidade descartável** criada para o teste, com **autenticador virtual declarado
explicitamente** (via CDP), conferido no event store/backend e com a conta apagada ao fim; a credencial
do titular nunca entra no navegador automatizado. Um risco de teste se resolve trocando o sujeito do
teste, não abrindo mão do teste.

---

## Formato de saída

```
## Frontend UI Review — <alvo>

Gates determinísticos:
  [OK|FAIL] A1 phantom-tokens   — <n> não definidos
  [OK|FAIL] A2 hardcoded-color  — <n> ocorrências
  [OK|WARN] A3 fallback-literal — <n>
  [OK|WARN] A4 controles-nativos
  [OK|FAIL] A5 cobertura (superfície inteira)

Achados semânticos (severidade · arquivo:linha · recomendação):
  - ...

Veredito: APROVADO | BLOQUEADO (gates FAIL ou achados HIGH)
```

## Anexo — cada gate ↔ o incidente real que ele previne

- **A1** ← 37 tokens fantasma (`--surface-1`, `--color-surface-unread`, …) → buracos brancos no dark.
- **A3** ← `var(--surface-1, #fff)` "funcionava" em light e escondeu o contrato quebrado.
- **A4** ← botão "Escolher arquivo" cinza do SO e swatch de cor com borda grossa nativa.
- **A5** ← migração parcial (4/10 áreas) deixou pipeline/partners/inbox quebrados.
- **C1** ← ausência de `Select` no DS → campo de BU impossível de padronizar.
- **C2** ← BU exibida como GUID `bbbbbbbb` por falta de endpoint id→nome.
- **C3** ← borda de 1px destoante nos swatches de cor.
- **D**  ← 2174 testes verdes que não pegaram nada disso.
