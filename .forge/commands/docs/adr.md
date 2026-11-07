---
description: Cria um ADR (formato MADR) no baseline — .forge/product/current/adr/ — com numeração sequencial e índice atualizado. Sucessor canônico do /forge:new-adr.
argument-hint: "new <título-da-decisão>"
---

# /forge:adr — ADR no baseline

Argumentos: `$ARGUMENTS` (`new <título>`; sem título, pergunte em uma linha).

## Passos

1. **Numeração:** liste `.forge/product/current/adr/[0-9][0-9][0-9][0-9]-*.md` e use o próximo número (começa em `0001`).
2. **Arquivo:** crie `NNNN-<titulo-kebab>.md` a partir do template `.forge/templates/product/adr.md`, preenchendo título/data/status `proposed` e o change de origem quando houver change ativo relacionado.
3. **Conteúdo:** preencha Contexto/Drivers/Opções/Decisão/Consequências com o usuário — uma pergunta por vez quando faltar informação; nunca invente a decisão.
4. **Índice:** crie/atualize `.forge/product/current/adr/README.md` (tabela Nº/Título/Status/Data).
5. **Publicação:** lembre que o ADR aparece em `docs/product/adr/` no próximo `/forge:publish-docs`.

## Conflito no índice (README/index)

O índice de ADRs (`.forge/product/current/adr/README.md`) é **append-only por natureza** —
cada branch só adiciona linhas novas. Em conflito de merge nesse arquivo:

1. **Nunca `git checkout --ours`/`--theirs` cego.** Isso descarta ADRs de um dos lados
   silenciosamente.
2. A resolução correta é **união das entradas**: mantenha as linhas de ambos os lados da tabela.
3. **Reordene por número** após unir (a ordem cronológica de merge não é a ordem numérica).
4. **Re-valide a numeração sequencial** — se dois branches criaram `0007-*` de forma independente,
   renumere o mais recente (por data de commit) para o próximo número livre e ajuste o nome do
   arquivo + referências (Links) que apontem para ele.

## Regras

- ADRs do baseline nunca são editados para mudar decisão — supersede com um novo ADR (status `superseded by NNNN` no antigo).
- Decisão nascida dentro de um change: referencie o `change-id` na seção Links.
