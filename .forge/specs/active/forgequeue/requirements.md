# Requirements — forgequeue

> Requisitos do change `forgequeue`, derivados da `proposal.md` §2 e do PRD
> `prompts/forgecode-three-changes.md` §3. Cada requisito é verificável por teste ou por comando e
> rastreável à proposal. IDs do change são `REQ-NN`; no `spec-delta.yaml` o mesmo requisito aparece
> como `REQ-FQ-NN` (prefixo da capability `forge-queue` no baseline), mapeamento `REQ-01 ↔ REQ-FQ-01`.

Convenções de verificação usadas nas notas: os testes citados rodam do diretório do pacote
(`packages/cli`, `packages/schema`, `packages/server`), nunca da raiz (guard
`do-not-run-tests-from-root`). "Executa o CLI real" significa `Bun.spawn` sobre
`packages/cli/src/index.ts`, como em `packages/cli/test/debug-paths.test.ts`.

Nomenclatura de comando: o binário instalado do fork é `opencode` (proposal §4, premissa A7), não
`forgecode`. As referências `forgecode queue`/`forgecode sessions` nesta spec denotam os comandos
novos `queue`/`sessions` do CLI (= `opencode queue`/`opencode sessions`); onde um comando real
pré-existente é citado (REQ-15), usa-se o literal `opencode session list`.

## REQ-01 — Enfileirar mensagem para uma sessão por UUID

- **Quando** o operador executa `forgecode queue --thread <sessionID> --message <texto>` com a flag
  habilitada, **o sistema deve** admitir a mensagem na inbox durável da sessão indicada, com
  `delivery` explícito, e retornar assim que a admissão for confirmada.
- **Critérios de aceite:**
  - [ ] a chamada ao servidor é `POST /api/session/{sessionID}/prompt` com `text` igual ao argumento e `delivery: "queue"` quando `--delivery` é omitido (assertado sobre o cliente, `queue-enqueue.test.ts`)
  - [ ] stdout em modo texto é exatamente `Queued message <id> for thread <uuid>` e o processo sai com código 0
  - [ ] com `--json`, stdout é um objeto com as chaves `id`, `sessionID`, `delivery`, `created`, `target` (o nome passado em `--to`, ou `null`), `idempotencyKey` (sempre presente, nunca `null`) e `status` valendo `queued`
  - [ ] o comando não faz nenhuma requisição que observe execução do modelo (`/api/experimental/session/{id}/wait`, `/message`, `/event`) antes de escrever a saída
  - [ ] sessão inexistente (HTTP 404) produz saída de erro `Session <uuid> not found` em stderr, código 1, e nenhuma linha `result: queued` na auditoria
- **Rastreia:** proposal §2.1, §2.9
- **Notas:** a admissão é a mesma rota usada pelo TUI; o change não adiciona endpoint.

## REQ-02 — Resolver destino por nome, apenas na geração atual

- **Quando** o operador usa `--to <nome>`, **o sistema deve** resolver o nome para exatamente uma
  sessão de topo não arquivada do projeto do diretório de trabalho, por igualdade exata de `title`,
  ou falhar sem enfileirar.
- **Critérios de aceite:**
  - [ ] um único candidato ativo com `title === <nome>` resolve para o `id` desse candidato e o enfileiramento usa esse `id`
  - [ ] zero candidatos ativos produz `Session "<nome>" not found in the current generation`, código 1, sem chamada de admissão
  - [ ] dois ou mais candidatos ativos com o mesmo título produzem `Session "<nome>" is ambiguous` seguido dos `id` e `location.directory` de cada candidato, código 1, sem admissão
  - [ ] quando o título existe apenas em sessão arquivada, a saída é `Session "<nome>" belongs to a previous generation (archived): <id>`, código 1, sem admissão
  - [ ] a consulta usa `GET /api/session` com `parentID=null`, `archived=false` e `search=<nome>`, e o caminho de enfileiramento nunca envia o `id` de uma sessão obtida com `archived=true`
  - [ ] a busca segue `cursor.next` enquanto houver página e nenhum candidato de título exato tiver sido encontrado, parando após 10 páginas
  - [ ] atingir o limite de páginas sem candidato produz `too many sessions match "<nome>"` e código 1, nunca `not found`
  - [ ] a consulta de sessões arquivadas usa o mesmo limite de páginas e serve apenas para montar a mensagem de erro
  - [ ] `--thread` e `--to` juntos é erro de uso com código 2 (a mensagem de uso lista os modos como exclusivos)
