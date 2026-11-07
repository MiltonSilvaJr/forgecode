---
name: gate-runner
description: Executa gates deterministas de uma feature/task — parseabilidade, grep positivo/negativo, anti-empty e smoke com timeout — emitindo UMA linha OK/FAIL por gate, com output bruto em /tmp. Use durante /forge:implement e /forge:verify para validar artefatos gerados sem estourar contexto.
---

# Gate Runner (v0 — §17.5)

Gates deterministas complementam os loops builder→validator (probabilísticos) com checagens objetivas e baratas. Disciplina inegociável (§17.6): **cada gate emite uma linha** `OK <gate>` ou `FAIL <gate> (<pista>)`; output bruto vai para `/tmp/gate-<nome>.log` e você lê **apenas `tail -20`** dele. Nunca cole o log no chat.

## Protocolo

1. Identifique os arquivos-alvo (os que a task tocou/gerou).
2. Selecione os gates aplicáveis (abaixo) e rode-os em sequência.
3. Qualquer `FAIL` → corrija e re-rode **só o gate que falhou** (máx. 2 tentativas; depois trate como falha irrecuperável da task: `[!]` + humano).
4. Reporte o conjunto em uma linha final: `gates: N OK, M FAIL`.
5. Ao estender um gate a uma classe nova de alvo (novo `type`, novo braço, novo escopo), o critério de pronto é um alvo real da classe nova **atravessando a cadeia inteira até o veredito verde** — nunca "a ferramenta aceita o tipo" medido só pela leitura do script. Estender o primeiro passo de uma cadeia de registro e parar aí troca "sem artefato" por "artefato inválido": as duas reprovações bloqueiam igual, e a segunda parece progresso sem ser.

## Receitas

**Premissa nomeada** (REQ-01/REQ-02, "Attack the Premise" — `/forge:implement` e `coding-loop`/`task-coder`, só quando a causa do `[!]` é literalmente "gate falha após 2 tentativas de correção"): depois de escrever o bloco de falha (`tasks.md`: bloco único; `PROGRESS-TRACKING.md`: entrada acumulada, nunca sobrescrita), rode:

```bash
bash .forge/scripts/check-attack-premise.sh --file <tasks.md|PROGRESS-TRACKING.md> --task-id <TASK-NN> >/tmp/gate-attack-premise.log 2>&1 \
  && echo "OK attack-premise:<TASK-NN>" || echo "FAIL attack-premise:<TASK-NN> ($(tail -1 /tmp/gate-attack-premise.log))"
```

Reprovado: complete `Gate:`/`Premissa:`/`Ator(es) com o desequilíbrio:` antes de reportar o HALT ao humano — não emita o relatório com os campos vazios. `--list --file <path>` lista toda TASK com os campos já preenchidos, insumo da seção "Premissas atacadas" de `verify.md`.

**Supressão sem referência** (REQ-03/REQ-04 — `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`/`eslint-disable*` em JS/TS, `# noqa`/`# type: ignore` em Python, sobre as linhas ADICIONADAS do diff, nunca o arquivo inteiro): chamado em `/forge:ship` (`--staged`, antes do commit) e no hook `pre-push` (`--range <base>...<head>`, base já resolvida pela cadeia de `_redfirst_resolve_base`):

```bash
bash .forge/scripts/check-suppression-reference.sh --staged >/tmp/gate-suppression-ref.log 2>&1 \
  && echo "OK suppression-ref" || echo "FAIL suppression-ref ($(tail -1 /tmp/gate-suppression-ref.log))"
```

Reprovado: a mensagem nomeia `<arquivo>:<linha>` e o trecho sem referência — adicione `LDG-NNNN`/`ADR-NNNN`/`ISSUE-NNN`/`issue #NNN`/`closes #NNN`/`fixes #NNN` ao comentário de supressão antes de prosseguir. Código gerado/vendorizado e todo `.forge/**` da raiz do repositório ficam fora do escopo automaticamente; exclusão adicional do consumidor via `.forge/suppression-scan-exclude.txt` (glob por linha, `# motivo: <justificativa>` obrigatório).

**Parseabilidade** (parser nativo do formato):

```bash
# JSON
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f" >/tmp/gate-parse.log 2>&1 && echo "OK parse:$f" || echo "FAIL parse:$f"
# YAML (python3 com pyyaml; fallback: o parser da sua stack)
python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))' "$f" >/tmp/gate-parse.log 2>&1 && echo "OK parse:$f" || echo "FAIL parse:$f"
# Frontmatter de .md
perl -0ne 'exit(0) if /^---\n.*?\n---/s; exit(1)' "$f" && echo "OK frontmatter:$f" || echo "FAIL frontmatter:$f"
```

