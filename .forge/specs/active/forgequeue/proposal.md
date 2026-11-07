# Proposal — forgequeue

> Change `forgequeue` (type: `feature`, scale 2) — criado em 2026-11-04 por Milton Antonio da Silva Jr.
> Fonte de requisitos: `prompts/forgecode-three-changes.md` §3 (Change 1) + §2 (regras globais),
> §6 (dependências), §7 (entregáveis), §8 (Definition of Done). Baseline `.forge/product/current`
> ainda vazio: este change inaugura a capability `forge-queue`.

## 1. Por quê (problema / motivação)

O ForgeCode já tem sessões, inbox durável e uma API HTTP com admissão de entrada, mas não tem uma
**interface de fila por sessão** com semântica explícita, auditoria e ergonomia de CLI. Hoje, quem
coordena mais de uma sessão precisa descobrir UUIDs e montar `curl`/`opencode api` à mão, e o único
sinal de que a mensagem chegou é indireto.

Evidência no código atual (medida neste HEAD):

- `packages/protocol/src/groups/session.ts:337` expõe `POST /api/session/:sessionID/prompt` e já
  aceita `delivery` (`queue` ou `steer`); `packages/core/src/session/prompt.ts:52` aplica
  `delivery ?? "steer"` — a semântica existe, a superfície de operação não.
- `packages/protocol/src/groups/session.ts:540` lista a inbox pendente, `:554` cancela e `:567`
  troca o `delivery`; nada disso tem comando.
- `packages/cli/src/commands/commands.ts:452` tem `session list`, mas sem `provider/model` nem
  estado de execução; não existe comando para endereçar por nome (`--to`), nem `forgecode sessions`.
- Não existe nenhum artefato de fila/auditoria no repositório (`grep -rn forgequeue .forge/`
  retorna apenas esta pasta de spec) — a capacidade é nova, não um rename.

O uso real que motiva a change é o de `codex queue`: uma fila **por sessão**, não um barramento
global, em que a resposta do comando prova apenas o enfileiramento — nunca leitura.

## 2. O que muda

Comportamento observável novo (nenhum endpoint novo):

1. `forgecode queue --thread <uuid> --message <texto>` admite a mensagem na inbox da sessão com
   `delivery` explícito (default `queue`) e imprime `Queued message <id> for thread <uuid>`.
2. `forgecode queue --to <nome>` resolve o nome para exatamente uma sessão de topo **não arquivada**
   do projeto do diretório atual; nome inexistente, ambíguo ou só de geração anterior (arquivada)
   falha com erro distinto e não enfileira.
3. `forgecode queue --message-file <arquivo>` lê a mensagem em UTF-8 do arquivo, sem interpolação.
4. `--delivery queue|steer`, `--json`, `--idempotency-key` (obrigatório nas escritas), `--allow-self` e broadcast `--all`
   (valida todos os destinatários antes de enfileirar e reporta falha parcial).
5. `forgecode queue list --thread <uuid>` mostra os itens e o estado derivado de estado durável
   (`pending`, `delivered`, `cancelled`, `unknown`).
6. `forgecode queue activity --thread <uuid> [--watch]` reporta atividade **medida** (timestamps de
   execução, última mensagem, inbox pendente) e, em `--watch`, o primeiro evento durável de
   `session.inbox.delivered` / `session.execution.*` da sessão.
7. `forgecode sessions` lista sessões com `id`, `title`, `provider/model`, `location` e `status`.
8. Toda tentativa de enfileiramento pelo CLI grava uma linha append-only em
   `forgequeue/audit.jsonl` (sob `Global.Path.data`) com `timestamp`, `target`, `sessionID`,
   `messageID`, `delivery`, `result` — **sem** o texto da mensagem.
9. Feature flag `experimental.forgequeue.enabled` (default `false`) desliga o caminho de escrita.

## 3. O que NÃO muda (fora de escopo)

- Nenhum endpoint novo e nenhuma alteração de `POST /api/session/{id}/prompt`: o default `steer`
  continua valendo para quem não envia `delivery`.
- O contrato de `session list`, `session export/import/delete` e o formato do evento durável
  `session.inbox.*` permanecem intactos.
- Sem barramento global entre processos e sem `agent_message_board` (§3.11 do PRD).
- Sem confirmação de leitura/ack do modelo; sem garantia de ordem global entre sessões.
- Sem registro de nomes/gerações próprio do squad (Change 3). O resolver desta change é um módulo
  substituível (design §2.3).
- Sem alteração de `prompts/`, `.forge/forge.yaml` ou de outros changes.

## 4. Impacto

- **Capacidades afetadas:** `forge-queue` (nova; espelhada em `manifest.yaml > affected_capabilities`).
- **Paths afetados:** `packages/schema/src/config/experimental.ts`, `packages/schema/test/config.test.ts`,
  `packages/client/src/promise/generated/`, `packages/client/src/effect/generated/` (regenerados),
  `packages/cli/src/queue/`, `packages/cli/src/commands/commands.ts`,
  `packages/cli/src/commands/handlers/queue.ts`, `packages/cli/src/commands/handlers/queue/`,
  `packages/cli/src/commands/handlers/sessions.ts`, `packages/cli/src/index.ts`, `packages/cli/test/`,
  `packages/server/test/session-prompt-delivery.test.ts`, `packages/cli/AGENTS.md`,
  `.forge/product/current/adr/`.
