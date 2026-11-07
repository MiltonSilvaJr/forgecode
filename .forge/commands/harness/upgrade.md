---
description: Atualiza o harness Forge deste projeto para a versão mais recente do template (npx forge-harness update) — overlay cirúrgico da maquinaria (commands/agents/hooks/scripts/schemas/rules), preservando specs, baseline e config. Distinto de /forge:update (que atualiza o grafo de código).
argument-hint: "[--no-backup] [--overwrite-drift]"
---

# /forge:upgrade — atualiza o harness para a versão nova do template

> Não confundir com `/forge:update` (grafo de código incremental). Este comando atualiza a
> **maquinaria do harness** (`.forge/commands`, `agents`, `hooks`, `scripts`, `schemas`, `rules`,
> `templates`, `adapters/*.yaml`) a partir do pacote `forge-harness`, **preservando** os dados do
> projeto: `specs/`, `product/current/` (baseline), `custom/`, `evals/`, `runners.yaml`,
> `constitution.md`, `context.md`, `FORGE.md`, e todo o `forge.yaml` exceto `harness.template_version`.

## Protocolo

0. **Rode do checkout principal, nunca de um worktree.** A maquinaria é versionada DENTRO da árvore: aplicá-la num worktree escreveria `.forge/**` novo apenas naquela branch, e o tronco mais os demais worktrees ficariam com a versão antiga — recebendo verde de gates que não estão rodando. Pior: `core.hooksPath` vive no `.git/config` **comum**, então um update rodado do worktree reaponta os hooks de todo o repositório para uma árvore que é de uma branch só. O `update` **recusa** rodar dali (sem flag de escape) e informa o caminho do tronco. Confirme antes:

   ```bash
   [ "$(git rev-parse --path-format=absolute --git-common-dir | xargs dirname)" = "$(git rev-parse --show-toplevel)" ] \
     && echo "checkout principal — pode seguir" || echo "worktree — rode do tronco"
   ```

1. **Prévia (dry-run)** — mostre o que mudaria, sem escrever:

   ```bash
   npx forge-harness@latest update --dry-run
   ```

   (Em desenvolvimento do próprio harness, use `node <repo-forge>/bin/forge.mjs update --dry-run
   --target "$(pwd)" --source <repo-forge>/template/.forge`.)

2. **Confirme** com o usuário a lista de mudanças (é uma ação que reescreve arquivos de maquinaria;
   um backup é criado por padrão em `.git/forge-backups/`, fora da árvore de trabalho, salvo `--no-backup`).

3. **Aplique**:

   ```bash
   npx forge-harness@latest update
   ```

   O comando faz: overlay aditivo da maquinaria (nunca deleta), atualiza `template_version`,
   reconcilia adapters ativos (`sync-adapters --adapter all`), garante `core.hooksPath` e o bloco
   managed do `.gitignore`, re-materializa o plugin `/forge:*` (se claude ativo), e roda o `doctor`.