- **Rastreia:** proposal §2.2, §4 (premissa A1)
- **Notas:** o `search` do servidor é `LIKE %nome%` sobre o título (`packages/core/src/session/store.ts:155`), por isso a comparação exata é feita no cliente. Título é o único nome que o ForgeCode já possui; o Change 3 troca a fonte mantendo este contrato.

## REQ-03 — Corpo da mensagem vindo de arquivo

- **Quando** o operador usa `--message-file <arquivo>`, **o sistema deve** ler o arquivo como UTF-8 e
  enviar o conteúdo literal como `text`, sem interpolação de shell.
- **Critérios de aceite:**
  - [ ] `--message-file` com um arquivo contendo `$(rm -rf /)`, crases e aspas envia exatamente esses bytes como `text`
  - [ ] arquivo inexistente produz `cannot read message file <path>` em stderr, código 1, sem admissão
  - [ ] arquivo vazio ou só com espaços produz `message file is empty` em stderr, código 1, sem admissão
  - [ ] usar `--message` e `--message-file` juntos é erro de uso com código 2 e a mensagem `--message and --message-file are mutually exclusive`
- **Rastreia:** proposal §2.3
- **Notas:** leitura via `Bun.file(path).text()` (AGENTS.md, "Use Bun APIs when possible").

## REQ-04 — Semântica de entrega explícita

- **Quando** o operador escolhe `--delivery`, **o sistema deve** enviar exatamente esse valor na
  admissão, com `queue` como default.
- **Critérios de aceite:**
  - [ ] sem `--delivery`, o payload enviado tem `delivery: "queue"`
  - [ ] `--delivery steer` envia `delivery: "steer"` e a mesma confirmação de enfileiramento
  - [ ] valor fora de `queue|steer` é recusado pelo parser de flags com código 2 e a mensagem de uso lista os valores aceitos
  - [ ] a ajuda do comando documenta que `queue` só é promovido na fronteira de ociosidade e `steer` na próxima fronteira de passo
- **Rastreia:** proposal §2.4
- **Notas:** o comportamento de promoção é do core (`packages/core/src/session/runner/llm.ts`), não deste change.

## REQ-05 — A confirmação prova apenas enfileiramento

- **Quando** o comando retorna sucesso, **o sistema deve** afirmar somente que o item foi admitido —
  nunca que foi lido, entregue ao modelo ou processado.
- **Critérios de aceite:**
  - [ ] o texto de sucesso é a frase fixa de REQ-01 e não contém `delivered`, `read`, `processed` nem `ack`
  - [ ] o objeto JSON de sucesso não tem chave que expresse leitura, entrega ou execução
  - [ ] `forgecode queue --help` cita os modos `--thread`, `--to`, `--all`, `--message`, `--message-file`, `--delivery`, `--json` e `--idempotency-key` (obrigatório nos comandos de escrita)
  - [ ] o comando retorna sem aguardar ociosidade da sessão: nenhuma chamada a `/api/experimental/session/{id}/wait` aparece no teste de enfileiramento
- **Rastreia:** proposal §2.1
- **Notas:** a evidência de atividade é responsabilidade de `queue activity` (REQ-11), não da confirmação.

## REQ-06 — Listar itens da fila com estado derivado

- **Quando** o operador executa `forgecode queue list --thread <uuid>`, **o sistema deve** listar os
  itens conhecidos daquela sessão com o estado derivado de estado durável.
