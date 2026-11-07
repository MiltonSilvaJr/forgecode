# Rascunho de notas de release: ForgeCode v0.1.0 (NÃO PUBLICAR)

Fluxo lido: `CHANGELOG.md` (já tem entrada `v0.1.0 — 2026-11-06`), `script/release.ts`,
`.github/release/plan-release.sh`. O repositório não usa Changesets.

## Versão sugerida

`v0.1.0`. Justificativa: linha própria do fork (SemVer 0.x, API ainda instável), preview
`0.1.0-<canal>.<n>`. Conflito de linha: a última tag é `v2.2.5` (upstream). `release.ts` aceita
base `v0.*` e cai para `v2.*`; sem tag `v0.*` a base ainda será `v2.2.5`, então confirme a
saída de `plan-release.sh` em dry-run antes de qualquer tag.

## Conteúdo

- Rebrand: binário, config (`forgecode.json`), diretórios, DB, serviço, appId desktop, instalador.
- Compatibilidade: `opencode.json`, `.opencode/` e `OPENCODE_*` continuam lidos; nativos vencem.
- Correção: mapeamento do host legado `console.opencode.ai` preservado.
- Update automático padrão passa a `disable`.

## Pré-condições antes de publicar

1. Decidir R2: dados do usuário (`~/.local/share/opencode`) não migram; histórico some ao trocar de binário.
2. Decidir R3: rebaixamento 2.2.5 -> 0.1.0 e coexistência de tags `v0.*`/`v2.*`.
3. Decidir R4: `install`, `lib.sh`, `publish-cli.sh`, `publish-desktop.sh`, `publish-aur.sh` e winget apontam para `opencode.ai`/`update.opencode.ai`. Sem infra própria de distribuição, a release não é executável sem tocar o upstream.
4. Decidir R5: README diz "interno" e "não publicado", mas `origin` é público.
5. Decidir R6: ID ACP, appId e esquema de URL.
6. Nome npm: pacotes seguem `@opencode/*`; publicar sob esse escopo colide com o upstream. Não publicar em npm sem escopo próprio.
7. Homebrew/winget/AUR/Nix: fórmulas e manifests existentes são do upstream; ForgeCode precisaria de tap e identificador próprios (`render-winget.sh` usa `ai.forgecode.desktop`).
8. Rodar `bun run check` (o hook `.husky/pre-push` roda) e a suíte dos pacotes sem as falhas pré-existentes listadas no inventário.

## Riscos de publicar

- Instalador e atualizador buscam artefatos do upstream: usuário poderia receber binário OpenCode.
- Perda aparente de sessões/credenciais por diretório novo.
- Atualização de quem está em 2.x não enxerga 0.1.0.
- Repositório público com texto "internal".
- Cada merge de `upstream` terá mais conflitos (R7).
