---
name: design-system-creator
description: Cria um design system completo a partir de um link de handoff do Claude Design (claude.ai/design). Baixa o bundle, lê o README + transcripts + tokens, instala o Storybook e materializa packages/design-tokens, packages/icons e packages/ui-components (primitivos + blocos + telas) além de docs/product/design-system/{design-system,tokens,components,accessibility}.md. Use quando o input for um link "https://api.anthropic.com/v1/design/h/<id>" seguido de "implemente os designs neste projeto" (PT ou EN), ou quando o usuário pedir para criar/implementar um design system a partir de um design do Claude Design.
---

# /design-system-creator — Design System a partir de um handoff do Claude Design

Você materializa um **design system de produção** a partir de um bundle de handoff exportado do Claude Design (`claude.ai/design`). A skill é **genérica**: tudo (cor de marca, fontes, neutros, raios) é **derivado do handoff** — nunca hardcode uma marca específica.

## Entrada

Um link no formato `https://api.anthropic.com/v1/design/h/<id>` acompanhado de uma instrução como:

> "Fetch this design file, read its readme, and implement the relevant aspects of the design. https://api.anthropic.com/v1/design/h/<id> — Implement: the designs in this project"

ou (pt-BR):

> "Baixe este arquivo de design, leia o arquivo readme e implemente os aspectos relevantes do design. https://api.anthropic.com/v1/design/h/<id> — Implemente: os designs neste projeto"

Se o link não vier, **peça-o** antes de começar.

## Definition of Done

1. `packages/design-tokens`, `packages/icons`, `packages/ui-components` criados (ou completados, em brownfield).
2. **Storybook instalado** e `storybook:build` verde.
3. `docs/product/design-system/{design-system.md, tokens.md, components.md, accessibility.md}` entregues, coerentes com os tokens reais.
4. `typecheck`, `lint`, `test:ci` (com coverage gates) e `storybook:build` **verdes**.
5. Trabalho num **branch de feature** (`feat/design-system/<slug>-ui-kit`), **sem commit/push** salvo pedido explícito.

## Princípios

- **Genérico sobre a marca.** Derive o brand color, fontes (display + UI), neutros e semânticas do `project/colors_and_type.css` do handoff. O X laranja `#FF4000` deste exemplo é só *um* caso — leia o que o handoff define.
- **A intenção mora nos transcripts.** Leia `chats/*.md` — é onde o usuário pousou depois de iterar com o assistente de design.
- **Brownfield-safe.** Se `packages/*` ou os docs já existem, **compare com o handoff e complete só o que falta** — nunca sobrescreva o que já está coerente. (Caso comum: os tokens já existem e batem com o handoff; nesse caso só adicione blocos/telas/docs ausentes.)
- **Stack fixa:** **CSS Modules + tokens** (CSS custom properties). **Sem Tailwind, sem Radix, sem CSS-in-JS.** `forwardRef` + helper `cn()` (clsx). Imports com extensão `.js` (NodeNext).
- **Idioma:** copy de UI em **pt-BR**, identificadores em **inglês**.
- **Nunca trabalhar no `main`.**

## Passo a passo

### 1. Baixar e extrair o handoff

```bash
URL="https://api.anthropic.com/v1/design/h/<id>"
curl -sSL -D /tmp/ds_headers.txt "$URL" -o /tmp/ds.tar.gz
# content-type: application/gzip ; content-disposition: filename "<Marca> Design System-handoff.tar.gz"
mkdir -p /tmp/ds && tar -xzf /tmp/ds.tar.gz -C /tmp/ds
find /tmp/ds -maxdepth 3 -type d | sort
```

Estrutura típica:

```
<marca>-design-system/
├── README.md                 ← "CODING AGENTS: READ THIS FIRST"
├── chats/chatN.md            ← transcripts (LEIA — a intenção final mora aqui)
└── project/
    ├── README.md             ← brand context, visual foundations, voz/conteúdo
    ├── SKILL.md              ← hard nos, voice cheat-sheet
    ├── colors_and_type.css   ← TODOS os tokens (fonte da verdade)
    ├── fonts/                ← .ttf self-hosted (copiar)
    ├── assets/{logos,brand}/ ← PNGs do logo + X mark (copiar)
    ├── preview/*.html        ← anatomia dos primitivos (buttons, inputs, cards, badges, type, spacing…)
    └── ui_kits/<app>/        ← README + *.jsx com blocos e telas do app
```

### 2. Ler na ordem certa

`README.md` → `chats/*.md` → `project/README.md` → `project/SKILL.md` → `project/colors_and_type.css` → `project/ui_kits/<app>/{README.md, *Components*.jsx}` → `project/preview/*.html`.

> **Não** renderize no browser nem tire screenshots — leia o HTML/CSS direto; tudo (dimensões, cores, regras) está na fonte.

