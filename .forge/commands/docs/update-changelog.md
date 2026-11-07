---
name: update-changelog
description: Atualiza o CHANGELOG.md de um componente ou da raiz, em modo explícito ou derivado de Conventional Commits, seguindo o formato Keep a Changelog em pt-BR.
arguments:
  - name: component
    description: "Caminho relativo do componente (ex: src/Server (atual), src/Domain (atual)); omitido = raiz do repositório"
    required: false
  - name: type
    description: Tipo da mudança (added, changed, deprecated, removed, fixed, security); omitido junto com description entra em modo derivado
    required: false
  - name: description
    description: Descrição da mudança em pt-BR; omitida junto com type entra em modo derivado
    required: false
---

# /forge:update-changelog

Atualiza o `CHANGELOG.md` do componente especificado (ou da raiz, se `component` for omitido), adicionando entrada(s) na seção `[Unreleased]`. Camada fina sobre o motor único da skill `readme-generator` — o mesmo motor que o hook `post-merge` usa para o CHANGELOG raiz (REQ-07: o hook nunca passa por este comando nem por `resolve-skill.sh`, cada um resolve o motor pelo seu próprio mecanismo).

## Modos

- **Explícito** — `type` e `description` informados: grava `- <description>` na seção pt-BR mapeada de `type`.
- **Derivado** — `type`/`description` omitidos: deriva entrada(s) de Conventional Commits, usando `--subject "<título>"` quando a invocação é de um squash merge (ex.: o título do PR), ou `--path <component>` para varrer os commits do componente que a branch atual trouxe desde a base (`merge-base` com a referência mais próxima entre `origin/develop`, `develop`, `origin/main`, `main`, `origin/master` e `master`; `--base <ref>` força outra). `--path` apontando para um componente inexistente, fora de um repositório git ou sem base resolvível é erro (rc 2), nunca "nada a registrar" por vacuidade (REQ-08).

Em todos os modos o motor deduplica por seção e texto dentro de `[Unreleased]`: rodar o comando duas vezes não duplica a entrada, e o `post-merge` pula o commit cuja entrada o comando já gravou com o mesmo texto (caso do `--path` e do `--subject` com o subject do próprio commit). Quando a entrada da branch tem texto diferente dos commits (ex.: `--subject` com o título do PR, ou modo explícito), o `post-merge` de um merge com commit de merge ainda grava as entradas por commit: nesse fluxo, escolha um dos dois caminhos para a mesma mudança.

## Passos a Executar

1. **Trava de branch protegida (REQ-09)**
   - Antes de qualquer edição, verificar a branch atual (`git branch --show-current`).
   - Se a branch atual for `develop`, `master` ou `main`, parar sem editar nada e informar que o comando não roda em branch protegida.

2. **Resolver o motor (REQ-12)**
   - Rodar `SKILL_DIR="$(bash .forge/scripts/resolve-skill.sh readme-generator scripts/changelog-engine.mjs scripts/gates/released.mjs scripts/gates/preserve.mjs scripts/gates/lint.mjs)"`.
   - Ordem de resolução: `FORGE_SKILL_DIR_README_GENERATOR` → `.forge/skills/readme-generator/` do projeto → skill de usuário do adapter ativo. Se o override `FORGE_SKILL_DIR_README_GENERATOR` estiver definido, ele é a única fonte: override inválido é erro, nunca queda silenciosa para a cópia do projeto.
   - Se `resolve-skill.sh` sair com rc ≠ 0 (`FAIL skill readme-generator ausente` ou `FAIL override ... inválido`), parar e reportar o erro — nunca cair em silêncio no comportamento antigo do comando.

3. **Detecção de `release-please-config.json` (REQ-10)**
   - Verificar se `<component ou raiz>/release-please-config.json` existe.
   - Se existir, parar sem editar `CHANGELOG.md` e apontar o título do PR atual como a fonte correta da entrada de release (quem gera release-please já deriva a entrada dali). O motor também recusa, com rc 2, como segunda barreira.

