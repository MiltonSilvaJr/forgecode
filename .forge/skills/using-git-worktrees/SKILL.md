---
name: using-git-worktrees
description: Use ao iniciar trabalho de feature que precisa de isolamento do workspace atual, ao executar um plano de implementação, ou quando o usuário pedir "worktree", "isolar o ambiente", "trabalhar numa branch separada sem mexer no meu checkout". Garante um workspace isolado via ferramenta nativa do harness ou, na ausência dela, via git worktree manual — com setup do projeto e baseline de testes verde antes de começar.
---

# Trabalho com Git Worktrees

## Visão geral

Garantir que o trabalho aconteça em um **workspace isolado**. Prefira a ferramenta de worktree nativa do harness. Só recorra ao `git worktree` manual quando não houver ferramenta nativa.

**Princípio central:** detecte isolamento existente primeiro. Depois use a ferramenta nativa. Depois recaia no git. Nunca brigue com o harness.

> **Fonte de verdade de naming e localização:** a política do projeto está em `.forge/rules/conventions/git-worktree.md`. Esta skill é o **procedimento acionável** que a complementa (detecção de isolamento, tool nativa, setup, baseline). Em caso de divergência, a rule vence.

**Anuncie ao iniciar:** "Estou usando a skill `using-git-worktrees` para preparar um workspace isolado."

---

## Passo 0 — Detectar isolamento existente

**Antes de criar qualquer coisa, verifique se você já está em um workspace isolado.**

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

**Guarda de submódulo:** `GIT_DIR != GIT_COMMON` também é verdadeiro dentro de submódulos git. Antes de concluir "já estou num worktree", confirme que não está num submódulo:

```bash
# Se isto retornar um caminho, você está num submódulo, não num worktree — trate como repo normal
git rev-parse --show-superproject-working-tree 2>/dev/null
```

**Se `GIT_DIR != GIT_COMMON` (e não for submódulo):** você já está em um worktree vinculado. Pule para o Passo 2 (Setup do projeto). **Não** crie outro worktree.

Reporte com o estado da branch:
- Numa branch: "Já estou em workspace isolado em `<path>`, na branch `<nome>`."
- HEAD destacado: "Já estou em workspace isolado em `<path>`, com HEAD destacado — worktree sem branch não tem o que empurrar, não admite PR, e o rastro do trabalho morre com a árvore." Dê nome a ela AGORA, antes de trabalhar: `git switch -c <tipo>/<escopo>/<descricao>`. O hook `post-checkout` do harness já faz isso sozinho nas worktrees criadas sob `.forge/worktrees/` depois que o harness foi instalado, com o nome de partida `wt/<slug>`; uma worktree que ainda esteja destacada é anterior ao hook, foi criada fora do território, ou veio de `git worktree add --no-checkout`, que não dispara gancho nenhum.

**Posse não se presume, se verifica.** Numa worktree que já existia antes desta sessão (retomada, sessão par, trabalho em lote), nunca rode `reset`, `checkout -f`, `clean` ou qualquer comando destrutivo assumindo que "eu criei isso, então é meu": o git não arbitra posse entre sessões concorrentes, e uma worktree recém-criada por outra sessão é indistinguível, para quem chega depois, de uma worktree disponível. Antes de qualquer operação destrutiva numa worktree, confirme `pwd` e `git branch --show-current` contra o que o mandato espera — o diretório herdado pelo shell não é o que o mandato diz em prosa — e, se houver qualquer sinal de sessão par ativa (worktree criada há pouco, commit recente que não é seu, marcador de posse de outra sessão), pare e pergunte em vez de limpar. Todo comando em worktree de outra sessão ou em caminho que não seja o seu checkout atual deve usar `git -C <path-absoluto>` explícito, nunca depender de `cd` relativo anterior.

**Se `GIT_DIR == GIT_COMMON` (ou for submódulo):** você está em um checkout normal do repositório.

O usuário já indicou a preferência de worktree nas instruções (`AGENTS.md`/`CLAUDE.md` ou no pedido)? Se **não**, peça consentimento antes de criar um worktree:

> "Quer que eu prepare um worktree isolado? Ele protege a sua branch atual de qualquer alteração."

Honre qualquer preferência já declarada sem perguntar. Se o usuário recusar, trabalhe no local e pule para o Passo 2.

---

## Passo 1 — Criar o workspace isolado

**Há dois mecanismos. Tente nesta ordem.**

### 1a. Ferramenta de worktree nativa (preferível)

O usuário pediu um workspace isolado (consentimento no Passo 0). Você já tem uma forma nativa de criar um worktree? Pode ser uma tool com nome como `EnterWorktree`/`WorktreeCreate`, um comando `/worktree`, ou uma flag `--worktree`. **Se tiver, use-a e pule para o Passo 2.**