### 3. Identidade e pré-requisitos do repo

- Slug do escopo npm `@<slug>` — leia do bloco YAML do `AGENTS.md` (`project_name`) ou pergunte.
- Monorepo JS: confirme `package.json` raiz (`type: module`, `workspaces: ["packages/*"]`) + `pnpm-workspace.yaml` (`packages/*`). Se não existir, crie.
- Toolchain: pnpm (preferido). `.nvmrc`/engines Node ≥ 22.
- **Branch:** `git switch -c feat/design-system/<slug>-ui-kit` (carrega mudanças não-commitadas). Nunca o `main`.

### 4. `packages/design-tokens`

- Copie `project/fonts/*.ttf` → `packages/design-tokens/fonts/`.
- `src/css/tokens.css`: **espelho exato** de `colors_and_type.css`. O `@import` do Google Fonts (fallback de pesos) **deve ser a primeira regra do arquivo** (spec CSS). `@font-face` self-hosted apontando `../../fonts/...`. Bloco `:root` com **todas** as variáveis (brand core, neutros, semânticas, surface/fg, type, spacing 4-pt `--s-*`, raios `--r-*`, sombras `--shadow-*`, motion).
- `src/tokens/*.ts`: objetos tipados (`brand`, `neutral`, `semantic`, `spacing`, `radius`, `shadow`, `motion`, `typography`) + `src/index.ts`.
- `package.json`: `exports` = `{ ".": dist, "./css": "./src/css/tokens.css", "./fonts/*": "./fonts/*" }`, `sideEffects: ["*.css"]`, `build: tsc -p tsconfig.build.json`.

### 5. `packages/icons`

- `assets/`: copie os PNGs do logo e do mark (`<mark>-{orange,black,white}.png`, logos color/black/white) de `project/assets/logos|brand`.
- `src/Icon.tsx`: wrapper sobre **lucide-react**. `IconSize = 16 | 20 | 24 | 32 | 40 | 48` (escala 4-pt, **só esses**). `strokeWidth` default 1.75. `aria-hidden` automático quando sem `aria-label`. **Nunca importar lucide-react direto num app** — só aqui.
- `src/<Brand>Mark.tsx`: usa o **PNG real** do X/mark (variants orange/black/white via `new URL('../assets/...', import.meta.url)`). **Proibido desenhar SVG próprio do mark.**
- `package.json`: dep `lucide-react`, `exports` dist, `build: tsc`.
- **Verifique que os nomes Lucide usados existem** antes de usar (resolva `lucide-react` do pnpm store e cheque os exports).

### 6. `packages/ui-components`

- **Infra:** `lib/cn.ts` (wrap de clsx); `test/setup.ts` (jest-dom + toHaveNoViolations + cleanup) e `test/axe.ts` (`runA11y` helper); `global.d.ts` (declara `*.module.css`).
- **`components/` (primitivos)** — a partir de `preview/*.html`: `Button` (variantes do `buttons.html`), `Input`, `Badge`, `Card`, `Eyebrow`. Cada um: `Componente/{Componente.tsx, Componente.module.css, Componente.stories.tsx, Componente.test.tsx, index.ts}`. `forwardRef` + `cn()`. CSS Module **tokens-only** (`var(--s-4)`, nunca `16px`; `var(--brand)`, nunca o hex). Press mecânico `scale(0.96)`; focus ring brand 2px + offset 2px **nunca removido**.
- **`blocks/` (do ui_kit)** — um componente por bloco do `*Components*.jsx` (header, balance card, rows de extrato/veículo, stat card, grids de atalho, nav inferior, banners…). Story `Blocos/...`, teste + `runA11y` cobrindo variantes visualmente significativas.
- **`patterns/` (só Storybook)** — as telas do ui_kit como **composições** (categoria `Padrões`), incluindo um `PhoneFrame` leve e um **fluxo interativo** navegável. **Não exporte** patterns na API pública do pacote.
- `src/index.ts`: exporta primitivos + blocks; re-exporta `Icon`/`<Brand>Mark` de `@<slug>/icons`.
- `.storybook/{main.ts, preview.tsx, manager.ts, storybook.css}`: framework `@storybook/react-vite`; addons `@storybook/addon-a11y` + `@storybook/addon-themes`; `preview.tsx` importa `@<slug>/design-tokens/css`, define `backgrounds`, `a11y` (color-contrast on), `storySort` (**Fundamentos → Componentes → Blocos → Padrões**) e `tags: ['autodocs']` default.
- `fundamentos/*.stories.tsx`: Introdução, Cores, Tipografia, Espaçamento, Raios e Sombras, Motion, Iconografia (consomem os tokens TS/CSS).
- `vite.config.ts`: build `lib` (es) + `test` (vitest jsdom, `setupFiles`, `css:true`, coverage `include: ['src/components/**','src/blocks/**','src/lib/**']`, thresholds linha 80 / branch 75 / funcs 80).

