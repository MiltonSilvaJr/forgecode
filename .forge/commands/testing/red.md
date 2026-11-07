---
description: Protocolo Red-first de correção de defeito (rule testing/regression-red-first.md) — vale para type:bugfix ou qualquer type com fixes_defects declarado (issue #138) — init escaffolda a evidência num change já existente (saída para brownfield), record declara o teste que reproduz o defeito (test-path, test-id, command e failure-pattern obrigatórios), replay roda o motor real (worktree git efêmero, um teste, timeout explícito) e converte a declaração em evidência observada, waive dispensa com motivo tipado quando o Red for genuinamente inviável.
argument-hint: "init|record|replay|waive|status <change-id> [flags]"
---

# /forge:red — evidência de Red em correção de defeito

Argumentos: `$ARGUMENTS`. Sem subcomando, mostra `status` do change ativo.

> Vale para changes sujeitos à política red-first — `type: bugfix`, **ou** qualquer outro `type`
> que declare `fixes_defects` (lista de ids de defeito no manifest, issue #138) — predicado
> `isDefectFixing` em `lib/defect-scope.mjs`. `evidence/red/red-evidence.json` nasce em
> `status: pending` no scaffold quando o change é `type: bugfix` (`/forge:spec new --type
> bugfix`); um change de outro `type` que declara `fixes_defects` depois de criado usa `init`
> (abaixo) para escaffoldar. Este comando é o único caminho para mover a evidência. Ver
> `.forge/rules/testing/regression-red-first.md` para a norma completa (§ Escopo) e
> `bugfix.md §5` para o protocolo dentro do change.

## init — escaffoldar evidência num change já existente (saída para brownfield)

```bash
bash .forge/scripts/red-evidence.sh init <change-id>
```

Cria `evidence/red/red-evidence.json` (`status: pending`) quando o change já é sujeito à política
red-first (`type: bugfix`, ou `fixes_defects` declarado — § Escopo da rule) mas nunca recebeu o
scaffold — harness atualizado por cima de um change em andamento, `fixes_defects` acrescentado
depois da criação do change, ou o arquivo apagado à mão. É a saída correta para esse caso:
`/forge:spec new --type bugfix` cria um change **novo**, não adiciona evidência a um já existente,
e só escaffolda automaticamente para `type: bugfix` — um `type: feature` com `fixes_defects`
sempre passa por `init` explicitamente. Idempotente — no-op se o arquivo já existir; falha se o
change não existir ou não satisfizer `isDefectFixing`.

## record — declarar o teste que reproduz o defeito

```bash
bash .forge/scripts/red-evidence.sh record <change-id> [--id <defeito>] \
  --test-path <path/do/teste> --test-id "<nome do caso>" \
  --command "<comando que roda só esse teste>" \
  --failure-pattern "<regex ou substring esperada na falha>" \
  [--fix-files "arq1,arq2"] [--setup-command "<comando executado antes do teste no worktree>"] \
  [--positive-control "<comando que precisa PASSAR na base>"] \
  [--reproduces "bugfix.md §1"] [--excerpt "<trecho, se já observou manualmente>"]
```

Grava a intenção — **nunca** marca `observed` sozinho. `status` fica (ou volta a) `pending` até
um `replay` bem-sucedido. `--test-path`, `--test-id`, `--command` e `--failure-pattern` são
**todos obrigatórios** (schema `red-evidence/v1`): sem `test_id`, a derivação da árvore base não
consegue ancorar no caso específico (só no arquivo de teste inteiro); sem `failure_pattern`, o
item 4 da rule nunca fica avaliável — campo ausente seria indistinguível de "gate desligado".

Antes de gravar: para defeito de carga/import ("X is not a function" no carregamento, módulo que
não resolve fora do bundler), meça a cadeia de imports mecanicamente (bundle com `metafile`, BFS da
entrada até o arquivo culpado) em vez de apontar o primeiro import plausível da lista — `import
type` é apagado na transpilação e não conta como elo; um diagnóstico que nomeia o elo errado leva a
TASK de correção a isolar o módulo errado. Quando o Red precisa de um alvo descartável que absorva
o dano (sentinela, para não tocar o repositório real), o sentinela replica a FORMA do alvo real na
dimensão que o mecanismo lê (tipo de diretório, layout, nome de caminho) — e a primeira medição do
sentinela é um controle positivo: o dano tem de aparecer nele antes de escrever o teste, senão um
sentinela simplificado demais devolve "sem efeito" e o defeito real parece não reproduzir. Quando o
defeito está no próprio host/fixture de teste (a correção mora no mesmo arquivo do caso), declare
isso explicitamente: `test_path` em `fix_files` faz o `replay` (passo 0) tratar o commit de criação
do teste como a correção e derivar uma base errada — ou separe a fixture num commit de refatoração
sem mudança de comportamento antes do fix (com o Red remedido depois dele), ou não declare
`fix_files` = `test_path` sem essa ressalva.

Formato de `test_id` (issue #190): o `replay` aceita o nome do caso como aparece no arquivo (nome do método, `test('<nome>')` do Jest/`node --test`, `test_nome` do pytest) e também a forma qualificada que xUnit/NUnit e `dotnet test --filter FullyQualifiedName~` usam — `Classe.Metodo` ou `Namespace.Classe.Metodo`. Na forma qualificada (só identificadores separados por `.`), a classe e o método são conferidos separadamente, como palavras inteiras, no arquivo de teste e na mesma linha de falha da saída; o namespace não é conferido. Qualquer outro formato continua exigindo a substring literal, e o `NOT-POSSIBLE` diz exatamente o que foi procurado.

`--positive-control` é **opcional** (issue #150, DA-13) — um comando que precisa PASSAR na
árvore base, na mesma corrida do teste declarado. Uma âncora (`failure_pattern`) que não falha
na base é defeito do TESTE, não do código sob correção: o teste afirma o CAMINHO que reproduz o
defeito, não só o resultado observado ao final — um padrão nulo, vazio ou genérico demais casa
com qualquer falha adjacente na base, inclusive uma sem relação com o defeito relatado.
`replay` recusa `failure_pattern` ausente/vazio com `not-possible` (rc≠0) mesmo quando o schema
não obriga o campo (evidência legada ou editada à mão); e `positive_control`, quando declarado e
falhando na base, também dá `not-possible` — prova, por execução, que a base seria capaz de
ficar verde antes de aceitar a falha do comando declarado como o defeito. Não é obrigatório: a
obrigatoriedade fica para a Onda 8, para não invalidar evidências já gravadas sem o campo.

### Vários defeitos no mesmo change (`entries[]`, issue #139)

`red-evidence.json` guarda um registro por defeito em `entries[]` — a **única fonte de
verdade** (redesenho de causa raiz da 4ª rodada de correção). Toda entrada tem `id` **não nulo e
estável**: um change com um único defeito continua funcionando exatamente como antes (`record`
sem `--id` declara e redeclara a mesma entrada — nada muda para o fluxo comum), mas por baixo
essa entrada já nasce com um id **auto-gerado** (`d1`, `d2`, ...) em vez de `id: null`. A partir
do segundo defeito. Quando o `bugfix.md` declara N defeitos (`§5`), abra N entradas — um `record
--id` por defeito; uma evidência de slot único cobrindo um `bugfix.md` que enumera vários dá
`observed` sobre 1/N em silêncio, e os demais nunca passam por `replay`:

- `record --id <novo>` **acrescenta** uma entrada — nunca sobrescreve as demais.
- `record --id <existente>` atualiza só aquela entrada (e, se o id era auto-gerado, passa a
  contar como declarado explicitamente — ver abaixo).
- `record` **sem `--id`** quando já existe uma entrada **declarada explicitamente** (por um
  `--id` anterior) — seja ela a única, seja uma de 2+ — é recusado (`rc≠0`, fail-closed): sem o
  `--id` explícito, o alvo é ambíguo, e a versão anterior deste comando resolvia a ambiguidade
  herdando os campos obrigatórios da última entrada gravada — o próprio defeito da issue. Só o
  fluxo de defeito único **auto-nomeado** (id `d1`, nunca declarado por `--id`) continua aceitando
  `record` sem `--id` — é o que preserva o fluxo comum de um change com um só defeito.
- Os escalares do topo (`test_path`, `status`, etc., lidos por ferramentas antigas que não
  conhecem `entries[]`) são sempre a **projeção pura** (`computeProjection`, `lib/red-evidence.mjs`)
  da **primeira entrada declarada** — nunca da última tocada, e recalculada em TODA escrita, nunca
  lida de volta como fonte. `status` do topo é `waived` só quando **todas** as entradas são
  `waived`, `observed` quando todas estão resolvidas mas nem todas são `waived`, e `pending`
  enquanto qualquer uma seguir pendente. Um topo que diverge dessa projeção fresca é tratado como
  **adulteração** por `check-red-first.sh check` (item 4 da rule) — a saída é rodar
  `/forge:red ensure`, que recalcula o topo a partir de `entries[]`.
- Um `red-evidence.json` **legado** (formato de entrada única, sem `entries[]` — o que hoje está
  em voo em changes já existentes) nunca perde dado: a leitura atribui a essa entrada o id fixo
  `legado`, e o primeiro `record --id` sobre um arquivo desses preserva o conteúdo legado como a
  primeira entrada (`id: "legado"`) e acrescenta a nova como uma entrada adicional. Um `entries[]`
  já existente com uma entrada sem id (só alcançável por um build anterior desta própria branch)
  recebe o mesmo tratamento na leitura — nunca fica um id nulo. Um scaffold nunca gravado
  (`recorded_at: null`, `status: pending`) não deixa resíduo — não há nada ali para preservar.
- `replay` e `waive` aceitam `--id <id>` para endereçar QUAL entrada o veredito resolve; sem
  `--id`, só 0/1 entrada é aceitável (fluxo retrocompatível) — com **2 ou mais** declaradas, os
  dois **recusam** (fail-closed, arquivo intacto) em vez de adivinhar, citando os ids existentes
  na própria mensagem. `ensure` (chamado incondicionalmente por `/forge:verify` e
  `/forge:archive`, sem `--id` — nenhum chamador sabe quais ids existem) nunca recusa: **itera**
  cada entrada não dispensada (`status != 'waived'`) e roda o motor sobre ela, gravando o
  veredito na própria entrada — como toda entrada tem id estável, a iteração nunca mais pula uma
  entrada por falta de nome. Os três gravam sempre na ENTRADA (nunca só no topo) e reconstroem o
  topo a partir dela — nunca uma escrita paralela que um `record --id` seguinte apagaria em
  silêncio.
- Não existe mais `--rename-null`: como toda entrada já nasce com id (auto ou explícito), nunca
  há uma entrada sem nome para renomear.

## replay — rodar o motor e observar de verdade

```bash
bash .forge/scripts/red-evidence.sh replay <change-id> [--id <defeito>] [--timeout <segundos, default 120>]
```

`--id` é obrigatório quando o change tem 2+ entradas em `entries[]` (ver seção acima); sem ele,
só 0/1 entrada é aceitável.

**`replay` só atinge `observed` depois que a correção está commitada** — o passo 0 do motor exige
o teste VERDE em HEAD antes de derivar a árvore pré-correção. Rodado na wave do `record`, antes de
qualquer TASK de correção existir, o resultado esperado é `FAIL replay (item green)` — isso é o
motor vendo o vermelho, não defeito do teste nem do planejamento; não é sinal para enfraquecer o
teste ou inventar uma correção só para obter a transição de cor. Na mesma lógica, se o vermelho é
observado na base mas, ao chegar a hora de corrigir, o teste já está verde em HEAD sem edição sua
(outra issue/PR fechou a mesma causa raiz como efeito colateral), não finja implementar: prove por
mutação que o mecanismo que já fecha a lacuna é real (remova o bloco suspeito numa cópia e veja o
defeito original reaparecer) e registre `waive` com essa classe — distinta de "o bug nunca existiu"
e de "ambiente de teste errado".

Quando `fixes_defects` tem mais de um id, uma âncora que reproduzia o defeito na base pode deixar
de guardá-lo depois de um segundo conserto do mesmo change — o `replay` mede "vermelho na base,
verde no HEAD" e não mede se esse verde ainda depende do conserto do id em questão. Antes de
aceitar o `observed`, reverta no HEAD apenas os `fix_files` daquele id (mantendo os dos demais) e
confira que o teste âncora volta a ficar vermelho; se continuar verde, a guarda real está em outro
teste (que a declaração de defeitos tem de nomear), não neste.

Este é o passo que converte "presumido" em "observado" — sem ele a evidência é só uma
declaração que qualquer agente poderia fabricar. O motor (`lib/red-replay.mjs`):

1. **Deriva a árvore pré-correção** (nunca pergunta): ANCESTRY quando o commit que adicionou o
   teste é ancestral do commit de correção (fluxo TDD normal — bug, depois teste, depois fix);
   REVERT-SYNTHESIS quando teste e correção estão no mesmo commit (squash) — reverte só os
   `fix_files` num worktree em HEAD, mantendo o teste; NOT-POSSIBLE quando nenhuma das duas
   resolve (nunca trava mudo — vira um veredito válido que pede `waive`).
2. **Roda UM teste** — o `command` declarado, nunca a suíte — num worktree git efêmero, com
   timeout explícito, sempre limpo ao final (sucesso ou erro).
3. **Exige, para `observed`**: falha na base (exit≠0) + classificação `behavioral` (não
   `build-error`), ou `setup-exception` (exceção de setup de fixture, ex.: xUnit
   `InitializeAsync` que lança — issue #191) somente com `failure_pattern` declarado que case +
   saída casando com `failure_pattern` quando declarado + passagem em HEAD
   (exit 0). Qualquer ausência vira `FAIL` com o item da rule citado, e a evidência **volta**
   para `pending` (nunca fica um `observed` falso na árvore).
4. **Recusa `failure_pattern` ausente/vazio** com `not-possible` (issue #150) — uma âncora que
   não amarra nada casaria com qualquer falha na base, inclusive uma adjacente ao defeito
   relatado; essa checagem roda mesmo quando o schema não obriga o campo (evidência legada ou
   editada à mão), sem invalidar o formato para quem já gravou evidência sem ele.
5. **Roda `positive_control`, quando declarado**, na mesma árvore base e na mesma corrida, antes
   do comando declarado (issue #150, `--positive-control` acima) — falhando, `not-possible` com
   a saída do controle no excerto, mesmo que o comando declarado também falhe na base.

Saídas: `OK replay` (grava `observed` + `base_commit`/`classification`/`excerpt`/
`excerpt_sha256`/`replayed_at`) · `FAIL replay (item N) — <motivo>` (volta a `pending`, exit 1)
· `NOT-POSSIBLE replay — <motivo>` (grava `not-possible`, exit 1 — próximo passo é `waive`; inclui
`failure_pattern` ausente/vazio e `positive_control` que falha na base).

## ci — a execução de referência, num runner que o autor não controla

```bash
bash .forge/scripts/red-evidence.sh ci
```

Varre **todo** change ativo sujeito à política red-first (`type: bugfix`, ou `fixes_defects`
declarado — § Escopo da rule), roda `ensure` em cada um e aplica o check estático, agregando o
veredito num exit code. É o que o workflow `red-first.yml` executa em cada pull request — e é
ele, não o `red-evidence.json` commitado, que decide se o Red foi observado.

Não aceita `<change-id>`, deliberadamente: quem define o escopo é o estado do repositório. Um
`ci --change X` devolveria a quem invoca a capacidade de apontar a verificação para o change que
lhe convém, que é o grau de controle que rodar no CI existe para tirar.

Change ativo fora da política é ignorado e repositório sem nenhum change sujeito a ela sai `0` —
ausência de correção de defeito não é falha. O runner precisa de histórico completo (`fetch-depth: 0`) para o
motor derivar a árvore pré-correção, e das dependências instaladas antes, porque o worktree
efêmero nasce sem elas.

Saídas: `OK ci — N change(s) …` · `FAIL ci — …` com uma linha `OK`/`FAIL` por change verificado.

## status — one-liner não-bloqueante

```bash
bash .forge/scripts/red-evidence.sh status <change-id>
```

## waive — dispensar com motivo tipado

```bash
bash .forge/scripts/red-evidence.sh waive <change-id> --reason <motivo> [--id <defeito>] [--note "<texto>"]
```

`--id` é obrigatório quando o change tem 2+ entradas em `entries[]` (ver seção "Vários defeitos
no mesmo change"); sem ele, só 0/1 entrada é aceitável.

| `--reason` | Quando | Efeito |
|---|---|---|
| `non-behavioral` | Typo, copy, config, documentação | Recusado automaticamente se o diff tocar código presente no grafo |
| `no-test-infra` | Brownfield sem suíte utilizável | Abre deferral + dívida técnica no ledger |
| `external-unreproducible` | Depende de terceiro indisponível | Abre deferral |
| `hotfix-under-incident` | Incidente em produção, correção antes do teste | Deferral com `blocks: [archive]` |

Delega para a política já implementada em `check-red-first.sh waive` (Onda B) — uma fonte só de
regra de waiver, sem reimplementação aqui.

## Regras

- Ao usar neste repositório um runner de teste ainda não visto por `lib/red-classify.mjs`
  (framework de infraestrutura declarativa — Prometheus, Alertmanager, admission tests — ou
  qualquer stack nova), confira proativamente se o classificador reconhece o formato de falha
  daquele runner **antes** do primeiro `replay` — rodar `record`+`replay` de amostra logo depois
  do primeiro vermelho evita descobrir a lacuna só depois de vermelho e verde já commitados. Se
  precisar de assinatura nova, trate como commit de infraestrutura compartilhada, separado do fix
  funcional, com menção no PR/verification.md.
- Ao construir uma lista de regressão por varredura mecânica (grep/diff de uma mudança aplicada a
  muitos arquivos de teste), exclua explicitamente qualquer arquivo cujo papel seja executar os
  outros da mesma coleção (um runner/dispatcher) antes de iterar a lista — ele não é "mais um
  arquivo tocado", é a lista; valide esse arquivo pelo gate dedicado que já o exercita em bancada
  controlada, nunca rodando-o por inteiro.
- Num gate shell com várias asserções em sequência que `red-evidence.sh task` (ou qualquer
  verificador que ancore no início absoluto da saída) vai avaliar, ordene os cenários para que PELO
  MENOS o primeiro exija a implementação real para produzir sucesso — um cenário de "recusa pura"
  (rc≠0 esperado) passa mesmo contra um stub genérico que recusa tudo, e se ele vier primeiro o
  vermelho "passa" por engano enquanto a falha real do cenário que importa fica enterrada no meio
  da saída. Antes de comitar o vermelho, confira a primeira linha capturada, não só o `rc` final.
- Não invente um teste para "passar no gate" — uma declaração fabricada é pior que a ausência
  declarada (mente para o próximo leitor). Prefira `waive` com motivo honesto.
- `replay` é caro (worktree + execução real) — nunca roda no `pre-push` (só o check estático,
  `check-red-first.sh`). Você o invoca aqui de forma explícita; `/forge:verify` e a transição
  para `verified` (`validate-spec.mjs`) chamam o mesmo motor por baixo via `red-evidence.sh
  ensure` — **sempre**, incondicionalmente, para todo change sujeito à política (§ Escopo da
  rule), sem ler `status` do
  artefato para decidir se executam. `ensure` não é um subcomando pensado para uso manual (por
  isso fora do `argument-hint` acima); ele existe para que nenhum `status: observed` sobreviva
  sem um replay real por trás, mesmo que o JSON tenha sido editado à mão.
- O resíduo honor-system que nenhum script fecha: que o motivo da falha seja **semanticamente**
  o defeito relatado, não uma quebra adjacente que por acaso casa com o padrão declarado. Isso
  continua sendo responsabilidade de quem escreve e de quem revisa.
