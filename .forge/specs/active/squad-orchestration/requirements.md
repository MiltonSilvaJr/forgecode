# Requirements — squad-orchestration

> Requisitos do change `squad-orchestration`. Cada requisito é verificável e rastreável à proposal.
> Fonte de verdade da maquinária de referência: `/Users/milton/Downloads/payments-orquestracao-multisessao/` (lida em 2026-11-04). Fonte de verdade do produto: código deste repositório nas refs citadas em cada nota.
> IDs `REQ-NN` mapeiam 1:1 para `REQ-SQUAD-NNN` no `spec-delta.yaml` (tabela em `design.md` §7).

## REQ-01 — Flag `squad.enabled` e configuração da camada

- **Quando** o servidor carrega a configuração, **o sistema deve** expor o bloco `squad` tipado, com `enabled` **default `false`**, e recusar toda operação da camada quando a flag estiver desligada.
- **Critérios de aceite:**
  - [ ] Config sem bloco `squad` decodifica `squad.enabled === false`; config com `squad: { enabled: true }` decodifica `true`; chave desconhecida dentro de `squad` gera diagnóstico de configuração, não descarte silencioso.
  - [ ] Com a flag desligada, cada endpoint do grupo `squad` responde `403` com mensagem acionável (`squad.enabled is false`) e cada subcomando CLI encerra com código diferente de zero e a mesma mensagem; nenhuma sessão é criada, nenhuma linha é escrita, nenhum evento é publicado.
  - [ ] Com a flag desligada, `bun run test` das suítes existentes de `core`, `protocol`, `server` e `cli` permanece verde (nenhum caminho novo é exercitado por default).
- **Rastreia:** proposal §2 (item 1, 12), §4
- **Notas:** espelha o padrão vigente de flag por bloco de config lido em `packages/core/src/artifact.ts:266-271` (`Config.latest(entries, "experimental")?.artifacts === true` + `requireEnabled()`). Blocos de config nativos são listados em `packages/core/src/config/normalize.ts:210-226` (`nativeAtomic`); chave fora dessa lista é descartada na normalização, por isso o bloco precisa entrar ali.

## REQ-02 — Registro durável por geração

- **Quando** o operador executa `squad init`, **o sistema deve** criar uma geração com identificador, `run_id`, timestamp e uma entrada por sessão declarada, contendo nome, papel, provider, modelo, variant/effort, `Location`, branch esperada, `session_id` (quando existir), estado e hashes, de forma durável e transacional.
- **Critérios de aceite:**
  - [ ] `squad init` grava a geração e as entradas em uma única transação; falha no meio não deixa geração parcial.
  - [ ] Existe no máximo uma geração com estado `active`: um segundo `init` sem `--replace` falha com `ConflictError` e não altera o registro; um segundo `init` com a mesma `--idempotency-key` é no-op e devolve o mesmo identificador.
  - [ ] `--replace` tem semântica definida: sem geração `active` anterior equivale a `init` normal; com geração `active` anterior, exige `--reason`, aplica **o mesmo predicado de `close`** (REQ-11 — checkpoints íntegros, nenhuma execução ativa fora da sessão que emite o comando, `inbox_pending` zerado) e, na mesma transação, marca a anterior `closed` (sem `squad_transition`) e cria a nova `active`; predicado não satisfeito ⇒ `ConflictError` listando pendências e a anterior permanece `active`. A anterior fechada por `--replace` continua alcançável por `session_id` e registra `closed_by: "replace"`.
  - [ ] Cada entrada tem estado em `{creating, starting, verified, closed, failed}`, e toda transição de estado é registrada com timestamp; estado inválido é rejeitado na escrita, não corrigido em leitura.
  - [ ] `prompt_sha256` é gravado antes da admissão do bootstrap e não muda sem novo `launch`; `checkpoint_sha256` acompanha o checkpoint mais recente e é recalculado na leitura de `close`.
  - [ ] O registro sobrevive a reinício do servidor: após reiniciar o processo sobre o mesmo banco, `squad status` devolve a mesma geração, as mesmas entradas e os mesmos `session_id`.
- **Rastreia:** proposal §2 (itens 1, 6), §4
- **Notas:** estado operacional em banco (não em arquivo versionado) por `conventions/machinery-propagation.md` ("estado de projeto mora no tronco, não na branch"); o registro é estado de execução. Campos do referencial: `state/registry.json` (`run_id`, `sessions[name]{state, provider, model, effort, uuid, rollout, prompt_sha256, verified_at}`) e PRD §5.8.11.

## REQ-03 — Resolução de nome escopada à geração atual

- **Quando** um comando precisa endereçar uma sessão por nome, **o sistema deve** resolver apenas contra a geração `active`, falhando de forma nomeada para nome inexistente, ambíguo ou pertencente a geração anterior, e aceitar UUID explícito para alcançar geração anterior.
- **Critérios de aceite:**
  - [ ] Nome de sessão da geração `closed` não resolve em `send`/`status`/`dispatch`; o erro nomeia a geração onde o nome existe e instrui o uso de `--session-id`.
  - [ ] Dois nomes iguais na mesma geração são rejeitados no `init` (unicidade por geração), de modo que ambiguidade em resolução só pode vir de configuração corrompida — e nesse caso o erro é `ConflictError`, nunca "primeiro que encontrar".
  - [ ] `--session-id <ses_...>` endereça a sessão mesmo quando ela pertence a geração anterior, sem gravá-la na geração atual.
  - [ ] A superfície de endereçamento (rota `:sessionRef` e flags `--to`/`--session-id`) aceita tanto `name` (resolvido só na geração ativa) quanto `session_id` (UUID cru, em qualquer geração); o mesmo vale para `send`/`status`/`launch` por CLI e HTTP.
  - [ ] Resolver nome nunca reescreve `session_id` de geração anterior nem copia entrada entre gerações.
- **Rastreia:** proposal §2 (item 2), §5 (lição 4)
- **Notas:** referência `squad/squad.py:308-323` (`send` resolve só `c['sessions']` da geração) e README "Nome de sessão resolve para a geração atual, não para a anterior". `Session.ID` (`packages/schema/src/session-id.ts`) é o UUID endereçável. A rota usa `:sessionRef` (nome **ou** UUID), não `:sessionName`, para não mentir sobre o que aceita.

## REQ-04 — `squad check` valida sem ler segredo

- **Quando** o operador executa `squad check`, **o sistema deve** produzir um relatório por sessão e por checagem (configuração, provider, modelo, variant, `Location`, branch, presença de credencial), com veredito `ok|warn|fail` e motivo, sem criar sessão e sem ler valor de credencial.
- **Critérios de aceite:**
  - [ ] Modelo ou variant inexistente no catálogo do provider produz `fail` para a sessão, nomeando provider/modelo/variant e a lista de variants disponíveis.
  - [ ] `Location` inexistente, ou branch medida diferente da esperada, produz `fail` com o valor medido e o esperado; branch não medível (diretório não é repositório git) produz `warn` com `unknown`, nunca `ok`.
  - [ ] Presença de credencial é reportada como `present|absent|unknown` por provider; com um valor sentinela exportado no ambiente, a saída de `squad check --json` não contém a sentinela em nenhum campo.
  - [ ] `check` não altera registro, não cria sessão, não enfileira e não grava auditoria de mutação; repetir a execução produz o mesmo relatório (exceto timestamps).