- **Critérios de aceite:**
  - [ ] item presente em `GET /api/session/{id}/inbox` é reportado como `pending`
  - [ ] item ausente da inbox e presente em `GET /api/session/{id}/message/{inboxID}` (HTTP 200) é reportado como `delivered`
  - [ ] item ausente da inbox e com `GET /api/session/{id}/message/{inboxID}` em 404 é reportado como `cancelled`
  - [ ] item que a trilha de auditoria registra e nenhuma das duas provas confirma (erro de transporte) é reportado como `unknown`, nunca como `delivered`
  - [ ] item pendente criado fora do CLI (sem registro de auditoria) aparece na listagem com `target` vazio
  - [ ] a saída em texto tem uma linha por item com `id`, `created` em ISO-8601 UTC, `delivery` e `state`, ordenada do mais recente para o mais antigo; `--json` devolve a mesma coleção
  - [ ] `--limit` (default 100) limita os itens de auditoria considerados e o número de provas de mensagem a no máximo `limit`
- **Rastreia:** proposal §2.5
- **Notas:** não há replay de eventos; o estado vem de inbox + projeção de mensagem, cujo `id` é o mesmo do item de inbox (AGENTS.md, "Session Core").

## REQ-07 — Listar sessões com identidade e estado

- **Quando** o operador executa `forgecode sessions`, **o sistema deve** listar as sessões de topo do
  projeto do diretório de trabalho com `id`, `title`, `provider/model`, `location` e `status`.
- **Critérios de aceite:**
  - [ ] cada linha tem `id` (`sessionID`), `title` (ou `-` quando ausente), `providerID/modelID` (ou `-` quando a sessão não tem modelo), `location.directory` e `status`
  - [ ] `status` é `busy` quando `time.busy` existe e é maior que `time.idle`, `archived` quando a sessão está arquivada e `idle` nos demais casos
  - [ ] por padrão só sessões não arquivadas aparecem; `--all` inclui as arquivadas
  - [ ] `--json` devolve a mesma coleção com as mesmas chaves
  - [ ] a consulta usa `parentID=null` e segue `cursor.next` até esgotar as páginas
- **Rastreia:** proposal §2.7
- **Notas:** `Session.Info` (`packages/schema/src/session.ts:32`) já carrega `model`, `location` e `time.busy/time.idle`; nenhuma superfície de servidor nova.

## REQ-08 — Bloquear auto-envio por padrão

- **Quando** o destino resolvido é a própria sessão que executa o comando, **o sistema deve** recusar
  o enfileiramento, a menos que `--allow-self` seja passado.
- **Critérios de aceite:**
  - [ ] com `OPENCODE_SESSION_ID` igual ao destino, o comando sai com código 1, escreve `Refusing to queue for the calling session <id>; pass --allow-self to override` e não faz chamada de admissão
  - [ ] com `--allow-self`, a mesma invocação enfileira e sai com código 0
  - [ ] sem `OPENCODE_SESSION_ID` definida, nenhum destino é tratado como auto-envio
  - [ ] a mesma regra se aplica a `--all`: a sessão de origem é excluída do broadcast, e `--all --allow-self` a inclui
- **Rastreia:** proposal §2.2, §4 (premissa A5)
- **Notas:** `OPENCODE_SESSION_ID` é injetada pelo tool de shell (`packages/core/src/tool/plugin/shell.ts:203`), então o caminho do agente é coberto sem flag extra.

## REQ-09 — Broadcast validado com falha parcial reportada

- **Quando** o operador usa `--all`, **o sistema deve** validar todos os destinatários antes de
  enfileirar qualquer mensagem e reportar o resultado por destinatário.
- **Critérios de aceite:**
  - [ ] os destinatários são as sessões de topo não arquivadas do projeto do diretório atual, menos a sessão de origem
  - [ ] com zero destinatários o comando sai com código 1 e a mensagem `no targets in the current generation`
  - [ ] a validação (existência e regra de auto-envio) ocorre para todos os destinatários antes da primeira admissão
  - [ ] falha em um destinatário produz código 1 e a saída lista todos os destinatários com `queued` ou `failed`, sem desfazer as admissões já feitas
  - [ ] a auditoria recebe uma linha por destinatário, incluindo as que falharam com `result: failed`
  - [ ] usar `--all` junto de `--thread` ou `--to` é erro de uso com código 2
