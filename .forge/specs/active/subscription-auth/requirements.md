# Requirements — subscription-auth

> Requisitos do change `subscription-auth`. Cada requisito é verificável e rastreável à proposal.
> Nenhuma pendência de clarificação permanece: as decisões assumidas estão em `proposal.md` §5 e `design.md` §2/§3.

## REQ-01 — Flag opt-in e desligada por padrão

- **Quando** não houver `subscription_auth` no config (ou `subscription_auth.enabled: false`) **o sistema deve** tratar a capacidade como desligada: não ler sessão nativa, não chamar Keychain, não registrar transporte de assinatura, reportar `enabled: false` e recusar `auth login --source native` com código `subscription_auth_disabled`.
- **Critérios de aceite:**
  - [ ] `Config.Info` decodifica sem `subscription_auth` e com `subscription_auth.enabled` omitido; o valor efetivo lido por `SubscriptionAuth` é `false` nos dois casos.
  - [ ] Com a flag `false`, o resolvedor devolve `state: "disabled"` para os três adapters e a lista de fontes tem `skipped: [{ reason: "subscription_auth_disabled" }]`, sem nenhuma leitura de arquivo de sessão.
  - [ ] `opencode auth status --json` com a flag `false` contém `"enabled": false` e os três adapters com `"state": "disabled"` e sem detalhe de fonte, e sai com código 0.
  - [ ] `opencode auth login kimi-code --source native --accept-tos` com a flag `false` falha com `code: "subscription_auth_disabled"` e a mensagem cita `subscription_auth.enabled`.
  - [ ] `claude-agent` e o login ChatGPT do provider `openai` continuam aparecendo/agindo exatamente como antes da flag (regressão: lista de providers idêntica com a flag `false` e com o config legado).
- **Rastreia:** proposal §2, §3
- **Notas:** a flag governa a camada nova, não o comportamento já entregue por `claude-agent` e `chatgpt`.

## REQ-02 — Contrato de fonte de credencial com relatório sem segredo

- **Quando** um adapter declarar fontes para seu provider, **o sistema deve** expor um contrato `Source` com `kind` (`env`, `store`, `native`, `keychain`, `api_key`), `report()` (presença, janela de validade, rótulo de conta, motivo de indisponibilidade) e `acquire()` (material tipado ou referência externa), e `report()` **nunca** pode devolver o segredo.
- **Critérios de aceite:**
  - [ ] O schema do relatório aceita apenas `{ present, state, expiresAt?, accountLabel?, detail? }`; um objeto com campo `accessToken`, `refreshToken`, `idToken`, `key` ou `code` é rejeitado na decodificação.
  - [ ] `SubscriptionAuth.Source` cobre os cinco `kind` e o `acquire()` devolve `Credential.Value` (`key`|`oauth`|`external`), reutilizando o schema existente em `packages/schema/src/credential.ts`.
  - [ ] Detecção de sessão de arquivo (Codex e Kimi, nunca Claude) lê o documento, valida presença de `access_token`/`refresh_token` e devolve somente `present`, `expiresAt` e `accountLabel`; um teste com token sentinela prova que o valor não aparece em `report()`, `JSON.stringify(report)` nem na mensagem de erro.
  - [ ] `kind: "api_key"` (fallback) é declarado pelo adapter como fonte de menor prioridade, com `acquire()` devolvendo `Credential.Key`.
- **Rastreia:** proposal §2.1
- **Notas:** o PRD chama o contrato de `CredentialSource`; o export é `SubscriptionAuth.Source` para não colidir com o tipo AWS `CredentialSource` já existente em `packages/ai/src/protocols/utils/bedrock-auth.ts:20` (ver `design.md` DD-02). GLM, MiniMax, Grok, DeepSeek e OpenRouter entram por este mesmo contrato, sem alteração no core; este change não os implementa.

## REQ-03 — Prioridade de resolução explícita e observável