- **Rastreia:** proposal §2 (item 4), §4 (dependência `subscription-auth`)
- **Notas:** modelos/variants via `packages/core/src/model.ts:77-84` (`Model.get`, `Info.variants`); branch via `Vcs.Info.branch` (`packages/schema/src/vcs.ts`). Presença de credencial vem da superfície publicada de `subscription-auth` (`Source.report()`/`auth status`, PRD §4.5.1) e, na ausência dele ou com a flag desligada, cai para presença de provider configurado — nunca para leitura de token.

## REQ-05 — `squad plan` simula sem efeito

- **Quando** o operador executa `squad plan`, **o sistema deve** renderizar exatamente o que `launch` faria — por sessão: provider, modelo, variant, `Location`, branch esperada, `session_id` existente ou "novo", e o `sha256` do prompt de bootstrap — sem criar sessão, sem enfileirar e sem escrever registro ou auditoria.
- **Critérios de aceite:**
  - [ ] Após `squad plan`, o digest canônico do registro (REQ-11) é idêntico ao de antes, a contagem de sessões do servidor é idêntica e não existe linha de auditoria nova.
  - [ ] `plan` lista as sessões na ordem da configuração e marca `adotar` para entrada que já tem `session_id` e `criar` para as demais.
  - [ ] `plan` não falha quando a flag está ligada e o servidor tem zero sessões; falha com a mensagem de REQ-01 quando a flag está desligada.
- **Rastreia:** proposal §2 (item 4)
- **Notas:** referência `squad/squad.py:210-215` (`plan` imprime a linha de comando sem abrir aba). No ForgeCode o "abrir" é `session.create` + admissão de prompt, então `plan` renderiza esses dois efeitos como texto.

## REQ-06 — `squad launch` cria, adota, verifica e reconcilia

- **Quando** o operador executa `squad launch`, **o sistema deve** levar cada sessão da geração a `verified` por evidência durável, gravando o estado antes do efeito e reconciliando em retomada.
- **Critérios de aceite:**
  - [ ] A ordem por sessão é: gravar `creating` com marcador e hash do prompt → criar sessão com o `model` (`provider/model#variant`) e o papel → gravar `starting` com `session_id` e `message_id` do marcador → verificar → gravar `verified`; queda entre quaisquer dois passos deixa estado reconciliável e nunca cria segunda sessão para o mesmo nome.
  - [ ] `verified` exige as quatro evidências: `Session.Info.model` igual ao esperado (provider, modelo e variant), marcador admitido na inbox, `session.inbox.delivered` para o mesmo `message_id` e `session.execution.started` para a sessão **posterior à admissão do marcador**; falta de qualquer uma mantém `starting` e o comando falha nomeando a evidência ausente.
  - [ ] Em adoção (`--adopt`), a sessão adotada grava `adopted_at` e a evidência de execução só conta se o evento for posterior a `adopted_at`; execução antiga anterior à adoção não promove a `verified`.
  - [ ] Retomar `launch` sobre entrada `creating` sem `session_id` cria a sessão; sobre `starting` apenas verifica, reusando o mesmo `message_id` (idempotente); sobre `starting` **após timeout** aceita `--retry` com `--reason` (não exige passar por `failed`); sobre `verified` re-verifica sem efeito; sobre `failed` exige `--retry` explícito com motivo. Quando o problema é provider/modelo (não evidência), a alternativa é `squad session replace` (REQ-23), não `--retry` cego.
  - [ ] `launch --only <nome>` processa só aquele nome e falha se ele não existir na geração ativa.
  - [ ] Timeout de verificação (default 90s, configurável) não apaga registro nem sessão: a entrada fica em `starting` com o motivo e a instrução de reconciliação.
- **Rastreia:** proposal §2 (item 5), §5 (A1, A3)
- **Notas:** `session.create` aceita `model` e `agent` (`packages/protocol/src/groups/session.ts:160-175`); `session.prompt` aceita `id` e `delivery` (`.../session.ts:337-346`); eventos em `packages/schema/src/session-event.ts:214-262`. Referência `squad/squad.py:250-305` (write-ahead de `prompt_sha256` e `state` antes de `terminal.write`) e `:160-185` (verificação de `cwd`, `model_provider`, `model`, `effort`).

## REQ-07 — `squad status` mostra estado e atividade medida

- **Quando** o operador executa `squad status`, **o sistema deve** listar geração ativa (e anterior), por sessão: nome, estado, `session_id`, provider/modelo/variant, `Location`, última atividade medida e veredito de liveness, com `--json`.
- **Critérios de aceite:**
  - [ ] `status` não cria, não enfileira e não altera registro; duas execuções consecutivas sem atividade produzem o mesmo conjunto de linhas.
  - [ ] A coluna de atividade carrega o instante medido e a fonte (`execution` ou `inbox`), nunca uma frase do agente.
  - [ ] Sessão de geração anterior aparece apenas no bloco da geração anterior, com `session_id` e estado `closed`, e não resolve por nome.
  - [ ] `--json` emite documento com `generation`, `sessions[]` e `previous` (ou `null`), consumível sem parsing de texto.
  - [ ] `status` expõe `inbox_pending` por sessão (contagem de itens `enqueued` sem `delivered` correspondente, via a porta `SquadChannel.pending`) e o total por geração; sessão com `inbox_pending > 0` é sinalizada, sem que isso mude o veredito de liveness.
- **Rastreia:** proposal §2 (itens 6, 7), §5 (A4)
- **Notas:** campos de relógio em `packages/schema/src/session.ts:35-49` (`time.busy`, `time.idle`, `time.updated`, `outcome`). Não existe `session.idle` como evento no código atual; o terminal é `session.execution.succeeded|failed|interrupted` — o PRD cita `session.idle` e esta especificação corrige para o evento real.

## REQ-08 — `squad send` enfileira pela ForgeQueue com prova de enfileiramento

- **Quando** o operador executa `squad send --to <nome|session-id> --message-file <arquivo>`, **o sistema deve** enfileirar o texto na sessão de destino pela porta de canal e devolver apenas a prova de enfileiramento.
- **Critérios de aceite:**
  - [ ] A saída contém o `message_id`, o nome, o `session_id`, o `delivery` e o instante; não afirma leitura, processamento ou conclusão.
  - [ ] `--delivery queue` (default) enfileira; `--delivery steer` entrega no próximo limite de passo; valor fora do enum é rejeitado antes de qualquer efeito.
  - [ ] Destino em estado diferente de `verified` é recusado com `ConflictError` nomeando o estado atual e `squad launch`; destino igual à sessão de origem é recusado com `ForbiddenError` salvo `--allow-self`.
  - [ ] Com `--idempotency-key` explícita, duas chamadas com a mesma chave devolvem o mesmo `message_id` e produzem uma única linha de inbox; sem chave, cada chamada é uma mensagem nova (nunca deduplicada por conteúdo).
  - [ ] Texto vem sempre de `--message-file` (UTF-8); não existe caminho que interpole texto de shell; arquivo ausente ou ilegível falha antes de enfileirar.
  - [ ] Servidor indisponível, sessão inexistente ou falha de admissão produzem erro nomeado e nenhuma linha de auditoria de sucesso.
- **Rastreia:** proposal §2 (item 3, 13), §4 (dependência `forgequeue`)
- **Notas:** semântica de inbox em `packages/core/src/session/inbox.ts` (`Delivery`, `Promotable`) e `packages/core/src/session/prompt.ts:52` (`delivery ?? "steer"`); o `squad` fixa default `queue` para mensagem de orquestração. Referência `squad/squad.py:308-323` (retorno `Queued message <id> for thread <uuid>`).

## REQ-09 — `squad broadcast` valida todos antes e reporta falha parcial

