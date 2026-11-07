---
name: readme-generator
description: Deriva entradas de CHANGELOG.md (Keep a Changelog, pt-BR) a partir de Conventional Commits, em modo explícito ou derivado, e valida o resultado com os gates released/preserve/lint. Use quando o `/forge:update-changelog` precisar de uma skill resolvida, ou quando o post-merge delegar a geração do rascunho de changelog.
---

# Readme Generator — motor de CHANGELOG (escopo desta versão)

Fora de escopo nesta versão: geração ou comparação de README.md, e comparação entre branches irmãs (develop/master/main) para recuperar conteúdo perdido. Essas capacidades existem na prova de conceito original (Payments) mas NÃO foram portadas para este template — só a parte de CHANGELOG. Se precisar de README, use outra ferramenta ou escreva à mão; esta skill não tenta.

## O que esta skill faz

Um motor único (`scripts/changelog-engine.mjs`) que escreve entradas em `CHANGELOG.md`, seção `## [Unreleased]`, formato Keep a Changelog, em português. É o mesmo motor usado por dois consumidores: o comando `/forge:update-changelog` (modos explícito e derivado, com gates) e o hook `post-merge` (modo `--merge-range`, sem gates — o hook é informacional).

### Modos do motor

- `--type <t> --description <d>` — explícito: grava uma entrada literal na seção mapeada de `<t>`. Cria `CHANGELOG.md` se não existir, com o cabeçalho padrão Keep a Changelog.
- `--subject "<msg>"` — derivado de um único subject de Conventional Commits (ex.: squash de PR).
- `--path <componente> [--base <ref>]` — derivado: varre os commits do componente que a branch atual trouxe desde a base (`merge-base` com `--base`, ou, entre `origin/develop`, `develop`, `origin/main`, `main`, `origin/master` e `master`, com a de merge-base mais próximo de `HEAD`) e deriva uma ou mais entradas. Sai com `rc=2` se o componente não existir, se a raiz não for um repositório git ou se nenhuma base resolver — nunca "nada a registrar" por vacuidade.
- `--merge-range <A..B>` — derivado do merge (usado só pelo hook `post-merge`); NUNCA cria `CHANGELOG.md` ausente — é no-op silencioso nesse caso, e também quando `HEAD` não é merge.

Em todos os modos, o motor deduplica por seção e texto contra o bloco `[Unreleased]`: nos modos do comando, uma entrada já presente na mesma seção (com ou sem o sufixo `(<hash>)` do hook) não é gravada de novo; no `--merge-range`, a chave por commit continua sendo o hash, e o commit só é pulado quando a mesma seção já tem a entrada sem hash gravada pelo comando com o mesmo texto. O texto das entradas é tratado como dado (sem interpretação de `$&`, `$'` etc.), e um CHANGELOG em CRLF é regravado em CRLF. O `CHANGELOG.md` precisa resolver para dentro de `--root`: symlink pendente ou que aponte para fora é recusado (rc 1), porque o hook grava texto vindo de commits de terceiros.

Mapeamento tipo → seção (alinhado a `rules/conventions/conventional-commits.md`): `feat` → Adicionado; `fix`/`perf` → Corrigido. Demais tipos (`refactor`, `revert`, `chore`, `docs`, `style`, `test`, `build`, `ci`) não geram entrada.

Em qualquer modo, se `release-please-config.json` existir no diretório relevante (componente ou raiz), o motor recusa editar o `CHANGELOG.md` — a entrada de release, nesse caso, vem do título do PR, não deste motor.

### Gates (`scripts/gates/`)

Chamados só pelo comando `/forge:update-changelog`, nunca pelo hook (que é informacional e não bloqueia merge):

- `released.mjs <antigo> <novo>` — cada seção `## [X.Y.Z]` do arquivo anterior tem que sair byte a byte idêntica no novo (terminadores de linha normalizados). Uma versão já publicada não pode ser alterada, removida ou duplicada.
- `preserve.mjs <antigo> <novo>` — nenhum item de lista do arquivo anterior pode desaparecer no novo sem substituto, dentro do mesmo par versão/seção.
- `lint.mjs <novo> [--since <antigo>]` — travessão, quebra de linha dentro de parágrafo, acentuação ausente (`nao` em vez de `não`), placeholder e link quebrado; com `--since`, só nas entradas novas (o histórico publicado, que `released` proíbe corrigir, não trava o comando).

Os três gates reprovam com `rc=2` quando o arquivo anterior não existe: para um CHANGELOG criado agora, o chamador passa um arquivo anterior vazio. Um gate nunca aprova por não ter tido o que comparar.

## Resolução

Resolvida por `bash .forge/scripts/resolve-skill.sh readme-generator <arquivo...>` — ordem: `FORGE_SKILL_DIR_README_GENERATOR` → `.forge/skills/readme-generator/` do projeto → skill de usuário do adapter ativo. O override, quando definido, é a única fonte consultada: override inválido é erro, não queda silenciosa para a cópia do projeto. O hook `post-merge` NUNCA usa esse resolvedor — ele resolve só dentro de `.forge/skills/readme-generator/` do próprio projeto (ou do tronco, via `resolve_delegated`), igual a qualquer outro alvo delegado do harness.

## references/

Vazio nesta versão — nenhuma referência específica de consumidor (a referência Payments, com README e comparação de branches irmãs, está fora de escopo nesta versão, como descrito acima).