- **Rastreia:** proposal §2.2, §4 (premissa A6)
- **Notas:** a ordem de enfileiramento é a ordem de `session.list` (mais recente primeiro), e não é garantia de ordem de processamento.

## REQ-10 — Trilha de auditoria append-only, sem segredos

- **Quando** o CLI tenta enfileirar (sucesso ou falha), **o sistema deve** acrescentar uma linha JSON
  ao arquivo de auditoria, sem reescrever linhas existentes.
- **Critérios de aceite:**
  - [ ] cada linha tem `schema_version` (inteiro `1`), `timestamp` (ISO-8601 UTC), `command`, `target` (nome ou `null`), `sessionID`, `messageID` (ou `null` em falha), `delivery`, `idempotencyKey` (sempre presente, nunca `null`), `result` (`queued` ou `failed`) e `error` (ou `null`)
  - [ ] duas tentativas produzem duas linhas e os bytes da primeira linha permanecem idênticos depois da segunda
  - [ ] nenhuma linha contém o texto da mensagem: um arquivo de teste com o marcador `FORGEQUEUE_SENTINEL` não deixa esse marcador no arquivo de auditoria
  - [ ] o arquivo é criado com permissão `0600` e o diretório pai é criado quando ausente
  - [ ] em falha, a linha é gravada com `result: failed`, `messageID: null` e `error` truncado em 200 caracteres
  - [ ] o caminho é `forgequeue/audit.jsonl` sob `Global.Path.data`, e o módulo aceita um diretório injetado para teste
  - [ ] falha ao gravar a linha de auditoria (diretório/arquivo sem escrita) não desfaz nem bloqueia o resultado da admissão: o comando avisa em stderr e prossegue, porque a fonte durável do enfileiramento é `session.inbox.enqueued`, não o JSONL local
- **Rastreia:** proposal §2.8, §4 (premissa A3)
- **Notas:** o campo `uuid` do PRD §3.5.11 é registrado como `sessionID`, o nome que o resto do repositório usa; a trilha não duplica o texto porque a fonte durável do conteúdo é a inbox.

## REQ-11 — Atividade medida, nunca presumida

- **Quando** o operador pergunta pela atividade de uma sessão, **o sistema deve** responder com
  timestamps duráveis e, sob demanda, com o primeiro evento durável que prove a retomada.
- **Critérios de aceite:**
  - [ ] `forgecode queue activity --thread <uuid>` imprime `state`, `lastMessageAt`, `pendingCount`, `outcome` e `observedAt`
  - [ ] `state` é `busy` quando `time.busy` existe e é maior que `time.idle` (ausente conta como 0), `idle` quando `time.idle` existe e não há execução em curso, e `unknown` quando a sessão existe mas não tem nenhum dos dois
  - [ ] `lastMessageAt` vem da mensagem mais recente (`GET /api/session/{id}/message` com `limit=1`, `order=desc`) e é `null` quando não há mensagem
  - [ ] `--watch` assina `GET /api/event` com `types=session.inbox.delivered,session.execution.started,session.execution.succeeded,session.execution.failed`, ignora eventos de outras sessões e termina com código 0 no primeiro evento da sessão alvo, imprimindo `type` e `created`
  - [ ] `--watch` sem evento até `--timeout` (default 60000 ms) termina com código 1 e `no activity within <ms>ms`
  - [ ] o comando não lê texto de mensagem para inferir ociosidade: `state` deriva apenas de `time.busy`/`time.idle`
  - [ ] `--json` devolve as mesmas cinco chaves (`state`, `lastMessageAt`, `pendingCount`, `outcome`, `observedAt`)
- **Rastreia:** proposal §2.6, §4 (premissa A1)
- **Notas:** o feed SSE não reproduz histórico (`packages/server/src/event-feed.ts`), por isso `--watch` observa o futuro e o snapshot observa o passado; nenhum dos dois afirma leitura do modelo.

## REQ-12 — Idempotência obrigatória por chave

- **Quando** o operador executa qualquer comando de escrita (`--thread`, `--to` ou `--all`), **o
  sistema deve** exigir uma chave de idempotência válida e derivar o id do item de forma
  determinística, para que repetição e retry não criem segundo item.