- **Quando** o operador executa `squad broadcast --message-file <arquivo>`, **o sistema deve** validar todos os destinatários antes de enfileirar o primeiro e reportar o resultado por destinatário.
- **Critérios de aceite:**
  - [ ] Se qualquer destinatário for inválido (não `verified`, inexistente, igual à origem), **nenhum** enfileiramento acontece e o relatório lista todos os inválidos.
  - [ ] Com todos válidos, o resultado é `accepted`, `rejected` ou `not_attempted` por destinatário, e o comando encerra diferente de zero se ao menos um não foi aceito.
  - [ ] `broadcast` nunca inclui a sessão de origem, mesmo que ela esteja `verified`; `--include-self` explícito é a única exceção.
  - [ ] A ordem de enfileiramento segue a ordem da configuração e é registrada na auditoria por destinatário.
  - [ ] A entrega é **best-effort não-transacional**: após a validação prévia, cada destinatário é enfileirado em ordem; se um enfileiramento falhar no meio (canal indisponível), os já enfileirados **permanecem** (a inbox do core não faz rollback) e o relatório marca o restante `not_attempted` com o motivo, encerrando diferente de zero. A impossibilidade de rollback é documentada (limitação), nunca silenciada.
- **Rastreia:** proposal §2 (item 3)
- **Notas:** referência `squad/squad.py:314-322` ("Valida todos antes da primeira entrega, inclusive em broadcast").

## REQ-10 — Checkpoint durável com seções obrigatórias e hash

- **Quando** o operador executa `squad checkpoint --session <nome> --file <markdown>`, **o sistema deve** validar, normalizar e persistir o checkpoint, com `sha256` do corpo e seções obrigatórias.
- **Critérios de aceite:**
  - [ ] Seções obrigatórias verificadas pelo título exato: `Resultado`, `Fontes`, `Comandos e provas`, `Limites`, `Próximos passos`, `Posse da árvore`; ausência ou seção vazia é rejeitada nomeando a seção.
  - [ ] `sha256` é calculado sobre os bytes UTF-8 do corpo normalizado (quebras `\n`, sem BOM) e gravado com o checkpoint; recomputar sobre o mesmo conteúdo produz o mesmo hash.
  - [ ] Conteúdo com padrão de segredo de alta confiança (chave privada PEM, `Bearer <token>`, `sk-…`, `ghp_…`, `AKIA…`, campo JSON `"token": "…"`) é recusado por padrão com a linha e o tipo detectado; `--allow-secret-like-text` exige `--reason` e grava a decisão na auditoria.
  - [ ] Checkpoint sobrevive a reinício e a fechamento da geração; `--export-dir` grava `<NOME>.md` fora da árvore versionada e o arquivo exportado tem o mesmo hash do persistido.
  - [ ] O histórico de checkpoints é **preservado** (pk `(generation_id, name, sha256)`): um novo checkpoint **não** sobrescreve o anterior; `squad_session.checkpoint_sha256` aponta sempre o mais recente e `checkpoint list` devolve o histórico. Corpo acima de `squad.checkpoint.max_bytes` (default `1 MiB`) é recusado nomeando o limite, medido sobre os bytes UTF-8 normalizados.
- **Rastreia:** proposal §2 (item 7), §4 (A2)
- **Notas:** referência `squad/finalizar-anteriores.py:34-47` (checkpoint mínimo, prova de `task_complete`, hash) e README camada 3. O referencial exigia 300 caracteres; aqui a exigência é seção obrigatória preenchida, que é verificável e não depende de tamanho.

## REQ-11 — `squad close` exige checkpoints e grava comprovante

- **Quando** o operador executa `squad close --generation <id>`, **o sistema deve** encerrar a geração apenas se toda sessão tiver checkpoint íntegro e não houver execução ativa, gravando o comprovante de transição.
- **Critérios de aceite:**
  - [ ] Falta de checkpoint, checkpoint cujo `sha256` gravado não confere com o recálculo sobre o corpo persistido, ou sessão com execução ativa (`SessionExecution.isActive` verdadeiro, ou `time.busy` posterior a `time.idle` sem `outcome` terminal) impedem o fechamento; o erro lista os nomes pendentes e a remediação. **A sessão que emite o `close`** (default: a orquestradora mantida aberta; `--by <name|session_id>` explicita outra) é **excluída do predicado de execução ativa** — dela exige-se apenas checkpoint íntegro — porque durante o comando ela está inevitavelmente `busy`; `closed_by` é gravado no comprovante e na auditoria.
  - [ ] Claim preservado por shutdown (processo morto no meio do turno) mantém a sessão não-quieta até reconciliação por retomada ou interrupção explícita (`interrupt` com motivo `user` libera o claim); `close` recusa enquanto isso, sem auto-liberar o claim.
  - [ ] O comprovante contém `source_generation`, `source_registry_digest`, `closed[name]{session_id, closed_at}`, `checkpoints[name]{sha256}`, `previous_sessions_closed`, `previous_orchestrator_kept_open`, `closed_by` e `created_at`.
  - [ ] `source_registry_digest` é calculado pela fórmula canônica de §2 do design; o exemplo computado `{"generation":"gen-2026-11-04","sessions":[{"name":"ATLAS",...},{"name":"ORQUESTRADORA",...}]}` (JSON exato em `design.md` §2.6) produz `786d7eb4896706ae559887f05468829c12e45eed0763e4cb3ea3bef925e01498`; qualquer divergência reprova o teste.
  - [ ] A sessão da ORQUESTRADORA da geração que fecha é mantida aberta e registrada como `previous_orchestrator_kept_open: true`; nenhuma sessão de origem é encerrada pelo `squad` antes disso.
  - [ ] Fechar geração já `closed` com o mesmo comprovante é no-op; com comprovante divergente é `ConflictError`.
  - [ ] `close` recusa quando existe item `enqueued` sem `delivered` correspondente (`inbox_pending > 0`, REQ-07) para qualquer sessão da geração, salvo `--force --reason <texto>` (que audita a decisão); a pendência é listada por nome.
- **Rastreia:** proposal §2 (item 8)
- **Notas:** referência `squad/finalizar-anteriores.py:19-84` e `squad/transicao.json` (`previous_sessions_closed`, `previous_orchestrator_kept_open`, `target_run_id`, `source_registry_sha256`); validação de amarração em `squad/squad.py:217-247`.

## REQ-12 — `squad transition` amarra geração anterior e nova

- **Quando** o operador executa `squad transition --from <geração>`, **o sistema deve** validar que a geração anterior fechou por inteiro, conferir a amarração do comprovante e vinculá-lo à geração nova.
- **Critérios de aceite:**
  - [ ] Sem comprovante, ou com conjunto de sessões diferente do registro de origem, ou com `sha256` de checkpoint divergente, a transição falha nomeando a divergência e não altera a geração nova.
  - [ ] O comprovante só é aceito se `source_registry_digest` for o digest atual do registro de origem; registro de origem alterado depois do fechamento produz `ConflictError`.
  - [ ] Repetir `transition` para o mesmo par (origem, alvo) é no-op; para alvo diferente é `ConflictError`.
  - [ ] Após transição, a geração nova é a única `active` e a anterior permanece `closed` e alcançável só por `session_id`.
- **Rastreia:** proposal §2 (item 8), §5 (lição 4)
- **Notas:** referência `squad/squad.py:217-247` (`target_run_id`/`source_registry_sha256`, `transition_for(data, bind=True)`).

## REQ-13 — Liveness medida, nunca presumida