4. **Rode a suíte de guarda do consumidor e trie cada reprovação contra a versão pré-upgrade.**
   Revisão de diff não substitui execução: num overlay que reescreve arquivos inteiros, o diff
   mostra bem o que mudou e mal o que sumiu (guarda de segurança removida, ordem invertida,
   argumento perdido — nada disso aparece como linha vermelha num `git diff`, só como reprovação
   de teste). Upgrade sem essa execução **não é declarado concluído**:

   ```bash
   bash .forge/scripts/tests/run-all.sh
   ```

   Rode também os checks declarados em `runtime.test`/`runtime.gates` do `FORGE.md`, se houver, além
   da suíte acima.

   Toda reprovação (rc 1) é comparada contra a versão do arquivo antes do commit do overlay —
   `git show HEAD:<path>` (o commit anterior ao do update) ou, se já não houver histórico limpo, o
   backup em `<git-dir>/forge-backups/` — e o `<git-dir>` é resolvido com
   `git rev-parse --git-dir`, nunca assumido como `.git/`: numa worktree linked, `.git` é um
   **arquivo** que aponta para o git-dir real, o mesmo cuidado de `bin/forge.mjs` ao localizar o
   backup. Classifique cada reprovação numa de três classes, com remediação distinta:

   - **Regressão** — o overlay quebrou um comportamento que a versão pré-upgrade tinha certo.
     Remediação: restaure o comportamento e, se a causa é do template (não de customização local),
     leve o achado ao upstream do `forge-harness`.
   - **Evolução legítima do template** — o teste do consumidor ainda espera o comportamento
     antigo, e o novo é o correto. Remediação: mescle o teste ao comportamento novo — **nunca**
     reverta o overlay para fazer o teste antigo passar de novo.
   - **Fixture desatualizada** — o teste compara um literal com um valor que o overlay mudou, e o
     valor antigo não é mais o certo em lugar nenhum. Remediação: atualize a fixture, **nunca**
     afrouxe a asserção.

   **Critério de desempate antes de chamar algo de "fixture desatualizada":** quando a reprovação
   é um literal comparado ao valor novo que o código produz, conte quem mais consome o valor
   antigo em código de produção:

   ```bash
   git grep -n -- '<valor antigo>' -- . ':!tests' ':!**/*test*'
   ```

   Se o valor antigo ainda vive em código de produção que o overlay não tocou, o teste está
   certo e quem mudou é que está errado — é regressão, não fixture desatualizada. Só realinhe o
   literal depois que os demais consumidores do mesmo contrato tiverem sido realinhados junto (o
   mecanismo da issue #75: um mutex com dois nomes de lock adquiridos por processos diferentes foi
   "corrigido" trocando o literal do teste, e o defeito voltou a rodar sem ninguém notar).

   **Alvo com desfecho NÃO VERIFICADO (rc 3, ver LDG-0181)** — morto por sinal, dependência
   ausente ou árvore não medida — é reexecutado **isoladamente** antes de qualquer classificação.
   Nunca classifique um alvo não verificado como regressão direto: um gate morto por sinal não é
   um gate que reprovou, e tratá-lo como regressão esconde a causa real (ambiente, dependência,
   timeout) atrás de uma remediação que não se aplica.

5. **Garanta o `core.hooksPath` absoluto.** O `update` já o grava apontando para `<tronco>/.forge/hooks/git` e migra o valor legado relativo (`.forge/hooks/git`), preservando um `hooksPath` customizado de verdade. Absoluto porque `core.hooksPath` vive no `.git/config` comum e um valor relativo é resolvido por cada worktree contra a própria árvore, que carrega a cópia antiga dos hooks. Confirme no fim:

   ```bash
   git config --get core.hooksPath   # tem de ser caminho absoluto, terminando em /.forge/hooks/git
   ```

6. **Meça a propagação para os worktrees existentes.** O `doctor` (que o `update` roda no fim) lista, por worktree linkado, quantos arquivos de maquinaria divergem do tronco e quantos commits aquele worktree está à frente. Use a tabela para decidir: sincronize primeiro os que estão com **zero commits à frente** (rebase/merge do tronco é trivial ali) e escale os que estão muito à frente ou em `HEAD` destacado, onde a sincronização é decisão de quem tem o contexto da branch.

