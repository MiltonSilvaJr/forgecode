# Design System <project_display>

## Princípio

O design system **<project_display>** é materializado em um pacote único, **`@<project_name>/design-system`** (React + TypeScript + Vite + **Storybook**), que consome os **tokens** e **assets** canônicos versionados em `docs/product/design-system/`:

| Camada | Onde | O que é |
|---|---|---|
| Tokens canônicos | `docs/product/design-system/tokens/` | `colors-and-type.css` (fonte canônica, CSS vars + `@font-face` Inter) + `tokens.json` (export machine-readable: cores, tipografia, spacing, radii, shadows, motion). |
| Assets de marca | `docs/product/design-system/assets/` | `logos/` (marca + sub-marcas), `favicon/`, `ilustrations/`, manual de identidade. |
| Pacote de UI | `packages/design-system/` (`@<project_name>/design-system`) | `tokens.css`/`tokens.ts`/`fonts.css` (Inter) + componentes React (`Button`, `Input`, `Card`, `Badge`, …) + Storybook (documentação viva). |

A fonte da verdade visual é `docs/product/design-system/` (e o Manual de Identidade Visual em `assets/`). Qualquer mudança de token reflete primeiro ali.

## White-label parametrizável (RF-14 / DEC-037 / ADR-0011)

A plataforma é **white-label parametrizável**: **cor primária e logo são tematizáveis por tenant**, com o **tema default = marca <project_display>**. Consequências não-negociáveis:

- **Nenhum componente pode depender de um valor de cor de marca específico.** Use sempre o token (`var(--color-primary-500)`, `var(--bg-brand)`); o valor real varia por tenant.
- **Contrast gate WCAG 2.1 AA obrigatório** (NFR-Usab.08): para qualquer cor primária de tenant, contraste ≥ 4.5:1 (texto normal) e ≥ 3:1 (texto grande/ícones/foco); seleção automática de cor on-brand ou bloqueio. Tema default sempre conforme.
- **Logo é configurável por tenant** (componente de logo, ex.: `BrandLogo`), default <project_display>. Nunca hardcodar o logo de um tenant em componente.
- `theme:write`: P-03 (Admin <project_display>) sempre; P-01 (RH cliente) condicional ao plano (DEC-040).

## Regras absolutas

1. **Cor primária é um token parametrizável** — default `#0051E6` (`--color-primary-500` / `--bg-brand`). **Nunca** hardcodar valor de cor de marca em CSS/TS; usar o token. PR que hardcoda cor de marca literal é bloqueado.
2. **Tokens, sempre.** Em CSS Module: `var(--space-4)`, jamais `16px` literal. Em TS: `import { color, spacing } from '@<project_name>/design-system'`. Hardcode de cor/espaço/tipografia fora dos tokens é bloqueado.
3. **Grid base-4.** Todo spacing em múltiplos de 4 — só via tokens `--space-1`…`--space-24`.
4. **Tipografia: Inter 18pt** (família única; pesos Thin 100 → Black 900). Escala modular 1.25 (`--font-size-xs`…`--font-size-5xl`). Numbers com `font-variant-numeric: tabular-nums` em qualquer surface financeira (não negociável).
5. **Raio via token.** `--radius-md` 8px (botões/cards/inputs), `--radius-lg` 12px (cards maiores), `--radius-full` (pills/avatars). Sem valores de raio literais.
6. **Motion contido.** Transições 150ms ease; hover escurece um passo (ex.: `primary-500`→`primary-600`); press `transform: scale(0.97)` + escurece a `-700`; disabled 40% opacidade. **Sem bounce/spring.**
7. **Focus visível, sempre.** Ring 3px da cor de marca (`rgba` ~10%), com offset. **Nunca** remover `:focus-visible`.
8. **Superfícies planas e limpas.** Sem gradientes, sem aurora, sem glassmorphism. Sombras suaves (`--shadow-xs`…`--shadow-2xl`), sem sombra colorida.
9. **Logo via componente configurável.** Use o componente de logo do design system (default <project_display>, sobrescrevível por tenant). Proibido embutir SVG/PNG de logo fixo em telas.
10. **Token fantasma é proibido.** Todo `var(--x)` deve referenciar um token **definido** na fonte de tokens. Um `var(--surface-1)` cujo `--surface-1` nunca foi definido "funciona" em light por acaso e vira buraco no dark — é o defeito de despadronização mais caro e mais invisível. Gate determinístico (diferença de conjuntos referenciados − definidos) na skill `frontend-ui-review` (A1); deve virar CI gate.
11. **Sem fallback literal em `var()`.** Referencie o token **nu**: `var(--surface-1)`, nunca `var(--surface-1, #fff)`. O fallback literal ou é morto (token existe) ou mascara um contrato quebrado (token fantasma) — nos dois casos transforma "contrato violado" em "funciona na minha máquina". Que quebre em dev e force a correção na origem (definir o token), não o remendo no ponto de uso.
12. **Controle nativo do browser é domado ou encapsulado.** `<input type="file|color|date|range">`, `<select>` etc. têm chrome próprio (`::file-selector-button`, `::-webkit-color-swatch`, `::-webkit-slider-thumb`) que o CSS comum não alcança — `border:none` no input não toca o pseudo-elemento interno. Todo controle nativo é ponto de fuga do DS até ser explicitamente estilizado nos pseudo-elementos **ou** encapsulado num componente do DS.