- **Quando** `status` ou `liveness` é consultado, **o sistema deve** classificar cada sessão em `working`, `idle`, `stalled`, `presumed_dead` ou `unknown` a partir de evidência durável, do claim de execução e de limiares configuráveis (`squad.liveness.stale_after`, default `60 minutes`; `squad.liveness.dead_after`, default `24 hours`).
- **Critérios de aceite:**
  - [ ] `working` quando há execução em curso — claim de execução preservado (`SessionExecution.isActive` verdadeiro **ou** claim de shutdown não liberado, o mesmo claim que o `close` consulta em §2.6) **ou** `time.busy` posterior a `time.idle` sem `outcome` terminal; `idle` quando não há execução em curso e `agora − última_atividade ≤ stale_after`; `stalled` quando `agora − última_atividade > stale_after`; `unknown` quando não há atividade durável registrada.
  - [ ] `working` **não afirma progresso**: sessão em `working` cujo `time.busy` (ou o instante de início do claim) é anterior a `agora − stale_after` é reportada com `working_stale: true` e o instante da evidência; o veredito primário continua `working`. Um **segundo limiar** (`dead_after`) escala `working_stale` para `presumed_dead` quando a evidência de execução é anterior a `agora − dead_after`, sinalizando a sessão para reconciliação/interrupção explícita — sem auto-liberar o claim. Sessão morta cujo claim persiste não lê `working` para sempre.
  - [ ] `última_atividade = max(time.idle, último terminal de execução, última entrega de inbox)`; **a admissão de inbox (`enqueued`) não participa** (admitir mensagem para um processo morto não o ressuscita) e `time.updated` não participa (renomear não é atividade); a admissão é exposta como campo informativo `sent_at` separado. O veredito carrega `measured_at`, `last_activity`, `source` (`execution` ou `inbox`), `working_stale`, `presumed_dead` e `cause`.
  - [ ] `squad block --waiting human|tool --reason <texto>` (REQ-24) grava evento durável de bloqueio; o liveness reporta `cause` = motivo + `waiting_on` (`human`|`tool`|`claim` ausente), distinguindo "espera de aprovação humana", "ferramenta travada" e "processo morto". Sessão com bloqueio declarado continua `working` (execução em curso) mas carrega a causa; o bloqueio nunca a reclassifica para `idle` por si.
  - [ ] Renomear sessão, mudar título ou escrever metadata atualiza `time.updated` e **não** torna a sessão `idle`: sem evento de execução/inbox novo e sem `time.idle`, o veredito continua `unknown` (nunca executou) ou `stalled` (já executou).
  - [ ] Exemplo computado com `stale_after = 60 min` e `última_atividade = 10:00`: medição às `10:59` ⇒ `idle`; às `11:01` ⇒ `stalled`; sessão sem execução e sem atividade ⇒ `unknown`; `working` com `time.busy` anterior a `agora − dead_after` ⇒ `presumed_dead`.
  - [ ] Nenhum caminho lê mensagem de agente, título de sessão ou metadado arbitrário para decidir liveness; um teste com mensagem "estou viva" e `time.updated` antigo devolve `stalled`.
  - [ ] `stale_after` ou `dead_after` inválido (`0`, negativo, duração malformada, ou `dead_after <= stale_after`) reprova a configuração na carga, não cai em default silencioso.
- **Rastreia:** proposal §2 (item 6), §5 (A4, lição 5)
- **Notas:** eventos reais `session.execution.started|succeeded|failed|interrupted`, `session.inbox.delivered` (`packages/schema/src/session-event.ts:214-262`); relógio em `Session.Info.time`. Referência README "Ociosidade se mede, não se presume" e o comando de `mtime` de rollout — substituído por relógio durável da sessão. O default `60 minutes` difere das "duas horas" do referencial (README "lições") **por decisão registrada**: `stale_after` é configurável e `time.busy`/`time.idle` são evidência mais forte que `mtime`. Limitação conhecida: `working` prova execução em curso, não progresso — sessão bloqueada à espera de aprovação de permissão mantém `time.busy` e é sinalizada por `working_stale`, não por `stalled`.

## REQ-14 — Protocolo de despacho validado

- **Quando** o operador cria um despacho, **o sistema deve** rejeitar item não nominal incompleto, alocar `ORQ-id` único por geração e validar base/head contra o git do dono quando possível.
- **Critérios de aceite:**
  - [ ] Campos obrigatórios: `orq_id`, `scope`, `owner` (nome registrado na geração ativa), `base`, `head`, `dor`, `dod`, `proof`, `exclusions` (lista não vazia), `exigidos` (subconjunto **não vazio** de `{jira, ci, merge, deploy, acceptance}`, default `[ci, merge, acceptance]`), `milestone` (data ou marco); ausência ou vazio reprova nomeando cada campo faltante na mesma resposta.
  - [ ] `ORQ-id` tem o formato `ORQ-<geração>-<NNN>` com sequência monotônica por geração; concorrência não produz id duplicado nem buraco por falha (alocação na mesma transação do insert).
  - [ ] Com git disponível e `base` existente, o despacho grava o OID resolvido e `validation: verified`; `base` inexistente reprova; `head` inexistente mas sintaticamente válido grava `validation: unknown` com o motivo; sem git, ambos ficam `unknown` e o despacho é aceito com aviso explícito.
  - [ ] `proof` deve conter ao menos um item verificável declarado (comando com saída, URL ou caminho de artefato); `proof` apenas adjetival (`ok`, `feito`, `concluído`, `verde`) é recusado nomeando o critério.
  - [ ] Despacho com conteúdo de segredo de alta confiança é recusado pela mesma regra de REQ-10.
  - [ ] `dispatch list --json` devolve os despachos da geração ativa com `orq_id`, dono, base/head, `validation` e estado, sem parsing de texto.
- **Rastreia:** proposal §2 (item 9), §5 (lição 1)
- **Notas:** formato do referencial — README "Protocolo de despacho" e `squad/prompts/ORQUESTRADORA.md` ("ORQ-id, escopo, dono, base/head, DoR, DoD, prova, exclusões e prazo de marco"). Resolução de ref exige extensão do adapter `Git` (`packages/core/src/git.ts:104-170`), que hoje expõe `history.head/branch` mas não `rev-parse --verify <ref>`.

## REQ-15 — Um escritor por árvore

- **Quando** um despacho ou mensagem de despacho é endereçado a uma árvore já possuída por outra sessão, **o sistema deve** recusar o takeover até existir checkpoint do dono atual e liberação explícita.
- **Critérios de aceite:**
  - [ ] A chave de dono é o toplevel da worktree com `writer_scope: worktree` (default) e o diretório comum do repositório com `writer_scope: repository`; a chave é **global** (não escopada por geração): `unique (tree_key) where released_at is null`, com `generation_id` como atributo — uma árvore tem no máximo um dono ativo em qualquer geração.
  - [ ] A posse é **adquirida explicitamente** no `launch` (na verificação da sessão, quando ela tem `Location`/`tree_key`), gravando a primeira linha de posse (`acquired_via: launch`); o primeiro `dispatch` para aquela árvore **confirma** a posse (`acquired_via: dispatch`, se o `launch` não a adquiriu). Sem linha de posse não há como o `dispatch`/`send --dispatch` recusar takeover — a aquisição no `launch` fecha essa lacuna.
  - [ ] `dispatch create --to <nome>` para árvore com dono ativo e diferente falha com `ConflictError` nomeando dono, desde quando e o comando de liberação.
  - [ ] `send --dispatch <orq_id>` aplica a mesma checagem; `send` sem despacho não é bloqueado por posse (mensagem não é atribuição de escrita).
  - [ ] `release --from <dono> --to <novo> --reason <texto>` só conclui com checkpoint do dono atual cujo hash confere; grava `squad_release` na auditoria com autor, motivo e hash do checkpoint.
  - [ ] Duas sessões com `Location` em repositórios distintos (toplevels distintos) podem possuir árvores simultaneamente.
