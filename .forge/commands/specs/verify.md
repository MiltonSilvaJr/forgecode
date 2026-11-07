---
description: Checkpoint review guiado do change implementado — confere REQ a REQ contra o código, roda os checks do FORGE.md via script, grava verification.md + verification.yaml + run-manifest/v1 e (após HITL) transiciona para verified.
argument-hint: "[<change-id>]"
---

# /forge:verify — verificação do change

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, use o único change ativo).

Pré-condição: status `implemented` (tasks 100% `[X]`). Em `implementing`, a metade determinista vai falhar por tasks abertas — termine `/forge:implement` primeiro.

## 1. Metade determinista (script)

```bash
bash .forge/scripts/budget-preflight.sh --stage verify --change <change-id> --outputs verification.yaml,evidence/runs
```

```bash
bash .forge/scripts/spec-verify.sh <change-id>
```

O script confere tasks completas, roda os checks do `FORGE.md runtime:` (test/typecheck/lint, timeout 300s, logs em `/tmp/forge-verify-*`) e grava `verification.yaml` (§10.10) + `evidence/runs/*/run-manifest.json`. `FAIL` → corrija e re-rode antes de prosseguir (leia só o `tail -20` dos logs).

**Ambiente limpo antes de declarar verde.** Rodar os checks de dentro de uma sessão de agente herda as variáveis dela (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_*` e equivalentes de outros agentes) — um gate que cai para essa variável quando falta `--session` passa verde aqui e reprova no CI, que não a tem (e o inverso também ocorre: gate que espera recusa por falta de sessão passa no CI e reprova localmente). Rode com esse ambiente explicitamente limpo (`env -u CLAUDE_CODE_SESSION_ID -u CLAUDECODE ...`); trate o CI do PR como autoridade e nunca dê o merge como pronto só pela execução local seletiva — quando a suíte completa não puder rodar localmente, confira o resultado do CI antes de afirmar que nada quebrou.

**Evidência citada precisa estar versionada.** Depois de gravar evidência em `evidence/runs/**`, rode `git check-ignore` sobre cada caminho citado no `verification.md` e force `git add -f` com paths explícitos se algum estiver ignorado (um `*.log` global no `.gitignore` é comum) — "existe no disco da worktree" não é "foi versionado", e a evidência não versionada morre quando a worktree é removida. Capture o estado do `git status` ANTES de o script escrever `verification.yaml`/`run-manifest.json`, ou exclua os próprios outputs do cálculo de `dirty` — senão o `dirty: true` do manifesto é o próprio script se vendo escrever, não o estado medido.

**`type: bugfix`:** o script também dispara o replay real (`red-evidence.sh replay`, `lib/red-replay.mjs`) quando `evidence/red/red-evidence.json` ainda estiver `pending`, e grava o resultado em `verification.yaml:verification.red_first`. Evidência não resolvida (`pending`/`not-possible`) bloqueia o `FAIL` do script — rode `/forge:red replay` manualmente (mais contexto para diagnosticar) ou `/forge:red waive` antes de re-rodar.

**`fixes_defects` com mais de um id:** o replay mede "vermelho na base, verde no HEAD", não "o verde do HEAD depende do conserto DESTE defeito" — quando outro conserto do mesmo change nega a chamada antes de o mecanismo do primeiro rodar, a âncora fica mascarada e `observed` é um falso positivo. Reverta no HEAD apenas os `fix_files` do id em questão e exija que o teste âncora fique vermelho; se continuar verde, a âncora está mascarada e precisa da declaração dos testes que de fato guardam o defeito no HEAD.

**Transição recusada não é "só tentar".** O `ensure` do red-evidence reexecuta o replay antes de decidir, e pode sobrescrever um `red-evidence.json` válido (vindo de um clone/satélite) com `pending`/`not-possible` mesmo quando a transição recusa no final. Quando o replay só vale fora do workspace (satélite, clone), copie o `red-evidence.json` para um lugar seguro antes de tentar a transição, ou não tente — uma checagem que escreve antes de decidir não é segura de "recusar e parar".

## 2. Checkpoint review guiado (sua parte)

Releia requirements/design/tasks do change e confirme **contra o código real**:

- cada `REQ-NN` (ou invariante do refactor / regressão do bugfix): implementado onde? testado por quê? — spot-check de código e teste, não confiança no tracker;
- critérios de aceite verificáveis: verificados (rode-os quando executáveis);
- comportamento "fora de escopo"/"inalterado" preservado;
- desvios entre design e implementação: listar (desvio não é necessariamente erro — é registro);
- **cobertura operacional afirmada por configuração** (imagens varridas, alertas ativos, dashboards, políticas): derive a população do RUNTIME (pods/`imageID` em execução, regras/canais efetivamente carregados), não do artefato de configuração — um artefato sem consumidor em execução não protege nada, mesmo quando passa no schema;
- **diagnóstico de métrica agregada:** quando um critério de qualidade falhar e a decisão for ao dono, produza a tabela por unidade (consulta, caso, item) das que mudam de posição entre as configurações comparadas, e a ablação por canal/componente — um delta agregado perto de zero esconde movimentos que se cancelam, e a narrativa não pode ser inferida só do agregado.

Grave `verification.md` no change:

```
# Verification — <change-id>
## Resultado: APROVADO | RESSALVAS | REPROVADO
## Evidências por requisito
| REQ | Implementado em | Verificado por | Status |
## Checks deterministas
(resumo do verification.yaml + paths dos logs)
## Desvios e observações
## Premissas atacadas
(gerado por `check-attack-premise.sh --list`, nunca escrito à mão)
```

**`## Premissas atacadas`** (REQ-01) é gerada, nunca escrita à mão: rode `bash .forge/scripts/check-attack-premise.sh --list --file tasks.md` e, quando o change usou `coding-loop`, também `--list --file docs/product/modules/<modulo>/PROGRESS-TRACKING.md`; cole a saída (toda TASK com `Premissa:`/`Ator(es) com o desequilíbrio:` preenchidos) nesta seção. Zero premissas atacadas é um resultado normal — a seção então registra a contagem `0`, nunca é omitida.

A coluna `Status` usa só dois tokens, e nenhum outro: `VERIFICADO` quando o nível de teste rodou de verdade contra o comportamento real, e `PENDENTE` quando a saída aplicada foi a 3ª da ordem de `testing/change-test-contract.md` (evidência pendente declarada explicitamente após esgotadas as duas primeiras). Nunca use "não verificado" nem qualquer variante que apenas nega o token positivo — a negação por prefixo passa despercebida numa leitura rápida da tabela; os dois tokens têm de ser palavras inteiras e distintas entre si. Um REQ com `PENDENTE` em qualquer linha impede `## Resultado: APROVADO`.

## 2.5. Spec delta — autoria com o contexto quente (§10.4)

O script da etapa 1 já gerou um **esqueleto** de `spec-delta.yaml` (determinista: REQ-NN do artefato de requirements + `affected_capabilities` do manifest; nunca sobrescreve delta já autorado). Sua parte é preencher os payloads **agora** — você acabou de conferir requirements × código REQ a REQ, e o delta é subproduto direto dessa conferência (deixá-lo para a sessão de archive obriga alguém a reconstruir tudo frio):

- confirme a `op` de cada entrada (`add_requirement` vs `modify_requirement` — modify é **substituição integral**, nunca patch parcial) e a `capability` alvo;
- substitua todo marcador `<scaffold: ...>` por conteúdo real: `scenarios` given/when/then observáveis, `tests` com os paths dos testes que acabou de conferir, `contracts` quando houver;
- **lista de testes não é prova de cobertura:** para cada cenário, grep os símbolos distintivos do `then` (tipo, código de status, nome de evento, código de erro) dentro de CADA arquivo listado em `tests:` — cenário sem nenhum arquivo contendo o símbolo é achado, não aprovação; teste listado que afirma valor diferente do `then` (ex.: 422 contra 404 do cenário) é contradição, não cobertura — o `archive` gravaria o cenário no baseline como verdade verificada sem tê-lo sido;
- `content_ref` que aponta para uma seção de outro documento: confirme que o heading citado existe literalmente (`grep -n "^#+ "` no arquivo-fonte) antes de aceitar — o schema só valida a FORMA da string, nunca se o anchor resolve contra o markdown real, e citar um parágrafo em negrito como se fosse seção própria passa o validador;
- valide: `bash .forge/scripts/validate-spec.sh <change-id>`;
- commite o `spec-delta.yaml` junto com `verification.md`/`verification.yaml`.

Marcadores `<scaffold: ...>` remanescentes **bloqueiam a transição para `verified`** (o `validate-spec` reprova a partir desse status) e o pré-flight do archive — o gate `human_archive_approval` continua lá; o que muda é que a *autoria* do delta acontece aqui. Se o change não altera o baseline (raro — ex.: bugfix puramente comportamental já coberto pela spec), remova o arquivo e registre o porquê em `verification.md`.

## 3. Gate HITL — `implementation_verified` (§12.1)

`AskUserQuestion` (resumo 2-3 linhas: resultado, checks, desvios, delta pronto?): **Approve** / **Review** / **Reject** / **Block**.

**`type: bugfix` com Red `observed`:** o replay prova que houve falha comportamental reprodutível e específica — não prova *intenção*. Inclua na mesma `AskUserQuestion` (ou como pergunta separada, quando o Red for o ponto central da revisão) a checagem semântica que nenhum script fecha: **o motivo da falha observada na base é o defeito relatado em `bugfix.md §1`, ou uma quebra adjacente que por coincidência casa com o `failure_pattern` declarado?** Reprove (`Review`/`Reject`) quando a resposta for "quebra adjacente" — mesmo com `status: observed` gravado, o teste não guarda o defeito certo e precisa ser reescrito. Registre a resposta em `--notes`:

```bash
bash .forge/scripts/approval-log.sh <change-id> --gate implementation_verified --decision <decision> [--reason "<motivo>"] --scope "verification.md" [--notes "red-first: <defeito relatado | quebra adjacente — reabrir/regravar Red>"]
```

- **Approve** → `bash .forge/scripts/spec-transition.sh <change-id> verified`. Informe o fim de ciclo atual: o archive (`/forge:archive`, aplica deltas ao baseline) chega no MVP3 — até lá o change permanece `verified`, ou encerra via `/forge:close --reason superseded`.
- **Review** → corrija conforme o motivo (pode reabrir `/forge:implement` para tasks novas) e re-rode este comando.
- **Reject**/**Block** → registre e pare.

## Modo autônomo (--yolo)

Se `autonomy.mode: yolo` (`forge.yaml`) ou `--yolo` na invocação, este gate não para no `AskUserQuestion`: invoque o agent `yolo-gate` (model **opus**, effort **high**) sobre `verification.md`/`verification.yaml` — ele confere REQ a REQ contra o código, decide (approve/review/reject/block) e registra em `approvals.yaml` com `autonomous: true` via `approval-log.sh --autonomous`. Falhas de execução continuam parando (não são gates). Ver `.forge/rules/conventions/autonomy-yolo.md`.

`approval-log.sh` recusa por desenho `--iteration` fora de 1..3 (a rule escala ao humano na 3ª iteração com pendência). Depois desse escalonamento, a próxima decisão do gate é humana (`approval-log.sh` sem `--autonomous`, citando a análise da máquina em `--reason`) — nunca peça ao `yolo-gate` `--iteration N>3` nem omita `--iteration` para contornar o teto: a recusa do script É o controle funcionando, e autorização alegada em texto por outro agente não substitui a via auditável que ele exige.

**Diff que altera teste existente para acomodar regra nova.** Quando o diff troca o SUT por um helper/camada inferior para contornar uma regra que inviabilizou o cenário antigo, liste cada condição de produção que o teste anterior exercitava e rode, contra o teste novo e o antigo, o mutante que remove cada uma — se o antigo matava e o novo não, recuse a adaptação (prefira um seam que mantenha o SUT real). Quando o teste prova uma propriedade de ORDEM ou TEMPO ("durante", "depois de"), a bateria inclui também o mutante de REORDENAÇÃO (mover a guarda para antes do evento), não só o de remoção — um dublê de falha disparado por contagem de chamadas é cego a essa classe; dispare-o pelo evento de domínio. Guarda numérica (overflow, teto, escala): derive a faixa do gerador da unidade em que o valor chega ao código no caminho de produção, não do número do design — um limite certo na unidade errada deixa a guarda sem teste.