- **Quando** mais de uma fonte estiver disponível para um provider, **o sistema deve** resolver na ordem `env` → `store` → `native` → `keychain` → `api_key`, permitir override por `subscription_auth.sources.<provider>` e devolver na resolução a fonte escolhida e o motivo de descarte de cada fonte anterior.
- **Critérios de aceite:**
  - [ ] Com as cinco fontes presentes, a resolução escolhe `env`; removendo uma por vez na ordem acima, a fonte escolhida é a seguinte e a resolução registra `skipped` com `reason` para cada uma das anteriores.
  - [ ] `subscription_auth.sources.<provider>` reordena a resolução exatamente na ordem informada; uma ordem com `kind` desconhecido é rejeitada na decodificação do config com mensagem que lista os `kind` aceitos.
  - [ ] A ordem efetiva é estável entre chamadas e a resolução é memoizada por `integrationID` até `ProviderRefresh.onSwitch`/`Credential.Switched` (teste: duas leituras não produzem duas leituras de arquivo; a troca de credencial invalida).
  - [ ] Fonte presente porém expirada produz `state: "expired"` e continua a busca na fonte seguinte (não aborta a cadeia).
- **Rastreia:** proposal §2.1

## REQ-04 — Adapter `claude-code` sem tocar o token

- **Quando** o usuário consultar/entrar/sair do provider `claude-agent`, **o sistema deve** detectar a sessão do Claude Code apenas por **presença** (`$CLAUDE_CONFIG_DIR/.credentials.json`, chave `oauthAccount` em `~/.claude.json`, item de Keychain `Claude Code-credentials` no macOS via `security find-generic-password -s <serviço>` sem `-w`), sem abrir o conteúdo do arquivo de credenciais, detectar o binário (`claude --version`), delegar o login a `claude auth login --claudeai` e vincular o transporte ao provider `claude-agent` existente.
- **Critérios de aceite:**
  - [ ] Sem `CLAUDE_CONFIG_DIR`, o caminho consultado é `~/.claude/.credentials.json`; com a variável, é `<CLAUDE_CONFIG_DIR>/.credentials.json` (teste com HOME temporário).
  - [ ] Em `darwin`, a detecção de Keychain executa `security find-generic-password -s "Claude Code-credentials"` **sem** `-w`; saída 0 → `present: true`, saída não-zero → `present: false, detail: "keychain_denied|missing"`.
  - [ ] O conteúdo do arquivo de credenciais não é lido: com o arquivo em modo `000` (ilegível) a detecção continua reportando `present: true` por existência e `expiresAt: null`; o relatório nunca contém token (fixture com token sentinela não aparece na saída).
  - [ ] `auth status` do adapter reporta `source: "native"` quando há sessão e `expiresAt: null` para Claude (a validade real é do `claude-agent`), junto do estado de prontidão do provider.
  - [ ] `auth login claude-code` com sessão já presente não executa login e responde `already_authenticated`; sem sessão, executa o comando oficial e, se o binário não existir, falha com `code: "cli_missing"` e a URL de instalação.
  - [ ] O adapter não adiciona header, não chama `api.anthropic.com` e não grava `Credential.OAuth` para Claude (teste: nenhuma credencial criada; transporte resolvido é `provider: "claude-agent"`).
- **Rastreia:** proposal §2.2
- **Notas:** cumpre `specs/v2/claude-agent-provider.md` (“opencode never reads Claude Code's saved login” e “never sits between Claude Code and Anthropic”).

## REQ-05 — Adapter `codex-chatgpt` com fonte nativa declarada como não transferível

- **Quando** o usuário consultar/entrar no provider `openai` pelo modo assinatura, **o sistema deve** detectar a sessão nativa em `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`, `auth_mode: "chatgpt"`, `last_refresh`, conta extraída do `id_token` sem logar o token), oferecer o login gerenciado existente (OAuth ChatGPT com escopo de token sharing) e reportar a fonte nativa como `usable_by_forgecode: false`.
- **Critérios de aceite:**
  - [ ] `CODEX_HOME` definido tem precedência sobre `~/.codex`; ambos ausentes → `present: false`; `auth_mode` diferente de `"chatgpt"` → `state: "incompatible"`.
  - [ ] A conta é extraída da claim `https://api.openai.com/auth.chatgpt_account_id` do `id_token` e aparece como `accountLabel`; o relatório não contém `access_token`, `id_token` nem `refresh_token` (teste com fixture sentinela).
  - [ ] `auth login codex-chatgpt` sem `--source` oferece as duas opções e, em modo não interativo, exige `--source managed|native`.
  - [ ] `--source managed` executa o fluxo OAuth existente e cria credencial `oauth` com `methodID` do método ChatGPT; `--source native` executa o login oficial do Codex e **não grava credencial alguma** — nem `oauth`, nem `key`, nem `external` — para que a presença de conexão não torne o provider `openai` disponível com uma credencial não transferível.
  - [ ] `auth status` mostra `native` como detectado e `usable_by_forgecode: false` com o motivo “a sessão do Codex CLI não é transferível; use --source managed ou a API key”.