**Grep positivo (OR cross-file)** — cada padrão obrigatório aparece em ao menos um arquivo-alvo:

```bash
grep -l "$PATTERN" "${FILES[@]}" >/dev/null && echo "OK grep+:$PATTERN" || echo "FAIL grep+:$PATTERN (ausente em todos os alvos)"
```

**Grep negativo (NOT cross-file)** — nenhum padrão proibido sobra:

```bash
out=$(grep -arnE 'TODO|FIXME|not implemented|console\.log\(|HACK' "${FILES[@]}" 2>/dev/null | head -5)
[ -z "$out" ] && echo "OK grep-:residuos" || { echo "$out" >/tmp/gate-grepneg.log; echo "FAIL grep-:residuos (tail -5 em /tmp/gate-grepneg.log)"; }
```

Padrões proibidos default: `TODO`/`FIXME`/`not implemented`/`HACK` residuais; `console.log(`/`print(` de debug; em-dash e pontos dentro de labels Mermaid.

O `grep`/`rg` default do shell de agente costuma ter `-I`/`--ignore-files` ligados por padrão: isso pula arquivo não UTF-8 (tratado como binário, sem aviso) e respeita `.gitignore` mesmo para arquivo **versionado**. Um "0 ocorrências" sob esse shim não é confiável sem controle. Use `LC_ALL=C /usr/bin/grep -a` (ou `rg -a --no-ignore`) em todo grep negativo/positivo que sustenta um veredito de ausência, e antes de aceitar o zero, compare `grep -rl ''` do shim com `/usr/bin/grep -ral ''` no mesmo escopo e liste os arquivos que ficaram invisíveis.

**Grep de fechamento de achado** — quando a correção de um achado cita um trecho literal como falso, a prova de que ele sumiu é busca, não releitura do trecho novo:

```bash
grep -c "$TRECHO_CITADO_COMO_FALSO" "$ARQUIVO"   # exige 0, além da contagem de preservação do que era obrigatório
```

A âncora de substituição precisa englobar a frase inteira que contém o trecho citado, não só a parte que muda — substituir só o miolo deixa a cláusula velha sobreviver no fim da mesma frase. E quando um achado cita **múltiplos locais** (`arquivo A e arquivo B`, ou duas linhas do mesmo documento), trate a lista como checklist completa: auditar cada local individualmente, nunca parar na primeira ocorrência corrigida, e buscar a MESMA string antiga no resto do artefato e nos artefatos irmãos citados — a frase velha costuma sobreviver ao lado da nova.

**Anti-empty** — artefato existe e tem substância:

```bash
[ -s "$f" ] && [ "$(wc -l < "$f")" -ge "${MIN_LINES:-3}" ] && echo "OK anti-empty:$f" || echo "FAIL anti-empty:$f"
```

Presença de arquivo e conteúdo que prova algo são predicados diferentes: um gate que só checa existência é satisfeito pelo template cru copiado sem edição (placeholder de SHA, coleção vazia declarada em texto). Todo gate de artefato por presença precisa também de uma asserção de conteúdo mínimo — nenhum marcador de scaffold/placeholder remanescente, e as coleções que sustentam o veredito com comprimento maior que zero — e o teste de aceitação do próprio gate é copiar o template cru para o lugar do artefato e exigir reprovação. Ao achar essa guarda de conteúdo aplicada a um artefato de um conjunto e não a um irmão do mesmo gate, auditar os irmãos imediatamente: a guarda que existe num deles prova que os outros precisam dela.

Uma guarda anti-vacuidade (conjunto varrido vazio nunca vira verde) não se escreve sobre "o conjunto processado é vazio" — isso colapsa dois estados opostos: "não consegui verificar" (indeterminado, deve reprovar) e "verifiquei e cada item estava isento por regra declarada e auditável" (resposta completa, pode ser verde). Escreva como conta que fecha: total do alvo = soma das categorias declaradas, e só um subconjunto nomeado dessas categorias autoriza o verde. A partir do momento em que essa conta sustenta um veredito, todo descarte silencioso do laço de processamento (item que sai do conjunto sem entrar em nenhuma categoria) vira defeito de segurança, não só de relatório.