- **Critérios de aceite:**
  - [ ] `queue --thread`, `queue --to` ou `queue --all` sem `--idempotency-key` sai com código 2 e `missing required --idempotency-key` em stderr, sem chamada de admissão e sem linha de auditoria
  - [ ] `queue list`, `queue activity` e `sessions` (leitura) não exigem `--idempotency-key`
  - [ ] a chave precisa casar `^[A-Za-z0-9._-]{1,80}$`; fora disso o comando sai com código 2 e `invalid idempotency key`
  - [ ] o id enviado é `msg_fq_<sha256(sessionID + chave)>` (escopado por sessão; a mesma chave em sessões diferentes não colide) e aparece como `id` na confirmação e no objeto `--json`
  - [ ] duas invocações com a mesma chave e a mesma sessão devolvem o mesmo `id`, e `queue list` mostra um único item
  - [ ] retry após falha de transporte com a mesma chave não cria segundo item: o servidor reconcilia o id e a segunda tentativa devolve o item existente
  - [ ] duas invocações com a mesma chave em sessões diferentes produzem itens distintos
  - [ ] conflito de id reaproveitado com outro tipo de item (HTTP 409) sai com código 1 e `idempotency key <chave> is already used by another item`
- **Rastreia:** proposal §2.4, §4 (premissa A4)
- **Notas:** a garantia de dedupe é do servidor (`packages/core/src/session/inbox.ts`, `promotedFromMessage`); o CLI exige a chave e apenas deriva o id. A obrigatoriedade substitui o "opcional" do PRD §3.6 por decisão humana.

## REQ-13 — Erros claros e comando não bloqueante

- **Quando** o servidor está indisponível ou a admissão falha, **o sistema deve** falhar com mensagem
  acionável, código diferente de zero e sem expor credencial.
- **Critérios de aceite:**
  - [ ] servidor inalcançável produz `cannot reach the ForgeCode server at <url>` em stderr e código 1
  - [ ] resposta 5xx produce código 1 citando o status HTTP recebido
  - [ ] nenhuma mensagem de erro, linha de auditoria ou saída contém o header `Authorization` nem o valor da credencial do serviço (teste com credencial marcadora)
  - [ ] nenhum caminho de erro deixa o processo aguardando: o comando termina após a tentativa de admissão
  - [ ] código 2 é reservado a erro de uso (flag inválida, combinação inválida, chave inválida); código 1 a falha operacional
- **Rastreia:** proposal §2.9
- **Notas:** a credencial é montada por `Service.headers(endpoint)` e nunca é impressa.

## REQ-14 — Feature flag desliga a escrita

- **Quando** `experimental.forgequeue.enabled` não é `true`, **o sistema deve** recusar o caminho de
  escrita do comando e explicar como habilitar.
- **Critérios de aceite:**
  - [ ] sem a chave em nenhum documento de configuração, `forgecode queue --thread ... --message ...` sai com código 1 e `ForgeQueue is disabled; set experimental.forgequeue.enabled to true in opencode.json`
  - [ ] quando mais de um documento define a chave, vale o último documento que a define, na ordem retornada por `GET /api/config`
  - [ ] com `enabled: true`, o enfileiramento prossegue normalmente
  - [ ] `forgecode sessions`, `queue list` e `queue activity` continuam disponíveis com a flag desligada (leitura)
  - [ ] `forgecode queue --help` documenta a chave de configuração
- **Rastreia:** proposal §2.9, §4 (premissa A2)
- **Notas:** a flag é aditiva em `packages/schema/src/config/experimental.ts`; nenhum comportamento existente muda com ela ausente.

## REQ-15 — Preservar o comportamento existente

- **Quando** este change entra, **o sistema deve** manter intactos os contratos que ele apenas consome.
- **Critérios de aceite:**
  - [ ] `POST /api/session/{id}/prompt` sem `delivery` continua admitindo com `steer` (teste de regressão em `packages/server/test`)
  - [ ] as chaves de `opencode session list --format json` não mudam (teste de regressão do CLI)
  - [ ] nenhuma rota nova aparece no OpenAPI do servidor e o diff de `packages/client/src/promise/generated/` se limita ao tipo de `ConfigEntry.experimental`
  - [ ] a suíte existente dos pacotes tocados continua verde