### 7. Instalar Storybook + deps

Se o `package.json` do `ui-components` já declara as devDependencies, basta `pnpm install`. Caso contrário:

```bash
pnpm --filter @<slug>/ui-components add -D \
  storybook @storybook/react-vite @storybook/addon-a11y @storybook/addon-themes \
  vite @vitejs/plugin-react vitest @vitest/coverage-v8 jsdom \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  jest-axe typescript
```

### 8. `docs/product/design-system/`

Quatro arquivos com **cabeçalho versionado** (Versão SemVer / Data / Status / Histórico de Versões — ver `.forge/rules/conventions/document-versioning.md`):

- **`tokens.md`** — espelho legível de `tokens.css` (brand, neutros, semânticas, surface/fg, tipografia, spacing 4-pt, raios, sombras, motion). "O pacote vence em caso de divergência."
- **`design-system.md`** (mestre) — princípios; voz/marca derivadas do handoff; 3 camadas; fundamentos visuais; regras absolutas; **stack (CSS Modules + tokens; deixar explícito que NÃO usa Tailwind/Radix)**; modo dark **descrito com honestidade** (se o `tokens.css` não tem camada dark, dizer isso); instalação; template de componente; comandos Storybook; checklist de PR; anti-patterns.
- **`components.md`** — catálogo: primitivos + blocos + padrões, com props/variantes/status e referência da story.
- **`accessibility.md`** — WCAG AA (AAA em fluxos financeiros); foco brand; tooling `jest-axe`/`runA11y` + `@storybook/addon-a11y`; checklists por tipo; padrões de leitor de tela do kit; **caveat de contraste** (brand color vs branco costuma ficar ~3.3:1 — limite para texto normal).

### 9. Buildar deps e verificar (tudo verde)

```bash
# dist de tokens+icons é necessário para resolver os workspaces nos testes/storybook
pnpm --filter @<slug>/design-tokens --filter @<slug>/icons run build
pnpm --filter @<slug>/ui-components run typecheck
pnpm --filter @<slug>/ui-components run lint
pnpm --filter @<slug>/ui-components run test:ci        # coverage gates
pnpm --filter @<slug>/ui-components run storybook:build # confirma que o kit renderiza
```

### 10. CHANGELOG e relatório

Atualize `CHANGELOG.md` (`Adicionado`). Reporte no chat: pacotes criados, nº de primitivos/blocos/telas, coverage, status do storybook build e o branch. **Deixe commit/push/PR para o usuário**, salvo pedido explícito.

## Armadilhas aprendidas (não repetir)

- **`@import` do Google Fonts tem que ser a 1ª regra** do `tokens.css` — senão o CSS é inválido.
- **Buildar `design-tokens` e `icons` ANTES** de rodar `vitest`/storybook do `ui-components` — os testes importam `@<slug>/icons` que resolve para `dist/`; sem `dist` o Vite falha em `Failed to resolve import`.
- **`exactOptionalPropertyTypes: true`** (comum nesses repos): (a) não passe `prop={undefined}` em `args` de story — use `render`; (b) `IconSize` é restrito — nada de 14/18/22, use 16/20/24; (c) `className` vindo de CSS Module é `string | undefined` — ao passar para uma prop `className?: string` tipada (ex.: no `<Mark>`), envolva em `cn(styles['x'])`.
- **jsdom não avalia contraste** → `jest-axe` reporta `color-contrast` como *incomplete* (não falha). Contraste real só no `addon-a11y`/browser. Documente o caveat.
- **Brand color vs branco** ≈ 3.3:1 — ok para texto grande/UI, limite para texto normal: reserve a CTAs curtos e ícones-ação; registre a decisão no `accessibility.md`.
- **Sempre via `@<slug>/icons`** — nunca `import 'lucide-react'` num app/bloco.
- **Mark sempre via PNG real** — nunca desenhar SVG próprio do X.
- **Brownfield:** se algo já existe e bate com o handoff, **não recrie** — só complete o que falta (ex.: tokens já prontos → adicione apenas blocos/telas/docs).
- **Stories** sempre com `tags: ['autodocs']`; copy pt-BR, identifiers em inglês.

## Proibições

- Trabalhar no `main`.
- Tailwind / Radix / CSS-in-JS (a stack é CSS Modules + tokens).
- Hardcode de cor/spacing em `.module.css` (sempre `var(--…)`).
- Hardcodar uma marca específica na skill — derive tudo do handoff.
- Criar arquivos de resumo (`*-summary.md`, `*-report.md`, …).
- Co-author de IA em commits.
- Commit/push/PR sem pedido explícito do usuário.