**Scanner de configuração (trivy config, checkov, kube-linter)** — rodar sobre a pasta crua do chart/manifesto pode devolver "Not scanned" com exit 0 quando o render falha silenciosamente (ex.: valor agora `required` sem os `values` do ambiente): isso é verde sem ter olhado nada.

```bash
# Renderizar com os values reais do ambiente ANTES de escanear — nunca escanear a pasta do chart
helm template "$CHART" -f "$VALUES_ENV" | trivy config - >/tmp/gate-scan.log 2>&1
# Confirmar que o número de alvos escaneados é > 0 (parse do relatório JSON), antes de aceitar exit 0
```

**Smoke com timeout** (anti auto-mentira — o comando roda de verdade, com exit code esperado):

```bash
perl -e 'alarm '"${TIMEOUT:-120}"'; exec @ARGV' -- bash -c "$CMD" >/tmp/gate-smoke.log 2>&1
[ $? -eq "${EXPECTED_EXIT:-0}" ] && echo "OK smoke:$NAME" || { echo "FAIL smoke:$NAME (tail -20 /tmp/gate-smoke.log)"; }
```

Essa receita **não mata binário Go** (gitleaks, `gh`, `kubectl`, `terraform`, `docker`, `helm`): o runtime Go captura todo sinal sem handler registrado e, sem `signal.Notify`, engole o `SIGALRM` entregue via `exec`. O processo continua vivo além do timeout e só morre com `kill` manual. Quando o comando alvo é ou invoca um binário Go, use um watchdog que mate o **grupo de processos** por SIGTERM/SIGKILL:

```bash
perl -e '$p=fork; if(!$p){setpgrp; exec @ARGV} $SIG{ALRM}=sub{kill "TERM",-$p; sleep 5; kill "KILL",-$p}; alarm shift; waitpid $p,0; exit($?>>8)' "${TIMEOUT:-120}" -- $CMD >/tmp/gate-smoke.log 2>&1
```

E um exit code ou mensagem de sucesso não são o mesmo que o efeito colateral que o comando alega ter evitado: flags de `--validate-only`/`--dry-run` de CLIs de infraestrutura costumam imprimir a MESMA mensagem de uma criação real (ex.: `gcloud ... --validate-only` imprime "Created [uuid]" sem nenhuma palavra "validate" na saída). Ao usar uma flag dessas pela primeira vez, ou sempre que o resultado for citado como prova de "nada foi escrito", exigir uma segunda verificação independente que efetivamente liste o recurso e confirme ausência — nunca aceitar a redação da própria mensagem de validação como prova.

**Credencial em log de execução** — para qualquer ferramenta de teste que recebe credencial por URL (callback OAuth, magic link), uma credencial pode vazar pelo canal que ninguém escreveu de propósito: o log de acesso padrão do framework HTTP, não o artefato de evidência redigido à mão. Gate complementar ao scan de segredos do repositório: varrer os logs de execução de testes/fumaça por padrões de credencial (`code=`, `access_token=`, JWT) além do scan do código-fonte.

## Diagnóstico de veredito (leitura de saída de gate)