- **Rastreia:** proposal §2.2, §3
- **Notas:** o caminho de inferência suportado para ChatGPT é o OAuth gerenciado, que exige o escopo `chatgpt.tokens.use.direct` (`packages/core/src/plugin/provider/chatgpt.ts:170-180`).

## REQ-06 — Adapter `kimi-code` e binding de transporte

- **Quando** o usuário consultar/entrar no provider `kimi-for-coding`, **o sistema deve** detectar a sessão em `$KIMI_SHARE_DIR` (default `~/.kimi-code`): `credentials/kimi-code.json` com `access_token`/`refresh_token` ou referência OAuth legada em `config.toml`, delegar o login a `kimi login` (device flow, expondo URL e código), e vincular o transporte ao provider `kimi-for-coding` sobre `https://api.kimi.com/coding/v1` com `Authorization: Bearer`.
- **Critérios de aceite:**
  - [ ] `KIMI_SHARE_DIR` tem precedência sobre `~/.kimi-code`; credencial com apenas `refresh_token` conta como `present: true` e `state: "refresh_required"`.
  - [ ] O login oficial é executado e a saída é parseada para URL de autorização e código de usuário; nem o código colado nem o token aparecem em log/erro (teste com sentinela).
  - [ ] Com a sessão presente e a flag ligada, `GET /api/provider` inclui `kimi-for-coding` e `GET /api/model` inclui ao menos um modelo do catálogo `kimi-code-plan-global` com `cost` zerado.
  - [ ] `GET /api/provider` do `kimi-for-coding` não contém o token em `settings` nem em `headers` (fixture com sentinela não aparece na resposta); o `Authorization` é aplicado por requisição.
  - [ ] `auth test kimi-code` faz exatamente uma chamada `POST https://api.kimi.com/coding/v1/messages` com `Authorization: Bearer <token>`, `max_tokens <= 8` e timeout de 15 s; um 401 produz `code: "session_expired"` e desabilita o provider na próxima atualização de catálogo.
  - [ ] Sem a sessão **e sem API key de fallback**, `kimi-for-coding` não aparece em `/api/provider` nem em `/api/model`; com fallback por `KIMI_API_KEY` e `subscription_auth.fallback.api_key: true`, aparece usando a chave (REQ-13).
- **Rastreia:** proposal §2.2
- **Notas:** a URL e o esquema Bearer seguem o especial-case já existente em `packages/ai/src/protocols/anthropic-messages.ts:736` e o fixture `packages/ai/test/provider/anthropic-messages.test.ts:1115`; a premissa é validada pela sondagem (REQ-11) antes de expor modelos.

## REQ-07 — `auth status` lista fonte, validade e estado

- **Quando** o usuário executar `opencode auth status [--json] [--provider <id>]`, **o sistema deve** listar cada provider de assinatura com `enabled`, `state`, `source`, `expiresAt`, `accountLabel`, `consent`, `transport` e o motivo do último descarte, sem fazer chamada de rede por padrão.
- **Critérios de aceite:**
  - [ ] `--json` emite um objeto com `enabled` e `providers[]`; cada item contém os oito campos acima (nulos quando desconhecidos) e nenhum campo de segredo.
  - [ ] Em modo texto, cada provider ocupa uma linha com nome, fonte, validade e estado, e a saída não contém `Bearer`, `access_token` nem `refresh_token`.
  - [ ] `--provider <id|alias>` desconhecido falha com `code: "provider_unsupported"` e lista os ids e aliases aceitos.
  - [ ] Sem `--probe`, o comando não executa I/O de rede (teste com servidor HTTP local que falha se receber requisição) e conclui em menos de 2 s com três providers.
  - [ ] `auth list` continua com a saída e o contrato atuais (regressão).
