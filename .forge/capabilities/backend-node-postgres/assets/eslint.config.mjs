// Baseline de qualidade Node/TypeScript. Materializado como `eslint.config.mjs` na raiz por
// `bash .forge/scripts/node-baseline.sh --apply`. Editar aqui é legítimo: o script nunca
// sobrescreve um arquivo existente sem --force, e o `--check` cobra apenas os itens abaixo.
//
// As três regras `forge-quality/*` são cópia própria do harness, vendorizada de
// soumatheusgomes/vibe-coding-toolkit (MIT) — ver
// .forge/capabilities/backend-node-postgres/assets/eslint-rules/. Elas pegam o que grep não
// pega: alias de import (`db as database`), import default vs namespace, e tamanho de arquivo
// medido por linha real de código-fonte (não comentário/config/barrel/teste).
//
// Pré-requisito deste arquivo, não deste baseline: se o projeto tem .ts/.tsx, ele precisa de um
// parser TypeScript já configurado (typescript-eslint ou @typescript-eslint/parser) para esses
// globs. As regras forge-quality/* não usam informação de tipo, mas dependem de o arquivo já
// ter sido parseado — sem isso, o espree padrão nem chega a entregar a árvore para a regra.
// Mesma relação que o dotnet SDK tem com o baseline .NET: pré-condição do projeto, não algo que
// este arquivo materializa por você.
import forgeQuality from "./.forge/capabilities/backend-node-postgres/assets/eslint-rules/index.cjs";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      ".next/**",
      "coverage/**",
      "**/*.tsbuildinfo",
    ],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    plugins: { "forge-quality": forgeQuality },
    rules: {
      // Import default ou namespace de um módulo de log/console conta como alcançar o objeto
      // global; import nomeado casa pelo nome importado — "console" aqui é sempre o global, não
      // um identificador qualquer terminado nesse nome.
      "forge-quality/no-direct-console": "warn",

      // Decisão do harness que NÃO é herdada do material de origem (ledger LDG-0061/LDG-0130):
      // max-lines NUNCA é "error" aqui. Ela conflita com
      // .forge/rules/conventions/code-style.md (tamanho de arquivo é smell, não portão) e o
      // próprio material de origem documenta o efeito de fatiamento cosmético perto do limite
      // sem resolvê-lo no desenho do gate — um arquivo com 399 de 400 linhas, e a extração
      // feita para resolver o aviso empurra o arquivo de destino para além do próprio teto.
      // `bash .forge/scripts/node-baseline.sh --check` REPROVA se esta linha virar "error".
      "forge-quality/max-lines": ["warn", { max: 350 }],

      // Precisa de `modules`/`layers` do PRÓPRIO projeto — este harness não adivinha alias de
      // import nem estrutura de pasta, e um palpite errado ficaria mudo para sempre (pior que
      // não ter a regra: dá falsa sensação de cobertura). Desligada por padrão; ligue
      // preenchendo o objeto abaixo (o schema exige `modules` e `layers` com pelo menos um item
      // cada) e mude a severidade. Exemplo, para um projeto com alias `@/db` e camada de
      // apresentação em src/app e src/components:
      //
      //   "forge-quality/no-direct-data-access": ["error", {
      //     modules: ["@/db", "@/db/index"],
      //     bindings: ["db"],
      //     layers: ["/src/app/", "/src/components/"],
      //     extensions: [".tsx"],
      //   }],
      "forge-quality/no-direct-data-access": "off",
    },
  },
  {
    // O adaptador de log em si, e qualquer arquivo que precise logar antes do resto da infra
    // estar disponível. Este bloco tem de vir DEPOIS do bloco que liga a regra: em flat config,
    // para um arquivo casado pelos dois, o bloco posterior vale por último — um "off" colocado
    // antes seria silenciosamente sobrescrito pelo "warn"/"error" que vem depois. Ajuste o glob
    // para o caminho real do seu adaptador de log.
    files: ["**/logger.{ts,js}", "**/log-adapter.{ts,js}"],
    plugins: { "forge-quality": forgeQuality },
    rules: {
      "forge-quality/no-direct-console": "off",
    },
  },
  {
    // Mesmo orçamento de tamanho para teste, em "warn" — includeTests é opt-in na regra porque
    // arquivo de teste fica fora do escopo padrão da regra (config/spec/barrel também ficam).
    files: [
      "**/*.test.{ts,tsx,js,jsx}",
      "**/{__tests__,__mocks__,fixtures,mocks}/**/*.{ts,tsx,js,jsx}",
    ],
    plugins: { "forge-quality": forgeQuality },
    rules: {
      "forge-quality/max-lines": ["warn", { max: 350, includeTests: true }],
    },
  },
];