- **Contagem de falhas é parte da assinatura, não ruído.** "O gate conhecido falhou" só vale quando o número e o conjunto de falhas batem com o registrado; contagem diferente é falha diferente até prova em contrário. Antes de classificar um gate como intermitente e convivendo com ele: listar os artefatos que a suíte produz em diretório ignorado pelo versionamento e perguntar quantos arquivos de teste os produzem — mais de um produtor sem dono único nem exclusão mútua é a explicação mais provável de intermitência, e o sinal mais barato é um caso passando ao lado de um caso falhando **no mesmo arquivo** (dentro de um arquivo a ordem é sequencial).
- **Identificador e detalhe raramente são a mesma propriedade.** Numa saída `<alvo>(<detalhe>)`, o detalhe costuma nomear onde o INSTRUMENTO parou (primeiro arquivo em que uma cadeia acumulada conflitou, por exemplo), não um atributo do alvo. Antes de interpretar, localizar na fonte do gate a linha que monta a string e nomear de que grandeza o detalhe é propriedade. Tabular por frequência (`grep -oE '\([^)]+\)' | sort | uniq -c | sort -rn`) antes de tirar conclusão sobre a população: concentração num único valor acusa causa comum no instrumento ou em infraestrutura compartilhada, dispersão acusa propriedade real.
- **Achado de instrumento novo ou recém-alterado é evidência sobre o instrumento antes de ser sobre o sistema.** Confirmar na fonte primária (migration, config, código) que o achado se sustenta antes de atribuir severidade; marcar como "não confirmado" até essa conferência.
- **Vermelho de CI só é prova do gate se o log mostra o marcador próprio do gate** (ex.: `FAIL check-x: 33`). Status FAILURE isolado pode vir de causa anterior no pipeline (credencial, fetch sem permissão) que nunca chegou a executar o gate. Se o grep que deveria trazer a mensagem do gate voltar vazio, investigar antes de seguir — nunca tratar FAILURE genérico como prova de Red.
- **Verde de PR/CI exige prova positiva de execução**, não só ausência de falha: exigir total de checks > 0 além de zero pendentes e zero falhas, e imprimir o total junto do OK. Repositório/commit sem nenhum check registrado é FAIL explícito ("nenhum check registrado no head"), nunca OK por vacuidade do filtro.
- **Nome de fixture usado como diretório é identificador de filesystem, não de código**: em filesystem insensível a caixa (APFS, NTFS), `c2` e `C2` colidem. Identificadores de cenário usados como path precisam ser únicos ignorando caixa, ou prefixados por grupo; um cenário que só falha quando roda junto dos outros é suspeito de colisão de estado compartilhado antes de intermitência.
- **Laço de medição em lote**: todo comando interno que pode ler stdin (`gh`, `ssh`, `docker exec`, `ffmpeg`, `read`) recebe `</dev/null` dentro de um `while read`, ou o laço usa `for x in $(cat lista)` — sem isso, o comando interno consome o resto da lista externa e o laço processa só o primeiro item de cada iteração, em silêncio. Toda medição em lote confere "processados=N de M" contra o esperado antes de interpretar o conteúdo; "todos iguais"/"zero achados" sobre um subconjunto truncado tem a mesma aparência de um resultado completo.

## Mutação — bateria de alvo morto

Um harness de mutação precisa de dois controles antes de aceitar qualquer resultado, porque os dois extremos (tudo vermelho, tudo verde) são os menos confiáveis e se parecem com evidência real:

1. **O mutante foi plantado?** — `diff` com contagem de linhas, nunca a suposição de que a substituição casou.
2. **O mutante é válido?** — o alvo ainda carrega/compila (carregamento seco do módulo). Um mutante que quebra a sintaxe reprova a suíte inteira (**tudo vermelho**, inclusive casos que a mutação nem toca) pela mesma asserção de "módulo ausente", o que parece rigor e não é nenhum teste tendo sido executado contra a lógica mutada; um mutante que não chegou a ser plantado por erro do script de mutação devolve a suíte inteira verde, o que parece "a guarda sobrevive" e na verdade é "nada foi testado".

Some a isso um **kill estreito** (a mutação de uma guarda deve matar os casos daquela guarda e deixar os outros vivos — um kill largo é suspeito de invalidade, não sinal de força) e um **controle negativo** (mutar algo que nenhum caso deveria cobrir, como texto de mensagem sem asserção, e exigir bateria verde).

Além da lógica (a decisão que o gate toma), toda bateria de mutação de um gate precisa cobrir dois outros caminhos, porque cada um deixa passar uma classe própria de regressão que o outro não detecta:

- **Fiação** (a condição, o caminho e o despacho que fazem o gate ser executado): mutar a condição de invocação no hook/CI (ex.: trocar a condição por uma que nunca casa) e exigir que ao menos um teste exercite o INVOCADOR real — hook, job de CI, comando — contra um alvo que deve reprovar. Teste que importa o módulo diretamente nunca detecta a desconexão; um gate correto e um gate correto-e-desligado produzem o mesmo relatório de testes se a bateria só cobre lógica.
- **Fonte alternativa de um dado**, quando a correção troca DE ONDE um valor vem (ex.: ler do commit empurrado em vez da árvore do tronco): além do mutante que remove/inverte a linha da correção, plantar (a) a fonte antiga somada à nova e (b) uma fonte vizinha plausível (HEAD vs ref, árvore de trabalho vs commit, tenant do contexto vs tenant do payload), cada um com um cenário em que as duas fontes divergem — remoção de linha prova que a correção é necessária, não que a fonte escolhida é a única que passa.
- **Cada chamador**, quando a correção fatora N chamadores num helper/condição compartilhada: mutar o helper mata todos de uma vez e é o mutante natural, mas só mutar CADA CHAMADOR isoladamente (reintroduzindo nele a condição antiga) mede se aquele chamador específico está de fato fiado ao helper, em vez de herdar por sorte.