- **Rastreia:** proposal §2.3

## REQ-08 — `auth login` com fonte, alias e consentimento

- **Quando** o usuário executar `opencode auth login <provider>`, **o sistema deve** aceitar os aliases `claude-code`, `codex-chatgpt`, `kimi-code`, resolver a fonte (`managed`/`native`) conforme `--source` ou escolha interativa, exigir aceite de ToS antes de qualquer leitura de sessão e recusar execução não interativa sem `--accept-tos`. O login de assinatura passa por `POST /api/experimental/subscription/:integrationID/login`, que cobra o aceite no servidor antes de delegar ao fluxo oficial já existente (`oauth`, `command` ou `key`, conforme o adapter).
- **Critérios de aceite:**
  - [ ] Os três aliases resolvem para `claude-agent`, `openai` e `kimi-for-coding`; um alias desconhecido falha com `code: "provider_unsupported"`.
  - [ ] Sem consentimento registrado e sem `--accept-tos`, a execução não interativa falha com `code: "consent_required"` antes de qualquer leitura de fonte (teste: nenhuma leitura de arquivo e nenhuma credencial criada).
  - [ ] A rota `POST /api/experimental/subscription/:integrationID/login` recusa (`consent_required`, 400) uma chamada sem `accept: true` mesmo que o CLI não tenha sido usado, e não cria credencial nesse caso.
  - [ ] Com `--accept-tos`, o consentimento é gravado para o provider e a versão do aviso, e a execução prossegue para o fluxo oficial.
  - [ ] `--source native` em provider sem fonte nativa falha com `code: "source_missing"`; `--source managed` em provider sem OAuth gerenciado falha com `code: "transport_unavailable"`.
  - [ ] Com sessão nativa já presente, o login responde `already_authenticated` e não altera arquivo de sessão (mtime e conteúdo inalterados).
- **Rastreia:** proposal §2.3, §2.4

## REQ-09 — `auth logout` remove só o que o ForgeCode gerencia

- **Quando** o usuário executar `opencode auth logout <provider>`, **o sistema deve** remover apenas credenciais criadas pelo ForgeCode e recusar quando a única fonte for nativa, indicando o comando oficial de logout.
- **Critérios de aceite:**
  - [ ] Com credencial gerenciada ativa, o logout remove a credencial e a lista de credenciais do provider fica vazia.
  - [ ] Com apenas fonte nativa, o logout falha com `code: "native_session_not_managed"` e a mensagem cita o comando oficial do provider (`claude auth logout`, `codex logout` ou `kimi logout`).
  - [ ] Arquivos de sessão nativa e itens de Keychain permanecem inalterados: bytes e mtime idênticos antes/depois (teste com fixtures).
  - [ ] `auth export` não exporta token de sessão nativa: como a sessão não vira credencial (DD-01/DD-07), nenhum token, código de device flow ou header aparece no JSON, e o teste procura o sentinela no arquivo exportado.
- **Rastreia:** proposal §2.3

## REQ-10 — `auth refresh` renova ou revalida sem destruir a credencial

- **Quando** o usuário executar `opencode auth refresh <provider>`, **o sistema deve** renovar credencial OAuth gerenciada pelo caminho existente (janela de 5 min, timeout 30 s, lock por credencial), revalidar sessão nativa e, em falha, preservar o valor anterior.
- **Critérios de aceite:**
  - [ ] Credencial OAuth expirada é renovada e o store passa a ter `expires` futuro; a operação devolve `expiresAt`.
  - [ ] Falha do provedor de refresh devolve `code: "refresh_failed"` e a credencial anterior permanece com o valor original (teste com servidor que responde 500).
  - [ ] Sessão nativa expirada devolve `code: "session_expired"` com o comando oficial de login na mensagem, sem tentar renovar por conta própria.
  - [ ] Duas chamadas concorrentes para o mesmo provider produzem uma única renovação (lock compartilhado) e ambas recebem o mesmo `expiresAt`.