- **Rastreia:** proposal §3
- **Notas:** este é o requisito de compatibilidade §2.1 do PRD.

## Requisitos não funcionais do change

- **NFR-01 — Portabilidade:** nenhum caminho do change executa shell, `security` ou binário externo;
  usa apenas APIs Bun/Node e o cliente HTTP. Medição: `bun test` dos pacotes `cli` e `schema` verde na
  matriz de CI existente (darwin, linux, win32).
- **NFR-02 — Não bloqueante:** o caminho de enfileiramento não faz requisição de espera nem de
  leitura de mensagem: no máximo `location.get`, as páginas de `session.list` necessárias e uma
  admissão por destinatário, sem chamada a `/wait`, `/message` ou `/event`. Medição: contador de
  chamadas no teste de integração (`queue-enqueue.test.ts`), verificando ausência das três rotas e
  uma admissão por destino.
- **NFR-03 — Leitura limitada:** `queue list` examina no máximo `--limit` registros de auditoria e
  executa no máximo `limit` provas de mensagem. Medição: contador de chamadas no teste, com
  `--limit 5` e 20 registros gravados.
- **NFR-04 — Sem segredo em artefato:** auditoria, saída e mensagens de erro nunca contêm o texto da
  mensagem nem a credencial do serviço. Medição: testes de REQ-10 e REQ-13 com marcadores.
- **NFR-05 — Idempotência obrigatória:** nenhuma invocação de escrita alcança o servidor sem chave
  válida, e todo enfileiramento envia id determinístico. Medição: teste sem chave (código 2, zero
  admissões) e teste de retry com a mesma chave (um único item).

## Checklist de cobertura de superfície

| REQ | Parâmetro/config exposto | Superfície (tela/endpoint/CLI) | Coberto por task |
|---|---|---|---|
| REQ-01 | `--thread`, `--message`, `--json` | `forgecode queue --thread --message` | TASK-06, TASK-07 |
| REQ-02 | `--to` | `forgecode queue --to` | TASK-02, TASK-07 |
| REQ-03 | `--message-file` | `forgecode queue --message-file` | TASK-07 |
| REQ-04 | `--delivery` | `forgecode queue --delivery` com valores `queue` e `steer` | TASK-06, TASK-07 |
| REQ-05 | `--json`, `--help` | `forgecode queue --help` | TASK-07, TASK-15 |
| REQ-06 | `--limit`, `--json` | `forgecode queue list` | TASK-08 |
| REQ-07 | `--all`, `--json` | `forgecode sessions` | TASK-10 |
| REQ-08 | `--allow-self` | `forgecode queue --allow-self` | TASK-06 |
| REQ-09 | `--all` | `forgecode queue --all` | TASK-11 |
| REQ-10 | diretório de auditoria | arquivo `forgequeue/audit.jsonl` em `Global.Path.data` | TASK-03 |
| REQ-11 | `--watch`, `--timeout` | `forgecode queue activity` | TASK-09 |
| REQ-12 | `--idempotency-key` (obrigatório nas escritas) | `forgecode queue --idempotency-key` | TASK-06, TASK-07 |
| REQ-13 | sem parâmetro exposto | mensagens de erro das superfícies acima | TASK-07 |
| REQ-14 | `experimental.forgequeue.enabled` | `opencode.json` + `forgecode queue --help` | TASK-01, TASK-04, TASK-07 |
| REQ-15 | sem parâmetro exposto | contratos existentes (`session list`, `session.prompt`) | TASK-13, TASK-14 |

## Superfícies de API e dados

> Seções obrigatórias porque o manifest declara `affects_surfaces: [api]`: o change altera o contrato
> OpenAPI de configuração e consome rotas existentes. Nenhuma rota é criada e nenhum dado novo é
> persistido no servidor.

## Mapa endpoint → ação → recurso → policy