**Braço paralelo de gate (política duplicada para uma classe nova de alvo):** a duplicação de uma tabela de vereditos perde cláusula em silêncio — a ausência de uma guarda é invisível lendo qualquer um dos dois arquivos isolado, porque só existe como diferença entre eles. Ao criar ou revisar um braço novo: (1) montar UM artefato mínimo e alimentá-lo aos DOIS braços, registrando os vereditos lado a lado — toda divergência é uma decisão que alguém assume em letra (a guarda entra no braço novo, ou o comentário diz qual ficou de fora e por quê); (2) extrair as cláusulas de INTEGRIDADE (validação do insumo) para uma fonte compartilhada, mesmo que a tabela de julgamento continue separada — o que legitimamente difere entre braços é o julgamento, quase nunca a validação; (3) checar se alguma etapa do braço antigo reexecuta e sobrescreve o artefato antes de julgar (segunda linha de defesa contra forja) e se o braço novo tem equivalente. A pergunta de revisão não é "o braço novo está correto?" e sim "o que o braço antigo recusa que este aceita?".

## Classes avançadas (manuais no MVP2; automação chega no MVP5)

- **Import-resolve** (Classe B): todo import/using aponta para arquivo/símbolo existente — verifique com o typecheck da stack quando declarado no `FORGE.md runtime:`.
- **Unused** (Classe C): sem imports/vars não usados — lint da stack.
- **Consistency cross-file** (Classe A): símbolo usado de forma consistente entre arquivos (ex.: factory vs middleware) — grep dirigido pelos contratos do design.

## Escopo e ciclo de vida do gate

- **Escopo por caminho tocado governa também o registro sobre o trabalho, não só o trabalho**: um gate que escopa "os changes que este push toca" sem distinguir caminhos de ENTREGA (código, testes, design) dos de REGISTRO DE ESTADO (deferrals, aprovações, progresso) acaba cobrando, do registro de que uma entrega está impedida, a mesma evidência que só a entrega resolvida produziria — e aí a única saída sancionada para documentar o impedimento é implementar o que está impedido. Ao definir escopo por caminho, declarar explicitamente quais caminhos são o objeto da cobrança e quais são a metalinguagem sobre ela, e não pôr o change em escopo quando o push só toca registro de estado.
- **Exceção/aceite de risco com prazo (`valid_until`) só é controle se algo relê a data depois do merge.** Um gate restrito ao diff (lint de migration, scanner de PR) nunca revisita o artefato depois de mergeado: o prazo de 30 dias proposto não reprova nada quando vence. Ao propor ou avaliar uma exceção com prazo, verificar o escopo de execução do gate e, se ele é por diff, exigir um executor próprio para o vencimento (check agendado, todo-PR que compare a data com hoje, item de bloqueio de release, ou catraca que só desce) — e o registro de risco deve dizer qual é.
- **Medir a linha de base de um gate antes de ligá-lo em modo bloqueante usa o MESMO comando e o MESMO escopo que o gate roda no CI**, de preferência sobre a árvore real (`git archive` da branch alvo), nunca uma cópia filtrada de arquivos. "0 achados em 1 alvo" e "0 achados em 17 alvos" são afirmações diferentes — reportar quantos alvos foram varridos junto do veredito. Um PR que liga bloqueio só deve ser marcado pronto para merge depois do primeiro run real do gate no repositório, não da medição local prévia.
- **Atualizar um PR antigo com a base não termina na resolução de conflito textual.** Mudanças da base que o merge resolve SEM conflito (schema mais restritivo, lista fixa que ganhou membro novo, invariante "todo X" que a base violou) podem invalidar o PR sem que o git acuse nada. Depois do merge da base, rodar localmente os gates do próprio PR (render, schema, guardas, checks de cobertura — extraídos do workflow, não só os testes unitários) contra a árvore mesclada antes de declarar o PR verde.
- **Modo "Audit"/relatório de um gate de admissão/política tem duas dimensões independentes**: a ação sobre violação (Audit/Deny) e o comportamento em erro de avaliação (`failurePolicy`: fail-open vs fail-closed). `failurePolicy: Fail` com `validationActions: [Audit]` ainda recusa quando o webhook está indisponível ou a credencial falha — um rollout "só observando" que não testa as duas dimensões não é observacional. Ao ligar uma política em modo relatório, medir as duas em TODAS as políticas que o pacote instala, não só a do pedido.