- **Rastreia:** proposal §2.3

## REQ-11 — `auth test` faz chamada mínima e reporta sem expor segredo

- **Quando** o usuário executar `opencode auth test <provider> [--model <id>]`, **o sistema deve** executar exatamente uma chamada mínima pelo transporte vinculado, com timeout de 15 s, sem streaming e sem retry, devolvendo `ok`, `latencyMs`, `model` e, em falha, um código acionável.
- **Critérios de aceite:**
  - [ ] Sucesso devolve `ok: true`, `latencyMs >= 0` e o modelo efetivamente usado.
  - [ ] `max_tokens <= 8` (ou equivalente do protocolo), uma única tentativa e timeout de 15 s (teste com servidor que atrasa 16 s → `code: "transport_unavailable"`); para `claude-code` a sondagem é a do provider `claude-agent` (status/probe do CLI), sem prompt e sem header novo.
  - [ ] 401/403 → `session_expired`; 429 → `rate_limited`; erro de rede → `transport_unavailable`; nenhum deles expõe header, corpo cru ou token (sentinela no erro do servidor não aparece na saída).
  - [ ] Com a flag desligada, `auth test` falha com `subscription_auth_disabled` sem abrir conexão.
  - [ ] O resultado é idêntico em `--json` e no modo texto quanto a `ok`, `model` e `latencyMs`.
- **Rastreia:** proposal §2.3

## REQ-12 — Exposição de provider/modelo condicionada a fonte e transporte

- **Quando** o catálogo de providers for montado, **o sistema deve** incluir um provider **introduzido por este change** (hoje `kimi-for-coding`) apenas se `subscription_auth.enabled` for `true`, uma fonte tiver resolvido `ready` e o adapter declarar transporte; providers preexistentes (`claude-agent`, `openai`) seguem a regra atual (REQ-01). A política `provider.use`/`integration.use` continua aplicada depois das transformações de catálogo.
- **Critérios de aceite:**
  - [ ] Flag ligada + sessão presente + transporte declarado → provider e modelos presentes em `/api/provider` e `/api/model`.
  - [ ] Qualquer uma das três condições falsa → provider ausente das duas rotas.
  - [ ] `provider.use: deny` para `kimi-for-coding` remove o provider mesmo com sessão válida e flag ligada.
  - [ ] `POST /api/experimental/subscription/kimi-for-coding/consent` grava consentimento e não altera a lista de providers antes de existir sessão.
  - [ ] Com a flag `false`, `/api/provider` e `/api/model` são idênticos ao baseline (teste de regressão com snapshot).
- **Rastreia:** proposal §2.5

## REQ-13 — Fallback para API key declarado, nunca silencioso

