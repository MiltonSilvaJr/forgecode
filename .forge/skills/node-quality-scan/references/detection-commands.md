# Comandos de detecção

O `scripts/scan.sh` roda tudo isto de uma vez e formata a saída. Esta página existe para auditar o que ele faz e para uso pontual quando você quer uma regra só.

Dois motores, o mesmo padrão: `rg` quando está instalado, `grep -arnE` quando não. Nenhum padrão usa `\b`, porque o `grep` BSD do macOS não o reconhece e o scanner passaria a achar menos na máquina de quem revisa — falso verde silencioso. `[[:space:]]` e `([^A-Za-z0-9_]|$)` fazem o mesmo trabalho nos dois.

```bash
# catch vazio
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' 'catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}'

# .then() sem .catch() correspondente (heurística por linha — ver limite abaixo)
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' '[.]then\(' | grep -v '[.]catch\('

# chamada síncrona de fs bloqueando o event loop
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' '(readFileSync|writeFileSync|existsSync|readdirSync|mkdirSync|statSync|unlinkSync|appendFileSync|copyFileSync|renameSync)\('

# template literal interpolado em query (heurística de uma linha só)
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' '[.](query|execute)\([[:space:]]*`[^`]*\$\{[^`]*`'

# Pool/Client de pg instanciado fora do bootstrap
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' 'new[[:space:]]+(Pool|Client)[[:space:]]*\('

# process.env fora de config/env.*
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' 'process[.]env[.][A-Za-z_][A-Za-z0-9_]*' | grep -vE '/(config|env)\.[jt]sx?:'

# relógio local no domínio
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' 'new[[:space:]]+Date\([[:space:]]*\)'

# any explícito
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' '(:[[:space:]]*any([^A-Za-z0-9_]|$)|([[:space:]]|^)as[[:space:]]+any([^A-Za-z0-9_]|$))'

# nomes que não nomeiam
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' '(class|interface|type)[[:space:]]+[A-Za-z0-9_]*(Manager|Helper|Utils|Utility)([^A-Za-z0-9_]|$)'

# let mutável exportado do módulo
rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}' '^export[[:space:]]+let[[:space:]]+'
```

Equivalente sem `rg`: troque `rg -n --glob '*.{ts,tsx,js,jsx,mjs,cjs}'` por `grep -arnE --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs'` e acrescente o diretório alvo no fim.

## Limites destes comandos

São regex sobre texto, não análise sintática (ao contrário das regras `forge-quality/*`, que são AST de verdade via ESLint). Eles não sabem o que é comentário, o que é string literal e o que atravessa mais de uma linha:

- `floating-promise` só vê `.then(` e `.catch(` na mesma linha física. Uma cadeia formatada com `.catch()` na linha seguinte (estilo comum de Prettier) escapa — falso negativo, não falso positivo.
- `sql-interpolation` só vê template literal que abre e fecha na mesma linha. Uma query montada com concatenação de string, ou um template literal multilinha, escapa pelo mesmo motivo.
- `// new Pool()` dentro de um comentário aparece como achado — o mesmo vale para qualquer padrão comentado.

É o preço de ser barato e portátil; a triagem é de quem lê. Quando a precisão importar mais que o custo, a ferramenta certa é uma regra ESLint de verdade operando sobre a árvore sintática — que é exatamente o que `forge-quality/no-direct-console` e `forge-quality/no-direct-data-access` já fazem para os dois casos onde valeu a pena escrever a regra em AST.