Ferramentas nativas cuidam de posicionamento de diretório, criação de branch e limpeza automaticamente — e neste projeto já posicionam os worktrees sob `.forge/worktrees/`, exatamente a localização canônica da rule. Usar `git worktree add` quando existe uma tool nativa cria estado fantasma que o harness não enxerga nem gerencia.

Só prossiga para o 1b se **não houver** ferramenta nativa de worktree disponível.

### 1b. Fallback: git worktree manual

**Só use isto se o 1a não se aplicar.** Crie o worktree manualmente com git, seguindo a convenção da rule `git-worktree.md`.

#### Localização e nomes (conforme a rule do projeto)

Neste repositório, worktrees são criados **dentro do repo**, sob `.forge/worktrees/<escopo>-<descricao>` — a mesma localização que a ferramenta nativa usa. O diretório `.forge/worktrees/` é **ignorado pelo `.gitignore`** (worktree dentro da árvore de trabalho não pode ser versionado).

- **Worktree local:** `.forge/worktrees/<escopo>-<descricao>` — ex.: `.forge/worktrees/feature-pix-qrcode`, `.forge/worktrees/agent-ledger-fix`. (Sem prefixo de tecnologia, conforme a rule.)
- **Branch:** `<tipo>/<escopo>/<descricao-em-kebab-case>` — ex.: `feat/payments/pix-qrcode-generation`, `fix/finance/ledger-split-rounding`. O `<tipo>` segue os Conventional Commits do projeto (ver `.forge/rules/conventions/conventional-commits.md`).
- **Nunca trabalhar diretamente no `main`.** Toda mudança começa numa branch criada via worktree.
- **Um worktree por tarefa.** Nunca reaproveitar worktree de feature concluída.
- **Agentes de IA sempre em worktree dedicado** — nunca compartilhe worktree com sessão humana.

Se o `AGENTS.md`/`CLAUDE.md` ou o pedido declararem outra localização, honre a preferência explícita — ela vence o padrão.

Num workspace com repositórios-filho (monorepo de workspace Forge com vários repositórios dentro), a mesma convenção vale **dentro de cada repositório-filho** — o worktree fica sob o `.forge/worktrees/` daquele repositório-filho, não num diretório irmão fora dele, porque é ali que o hook e a tooling do workspace olham. Confirme isso antes de criar, em vez de assumir que a localização canônica vale só para o repositório raiz.

#### Criar o worktree

```bash
# A partir da raiz do repositório:
git worktree add .forge/worktrees/<escopo>-<descricao> -b "<tipo>/<escopo>/<descricao>"
cd .forge/worktrees/<escopo>-<descricao>

# Exemplo concreto:
# git worktree add .forge/worktrees/feature-pix-qrcode -b feat/payments/pix-qrcode-generation
```

> **Garantia de `.gitignore`:** confirme que `.forge/worktrees/` (ou `.forge/` inteiro) está no `.gitignore` antes de criar. Se não estiver, adicione a entrada primeiro — caso contrário o worktree poluirá o `git status`.

**Fallback de sandbox:** se `git worktree add` falhar com erro de permissão (negação de sandbox), avise o usuário que o sandbox bloqueou a criação do worktree e que você vai trabalhar no diretório atual. Em seguida, rode o setup e o baseline de testes no local.

---

## Passo 2 — Setup do projeto

Detecte a stack automaticamente e rode o setup apropriado:

```bash
# Node.js / TypeScript (monorepo: pode haver vários package.json)
if [ -f package.json ]; then npm install; fi

# .NET
if ls *.sln >/dev/null 2>&1 || ls **/*.csproj >/dev/null 2>&1; then dotnet restore; fi

# Android / Kotlin (Gradle)
if [ -f build.gradle ] || [ -f build.gradle.kts ]; then ./gradlew dependencies >/dev/null; fi

# Go
if [ -f go.mod ]; then go mod download; fi

# Python
if [ -f pyproject.toml ]; then (poetry install 2>/dev/null || pip install -e .); fi
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
```

Se nenhum desses marcadores existir, pule a instalação de dependências.

---

## Passo 3 — Verificar baseline limpo

Rode os testes para garantir que o workspace começa limpo:

```bash
# Use o comando apropriado à stack:
#   npm test  |  dotnet test  |  ./gradlew test  |  go test ./...  |  pytest
```

**Se os testes falharem:** reporte as falhas e pergunte se deve prosseguir ou investigar — não dá para distinguir bug novo de problema pré-existente sem baseline verde.

**Se os testes passarem:** reporte que está pronto.