- **Quando** a assinatura estiver indisponível e `subscription_auth.fallback.api_key` for `true` (default), **o sistema deve** resolver a API key e marcar `fallback: "api_key"` com o motivo; com a opção `false`, falhar com `code: "subscription_unavailable"`.
- **Critérios de aceite:**
  - [ ] `fallback.api_key: true` + sessão ausente + `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`KIMI_API_KEY` presente → `state: "ready"`, `source: "api_key"`, `fallback: "api_key"` e `reason` preenchido.
  - [ ] `fallback.api_key: false` + sessão ausente → `code: "subscription_unavailable"` e nenhuma credencial criada.
  - [ ] `auth status` mostra a linha de fallback com o motivo, e `auth test` reporta que usou API key (teste com servidor local).
  - [ ] O fallback nunca ocorre quando a fonte de assinatura falhou por `account_mismatch` (conta incompatível exige ação do usuário).
- **Rastreia:** proposal §2.6

## REQ-14 — Erros acionáveis e redação de segredo

- **Quando** qualquer operação de assinatura falhar, **o sistema deve** devolver um `code` estável de um conjunto fechado e uma mensagem com a próxima ação, redigindo `Authorization`, `x-api-key`, `cookie`, `set-cookie`, `access_token`, `refresh_token`, `id_token`, `code` e `user_code`.
- **Critérios de aceite:**
  - [ ] Cada condição de teste mapeia para exatamente um código: `subscription_auth_disabled`, `provider_unsupported`, `source_missing`, `session_expired`, `refresh_failed`, `cli_missing`, `keychain_denied`, `account_mismatch`, `transport_unavailable`, `consent_required`, `native_session_not_managed`, `subscription_unavailable`, `rate_limited`.
  - [ ] Toda mensagem de erro cita um comando (`opencode auth …`) ou uma URL de instalação; nenhuma termina em “erro desconhecido”.
  - [ ] Um corpo de erro de provider contendo `Bearer abc.def.ghi` e `refresh_token=secret` é persistido/logado sem os valores (teste com sentinela varrendo a saída e o log).
  - [ ] `code` é o mesmo no stdout `--json`, no log e no evento, para a mesma falha.
- **Rastreia:** proposal §2.7

## REQ-15 — Superfície HTTP experimental aditiva e compatível

- **Quando** as rotas novas forem publicadas, **o sistema deve** expô-las em `/api/experimental/subscription/...` com identificadores `experimental.subscription.*`, sem alterar nenhuma rota, tipo ou comportamento existente, e com o client/SDK regenerado.
- **Critérios de aceite:**
  - [ ] `GET /api/experimental/subscription/status`, `POST /api/experimental/subscription/:integrationID/login`, `POST /api/experimental/subscription/:integrationID/consent`, `POST /api/experimental/subscription/:integrationID/refresh` e `POST /api/experimental/subscription/:integrationID/test` respondem 200/204 com os schemas declarados.
  - [ ] `packages/protocol/test/experimental-identifiers.test.ts` passa: todo path sob `/api/experimental/` tem identificador `experimental.*` e vice-versa.
  - [ ] `bun run generate` em `packages/client` produz apenas adições (nenhum arquivo gerado tem remoção) e `client.experimental.subscription.*` existe no SDK gerado.
  - [ ] Rotas existentes (`/api/integration`, `/api/credential`) mantêm contrato: teste de contrato das rotas estáveis inalterado.
  - [ ] `integrationID` desconhecido nas rotas novas responde `provider_unsupported` com 400, não 500.
  - [ ] A política do "Mapa endpoint → ação → recurso → policy" é imposta no handler: `integration.connect: deny` faz `login`/`consent`/`refresh` responderem 403 (não 200/400) e `provider.use: deny` faz `test` responder 403, no mecanismo de `packages/server/src/handlers/integration.ts:31` (teste cobre `deny` e `allow`).
- **Rastreia:** proposal §2.8

## REQ-16 — ToS versionado, documentado e nunca implícito

- **Quando** um provider de assinatura for habilitado pela primeira vez, **o sistema deve** apresentar um aviso de termos de uso versionado, registrar o aceite por provider e versão, e reexibir quando a versão mudar; a documentação publica o aviso e os limites conhecidos.
- **Critérios de aceite:**
  - [ ] O aviso tem identificador de versão e texto que declara o risco de violação de termos e o caminho oficial por API key.
  - [ ] Aceite registrado em KV com `providerID`, `noticeVersion` e `acceptedAt`; `auth status` mostra `consent: "acknowledged"`.
  - [ ] Incremento da versão do aviso faz `auth status` voltar a mostrar `consent: "required"` e `auth login` falhar sem `--accept-tos`.
  - [ ] O documento `specs/v2/subscription-auth.md` contém o aviso, a flag, a ordem de prioridade e as limitações por provider.
  - [ ] Nenhum caminho habilita assinatura sem aceite: a checagem ocorre no servidor, não só no CLI (teste chama a rota de `login`, `consent`, `refresh` e `test` sem aceite quando a fonte é de assinatura e recebe `consent_required` em todas).
- **Rastreia:** proposal §2.4

## Requisitos não funcionais do change (quando houver)

- **NFR-01 —** `opencode auth status` sem `--probe` conclui em ≤ 2 s com os três adapters no pior caso local, sem requisição de rede (medição: teste com servidor HTTP local que falha ao receber conexão + relógio injetado).
- **NFR-02 —** zero segredo em artefato persistido: varredura de `credential`, config, KV de consentimento, log e saída JSON não encontra nenhum sentinela de token (medição: teste com sentinelas + `bash .forge/scripts/check-secrets.sh --path .forge/specs/active/subscription-auth` no gate final).
- **NFR-03 —** com a flag `false`, a camada `subscription-auth` não faz nenhuma leitura fora dos diretórios do próprio ForgeCode no caminho de `auth status`/`/api/provider` — as sondagens preexistentes do `claude-agent` continuam como hoje e são medidas separadamente no teste de regressão (medição: HOME temporário sem `~/.claude`, `~/.codex` e `~/.kimi-code`, com permissões negadas, sem erro novo nem aumento de latência).
- **NFR-04 —** a sondagem (`auth test`) tem timeout de 15 s e no máximo uma tentativa; o refresh gerenciado mantém timeout de 30 s e lock por credencial (medição: testes com relógio/fetch controlados).

## Checklist de cobertura de superfície

| REQ | Parâmetro/config exposto | Superfície (tela/endpoint/CLI) | Coberto por task |
|---|---|---|---|
| REQ-01 | `subscription_auth.enabled` | config `opencode.json`; `opencode auth status` | TASK-01, TASK-15 |
| REQ-03 | `subscription_auth.sources.<provider>` | config `opencode.json` | TASK-01, TASK-03 |
| REQ-07 | filtro `--provider` | `opencode auth status --provider`; `GET /api/experimental/subscription/status` | TASK-12, TASK-15 |
| REQ-08 | `--source`, `--accept-tos` | `opencode auth login <provider>`; `POST /api/experimental/subscription/:integrationID/login` | TASK-13, TASK-18 |
| REQ-09 | alvo do logout | `opencode auth logout <provider>` | TASK-19 |
| REQ-10 | alvo do refresh | `opencode auth refresh <provider>`; `POST /api/experimental/subscription/:integrationID/refresh` | TASK-13, TASK-16 |
| REQ-11 | `--model` | `opencode auth test <provider>`; `POST /api/experimental/subscription/:integrationID/test` | TASK-13, TASK-17 |
| REQ-12 | provider `kimi-for-coding` | catálogo de providers e seletor de modelos (`GET /api/provider`, `GET /api/model`) | TASK-10, TASK-20 |
| REQ-13 | `subscription_auth.fallback.api_key` | config `opencode.json` | TASK-01, TASK-03 |
| REQ-16 | consentimento por provider e versão | `POST /api/experimental/subscription/:integrationID/consent`; `--accept-tos` | TASK-06, TASK-13, TASK-18 |

- Nenhuma linha “N/A” sem justificativa: os REQs sem parâmetro exposto (REQ-02, REQ-04, REQ-05, REQ-06, REQ-14, REQ-15) são contrato/adapter/protocolo e não expõem chave de configuração adicional.

## Superfícies de API e dados

> `manifest.affects_surfaces` inclui `api`; seções abaixo preenchidas.

## Mapa endpoint → ação → recurso → policy

| Endpoint | Ação | Recurso | Policy | REQ |
|---|---|---|---|---|
| `GET /api/experimental/subscription/status` | read | fontes e estado de credencial por integration (metadado local; nenhum segredo) | `integration.use` (`<integrationID>#<conta>`) e `provider.use` para o provider vinculado | REQ-07 |
| `POST /api/experimental/subscription/:integrationID/login` | write | cria credencial gerenciada (`oauth`/`key`) quando a fonte é managed; na fonte nativa apenas valida a sessão, sem gravar credencial; sempre após aceite de ToS | `integration.connect` (`<integrationID>`) e `integration.use` | REQ-08 |
| `POST /api/experimental/subscription/:integrationID/consent` | write | registro de aceite de ToS por provider e versão | `integration.connect` (`<integrationID>`) | REQ-16 |
| `POST /api/experimental/subscription/:integrationID/refresh` | write | credencial OAuth gerenciada ou revalidação de sessão nativa | `integration.connect` + `integration.use` | REQ-10 |
| `POST /api/experimental/subscription/:integrationID/test` | read | chamada mínima ao provider vinculado (consome cota da assinatura) | `provider.use` do provider vinculado; `integration.use` da conta | REQ-11 |