7. **Resuma** o resultado: o que foi atualizado, o que foi preservado (specs/baseline), o estado do `core.hooksPath`, a divergência dos worktrees e o backup. **Liste cada reprovação da suíte (passo 4) com a classe atribuída** — regressão, evolução legítima do template ou fixture desatualizada — e a remediação aplicada; "suíte verde depois do upgrade" não pode ser obtido realinhando testes sem esse registro. Se o update imprimiu `PRESERVADO (deriva local)` ou `PRESERVADO (sem lock para provar)`, liste cada caminho com a versão pendente em `.forge/cache/template-pendente/` e peça ao usuário a decisão por arquivo (seção abaixo); nunca rode `--overwrite-drift` sem esse aceite explícito.
   O backup fica em `.git/forge-backups/` e não precisa ser removido para rodar gates: fora da árvore, ele não é varrido por `--path` nem aparece em `git status`. Antes ele vivia em `.forge.bak-N` e era varrido pelos próprios gates, bloqueando o primeiro push após o upgrade por conteúdo que era cópia do repositório (issue #76).

## Armar o gancho da ponte nativa do liaison (`guard-cross-session-send.sh`)

Este update traz o gancho `PreToolUse` de `SendMessage` que faz a ponte entre a mensageria nativa do Claude Code e o liaison (`add-liaison-native-bridge`). Pela regra vigente de ganchos novos, um consumidor que já tem `.claude/settings.json` (todos os consumidores de hoje) recebe o gancho **inativo e nomeado** — o `doctor` o lista como inativo, e é preciso armar sem desfiar os ganchos que já existem:

(1) rode `/forge:doctor` para ver o estado efetivo de cada gancho do diretório; (2) sem `hooks.manifest`, crie-o com uma linha por gancho levando o matcher e o contrato efetivos mostrados pelo doctor (nunca os do default, que alargariam em silêncio um matcher que o consumidor restringiu) e o estado efetivo (fiado → `armado`; inativo → `retido:<motivo>` do default ou `retido:inativo-no-consumidor`), deixando a linha de `guard-cross-session-send.sh` como `armado`; (3) com `hooks.manifest` já existente mas sem o marcador `# forge-manifest-format: 1`, migre-o para o formato canônico (marcador e campo de estado em todas as linhas, com o estado efetivo de hoje) e acrescente a linha nova; (4) rode `/forge:sync-adapters` e confira no doctor que os ganchos antes fiados continuam fiados e que o gancho novo está armado; (5) commite `hooks.manifest` e `.claude/settings.json`.

Sem este passo, o consumidor fica sem nenhuma guarda de saída para `SendMessage` — nem segredo, nem destino declarado, nem contenção por workspace. Sem cadastro em `.forge/liaison/allowed-workspaces.json`, o gancho bloqueia toda mensagem para outro workspace; a ordem recomendada antes de armar num repositório que conversa com outro workspace é `native pin` → `native allow <peer> --reason "<motivo>"` → commit → armar o gancho. O próximo `pre-push` e o PR mostram essa mudança de contenção esperada (`native containment`). Reversão: desarme a linha em `hooks.manifest` e rode `sync-adapters`.

## Divergências deliberadas de maquinaria (issues #101/#131)

Maquinaria fora de `ENRICHABLE_DIRS` (`scripts/`, `hooks/`, `commands/` e qualquer outro caminho que não esteja em `agents/rules/skills/templates` — capabilities, contracts, schemas, `adapters/*.yaml`, `README.md`) que diverge do template novo recebe uma decisão por arquivo: exceção declarada em `.forge/machinery-exceptions.txt` preserva; arquivo provadamente intocado sobrescreve com a linha `ATUALIZADO` — a prova é o sha local igual a um conteúdo que o próprio harness entregou, com ou sem entrada no `machinery.lock`: a entrada do lock, a versão pendente que o update anterior guardou em `.forge/cache/template-pendente/<caminho>` ou alguma versão publicada do template (histórico `template/machinery-history.json` do pacote); só o sha local que não é nenhum desses conteúdos preserva, com a linha `PRESERVADO (deriva local)` quando o lock tem entrada para o caminho e com a linha `PRESERVADO (sem lock para provar)` quando não tem (não há lock, ou ele não cobre o arquivo; sem histórico, ver abaixo) — nos dois casos a versão nova do template vai para `.forge/cache/template-pendente/<caminho>`; e `--overwrite-drift` troca essa preservação por sobrescrita com backup (seção "Deriva local", abaixo). A declaração explícita, uma linha por arquivo, é o jeito de dizer que o conserto local deve ficar:

```
<sha256 do TEMPLATE no momento da declaração>  <caminho relativo a .forge/>  # razão
```

O caminho aceita prefixo `./` ou `.forge/` (normalizado antes de casar contra o template, e a
grafia original é nomeada no relatório); duas declarações que normalizam para o mesmo caminho
contam como duplicata. Qualquer token além de `<sha> <caminho>` malforma a linha, com ou sem `#`
(igual ao parser de origem, `read -r e_sha e_rel e_resto` — um terceiro token não vazio recusa a
linha). O sha é sempre o do TEMPLATE (nunca o do disco) e casa por IGUALDADE ESTRITA, nunca por
prefixo: um sha declarado com menos de 64 dígitos (sintaxe válida, >= 32 dígitos) nunca é igual ao
sha de 64 dígitos do template, então cai sempre em **expirado**. Se o template mudar o
arquivo de novo, a declaração **expira** — o `update` preserva o arquivo mesmo assim e nomeia os
dois shas para reexame, em vez de bloquear (parar seria mudar a fronteira publicada do comando).
O `--dry-run` usa a MESMA classificação que a aplicação real: a prévia nunca anuncia sobrescrita
(`~ caminho`) de um arquivo que uma exceção viva ou expirada preserva, nem remoção (`- caminho
(órfão ...)`) de um tombstone que uma exceção barra — os dois aparecem como `= caminho (preservado
— ...)` / `= caminho (tombstone pulado — exceção declarada)` também na prévia.

O relatório do `update` nomeia cada exceção viva (`PRESERVADO (exceção declarada)`), cada
expirada (`EXCEÇÃO EXPIRADA`, com os dois shas) e cada ociosa (`EXCEÇÃO OCIOSA` — caminho fora do
template, já idêntico a ele, enriquecível ou ainda não instalado nesta árvore). Um caminho que o
template **removeu** (tombstone) e que tem exceção declarada não é apagado pela poda de órfãos —
aparece uma única vez, como `tombstone pulado — exceção declarada`, nunca duplicado como
`EXCEÇÃO OCIOSA`. O orphan-check defensivo que reprova o `update` quando sobra um placeholder
`<PROJECT_*>` num `.md`/`.yml` de maquinaria isenta também o caminho preservado por exceção viva ou
expirada: é conteúdo do consumidor, não do template, e não deve derrubar o comando por escolha
alheia.

Arquivo ilegível, linha malformada ou caminho declarado duas vezes param o update **antes** de escrever qualquer coisa (inclusive o `--dry-run`), nomeando a linha. Ao consertar ou reconciliar um arquivo, remova a linha dele: exceção que não cobre mais nada absolve em silêncio uma divergência futura que ninguém examinou.

## Deriva local de maquinaria (revisão da DH-1)

O ensaio de campo da 0.16.0 mediu cerca de 40 consertos deliberados sobrescritos em cinco consumidores que nunca tinham declarado exceção, entre eles consertos cuja perda fez a suíte do próprio consumidor reprovar. Por isso o `update` não sobrescreve mais, por padrão, maquinaria própria em deriva local: o arquivo fica como está, a linha `PRESERVADO (deriva local): <caminho> — versão nova do template em .forge/cache/template-pendente/<caminho>` nomeia cada um (ou `PRESERVADO (sem lock para provar): <caminho> — o conteúdo local não é nenhuma versão publicada do template; ...`, quando o lock não tem entrada para o caminho; se o pacote não trouxe o histórico de versões publicadas para consultar, a mesma linha diz `sem histórico de versões publicadas para provar` em vez de afirmar que o conteúdo não é nenhuma delas), e um `WARN` agregado no fim dá a contagem, separando quantos são sem lock. O `machinery.lock` não avança nesses caminhos (continua registrando o que o consumidor recebeu por último), para que o próximo update continue reconhecendo a deriva. Conteúdo que o próprio harness entregou nunca é deriva, com ou sem entrada no lock: o arquivo byte-idêntico a uma versão publicada do template (`template/machinery-history.json`) ou à versão pendente que o update anterior guardou recebe o template com `ATUALIZADO`. Isso cobre o lock defasado por checkout (o `.forge/` é versionado e o `.forge/cache/` não, então um update feito em outra worktree ou por um colega chega por pull sem o lock) e a reconciliação à mão da saída (2) abaixo. O custo: voltar um arquivo, de propósito, a uma versão publicada mais antiga não é reconhecido como deriva; para manter essa versão, declare a exceção. O `--dry-run` antecipa as mesmas linhas e o mesmo `WARN`. O `doctor` imprime `TEMPLATE-PENDENTE: N arquivo(s) ...` com os primeiros caminhos enquanto a versão pendente ainda difere do arquivo local e o caminho não tem exceção declarada.

Reconcilie cada arquivo pendente com o usuário, por uma de três saídas: (1) o conserto local deve ficar — declare a exceção em `.forge/machinery-exceptions.txt` com o sha da versão pendente (`shasum -a 256 .forge/cache/template-pendente/<caminho>`) e a razão; (2) o template já cobre o conserto, ou os dois se completam — compare com `diff .forge/<caminho> .forge/cache/template-pendente/<caminho>` e incorpore à mão; se o resultado for igual à versão pendente, a reconciliação acabou: o `doctor` para de cobrar na hora, e o próximo update reconhece o arquivo como versão entregue pelo template e o atualiza (`ATUALIZADO`), sem nova versão pendente; se for uma mescla que ainda difere dela, declare também a exceção como na saída (1), senão o arquivo volta a ser deriva e pendente a cada update; (3) o template deve vencer em todos os arquivos pendentes — rode `npx forge-harness@latest update --overwrite-drift`, que sobrescreve com backup em `.git/forge-backups/` e nomeia cada um como `SOBRESCRITO (não declarado)`, sem passar por cima de exceção declarada. O diretório de pendentes é reconstruído a cada update e fica sob `.forge/cache/`, que não é versionado: um clone novo não tem `machinery.lock`, e nele a prova de intocado vem do histórico de versões publicadas — o arquivo idêntico a uma versão publicada recebe o template (`ATUALIZADO`), e só o que difere de todas aparece como `PRESERVADO (sem lock para provar)`.

## Copiar `.forge` de outro repositório é upgrade parcial (issue #153)

Copiar o diretório `.forge` (inteiro ou por partes: só `scripts/`, só um `commands/harness/*.md`
que "ficou melhor" noutro projeto) de OUTRO consumidor para este repositório parece um atalho
para adiantar o upgrade, mas é o mesmo overlay que este comando faz, sem nenhuma das garantias
dele: sem preservar `specs/`, `product/current/`, `custom/`, `constitution.md`, `context.md`,
`FORGE.md` do destino (que a cópia pisa ou ignora, dependendo do que foi copiado); sem atualizar
`forge.yaml:template_version` para casar com o que chegou; sem reconciliar `machinery.lock`, que
continua registrando a versão ANTERIOR da árvore de origem (ou nem existe, se a origem nunca
rodou `update`); e sem trazer o script ou hook que, na origem, invocava cada lib copiada — o
consumidor de destino herda a lib, não quem a chamava.

Os dois sintomas ficam invisíveis até o `doctor` rodar (`/forge:doctor`, ou este comando no passo
3):

- **Lib órfã** — `scripts/lib/*.sh`/`*.mjs` presente e sem nenhum script, hook ou outra lib que a
  mencione. É o rastro mais comum de uma cópia parcial: a lib veio, o invocador da origem não.
- **Divergência de versão** — `forge.yaml:template_version` (o que a cópia trouxe, ou o que já
  estava aqui) e a versão gravada no cabeçalho de `.forge/cache/machinery.lock` (a última
  aplicação REAL de `update` nesta árvore) discordam. Nenhum dos dois arquivos sozinho prova
  nada — só o cruzamento denuncia.

O `doctor` nomeia os dois, sempre informativo (nunca reprova sozinho: uma lib sem invocador pode
ser deliberada, e um clone novo sem `machinery.lock` diverge legitimamente até o primeiro
`update`), mas nomear não é reconciliar — trate o aviso como sinal de que uma cópia manual
aconteceu e faça o upgrade de verdade: rode este comando (passo 1–3) a partir da versão publicada
do template, nunca copiando de outro checkout. Se a cópia manual já aconteceu e não pode ser
desfeita, decida por arquivo copiado (seção "Divergências deliberadas de maquinaria" acima):
declare exceção para o que deve ficar, ou rode `update` para trazer o resto ao ponto de
convergência com o `machinery.lock` correto.

## Regras

- **Nunca** rode este comando de dentro de um worktree linkado — ele recusa, e a recusa não tem flag
  de escape (rule `conventions/machinery-propagation.md`).
- **Maquinaria versionada na árvore não se propaga sozinha.** Atualizar o tronco não atualiza nenhum
  worktree ativo; um gate aprovado no tronco não protege onde o trabalho acontece até a branch
  daquele worktree receber o merge.
- **Nunca** use `init --force` para atualizar — ele move o `.forge/` inteiro para backup e reinstala
  do zero. `update` é o caminho que preserva o trabalho de produto.
- Órfãos (arquivos que o template removeu entre versões) **não** são deletados pelo overlay aditivo —
  ficam inertes. Remoção segura de órfãos depende de manifesto de versão (evolução futura).
- Customização de rule deve viver em `custom/rules/**` (override oficial), **nunca** editando
  `rules/*` in-place — senão o `update` sobrescreve a edição (o backup cobre, mas evite o atrito).