## Entrega real do artefato (gate de regra/alerta/config)

Um teste de regra/alerta/gate que só prova a lógica (promtool, linter, unit test da expressão) não prova que o artefato chega ao avaliador real nem que os dados que ele filtra existem na produção — e os dois defeitos dão o mesmo "verde" que a lógica correta daria:

- **Entrega**: confirmar que o artefato vira objeto carregado pelo sistema que o avalia (render do que o deploy de fato aplica, contagem de objetos no avaliador), não só que o arquivo-fonte passou o linter.
- **Dimensão filtrada**: toda label/campo que a regra filtra precisa existir na série/evento produzido de verdade — medir no ponto de emissão ou no coletor, nunca só na fixture do teste, porque a fixture escrita pelo mesmo autor da regra é onde a suposição se esconde (ex.: regra filtra `environment="stg"` e a série real nunca carrega essa label).

Ao verificar um card "entregue", pergunte onde o arquivo vira objeto carregado e de onde vem cada campo filtrado na expressão da regra.

## Regras

- Todo comando externo roda com timeout (receita `perl alarm`/watchdog de grupo acima — portátil em macOS/Linux; para binário Go, use o watchdog que mata o grupo de processos, não o `alarm` simples).
- Gates não substituem os checks do `/forge:verify` — são o filtro barato POR TASK.
- Nunca "passe" um gate editando o gate; ajuste o artefato.
- Composição entre um gate e a ação que ele autoriza (commit, push, merge, retarget de PR) é condicionada ao código de saída do gate com `&&`/`exit`, nunca com `;` nem com pipe que mascara o código (`cmd | tail && git commit` lê o exit do `tail`, não do gate; rode sem pipe, com saída em arquivo e `tail` separado para exibir, ou sob `set -o pipefail`).
- Sob `set -euo pipefail`, um pipe de extração que termina em `grep`/`head -1`/`sed` e pode legitimamente não achar nada (resultado de negócio, não falha de ambiente) precisa de `|| true` no fim — é a checagem explícita de vazio depois, não o exit do `grep` dentro do pipe, que decide se é erro. Teste a MENSAGEM de erro esperada, não só o exit code final: um script pode morrer no `set -e` antes de chegar à linha que imprimiria o diagnóstico, e ainda assim sair com o código "certo".
- Suíte bats rodada localmente no macOS herda o `bash` 3.2 do sistema por padrão; sob esse bash, `set -e`, uma asserção `[[ ... ]]` falsa que não é o último comando do teste NÃO reprova o teste, e `! cmd` no meio de um teste nunca reprova (o bash ignora o status de um comando negado para efeito de `set -e`). Os dois dão verde falso local com o mesmo teste reprovando corretamente no CI (Ubuntu, bash 5). Antes de aceitar verde de bats como evidência: confira `bash --version` do interpretador que o bats resolve e exija major >= 4 (isolar só o binário do bash moderno na frente do PATH, sem trocar o resto do toolchain — colocar um diretório inteiro de outra distribuição na frente pode trocar outras ferramentas, como o `python3` do lint, e quebrar por outro motivo). Proíba `! cmd` como asserção intermediária; use `run cmd` com `[ "$status" -ne 0 ]` ou um helper que retorne 1. Se uma mutação semanticamente relevante sobreviver, rode o script mutado à mão e compare a saída com a asserção antes de concluir que o teste é fraco.
- Suíte verde localmente só vale para os gates que de fato rodaram localmente: antes de declarar pronto, enumere os gates que o CI aplica ao PR (testes, catraca de warnings, formato, contrato) e rode localmente o equivalente barato de cada um — ou diga explicitamente qual não rodou. Catraca de warnings do CI (ex.: warning novo num arquivo tocado pelo diff) reprova build com testes 100% verdes; um `grep` dos arquivos do diff na saída do build (com `--no-incremental`, para não esconder warning por cache) é barato e cobre o caso.
- Recorte de suíte de não-regressão por semelhança de NOME de arquivo não é prova de dependência — é convenção, que vale até o primeiro arquivo que não a seguiu, e o recorte errado produz um relatório "N de N verdes" indistinguível do recorte certo. Derive o recorte do CONTEÚDO (quem importa o módulo, quem invoca o script, quem asserta sobre a saída alterada — se o que mudou foi uma string impressa, busque pelo literal da string antiga, não pelo nome do arquivo). Quando o recorte não puder ser derivado com confiança, rodar a suíte inteira é o preço da prova, não desperdício.