## Classificação de dados

| Dado/campo | Classificação (pii\|pan\|sensitive\|public) | Mascaramento | Fronteira de tokenização |
|---|---|---|---|
| `access_token`, `refresh_token`, `id_token` | sensitive | nunca serializado; `[redacted:token]` em erro/log | lido em memória no momento do uso; nunca persistido pelo ForgeCode |
| `code`, `user_code` de device flow | sensitive | `[redacted:device-code]` | transitório no processo de login |
| `Authorization`, `x-api-key`, `cookie`, `set-cookie` | sensitive | cabeçalho inteiro mascarado | borda HTTP do provider; nunca ecoado |
| `accountLabel` (e-mail/`chatgpt_account_id`) | pii | rótulo visível ao usuário; em log, e-mail mascarado (`a***@dominio`) e id truncado | rótulo derivado do `id_token`, sem persistir o token |
| `expiresAt`, `last_refresh`, `state`, `source` | public | — | metadado de status |
| `path` de sessão nativa (`~/.codex`, `~/.kimi-code`, `~/.claude`) | public | caminho absoluto omitido do `--json` por padrão | configuração local do host |

## Checklist de sinais OTel por boundary

> Boundary novo: as cinco rotas experimentais do servidor local e a sondagem de provider.

- [x] `subscription` emite **span** `subscription.auth.probe` / `subscription.auth.refresh` via `Effect.withSpan`, exportado quando o layer OTLP estiver configurado (`packages/util/src/observability/otlp.ts:73`), no mesmo padrão de `Plugin.load` (`packages/core/src/plugin.ts:89`).
- [x] `subscription` emite **log estruturado** com `integrationID`, `sourceKind`, `outcome` e `code`; o `trace_id`/`span_id` acompanha quando o layer OTLP está ativo (o repositório não instala contexto OTel por padrão).
- [ ] **Métrica** de golden signal: não aplicável neste change — o repositório exporta apenas traces (`packages/util/src/observability/otlp.ts` importa `OTLPTraceExporter` e `BatchSpanProcessor`, sem leitor de métricas), e o servidor é local single-user. A latência da sondagem é reportada em `auth test` (`latencyMs`), que é a medição disponível.