- **Rastreia:** proposal §2 (item 10), §5 (A5, lição 6)
- **Notas:** referência README "Uma árvore, um escritor por vez" e PRD §5.5. `Git.Repository.worktree`/`commonDirectory` (`packages/core/src/git.ts:15-19`) dão as duas chaves sem `startswith` de string.

## REQ-16 — `squad activate` entrega transferência sem liberar execução

- **Quando** o operador executa `squad activate`, **o sistema deve** entregar à ORQUESTRADORA a mensagem de transferência, exigindo geração completa e comprovante de transição vinculado, mantendo a execução produtiva travada.
- **Critérios de aceite:**
  - [ ] `activate` exige todas as sessões em `verified` e comprovante de transição vinculado à geração ativa; caso contrário falha listando o que falta.
  - [ ] A mensagem entregue contém o caminho do registro, a geração, o conjunto de sessões verificadas e a instrução de que apenas bootstrap/continuidade estão autorizados; não contém credencial nem conteúdo de checkpoint.
  - [ ] `activate` não altera `productive` para `true`; a sessão permanece com `productive: false` e o estado é visível em `status`.
  - [ ] Repetir `activate` para a mesma geração é no-op idempotente (mesmo `message_id`); para geração diferente da ativa é `ConflictError`.
- **Rastreia:** proposal §2 (item 8), §3 (não libera execução produtiva)
- **Notas:** referência `squad/squad.py:358-367` (`activate` exige 13 verificadas + `transition_for`, envia `ATIVAR-ORQUESTRADORA.md`) e `squad/prompts/COMUM.md` ("Nesta mensagem eu autorizo apenas bootstrap e leitura de continuidade"). `productive` é metadado auditável: o ForgeCode não tem gate de direitos de execução, e a especificação não finge que tem (registrado em design §2.10).

## REQ-17 — Painel/kanban com evidência por estágio

- **Quando** o operador executa `squad panel build`, **o sistema deve** produzir um documento compatível com o `kanban.json` consumido pelo painel existente, com evidência por estágio e `unknown` explícito.
- **Critérios de aceite:**
  - [ ] O documento contém `versao_schema`, `revisao`, `atualizado_em`, `colunas`, `cards{}` e `fonte{}`, e cada card contém `id`, `titulo`, `coluna`, `agente`, `prioridade`, `refs`, `evidencias` e `estagios`.
  - [ ] `estagios` tem as cinco chaves `jira`, `ci`, `merge`, `deploy`, `acceptance`, cada uma com `status` em `{verified, failed, unknown}`, `evidence` (tipo, referência, instante) ou `null`, e `source`.
  - [ ] Cada card declara `exigidos[]` (subconjunto dos cinco; default `[ci, merge, acceptance]`); card `done` só existe quando todo estágio em `exigidos[]` está `verified`; estágio exigido sem evidência é `unknown`, obriga `progressa: false` e entra em `desconhecido[]`; nenhum card com `desconhecido[]` não vazio tem barra de progresso.
  - [ ] Card sem nenhuma fonte configurada aparece com todos os estágios `unknown` e coluna `backlog`, sem inventar estágio a partir de status de Jira.
  - [ ] `squad panel show` imprime um resumo legível por coluna (contagem de cards por coluna, quais com `progressa: false` e quais em `desconhecido[]`), e `panel build --out <path>` grava o documento e devolve o caminho. Não existe superfície de TUI/app própria: o consumidor é o plugin `painel-kanban` externo + `panel show` + o `kanban.json` (limitação documentada em REQ-20).
  - [ ] `panel build` não escreve em Jira, git, ledger ou sessão: só lê e devolve o documento; `--out` grava o arquivo no caminho pedido.
- **Rastreia:** proposal §2 (item 11, 12), §5 (lição 7)
- **Notas:** formato do consumidor em `priorizacao/build_kanban.py:202-217` (campos `versao_schema`, `revisao`, `colunas`, `cards`, `fonte`) e `:73-87` (card com `evidencias`, `estado_360`, `bloqueio`). Jira via adapter de comando somente leitura (`priorizacao/jira_live.py`).

## REQ-18 — Auditoria append-only sem segredo e sem corpo de mensagem

- **Quando** qualquer mutação da camada ocorre, **o sistema deve** acrescentar uma linha de auditoria imutável, sem corpo de mensagem e sem segredo.
- **Critérios de aceite:**
  - [ ] Cada linha contém `at`, `kind` (`init|launch|send|broadcast|dispatch|checkpoint|close|transition|activate|release`), `generation`, `target` (nome ou "—"), `session_id`, `message_id` (quando houver), `delivery` (quando houver), `result`, `idempotency_key` (quando houver) e `detail` redigido.
  - [ ] Não existe API, comando ou função que altere ou remova linha de auditoria; a única operação exposta é acrescentar e listar.
  - [ ] Para mensagem, a auditoria grava `message_sha256` e `message_id`, nunca o texto; um teste com texto contendo sentinela de segredo encontra a sentinela na inbox de destino e **não** a encontra em `squad_audit`, em `status --json` nem no checkpoint.
  - [ ] `detail` passa por redaction de `Bearer <…>`, `sk-…`, `ghp_…`, `AKIA…`, `"token": "…"` e bloco PEM; o padrão redigido substitui o valor por `[redacted]`.
  - [ ] Resultado de falha também é auditado, com o motivo, sem stack trace e sem caminho absoluto do usuário.
  - [ ] Cada linha grava `actor` (nome ou `session_id` de quem disparou a mutação) e `prev_hash` (sha256 da linha anterior da mesma cadeia); o export (`squad audit export --since <iso> --out <path>`) grava as linhas e devolve o digest da cadeia, permitindo verificação de integridade por terceiro.
  - [ ] A cadeia (`prev_hash`) não é recomputável retroativamente sem quebrar os hashes subsequentes; um teste que adultera uma linha intermediária reprova o digest devolvido pelo export.
- **Rastreia:** proposal §2 (item 13), §4 (sem segredos)
- **Notas:** referência `squad/squad.py:319-321` (append em `messages.jsonl` com `at`, `target`, `uuid`, `message`, `result`); aqui o corpo sai e entra o hash. Rule `architecture/security-and-secrets.md` e `conventions/no-hardcoded-secrets.md`.

## REQ-19 — Integração por contrato com ForgeQueue e SubscriptionAuth