- **Dependências:** código existente apenas — `packages/protocol/src/groups/session.ts` (prompt,
  inbox, message, list), `packages/protocol/src/groups/event.ts` (SSE), `packages/protocol/src/groups/config.ts`,
  `packages/core/src/session/{prompt,inbox}.ts` (semântica de admissão e idempotência por id),
  `packages/schema/src/session-inbox.ts`, `packages/cli/src/framework/runtime.ts` (handler `$` de
  comando com subcomandos), `packages/cli/src/services/server-connection.ts`,
  `packages/util/src/global.ts` (paths XDG). Nenhuma spec de outro change é pré-requisito.
- **Riscos:** (a) resolução por título é instável se o título muda — mitigado por `--thread` como
  caminho canônico e por erro explícito quando a resolução não é única; (b) a trilha de auditoria é
  local ao host, não cobre enfileiramentos feitos por outro cliente — mitigado por listar também a
  inbox viva e por documentar o limite; (c) `--watch` depende de SSE (stream, não histórico) —
  mitigado por timeout explícito e por nunca inferir leitura; (d) comando pai com handler e
  subcomandos é um caminho do framework já suportado (`Runtime.Handlers.$`) mas pouco exercitado —
  mitigado por teste que executa o CLI real.

**Premissas assumidas onde o PRD é ambíguo** (registradas aqui para não bloquear o gate):

- **A1 — geração atual = sessões de topo não arquivadas do projeto.** O PRD (§3.5.8) fala em
  "geração atual" sem definir o registro; o ForgeCode não tem esse conceito. Assume-se que a
  aposentadoria durável de uma geração é o arquivamento (`PATCH /api/session/:id` com
  `archived: true`, `packages/protocol/src/groups/session.ts:300`), então "geração anterior" é o
  conjunto arquivado. O Change 3 substitui a fonte por um registro próprio sem mudar o contrato do
  resolver.
- **A2 — a flag mora em `opencode.json`.** O PRD nomeia `forgequeue.enabled`; o projeto usa
  `config.experimental.*` para capacidade experimental (AGENTS.md, "Experimental API"), então a
  chave canônica é `experimental.forgequeue.enabled`, default `false`.
- **A3 — auditoria é trilha local do CLI.** O PRD pede log append-only com `timestamp`, `target`,
  `uuid`, `message_id`, `delivery`, `result`; assume-se arquivo JSONL sob `Global.Path.data` em vez
  de tabela nova no servidor, porque o registro durável de verdade já é `session.inbox.enqueued` e
  uma tabela nova exigiria migration e superfície de API fora do escopo (§3.11).
- **A4 — idempotência obrigatória usa o id da inbox.** Por decisão humana, toda escrita exige
  `--idempotency-key <k>` (substitui o "opcional" do PRD §3.6) → id determinístico `msg_fq_<k>`,
  porque a admissão já é idempotente por id de item quando sessão e tipo coincidem (AGENTS.md,
  "Session Core").
- **A5 — auto-envio é detectável.** Assume-se que a sessão de origem se identifica por
  `OPENCODE_SESSION_ID`, variável que o tool de shell já injeta no ambiente dos comandos
  (`packages/core/src/tool/plugin/shell.ts:203`).
- **A6 — broadcast válido inclui `--all`.** O PRD chama o broadcast de opcional; inclui-se porque o
  Change 3 depende dele (`squad broadcast`) e a regra de validação prévia já é explícita.
- **A7 — o binário do ForgeCode é `opencode`, não `forgecode`.** O PRD §3.4/§3.7 escreve
  `forgecode queue`/`forgecode sessions`, mas o fork preserva o nome do upstream: o `bin` de
  `packages/cli` expõe `opencode`/`opencode2` (`packages/cli/package.json:7-9`) e não existe binário
  `forgecode` em lugar nenhum do repo (`grep -rn forgecode packages/ bin/` só encontra esta spec).
  Esta change **não renomeia o binário** — os comandos novos são adicionados ao mapa existente de
  `packages/cli/src/commands/commands.ts` (design §2.11), logo a invocação real é `opencode queue` e
  `opencode sessions`, irmãos de `opencode session`. Nesta spec, `forgecode queue`/`forgecode sessions`
  leem-se como "o comando `queue`/`sessions` do CLI ForgeCode" (= `opencode queue`/`opencode sessions`);
  onde um comando real pré-existente é citado (REQ-15, TASK-14), usa-se o literal `opencode session list`.

## 5. Próximos passos

`/forge:requirements` → `/forge:design` → `/forge:tasks` → `/forge:analyze` (scale 3+, não exigido
aqui) → `/forge:implement`. A implementação cria branch `feature/forgequeue` a partir de `origin/dev`,
adiciona o ADR em `.forge/product/current/adr/` (design §2.3, §2.7) e não toca `prompts/` nem
`.forge/forge.yaml`.