## Mapa de eventos auditáveis

| Mutação | Audit event | Payload (sem PII/PAN crua) | REQ |
|---|---|---|---|
| Aceite de ToS registrado | `subscription.auth.changed` (`action: "consent"`) | `integrationID`, `action`, `noticeVersion` | REQ-16 |
| Login gerenciado cria credencial | `credential.updated` (existente) + `subscription.auth.changed` (`action: "login"`) | `integrationID`, `action`, `sourceKind` | REQ-08 |
| Logout remove credencial gerenciada | `credential.updated` (existente) + `subscription.auth.changed` (`action: "logout"`) | `integrationID`, `action`, `sourceKind` | REQ-09 |
| Refresh renova credencial | `subscription.auth.changed` (`action: "refresh"`) | `integrationID`, `action`, `sourceKind`, `expiresAt` | REQ-10 |
| Sondagem executada | `subscription.auth.changed` (`action: "probe"`) | `integrationID`, `action`, `outcome`, `code` | REQ-11 |

## Fora de escopo (reafirmação)

- Burlar limites de plano ou termos de uso; compartilhar credencial entre usuários, contas ou projetos.
- Ler o login salvo do Claude Code e falar com a Anthropic no lugar dele.
- Reimplementar o endpoint/app-server do Codex CLI; a sessão nativa do Codex não é transferível.
- Implementar GLM, MiniMax, Grok, DeepSeek e OpenRouter neste change.
- Substituir `Integration`/`Credential`, `auth list/export/import/switch` ou o seletor de modelos.
- Guardar, exportar ou migrar token de sessão nativa.
- Habilitar assinatura por padrão ou sem aceite de ToS.
