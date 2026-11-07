---
description: Ponto de entrada explícito para a skill design-system-creator — instala o Storybook, cria os assets de design system (tokens, ícones, componentes) e desenvolve as UIs a partir de um handoff do Claude Design. Use quando você tiver um link de handoff no formato https://api.anthropic.com/v1/design/h/<id>.
argument-hint: "[<handoff-url>]"
---

# /forge:design-system — Storybook, design system e UIs a partir de um handoff

Argumentos: `$ARGUMENTS` — o link de handoff do Claude Design no formato
`https://api.anthropic.com/v1/design/h/<id>`. Se não vier, **peça-o** antes de começar
(a skill não consome HTML avulso, e sim o bundle do handoff).

Este comando é o ponto de entrada explícito para a skill `design-system-creator`. Toda a
lógica detalhada (download/extração do bundle, leitura de README + transcripts + tokens,
estrutura dos pacotes, armadilhas) vive na skill — aqui apenas orquestramos a invocação.

## Protocolo

1. **Pré-condições de stack.** A skill assume **monorepo JS (pnpm)**, Node >= 22, **React +
   CSS Modules + tokens** (sem Tailwind, sem Radix, sem CSS-in-JS). Inspecione o repositório.
   Se ele não tiver essa estrutura (ex.: backend `services/`, outra linguagem, ou raiz sem
   `package.json`), **pare e decida com o usuário** onde materializar — pasta do app frontend
   ou um pacote de design system próprio. Nunca trabalhe no `main`.

2. **Carregue a skill `design-system-creator`** e siga o seu passo a passo, usando o link de
   `$ARGUMENTS` como entrada. Em resumo: baixar/extrair o bundle, ler na ordem certa, instalar
   o Storybook e materializar `packages/design-tokens`, `packages/icons` e
   `packages/ui-components` (primitivos + blocos + telas) além de
   `docs/product/design-system/{design-system,tokens,components,accessibility}.md`.
   Trabalhe num branch `feat/design-system/<slug>-ui-kit`.

3. **Genérico sobre a marca.** Derive cores, fontes, neutros e semânticas do
   `project/colors_and_type.css` do handoff. A intenção final mora nos `chats/*.md` — leia-os.

4. **Verifique (tudo verde):** `typecheck`, `lint`, `test` (coverage gates) e `storybook:build`.

5. **Relate** os pacotes criados, número de primitivos/blocos/telas, coverage e o branch.
   **Não** commite/push/PR sem pedido explícito. Sem co-autoria de IA.
