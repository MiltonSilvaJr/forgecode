// Autoteste das regras forge-quality/*. Adaptado de
// soumatheusgomes/vibe-coding-toolkit (templates/eslint/verify.mjs), commit em uso:
// main @ 2026-09-04. Única mudança de conteúdo: os rótulos de suíte usados só como texto
// (RuleTester.run("quality/...", ...)) viraram "forge-quality/..." para casar com o namespace
// que este harness registra em ../eslint.config.mjs — a lógica de teste, os
// `code`/`filename`/`options`/`errors` de cada caso, é a mesma do upstream.
//
// MIT License
//
// Copyright (c) 2026 Matheus Gomes
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Usa apenas o RuleTester do próprio ESLint -- nenhum framework de teste, nenhuma dependência
// além do ESLint (já presente em qualquer projeto Node/TS que rode lint). RuleTester.run()
// lança na primeira falha, então saída não-zero é o próprio sinal de falha; não há assertion
// library para configurar. As fontes de teste são JavaScript puro com nomes de arquivo
// .ts/.tsx de propósito: as regras só olham para o filename e para sintaxe que o espree já
// entende, então a checagem não precisa de parser TypeScript.
//
// Uso, de qualquer diretório (o alvo default é resolvido relativo a ESTE arquivo, não ao cwd
// de quem chama — desvio deliberado do upstream, que assume cwd == raiz do projeto):
//   node .forge/capabilities/backend-node-postgres/assets/eslint-rules/verify.mjs
// Passe um caminho para checar uma cópia que vive em outro lugar (resolvido relativo ao cwd):
//   node verify.mjs ./index.cjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { RuleTester } from "eslint";

const defaultTarget = fileURLToPath(new URL("./index.cjs", import.meta.url));
const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget;
const plugin = (await import(pathToFileURL(target).href)).default;

const ruleTester = new RuleTester();
// Unique identifiers per line: repeating one declaration would collide
// with itself and fail as a parse error before any rule ever runs.
const lines = (count) =>
  Array.from({ length: count }, (_, i) => `const value${i} = ${i};`).join("\n") +
  "\n";

ruleTester.run("forge-quality/max-lines", plugin.rules["max-lines"], {
  valid: [
    {
      name: "a file under the budget",
      code: lines(3),
      filename: "src/service.ts",
      options: [{ max: 10 }],
    },
    {
      name: "test files are exempt by default",
      code: lines(20),
      filename: "src/service.test.ts",
      options: [{ max: 10 }],
    },
    {
      name: "files inside a test directory are exempt by default",
      code: lines(20),
      filename: "src/__tests__/helpers.ts",
      options: [{ max: 10 }],
    },
    {
      name: "declaration files are never checked",
      code: lines(20),
      filename: "src/types.d.ts",
      options: [{ max: 10 }],
    },
    {
      name: "barrel files are never checked",
      code: lines(20),
      filename: "src/index.ts",
      options: [{ max: 10 }],
    },
    {
      name: "generated output is never checked",
      code: lines(20),
      filename: "src/generated/client.ts",
      options: [{ max: 10 }],
    },
    {
      name: "a baseline entry silences a known offender",
      code: lines(20),
      filename: "src/legacy.ts",
      options: [{ max: 10, ignore: ["src/legacy.ts"] }],
    },
  ],
  invalid: [
    {
      name: "a file over the budget",
      code: lines(20),
      filename: "src/service.ts",
      options: [{ max: 10 }],
      errors: [{ messageId: "tooLong" }],
    },
    {
      name: "includeTests brings test files back under the budget",
      code: lines(20),
      filename: "src/service.test.ts",
      options: [{ max: 10, includeTests: true }],
      errors: [{ messageId: "tooLong" }],
    },
  ],
});

console.log("forge-quality/max-lines: ok");