**Cuidado com worktree usado só como dependência de leitura** (ex.: fixture de teste de integração que carrega migrations ou contrato de outro repositório via um worktree local de longa duração, apontado para o `develop` de um repositório-irmão). Esse tipo de worktree ninguém commita nele, então ele fica parado e vai ficando atrasado em relação ao branch que deveria espelhar — sem o sinal de um conflito de merge para chamar atenção. Uma falha de teste vinda desse worktree pode ser só o pin desatualizado, não uma regressão real da mudança sob teste. Antes de aceitar uma falha como causada pela mudança: `git -C <worktree-pin> log -1` contra `git -C <worktree-pin> rev-parse origin/<branch-rastreada>` (depois de um fetch); se divergir, atualize o pin (ou extraia o `origin/<branch>` atual numa cópia descartável, sem tocar o worktree compartilhado, se ele não for seu) antes de investigar o teste.

### Relatório

```
Worktree pronto em <caminho-completo>
Testes passando (<N> testes, 0 falhas)
Pronto para implementar <nome-da-feature>
```

---

## Mesclar branch longeva dentro do worktree (PR humano muito atrasado)

Mandato recorrente: trazer `develop`/`main` para dentro da branch de um PR humano aberto há muitos
commits, dentro do worktree isolado. Esse fluxo tem riscos próprios, além dos do Passo 0-3.

**Decidir se o PR ainda agrega algo vem ANTES de resolver conflito, nunca depois.** "Resolver os
conflitos do merge" e "decidir se o PR ainda é necessário" são duas perguntas distintas, e a segunda
precisa ser respondida primeiro — depois do merge, a reconciliação textual dos conflitos tende a
mascarar a pergunta. Antes de `git merge`: (1) leia o diff do PR por inteiro; (2) para cada conceito de
negócio novo que o PR introduz (um enum, um campo, uma validação), faça `grep` na `develop` pelo mesmo
nome/conceito — não só pelo caminho de arquivo, que só prova sobreposição de arquivo, não que a
capability já foi entregue por outro caminho; (3) se achar equivalente já shipado com commit mais novo
que a criação da branch do PR, isso é sinal forte de superação; (4) se a peça restante do PR conflitar
com uma decisão **documentada** na develop (comentário explicando por que um campo fica vazio de
propósito, por exemplo), trate como incompatibilidade de design, não como gap a preencher — reportar
"SUPERADO" é melhor que produzir um merge que reverte silenciosamente uma decisão já tomada. Quando o
conflito de merge for de lógica de domínio (não de versão trivial), `git log --oneline
<target>..<destino> -- <arquivos-em-conflito>` lista os commits do lado destino que tocaram os mesmos
arquivos; leia a mensagem **completa** de cada candidato (`git show <sha> -s --format='%B'`), não só o
assunto — é no corpo que normalmente está o "porquê" e a rejeição explícita de alternativas.

**Merge "sem conflito" não é prova de nada, textual ou semântica.** Git só marca `CONFLICT` quando as
duas edições tocam a mesma linha; duas refatorações da mesma responsabilidade em pontos de texto
diferentes (a mesma lógica de negócio reescrita de formas incompatíveis nos dois lados) se concatenam
em silêncio como "Auto-merging", sem marcador algum, mesmo produzindo método duplicado, `await` fora de
`async`, chave desbalanceada ou referência a campo que só existe de um lado. Trate **todo arquivo que o
PR tocou** — não só os que o git marcou como `CONFLICT` — como unidade de verificação pós-merge: releia
o arquivo inteiro ou diff contra o merge-base antes de aceitar o resultado. Separadamente, ausência de
conflito textual também não prova que a árvore compila: o branch destino pode ter introduzido, depois
que a branch de origem nasceu, um gate de build novo (ex.: analisador Roslyn `PublicApiAnalyzer`
exigindo toda API pública declarada em `PublicAPI.Shipped.txt`/`Unshipped.txt`, ou equivalente em outra
stack) que não gera conflito porque cada lado editou linhas diferentes do mesmo arquivo de rastreio —
só aparece no build seguinte. Rode o build/teste real sempre, mesmo quando o merge "deu certo"; nunca
infira limpeza de build a partir de ausência de `CONFLICT`.

**Comando git que falha no meio de uma cadeia não interrompe os comandos seguintes.** `git checkout -b
<nome> ... && git merge ...` numa única chamada: se o `checkout -b` falhar (ex.: branch residual de uma
tentativa anterior na mesma sessão), o `&&` não impede o `git merge` de rodar — ele roda no branch em
que o processo já estava, sem erro visível, porque a falha do checkout não "travou" a árvore, só a
deixou onde já estava. Ao reexecutar uma sequência que já falhou uma vez: apague o branch residual
(`git branch -D <nome>`) se não tiver trabalho útil, reutilize-o com `checkout` sem `-b`, ou confirme
`git branch --show-current` imediatamente depois do `checkout -b` — nunca assuma que o passo seguinte
"rodou sem erro" porque o anterior funcionou.