> Declarado porque o change altera o contrato OpenAPI de configuração (`GET /api/config` passa a
> devolver `experimental.forgequeue`) e consome rotas existentes. Nenhuma rota é criada.

| Endpoint | Ação | Recurso | Policy | REQ |
|---|---|---|---|---|
| `POST /api/session/:sessionID/prompt` | write (admitir entrada) | inbox durável da sessão alvo | middleware `Authorization` do servidor com a credencial do serviço; sem authz por dono (instância local de usuário único) | REQ-01, REQ-02, REQ-04, REQ-12 |
| `GET /api/session` | read (listar) | sessões do projeto do diretório atual | idem | REQ-02, REQ-07, REQ-09 |
| `GET /api/session/:sessionID/inbox` | read | inbox pendente da sessão | idem | REQ-06 |
| `GET /api/session/:sessionID/message/:messageID` | read | mensagem projetada da sessão | idem | REQ-06 |
| `GET /api/event` | read (stream SSE) | feed de eventos da instância | idem | REQ-11 |
| `GET /api/config` | read | documentos de configuração do location | idem | REQ-14 |

## Classificação de dados

| Dado/campo | Classificação (pii\|pan\|sensitive\|public) | Mascaramento | Fronteira de tokenização |
|---|---|---|---|
| texto da mensagem enfileirada | sensitive | nunca gravado em auditoria, stdout ou erro; só viaja no corpo da admissão | não tokenizado; a fonte durável é a inbox do servidor |
| `title` da sessão usado como nome de destino | public | gravado em claro somente no campo `target` da auditoria (0600) | não tokenizado |
| `sessionID` e `messageID` | public (identificador opaco) | gravados integrais | não tokenizado |
| credencial do serviço (`Authorization`/basic) | sensitive | nunca impressa, logada ou gravada; montada por `Service.headers` | resolvida fora do change (`packages/client/src/effect/service`) |

## Checklist de sinais OTel por boundary

Sem boundary de serviço novo: o change adiciona um cliente CLI sobre HTTP existente e um campo
aditivo no schema de configuração. A correlação do boundary HTTP já existente está em
`packages/server/src/request-tracing.ts` e não é alterada.

- [x] nenhum span novo é exigido: a operação do CLI é cliente, e o span do handler HTTP já cobre a admissão
- [x] nenhum log estruturado novo no servidor: os eventos duráveis `session.inbox.*` já são o registro correlacionável
- [x] nenhuma métrica de golden signal nova: o caminho reusa as rotas já instrumentadas; a trilha de auditoria do CLI é registro de aplicação, não telemetria

## Mapa de eventos auditáveis

| Mutação | Audit event | Payload (sem PII/PAN crua) | REQ |
|---|---|---|---|
| admissão de entrada na inbox | `session.inbox.enqueued` (durável, existente) | `sessionID`, `inboxID`, `item.type`, `item.delivery` — o payload de item já carrega o texto e não é duplicado na trilha do CLI | REQ-01, REQ-04, REQ-12 |
| entrega do item à sessão | `session.inbox.delivered` (durável, existente) | `sessionID`, `inboxID` | REQ-06, REQ-11 |
| início e fim de execução | `session.execution.started`, `session.execution.succeeded`, `session.execution.failed` (duráveis, existentes) | `sessionID` (e `error` no caso de falha, já redigido pelo core) | REQ-11 |
| tentativa de enfileiramento pelo CLI | `forgequeue.audit` — linha JSONL append-only em `forgequeue/audit.jsonl` | `timestamp`, `command`, `target`, `sessionID`, `messageID`, `delivery`, `idempotencyKey`, `result`, `error` (≤200 caracteres); sem texto de mensagem | REQ-10 |

## Fora de escopo (reafirmação)

- `agent_message_board` compartilhado e qualquer barramento entre processos.
- Confirmação de leitura/ack do modelo e garantia de ordem global entre sessões.
- Substituir o sistema de eventos existente ou adicionar endpoint de fila.
- Registro de gerações/nomes do squad (Change 3) e providers de assinatura (Change 2).