4. **Guardar a versão anterior do arquivo (obrigatório — é o que os gates comparam)**
   - `CL="<component ou raiz>/CHANGELOG.md"; ANTERIOR="$(mktemp)"`.
   - Se `$CL` existe: `cp "$CL" "$ANTERIOR"`. Se não existe: `: > "$ANTERIOR"` (arquivo anterior vazio = CHANGELOG criado agora) e anotar `CRIADO=1`.
   - Os gates reprovam com rc 2 se o arquivo anterior não existir: nunca passe um caminho inventado nem o mesmo `$CL` nas duas posições.

5. **Chamar o motor no modo apropriado**
   - Texto vindo do usuário ou do PR (`description`, título) é dado, não shell: atribua-o a uma variável com aspas simples (escapando `'` como `'\''`) e passe `"$VAR"`. Nunca interpole título ou descrição dentro de aspas duplas nem sem aspas.
   - Explícito: `node "$SKILL_DIR/scripts/changelog-engine.mjs" --root <component ou raiz> --type <type> --description "$DESCRICAO"`.
   - Derivado por subject: `node "$SKILL_DIR/scripts/changelog-engine.mjs" --root <component ou raiz> --subject "$TITULO"`.
   - Derivado por path: `node "$SKILL_DIR/scripts/changelog-engine.mjs" --root <raiz> --path <component> --changelog <component>/CHANGELOG.md` (acrescente `--base <ref>` se a base padrão não servir).
   - O motor cria `CHANGELOG.md` com cabeçalho Keep a Changelog padrão quando ausente (REQ-14), nestes modos — nunca no modo `--merge-range`, que é exclusivo do hook.

6. **Rodar os 4 gates, nesta ordem, parando no primeiro que falhar (REQ-11)**
   - `node "$SKILL_DIR/scripts/gates/released.mjs" "$ANTERIOR" "$CL"` — nenhuma seção `## [X.Y.Z]` já publicada pode ter mudado ou sumido.
   - `node "$SKILL_DIR/scripts/gates/preserve.mjs" "$ANTERIOR" "$CL"` — nenhum bloco antigo pode ter sido removido sem substituto.
   - `node "$SKILL_DIR/scripts/gates/lint.mjs" "$CL" --since "$ANTERIOR"` — travessão, quebra de linha dentro de parágrafo, acentuação ausente, placeholder e link quebrado reprovam, verificados só nas entradas novas (o histórico publicado não pode ser corrigido, então não pode travar o comando).
   - `NOVAS="$(mktemp)"; awk 'FILENAME==ARGV[1]{velha[$0]++; next} velha[$0]-- <= 0' "$ANTERIOR" "$CL" > "$NOVAS"; .forge/scripts/check-ai-attribution.sh text "$NOVAS"` — nenhuma assinatura de IA nas linhas gravadas agora (o histórico publicado pode citar marcadores ao documentar a própria regra, e não pode travar o comando).
   - **Se qualquer gate falhar, desfazer a escrita antes de reportar:** `cp "$ANTERIOR" "$CL"` (ou `rm "$CL"` se `CRIADO=1`). O comando nunca termina com o CHANGELOG editado e um gate vermelho.

7. **Nunca commitar**
   - O comando só edita `CHANGELOG.md` e reporta sucesso/falha. Quem decide quando e como comitar é o humano (ou um passo explícito e separado de `/forge:ship`).

## Validações Pós-Execução

- [ ] Comando parou sem editar nada se a branch atual era `develop`/`master`/`main`
- [ ] Comando parou sem editar nada se havia `release-please-config.json` no componente/raiz
- [ ] Versão anterior do arquivo guardada antes da escrita e usada pelos gates
- [ ] Entrada adicionada na seção `[Unreleased]` do componente ou raiz correto (quando aplicável)
- [ ] Seção do tipo correto usada (mapeamento pt-BR)
- [ ] Sem alteração em versões já liberadas (gate `released`)
- [ ] Nenhum bloco antigo removido sem substituto (gate `preserve`)
- [ ] Sem travessão, quebra de linha indevida, acentuação ausente, placeholder ou link quebrado nas entradas novas (gate `lint`)
- [ ] Sem assinatura de IA na entrada (`check-ai-attribution.sh text`)
- [ ] Arquivo restaurado se algum gate falhou
- [ ] Formato Keep a Changelog preservado
- [ ] Nenhum `git commit` executado pelo comando