ruleTester.run("forge-quality/no-direct-console", plugin.rules["no-direct-console"], {
  valid: [
    {
      name: "a logging helper is fine",
      code: "logger.info('hello');",
      filename: "src/service.ts",
    },
    {
      name: "test files may log freely",
      code: "console.log('hello');",
      filename: "src/service.test.ts",
    },
    {
      name: "an allowed method is not reported",
      code: "console.error('boom');",
      filename: "src/service.ts",
      options: [{ allow: ["error"] }],
    },
    {
      name: "a method that is not a console method is not reported",
      code: "console.render('x');",
      filename: "src/service.ts",
    },
    {
      name: "an identifier that merely ends in console is not the console",
      code: "fakeconsole.log('x');",
      filename: "src/service.ts",
    },
  ],
  invalid: [
    {
      name: "a direct console call in production code",
      code: "console.log('hello');",
      filename: "src/service.ts",
      errors: [
        {
          messageId: "banned",
          data: { method: "log", logger: "the project logging helper" },
        },
      ],
    },
    {
      name: "the logger option names the replacement in the message",
      code: "console.warn('hello');",
      filename: "src/service.ts",
      options: [{ logger: "logger.warn()" }],
      errors: [{ messageId: "banned", data: { method: "warn", logger: "logger.warn()" } }],
    },
  ],
});

console.log("forge-quality/no-direct-console: ok");

const dataAccess = {
  modules: ["@/db", "@/db/index"],
  layers: ["/src/app/", "/src/components/"],
  extensions: [".tsx"],
};

ruleTester.run(
  "forge-quality/no-direct-data-access",
  plugin.rules["no-direct-data-access"],
  {
    valid: [
      {
        name: "a guarded layer importing something other than the client",
        code: "import { userColumns } from '@/db';",
        filename: "/repo/src/app/page.ts",
        options: [dataAccess],
      },
      {
        name: "a layer that is not guarded may import the client",
        code: "import { db } from '@/db';",
        filename: "/repo/src/server/user-repository.ts",
        options: [dataAccess],
      },
      {
        name: "a module that is not the data module",
        code: "import { db } from './local-cache';",
        filename: "/repo/src/app/page.ts",
        options: [dataAccess],
      },
      {
        name: "test files are exempt",
        code: "import { db } from '@/db';",
        filename: "/repo/src/app/page.test.ts",
        options: [dataAccess],
      },
      {
        name: "a side-effect import pulls no binding",
        code: "import '@/db';",
        filename: "/repo/src/app/page.ts",
        options: [dataAccess],
      },
      {
        name: "a custom binding list does not match the default name",
        code: "import { db } from '@/db';",
        filename: "/repo/src/app/page.ts",
        options: [{ ...dataAccess, bindings: ["prisma"] }],
      },
    ],
    invalid: [
      {
        name: "a guarded layer importing the client by name",
        code: "import { db } from '@/db';",
        filename: "/repo/src/app/page.ts",
        options: [dataAccess],
        errors: [{ messageId: "forbidden", data: { module: "@/db" } }],
      },
      {
        name: "the extensions list guards a file outside the layer paths",
        code: "import { db } from '@/db';",
        filename: "/repo/src/widgets/table.tsx",
        options: [dataAccess],
        errors: [{ messageId: "forbidden", data: { module: "@/db" } }],
      },
      {
        name: "a default import always counts as pulling the client",
        code: "import anything from '@/db';",
        filename: "/repo/src/app/page.ts",
        options: [dataAccess],
        errors: [{ messageId: "forbidden", data: { module: "@/db" } }],
      },
      {
        name: "a namespace import always counts as pulling the client",
        code: "import * as everything from '@/db';",
        filename: "/repo/src/app/page.ts",
        options: [dataAccess],
        errors: [{ messageId: "forbidden", data: { module: "@/db" } }],
      },
      {
        name: "a renamed import is matched on the imported name, not the local one",
        code: "import { db as database } from '@/db';",
        filename: "/repo/src/app/page.ts",
        options: [dataAccess],
        errors: [{ messageId: "forbidden", data: { module: "@/db" } }],
      },
      {
        name: "a custom binding list matches its own name",
        code: "import { prisma } from '@/db';",
        filename: "/repo/src/app/page.ts",
        options: [{ ...dataAccess, bindings: ["prisma"] }],
        errors: [{ messageId: "forbidden", data: { module: "@/db" } }],
      },
    ],
  }
);

console.log("forge-quality/no-direct-data-access: ok");