**O que já está no índice entra no próximo commit, mesmo com paths explícitos.** `git add <path>` com
caminho explícito só controla o que você acabou de adicionar — não desfaz um `git rm` ou `git add`
anterior que já estava no índice. Em sessão que intercala Red, Green e correção de teste, uma correção
comitada no meio de um Green em andamento pode levar junto a remoção de um arquivo que ainda devia
existir, deixando o commit intermediário com o build quebrado. Antes de todo commit, confira `git diff
--cached --name-status` contra o que você pretende; em fluxo Red/Green, prefira `rm` comum em vez de
`git rm` até o commit final, ou use `git commit -- <paths>` para comitar só os caminhos pretendidos
ignorando o resto do índice.

---

## Referência rápida

| Situação | Ação |
|----------|------|
| Já num worktree vinculado | Pular criação (Passo 0) |
| Dentro de um submódulo | Tratar como repo normal (guarda do Passo 0) |
| Tool nativa de worktree disponível | Usá-la (Passo 1a) |
| Sem tool nativa | Fallback git worktree em `.forge/worktrees/` (Passo 1b) |
| Naming / localização | Conforme `git-worktree.md` (`.forge/worktrees/<escopo>-<descricao>`) |
| Erro de permissão na criação | Fallback de sandbox, trabalhar no local |
| Testes falham no baseline | Reportar falhas + perguntar |
| Sem marcador de stack | Pular instalação de dependências |

---

## Erros comuns

### Brigar com o harness
- **Problema:** usar `git worktree add` quando o harness já provê isolamento.
- **Correção:** o Passo 0 detecta isolamento existente; o Passo 1a delega à tool nativa.

### Pular a detecção
- **Problema:** criar um worktree aninhado dentro de um existente.
- **Correção:** sempre rodar o Passo 0 antes de criar qualquer coisa.

### Ignorar a convenção do projeto
- **Problema:** criar o worktree como diretório irmão do repo (`../<escopo>-<descricao>`) quando a rule manda `.forge/worktrees/<escopo>-<descricao>`.
- **Correção:** seguir `git-worktree.md`; criar sempre sob `.forge/worktrees/`; preferência explícita do usuário vence o padrão.

### Prosseguir com testes falhando
- **Problema:** impossível distinguir bug novo de problema pré-existente.
- **Correção:** reportar as falhas e obter permissão explícita para prosseguir.

### Tratar worktree alheio como disponível
- **Problema:** rodar `reset`/`checkout -f`/`clean` numa worktree que outra sessão criou, apagando o trabalho dela sem erro visível do git.
- **Correção:** verificar `pwd`/`git branch --show-current` contra o esperado antes de qualquer comando destrutivo; na dúvida, parar e perguntar em vez de "limpar".

### Aceitar "sem conflito" como "merge seguro"
- **Problema:** declarar um merge de branch longeva pronto porque o git não marcou `CONFLICT`, sem reler os arquivos tocados nem rodar build/teste.
- **Correção:** ver "Mesclar branch longeva dentro do worktree" — todo arquivo que o PR tocou entra na verificação pós-merge, e o build real roda sempre.

---

## Sinais de alerta (red flags)

**Nunca:**
- Criar worktree quando o Passo 0 detecta isolamento existente.
- Usar `git worktree add` tendo uma tool nativa de worktree (ex.: `EnterWorktree`). É o erro nº 1 — se você tem, use.
- Pular o Passo 1a indo direto aos comandos git do 1b.
- Criar worktree fora de `.forge/worktrees/` (ex.: diretório irmão do repo).
- Trabalhar diretamente no `main`.
- Pular a verificação do baseline de testes.
- Prosseguir com testes falhando sem perguntar.

**Sempre:**
- Rodar a detecção do Passo 0 primeiro.
- Preferir a tool nativa ao fallback git.
- Seguir naming e localização da rule `git-worktree.md` (`.forge/worktrees/<escopo>-<descricao>`).
- Detectar e rodar o setup do projeto.
- Verificar baseline de testes verde.

---

## Limpeza (após o merge)

Worktrees acumulados consomem espaço e geram confusão. Após o PR ser mergeado:

```bash
git worktree remove .forge/worktrees/<escopo>-<descricao>
git branch -d <tipo>/<escopo>/<descricao>
git worktree prune        # remove referências órfãs
```

Worktrees sem PR aberto há vários dias são candidatos a limpeza.