## Storybook é a documentação viva

- Toda story nova com `tags: ['autodocs']` para gerar Docs page automaticamente.
- Toda story passa pelo `@storybook/addon-a11y` (axe-core) sem violação `serious`/`critical`.
- `npm run build-storybook` deve passar — gate em CI.
- Stories em pt-BR (copy de UI); identifiers em inglês.

## Testes

| Tipo | Ferramenta | Obrigatório quando |
|---|---|---|
| Unit + behavior | `@testing-library/react` (runner conforme `testing/quality-gates.md`) | Todo componente |
| A11y | `jest-axe` / addon-a11y | Toda variante visualmente significativa (default + erro + disabled) |
| Story smoke + a11y | `@storybook/test-runner` | Em CI, contra `storybook-static` |
| Regressão visual | Playwright snapshots / Chromatic | Componentes do design system |

Coverage de frontend (`features/`): linha 80%, branch 75% (ver `testing/quality-gates.md`).

## Naming

| Artefato | Convenção |
|---|---|
| Pacote npm | `@<project_name>/design-system` |
| Pasta de componente | `PascalCase/` (ex.: `Button/`) |
| Arquivo de componente | `PascalCase.tsx` |
| Estilo | `PascalCase.module.css` |
| Story | `<Componente>.stories.tsx` |
| Teste | `<Componente>.test.tsx` |
| Variante de prop | union literal lowercase (`'primary' \| 'secondary'`) |

## Anti-patterns proibidos

| Anti-pattern | Por quê |
|---|---|
| Hardcodar valor de cor de marca (ex.: `#0051E6`) em CSS/TS | Quebra o white-label; use `var(--color-primary-500)`/`--bg-brand` |
| Depender de um valor de cor de marca específico em componente | A cor varia por tenant — use sempre token |
| Embutir logo fixo em tela | Logo é parametrizável por tenant — use o componente de logo |
| Tokens hardcoded (`16px`, raio/cor literais) em `.module.css` | Use `var(--space-4)`, `var(--radius-md)`, etc. |
| Remover `:focus-visible` | Quebra acessibilidade |
| Aplicar tema sem passar pelo contrast gate WCAG AA | Viola NFR-Usab.08 / ADR-0011 |
| Story sem `tags: ['autodocs']` | Sai da documentação viva |
| Componente sem teste de a11y | Bloqueia merge |
| `// @ts-ignore` em código novo | Investigar o tipo correto |
| Gradiente/aurora/glassmorphism | Fora da linguagem visual <project_display> |
| `var(--x)` referenciando token nunca definido (token fantasma) | "Funciona" em light, buraco no dark — defina o token ou remova a referência |
| `var(--token, #hex)` com fallback literal | Mascara contrato quebrado — referencie o token nu; que quebre em dev |
| Controle nativo (`<input type="file/color/date">`, `<select>`) sem estilizar pseudo-elemento nem encapsular | Chrome do SO vaza do design system |
| Dado cru (GUID/enum) exibido na tela como identificador | Geralmente falta de rótulo humano no backend — resolver na fonte, não com CSS |

## Cross-refs

- [`docs/product/design-system/README.md`](../../../docs/product/design-system/README.md) — fundamentos visuais e estrutura
- [`docs/product/design-system/tokens/`](../../../docs/product/design-system/tokens/) — tokens canônicos (`colors-and-type.css`, `tokens.json`)
- [`packages/design-system/README.md`](../../../packages/design-system/README.md) — pacote `@<project_name>/design-system`
- [`docs/product/uxd/README.md`](../../../docs/product/uxd/README.md) — UXD (binding ao design system)
- ADR-0011 (contrast gate da tematização), RF-14 / DEC-037 (white-label parametrizável), NFR-Usab.08
- [`.forge/rules/conventions/naming.md`](../conventions/naming.md), [`.forge/rules/conventions/language-policy.md`](../conventions/language-policy.md), [`.forge/rules/testing/quality-gates.md`](../testing/quality-gates.md), [`.forge/rules/testing/tdd.md`](../testing/tdd.md)
- Skill `frontend-ui-review` — auditoria de despadronização (token fantasma, cor hardcoded, controle nativo, dark mode) com gates determinísticos; é o lado de review destas convenções (regras 10-12)