- **Quando** a camada precisa enfileirar ou verificar credencial, **o sistema deve** isolar o acoplamento em adapters e usar a primitiva real de cada fronteira — a inbox do core para o canal e a superfície de relatório/status do `subscription-auth` para a credencial — sem duplicar a implementação de nenhum dos dois.
- **Critérios de aceite:**
  - [ ] Existe uma única porta de canal (`SquadChannel`) com `enqueue` e `pending`, cuja implementação chama `Session.prompt(sessionID, text, delivery, id)` (a mesma primitiva que o CLI do `forgequeue` consome, mas **não** um contrato publicado por ele), e uma única porta de credencial (`CredentialPresence`) cuja implementação consome `SubscriptionAuth.Source.report()`/`GET /api/experimental/subscription/status`; nenhum outro módulo do `squad` importa `SessionInbox`, `Session.prompt`, `Credential` ou módulo de `forgequeue`/`subscription-auth` diretamente.
  - [ ] Teste de contrato roda o adapter de canal contra um servidor falso que responde a primitiva de inbox (admissão devolve `message_id`; entrega emite `session.inbox.delivered`); mudança na semântica de `delivery`/idempotência quebra esse teste, não a camada inteira.
  - [ ] `CredentialPresence` devolve `present|absent|unknown` e nunca expõe valor; com o adapter stub devolvendo `absent`, `check` reprova a sessão sem ler nenhum arquivo de credencial; com `subscription_auth.enabled: false`, a porta devolve `unknown` e o `check` cai para presença de provider configurado, nunca para leitura de token.
  - [ ] Nenhum path do change importa módulo de `forgequeue`/`subscription-auth` fora dos dois arquivos de adapter.
- **Rastreia:** proposal §4 (dependências), §5 (A6)
- **Notas:** o `forgequeue` é um CLI (não publica contrato de servidor — ver `forgequeue/design.md` DD-01); a porta de canal liga na primitiva de inbox do core, que é o substrato comum. O `subscription-auth` publica `Source.report()`/`auth status`, não um método `status(providerID)`; o `CredentialPresence` é a projeção `present|absent|unknown` dessa superfície. A fronteira é declarada no design §4.5 com o que cada lado promete.

## REQ-20 — Ajuda, documentação e demonstração sem credencial

- **Quando** o operador consulta `squad --help` ou a documentação do pacote, **o sistema deve** explicar cada subcomando, os efeitos de `plan`/`check` e o que o `squad` não faz, e existir um script de demonstração que roda sem credencial real.
- **Critérios de aceite:**
  - [ ] `squad --help` lista todos os subcomandos implementados e `squad <cmd> --help` mostra flags e defaults; `plan` e `check` aparecem descritos como seguros/sem efeito.
  - [ ] A documentação do pacote cobre: flag e default, contrato de despacho, formato de checkpoint, semântica `queue` vs `steer`, prova de enfileiramento (não de leitura), escopo de liveness (`working`/`idle`/`stalled`/`unknown`/`working_stale`), formato do `kanban.json` (estágios, `exigidos[]`, `unknown`, `progressa`), a ausência de painel próprio (consumo via plugin `painel-kanban` externo + `panel show`) e limites (não aprova, não faz merge/deploy, não libera execução produtiva).
  - [ ] O script de demonstração cria duas sessões com provider falso (fixture injetada, **sem depender de modelo local instalado**), enfileira uma mensagem, mostra o evento de entrega, grava checkpoint e executa transição; roda sem chave de API e sem rede externa.
  - [ ] A demonstração falha de forma legível (não silenciosa) quando o servidor não está disponível.
- **Rastreia:** proposal §2 (item 12), PRD §7 (entregáveis: help, plan, check seguros, script de demonstração)
- **Notas:** doc do pacote afetado; `packages/cli` tem testes de help por `cli([... "--help"])` (`packages/cli/test/debug-paths.test.ts:6-14`).

## REQ-21 — Regressão e desligamento limpo

- **Quando** a flag está desligada ou o change é comparado com `origin/dev`, **o sistema deve** preservar o comportamento existente de fila, autenticação, prompt, inbox e execução.
- **Critérios de aceite:**
  - [ ] Com `squad.enabled: false`, `GET /api/experimental/squad/session` responde `403`; nenhuma rota existente muda de assinatura, status ou payload.
  - [ ] `bun run test` em `packages/core`, `packages/protocol`, `packages/server` e `packages/cli` passa antes e depois do change; os testes de `queue`, `auth`, `session.prompt` e `session.inbox` permanecem verdes sem alteração de expectativa.
  - [ ] `bun run generate` em `packages/client` produz diff apenas aditivo (novo namespace `experimental.squad`), e o teste `packages/protocol/test/experimental-identifiers.test.ts` passa.
  - [ ] Nenhuma alteração de schema existente: a migration é aditiva (novas tabelas) e não reescreve tabela de sessão, inbox ou evento.
- **Rastreia:** proposal §3, §4
- **Notas:** regra de compatibilidade do PRD §2.1; `packages/protocol/test/experimental-identifiers.test.ts` exige que toda rota sob `/api/experimental/` tenha identificador `experimental.*`.

## REQ-22 — `squad dispatch accept` produz o estágio `acceptance`

- **Quando** o dono aceita um despacho, **o sistema deve** gravar `state = accepted`, `accepted_at` e `accepted_by`, produzindo a evidência que alimenta o estágio `acceptance` do painel (REQ-17), sem efeito sobre sessão, git ou credencial.
- **Critérios de aceite:**
  - [ ] `squad dispatch accept --orq <orq_id>` (e `POST /api/experimental/squad/dispatch/:orqId/accept`) só aceita despacho da geração ativa em estado `open`; repetir é no-op idempotente; despacho `done`/`blocked` ou de outra geração é `ConflictError`.
  - [ ] O aceite grava `accepted_at`, `accepted_by` e auditoria (`kind: dispatch_accept`, com `actor` e `prev_hash` de REQ-18); nenhuma sessão é criada, nenhum git é tocado, nenhuma credencial é lida.
  - [ ] O estágio `acceptance` do painel passa a `verified` apenas quando `squad_dispatch.state = accepted` **e** o `head_oid` aceito confere com o do card; sem aceite continua `unknown`.
- **Rastreia:** proposal §2 (item 11), design §2.8/§2.9
- **Notas:** corrige a lacuna de que `acceptance` era inalcançável (nenhuma rota/subcomando produzia `squad_dispatch.state = accepted`) e de que `exigidos[]` era exigido sem coluna em `squad_dispatch` (REQ-14 adiciona `exigidos`).

## REQ-23 — `squad session replace` substitui sessão presa em `starting`

- **Quando** uma sessão fica presa em `starting` por provider/modelo/variant errados (não por evidência ausente), **o sistema deve** permitir `squad session replace --name <X> --provider <p> [--model <m>] [--variant <v>]` criando uma sessão nova que **herda o checkpoint** da anterior, sem duplicar a entrada nem perder histórico.
- **Critérios de aceite:**
  - [ ] `replace` só sobre sessão da geração ativa em estado `starting` (ou `failed`); gera novo `session_id`, herda `checkpoint_sha256`/corpo do checkpoint mais recente e grava `last_error` com o motivo; o `session_id` antigo é mantido no histórico, nunca reescrito.
  - [ ] É a alternativa a `--retry` quando o problema é o provider/modelo (REQ-06); `replace` grava auditoria `kind: session_replace` com `from`/`to` e `reason`.
  - [ ] Uma única entrada por `(generation_id, name)` permanece (não cria segunda sessão para o mesmo nome no registro).
- **Rastreia:** proposal §2 (item 5), design §2.5
- **Notas:** fechado junto com `--retry` a partir de `starting` (REQ-06) para eliminar a sessão presa em `starting` sem saída.

## REQ-24 — `squad block` declara causa de bloqueio

- **Quando** o operador quer declarar por que uma sessão em `working` está parada, **o sistema deve** gravar `squad block --waiting human|tool --reason <texto>` como evento durável, alimentando o `cause` do liveness (REQ-13).
- **Critérios de aceite:**
  - [ ] `block` só sobre sessão `verified` da geração ativa; grava autor, `waiting_on` (`human`|`tool`), motivo e instante; repetir com o mesmo motivo é no-op idempotente; `--clear` remove o bloqueio declarado.
  - [ ] O liveness reporta `cause` = motivo + `waiting_on`, distinguindo espera humana de ferramenta travada; `block` nunca muda `working` → `idle` nem auto-libera claim.
  - [ ] Auditoria `kind: block` (e `block_clear`), sem corpo de mensagem.
- **Rastreia:** proposal §2 (item 6), design §2.7

## REQ-25 — Custo e cota projetados por sessão e geração

- **Quando** o operador consulta `status`, **o sistema deve** projetar `cost` e `tokens` acumulados por sessão e por geração a partir de evidência durável (`Session.Info.cost`/`tokens`, evento `session.usage.recorded`), mantendo `expiresAt` da credencial como aviso, não como gate.
- **Critérios de aceite:**
  - [ ] `status --json` inclui `cost` e `tokens` por sessão (de `Session.Info`) e um total por geração (soma das sessões); `unknown` quando a sessão nunca registrou uso.
  - [ ] O relatório de credencial (`CredentialPresence`) passa a expor `expiresAt` (quando disponível) como campo de **aviso** (`warn` quando expira em até `squad.credential.expiry_warn`, default `7 days`), preservando `present|absent|unknown` como veredito primário — sem reduzir tudo a `present|absent|unknown`.
  - [ ] Nenhum valor de credencial é lido; `cost`/`tokens` vêm de `Session.Info`/evento, nunca de scraping de fatura.
- **Rastreia:** proposal §4 (dependências), design §2.7/§4.5
- **Notas:** o dado já existe (`Session.Info.cost`/`tokens`, `packages/schema/src/session.ts:42-43`; evento `session.usage.recorded`, `packages/schema/src/session-event.ts:161-167`); o change projeta, não coleta.

## Requisitos não funcionais do change

- **NFR-01 — Latência de `status`:** p95 ≤ 2 s para 20 sessões em servidor local. Procedimento: 30 execuções consecutivas de `squad status --json`, descartando as 2 primeiras (warm-up de JIT/pool), ordenando as 28 restantes e tomando o percentil 95 na posição `⌈0.95×28⌉`; a amostra é registrada no `/forge:verify` com `min`, `p50`, `p95`, `max`. `p95` de amostra pequena é **estimativa indicativa**, não garantia estatística — o limiar é sinal, não gate de release.
- **NFR-02 — Zero segredo em artefato:** nenhum documento produzido ou persistido pela camada (registro, checkpoint, despacho, auditoria, `status --json`, `kanban.json`) contém valor de credencial; medido pelo teste de sentinela de REQ-18 e por varredura `grep` das fixtures.
- **NFR-03 — Sem daemon externo:** todo comando funciona com apenas o servidor local do ForgeCode; nenhuma chamada de rede fora de loopback (medido pelo harness `refuseNetwork` de `packages/core/test/lib/effect.ts`).
- **NFR-04 — Idempotência e reconciliação:** repetir qualquer comando mutante com a mesma chave de idempotência deixa o digest canônico do registro idêntico; medido por teste de propriedade sobre 20 estados gerados (execuções distintas, ordem de inserção distinta).
- **NFR-05 — Portabilidade:** nenhum uso de AppleScript, iTerm2, `osascript` ou caminho específico de macOS; caminhos compostos com `path.join`; testes de OS-específico só quando o git exigir, com `describe.skipIf` justificado.
- **NFR-06 — Observabilidade proporcional:** cada operação emite log estruturado com `generation` e `name` (sem corpo de mensagem, sem caminho absoluto), a admissão no canal emite métrica de contagem e latência, e a rota HTTP usa o tracing existente do servidor (`packages/server/src/request-tracing.ts`).

## Checklist de cobertura de superfície

| REQ | Parâmetro/config exposto | Superfície (tela/endpoint/CLI) | Coberto por task |
|---|---|---|---|
| REQ-01 | `squad.enabled`, `squad.state_dir`, `squad.liveness.stale_after`, `squad.liveness.dead_after`, `squad.writer_scope`, `squad.checkpoint.max_bytes`, `squad.credential.expiry_warn`, `squad.panel.*` | config (`opencode.json`) + `squad check` | TASK-01, TASK-10 |
| REQ-02 | `--generation`, `--config`, `--replace`, `--idempotency-key` | `opencode squad init` + `POST /api/experimental/squad/generation` | TASK-06, TASK-08, TASK-09 |
| REQ-03 | `--to`, `--session-id` | `opencode squad send`, `opencode squad status` + `GET /api/experimental/squad/session` | TASK-07, TASK-13, TASK-19 |
| REQ-04 | nenhum parâmetro de mutação; `--json` | `opencode squad check` + `GET /api/experimental/squad/check` | TASK-10 |
| REQ-05 | `--json` | `opencode squad plan` + `GET /api/experimental/squad/plan` | TASK-11 |
| REQ-06 | `--only`, `--retry`, `--adopt`, `--timeout` | `opencode squad launch` + `POST /api/experimental/squad/session/:sessionRef/launch` | TASK-16, TASK-17 |
| REQ-07 | `--json` | `opencode squad status` + `GET /api/experimental/squad/session` | TASK-18, TASK-19 |
| REQ-08 | `--delivery`, `--message-file`, `--idempotency-key`, `--allow-self` | `opencode squad send` + `POST /api/experimental/squad/session/:sessionRef/send` | TASK-12, TASK-13 |
| REQ-09 | `--message-file`, `--include-self` | `opencode squad broadcast` + `POST /api/experimental/squad/broadcast` | TASK-14 |
| REQ-10 | `--file`, `--export-dir`, `--allow-secret-like-text`, `--reason` | `opencode squad checkpoint` + `POST /api/experimental/squad/checkpoint` | TASK-20 |
| REQ-11 | `--generation`, `--by`, `--force`, `--reason` | `opencode squad close` + `POST /api/experimental/squad/generation/:generationID/close` | TASK-21, TASK-39 |
| REQ-12 | `--from` | `opencode squad transition` + `POST /api/experimental/squad/transition` | TASK-22 |
| REQ-13 | `squad.liveness.stale_after`, `squad.liveness.dead_after` | `opencode squad status` + `GET /api/experimental/squad/liveness` | TASK-18, TASK-19, TASK-34 |
| REQ-14 | `--file`, `--to`, `--send`, `--exigidos` | `opencode squad dispatch create` + `POST /api/experimental/squad/dispatch` | TASK-24, TASK-26, TASK-32 |
| REQ-15 | `--from`, `--to`, `--reason`, `squad.writer_scope` | `opencode squad release` + `POST /api/experimental/squad/release` | TASK-25, TASK-26, TASK-38 |
| REQ-16 | nenhum parâmetro de liberação | `opencode squad activate` + `POST /api/experimental/squad/activate` | TASK-23 |
| REQ-17 | `--out`, `squad.panel.jira_command`, `squad.panel.ci_evidence` | `opencode squad panel build` + `GET /api/experimental/squad/panel` | TASK-27, TASK-28, TASK-29 |
| REQ-18 | não expõe parâmetro de escrita; `audit export --since --out` | `GET /api/experimental/squad/audit` (somente leitura) + `opencode squad audit export` | TASK-15, TASK-37 |
| REQ-19 | não expõe parâmetro | interno (adapters) | TASK-12, TASK-10 |
| REQ-20 | `--help` | `opencode squad --help` | TASK-30 |
| REQ-21 | `squad.enabled` | config + todas as superfícies acima | TASK-01, TASK-31 |
| REQ-22 | `--orq` | `opencode squad dispatch accept` + `POST /api/experimental/squad/dispatch/:orqId/accept` | TASK-32 |
| REQ-23 | `--name`, `--provider`, `--model`, `--variant` | `opencode squad session replace` | TASK-33 |
| REQ-24 | `--waiting`, `--reason`, `--clear` | `opencode squad block` + `POST /api/experimental/squad/block` | TASK-35 |
| REQ-25 | `squad.credential.expiry_warn` | `opencode squad status --json` | TASK-36 |

## Superfícies de API e dados

## Mapa endpoint → ação → recurso → policy

| Endpoint | Ação | Recurso | Policy | REQ |
|---|---|---|---|---|
| `POST /api/experimental/squad/generation` | write | geração/registro | middleware `Authorization` + `squad.enabled` | REQ-02 |
| `GET /api/experimental/squad/generation` | read | geração/registro | middleware `Authorization` + `squad.enabled` | REQ-02, REQ-07 |
| `POST /api/experimental/squad/generation/:generationID/close` | write | geração/comprovante | middleware `Authorization` + `squad.enabled` | REQ-11 |
| `POST /api/experimental/squad/transition` | write | comprovante de transição | middleware `Authorization` + `squad.enabled` | REQ-12 |
| `GET /api/experimental/squad/session` | read | registro/liveness | middleware `Authorization` + `squad.enabled` | REQ-03, REQ-07 |
| `POST /api/experimental/squad/session/:sessionRef/launch` | write | sessão/registro | middleware `Authorization` + `squad.enabled` | REQ-06 |
| `POST /api/experimental/squad/session/:sessionRef/send` | write | inbox da sessão | middleware `Authorization` + `squad.enabled` | REQ-08 |
| `POST /api/experimental/squad/session/:sessionRef/replace` | write | sessão/registro | middleware `Authorization` + `squad.enabled` | REQ-23 |
| `POST /api/experimental/squad/broadcast` | write | inbox de N sessões | middleware `Authorization` + `squad.enabled` | REQ-09 |
| `POST /api/experimental/squad/checkpoint` | write | checkpoint | middleware `Authorization` + `squad.enabled` | REQ-10 |
| `POST /api/experimental/squad/dispatch` | write | despacho | middleware `Authorization` + `squad.enabled` | REQ-14 |
| `GET /api/experimental/squad/dispatch` | read | despachos da geração | middleware `Authorization` + `squad.enabled` | REQ-14 |
| `POST /api/experimental/squad/dispatch/:orqId/accept` | write | aceite de despacho | middleware `Authorization` + `squad.enabled` | REQ-22 |
| `POST /api/experimental/squad/block` | write | bloqueio declarado | middleware `Authorization` + `squad.enabled` | REQ-24 |
| `POST /api/experimental/squad/release` | write | dono da árvore | middleware `Authorization` + `squad.enabled` | REQ-15 |
| `POST /api/experimental/squad/activate` | write | transferência de geração | middleware `Authorization` + `squad.enabled` | REQ-16 |
| `GET /api/experimental/squad/panel` | read | card/evidência por estágio | middleware `Authorization` + `squad.enabled` | REQ-17 |
| `GET /api/experimental/squad/liveness` | read | liveness medida | middleware `Authorization` + `squad.enabled` | REQ-13 |
| `GET /api/experimental/squad/audit` | read | trilha de auditoria | middleware `Authorization` + `squad.enabled` | REQ-18 |
| `GET /api/experimental/squad/check` | read | relatório de pré-voo | middleware `Authorization` + `squad.enabled` | REQ-04 |
| `GET /api/experimental/squad/plan` | read (simulação) | plano de abertura | middleware `Authorization` + `squad.enabled` | REQ-05 |

## Classificação de dados

| Dado/campo | Classificação (pii\|pan\|sensitive\|public) | Mascaramento | Fronteira de tokenização |
|---|---|---|---|
| `squad_session.location` (caminho absoluto) | sensitive | ausente de log por default; presente na resposta do dono | não aplicável |
| `squad_session.session_id` | sensitive | não mascarado (identificador operacional); logs só com `name`/`generation` | não aplicável |
| corpo de mensagem de despacho | sensitive | nunca persistido pelo squad; só `sha256` + `message_id` | inbox do ForgeCode |
| corpo de checkpoint | sensitive | não mascarado no artefato do dono; varredura de segredo na escrita | banco do servidor |
| `squad_dispatch` (escopo, prova, exclusões) | sensitive | redaction de padrão de segredo na escrita | banco do servidor |
| credencial de provider | sensitive | nunca lida, nunca persistida, nunca logada | `subscription-auth` |
| `kanban.json` | public (interno) | sem PII; nomes de sessão e estágios | não aplicável |

## Checklist de sinais OTel por boundary

- [ ] CLI → servidor emite **span** (tracing HTTP existente) cobrindo cada chamada `squad`.
- [ ] Serviço `squad` emite **log estruturado** com `generation` e `name` (sem corpo, sem caminho absoluto) correlacionado ao trace.
- [ ] Admissão no canal emite **métrica** de contagem e latência por resultado (`accepted`/`rejected`).

## Mapa de eventos auditáveis

| Mutação | Audit event | Payload (sem PII/PAN crua) | REQ |
|---|---|---|---|
| criação de geração | `squad.init` | `generation`, `sessions_count`, `idempotency_key` | REQ-02 |
| lançamento/verificação | `squad.launch` | `generation`, `name`, `session_id`, `state`, `result` | REQ-06 |
| mensagem enfileirada | `squad.send` | `generation`, `target`, `session_id`, `message_id`, `message_sha256`, `delivery`, `result` | REQ-08 |
| broadcast | `squad.broadcast` | `generation`, `targets[]`, `accepted[]`, `rejected[]` | REQ-09 |
| checkpoint | `squad.checkpoint` | `generation`, `name`, `sha256`, `sections[]` | REQ-10 |
| despacho criado | `squad.dispatch` | `generation`, `orq_id`, `owner`, `base`, `head`, `validation` | REQ-14 |
| liberação de árvore | `squad.release` | `generation`, `from`, `to`, `checkpoint_sha256`, `reason` | REQ-15 |
| fechamento de geração | `squad.close` | `generation`, `closed[]`, `source_registry_digest` | REQ-11 |
| transição | `squad.transition` | `source_generation`, `target_generation`, `source_registry_digest` | REQ-12 |
| ativação | `squad.activate` | `generation`, `target`, `message_id`, `productive` | REQ-16 |
| aceite de despacho | `squad.dispatch_accept` | `generation`, `orq_id`, `accepted_by`, `head_oid` | REQ-22 |
| substituição de sessão | `squad.session_replace` | `generation`, `name`, `from_session_id`, `to_session_id`, `reason` | REQ-23 |
| bloqueio declarado | `squad.block` | `generation`, `name`, `waiting_on`, `reason` | REQ-24 |

## Fora de escopo (reafirmação)

- Reescrever Jira/TWG/ledger ou substituir o plugin `painel-kanban` (proposal §3).
- Barramento global entre processos, `agent_message_board`, confirmação de leitura/ack do modelo.
- Abrir abas/iTerm2, executar CLI de provider, automação de merge/deploy/Terraform.
- Ler, imprimir ou persistir valor de credencial; aprovação humana automática; liberação de execução produtiva.
- Copiar logs/evidências pesadas do referencial.
- Alterar comportamento de `queue`/`auth`/`prompt`/`inbox` com a flag ligada ou desligada.
- `squad session deregister` (remoção de entrada do registro): entrada órfã é encerrada por `close`/`--replace` e permanece auditável — não há comando de remoção nesta camada.
