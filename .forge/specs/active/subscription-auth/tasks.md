# Tasks — subscription-auth

> Tasks do change `subscription-auth`, ordenadas por dependência. Formato de ID: `TASK-NN` (numeração contínua).
> Status: `[ ]` todo · `[-]` em progresso · `[X]` concluída · `[!]` bloqueada (exige intervenção humana).
> Cada task é atômica (commit de vermelho + commit de implementação), rastreável a um REQ/seção do design, e declara o que toca.
> Cada task declara `Teste (comando)` e `Padrão de falha` (e `Setup do teste`, opcional): o Red é provado por execução (`red-evidence.sh task`) e uma task sem os dois campos é marcada `[!]`, não pulada.
> Comandos de teste rodam **do diretório do pacote** (guard `do-not-run-tests-from-root`). `bun` não está disponível no ambiente em que esta spec foi escrita; os comandos são o DoD do implementador, não uma execução registrada aqui.

## Wave 1 — Contrato, config e resolvedor

- [X] TASK-01 — Config `subscription_auth` com flag, ordem de fontes, fallback e versão do aviso (rastreia: REQ-01, REQ-03, REQ-13, design §2.1, design DD-09; paths: `packages/schema/src/config/subscription-auth.ts`, `packages/schema/src/config.ts`, `packages/schema/test/config-subscription-auth.test.ts`; depende: —)
  - Teste (comando): `cd packages/schema && bun test test/config-subscription-auth.test.ts`
  - Padrão de falha: `Expected: false`
  - Setup do teste: nenhum (schema puro)

- [X] TASK-02 — Tipos de superfície: `SubscriptionAuth.Source`, relatório, resolução, erros e evento (rastreia: REQ-02, REQ-14, design §2.1, design DD-02, design DD-08; paths: `packages/schema/src/subscription-auth.ts`, `packages/schema/src/event.ts`, `packages/schema/test/subscription-auth.test.ts`; depende: —)
  - Teste (comando): `cd packages/schema && bun test test/subscription-auth.test.ts`
  - Padrão de falha: `Expected: "native"`
  - Setup do teste: nenhum

- [X] TASK-03 — Serviço `SubscriptionAuth.Resolver` com prioridade, override, memoização e fallback (rastreia: REQ-03, REQ-13, NFR-03, design §2.1, design DD-03, design DD-07; paths: `packages/core/src/subscription.ts`, `packages/core/src/subscription/resolver.ts`, `packages/core/test/subscription-auth/resolver.test.ts`; depende: TASK-01, TASK-02)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/resolver.test.ts`
  - Padrão de falha: `Expected: "env"`
  - Setup do teste: `bun run test` usa HOME temporário via `script/test.ts`

- [X] TASK-04 — Leitores de sessão nativa para Claude, Codex e Kimi e detecção de Keychain sem `-w` (rastreia: REQ-02, REQ-04, REQ-05, REQ-06, design §2.1, design DD-04, design DD-05, design DD-06; paths: `packages/core/src/subscription/native-session.ts`, `packages/core/test/subscription-auth/native-session.test.ts`; depende: TASK-02)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/native-session.test.ts`
  - Padrão de falha: `Expected: true`

- [X] TASK-05 — Redação central de segredo e union de erros com 13 códigos (rastreia: REQ-14, NFR-02, design §2.1, design DD-08; paths: `packages/core/src/subscription/redaction.ts`, `packages/core/test/subscription-auth/redaction.test.ts`; depende: TASK-02)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/redaction.test.ts`
  - Padrão de falha: `Expected: "\[redacted:token\]"`

- [X] TASK-06 — Aviso de ToS versionado e consentimento em KV por provider (rastreia: REQ-16, design §2.1, design DD-10; paths: `packages/core/src/subscription/notice.ts`, `packages/core/src/subscription/consent.ts`, `packages/core/test/subscription-auth/consent.test.ts`; depende: TASK-01)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/consent.test.ts`
  - Padrão de falha: `Expected: "required"`

## Wave 2 — Adapters, provider e plugin host

- [X] TASK-07 — Adapter `claude-code` com detecção por metadado, login delegado e binding `claude-agent` (rastreia: REQ-04, design §2.1, design DD-04; paths: `packages/core/src/subscription/adapters/claude-code.ts`, `packages/core/test/subscription-auth/adapter-claude-code.test.ts`; depende: TASK-03, TASK-04, TASK-05, TASK-06)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/adapter-claude-code.test.ts`
  - Padrão de falha: `Expected: "already_authenticated"`

- [X] TASK-08 — Adapter `codex-chatgpt` com fonte nativa não transferível e login gerenciado (rastreia: REQ-05, design §2.1, design DD-05, design §3; paths: `packages/core/src/subscription/adapters/codex-chatgpt.ts`, `packages/core/test/subscription-auth/adapter-codex-chatgpt.test.ts`; depende: TASK-03, TASK-04, TASK-05, TASK-06)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/adapter-codex-chatgpt.test.ts`
  - Padrão de falha: `Expected: false`

- [X] TASK-09 — Adapter `kimi-code` com sessão em `KIMI_SHARE_DIR`, login device flow e binding `kimi-for-coding` (rastreia: REQ-06, design §2.1, design DD-06; paths: `packages/core/src/subscription/adapters/kimi-code.ts`, `packages/core/test/subscription-auth/adapter-kimi-code.test.ts`; depende: TASK-03, TASK-04, TASK-05, TASK-06)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/adapter-kimi-code.test.ts`
  - Padrão de falha: `Expected: "refresh_required"`

- [X] TASK-10 — Provider `kimi-for-coding` sobre `moonshot/messages`, catálogo do plano e Bearer (rastreia: REQ-06, REQ-12, design §2.1, design DD-06, design DD-13; paths: `packages/core/src/plugin/provider/kimi.ts`, `packages/core/src/plugin/provider.ts`, `packages/core/test/subscription-auth/provider-kimi.test.ts`; depende: TASK-03, TASK-09)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/provider-kimi.test.ts`
  - Padrão de falha: `Expected: "https://api.kimi.com/coding/v1"`

- [X] TASK-11 — Plugin host `subscription-auth`, registro em `internal.ts` e evento `subscription.auth.changed` (rastreia: REQ-02, REQ-14, design §2.1, design DD-08, design DD-13; paths: `packages/core/src/subscription/plugin.ts`, `packages/core/src/plugin/internal.ts`, `packages/core/test/subscription-auth/plugin.test.ts`; depende: TASK-07, TASK-08, TASK-09, TASK-10)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/plugin.test.ts`
  - Padrão de falha: `Expected: "subscription.auth.changed"`

## Wave 3 — Superfícies HTTP e CLI

- [X] TASK-12 — Grupo de protocolo `subscription` com as cinco rotas experimentais (rastreia: REQ-07, REQ-15, design §4, design DD-12; paths: `packages/protocol/src/groups/subscription.ts`, `packages/protocol/src/api.ts`, `packages/protocol/test/subscription-group.test.ts`; depende: TASK-02; expõe: `GET /api/experimental/subscription/status`, `POST /api/experimental/subscription/:integrationID/login`)
  - Teste (comando): `cd packages/protocol && bun test test/subscription-group.test.ts`
  - Padrão de falha: `Expected: "experimental.subscription.status"`

- [X] TASK-13 — Handlers `status`, `login`, `consent`, `refresh` e `test` no servidor (rastreia: REQ-07, REQ-10, REQ-11, REQ-16, NFR-04, design §4, design DD-12, design DD-15; paths: `packages/server/src/handlers/subscription.ts`, `packages/server/src/handlers.ts`, `packages/server/test/subscription.test.ts`; depende: TASK-03, TASK-06, TASK-11, TASK-12; expõe: `POST /api/experimental/subscription/:integrationID/login`, `POST /api/experimental/subscription/:integrationID/consent`, `POST /api/experimental/subscription/:integrationID/refresh`, `POST /api/experimental/subscription/:integrationID/test`)
  - Teste (comando): `cd packages/server && bun test test/subscription.test.ts`
  - Padrão de falha: `Expected: "session_expired"`
  - Nota: os handlers emitem span `subscription.auth.probe`/`subscription.auth.refresh` via `Effect.withSpan` e log estruturado com `integrationID`, `sourceKind`, `outcome` e `code` (checklist OTel de `requirements.md`). A política do "Mapa endpoint → ação → recurso → policy" é imposta aqui via `ManagedPolicy.match`/`decision` (`integration.connect` para login/consent/refresh, `integration.use` para status/refresh, `provider.use` no test), no mecanismo de `packages/server/src/handlers/integration.ts:31`; o teste cobre `integration.connect: deny` → 403 em login/consent/refresh e `provider.use: deny` → 403 em test.
  - Red: `OK task` após reescrever o commit de vermelho (closures `() => Effect` no lugar dos valores `Effect`) e rebasear os 3 descendentes locais. Prova: red `3f479f6053`, green `5b72b6a9ce`, `--setup-command "HUSKY=0 bun install --frozen-lockfile"`; a falha no vermelho é a asserção `Expected: "session_expired"` (não 500). A árvore final é idêntica à anterior (`git diff` vazio contra o backup).

- [X] TASK-14 — Regenerar client/SDK e validar identificadores experimentais (rastreia: REQ-15, design §4, design DD-12; paths: `packages/client/src`, `packages/protocol/test/experimental-identifiers.test.ts`; depende: TASK-12, TASK-13)
  - Teste (comando): `cd packages/protocol && bun test test/experimental-identifiers.test.ts`
  - Padrão de falha: `Expected: \[\]`
  - Setup do teste: `cd packages/client && bun run generate`
  - Nota: task de geração, não de comportamento — não há par vermelho/verde próprio; a asserção é o teste de identificadores já existente mais o `git diff --stat` mostrando apenas adições em `packages/client/src`.

- [X] TASK-15 — CLI `auth status` com texto, `--json`, `--provider` e saída offline (rastreia: REQ-07, REQ-01, NFR-01, design §4, design DD-11; paths: `packages/cli/src/commands/commands.ts`, `packages/cli/src/index.ts`, `packages/cli/src/commands/handlers/auth/status.ts`, `packages/cli/test/auth-status.test.ts`; depende: TASK-14)
  - Teste (comando): `cd packages/cli && bun test --timeout 30000 test/auth-status.test.ts`
  - Padrão de falha: `Expected: false`

- [X] TASK-16 — CLI `auth refresh` com resultado e falha acionável (rastreia: REQ-10, design §4, design DD-06; paths: `packages/cli/src/commands/handlers/auth/refresh.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/test/auth-refresh.test.ts`; depende: TASK-14)
  - Teste (comando): `cd packages/cli && bun test --timeout 30000 test/auth-refresh.test.ts`
  - Padrão de falha: `Expected: "refresh_failed"`
  - Nota: o refresh gerenciado agora usa `Integration.connection.resolve` (lock compartilhado, janela de 5 min e persistência atômica) e devolve `refresh_failed` sem expor erro do provider quando a renovação falha; sessão nativa não-ready continua `session_expired`. Consentimento é exigido antes.

- [X] TASK-17 — CLI `auth test` com `--model`, saída mínima e redação (rastreia: REQ-11, NFR-04, design §4, design DD-15; paths: `packages/cli/src/commands/handlers/auth/test.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/test/auth-test-command.test.ts`; depende: TASK-14)
  - Teste (comando): `cd packages/cli && bun test --timeout 30000 test/auth-test-command.test.ts`
  - Padrão de falha: `Expected: true`

- [X] TASK-18 — CLI `auth login` com aliases, `--source` e `--accept-tos` (rastreia: REQ-08, REQ-16, design §4, design DD-10; paths: `packages/cli/src/commands/handlers/auth/login.ts`, `packages/cli/src/commands/handlers/auth/shared.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/src/commands/handlers/acp.ts`, `packages/cli/test/auth-login-subscription.test.ts`; depende: TASK-13, TASK-14)
  - Teste (comando): `cd packages/cli && bun test --timeout 30000 test/auth-login-subscription.test.ts`
  - Padrão de falha: `Expected: "consent_required"`

- [X] TASK-19 — CLI `auth logout` com guarda de sessão nativa e help/ToS (rastreia: REQ-09, REQ-16, design §4, design DD-01; paths: `packages/cli/src/commands/handlers/auth/logout.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/test/auth-logout-subscription.test.ts`; depende: TASK-14, TASK-15, TASK-18)
  - Teste (comando): `cd packages/cli && bun test --timeout 30000 test/auth-logout-subscription.test.ts`
  - Padrão de falha: `Expected: "native_session_not_managed"`

## Wave 4 — Exposição, regressão, sondagem real e gates

- [X] TASK-25 — Delegar o login gerenciado do Codex ao OAuth oficial do Integration (rastreia: REQ-08, design §1.1, design DD-05, design DD-12; paths: `packages/core/src/subscription/service.ts`, `packages/core/src/subscription/adapters/codex-chatgpt.ts`, `packages/core/src/subscription/adapters/adapter.ts`, `packages/core/test/subscription-auth/adapter-codex-chatgpt.test.ts`; depende: TASK-13; expõe: `POST /api/experimental/subscription/:integrationID/login` com `source: managed`)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/adapter-codex-chatgpt.test.ts`
  - Padrão de falha: `Expected: "https://auth.openai.com/api/accounts/authorize"`
  - Setup do teste: nenhum (porta fake de Integration via `Effect.provideService`)
  - Nota: o `--source managed` de `codex-chatgpt` deixava de devolver `https://chatgpt.com/authorize` estático e passa a chamar `Integration.oauth.connect({ integrationID: "openai", methodID: "chatgpt-token-sharing" })`, reutilizando o OAuth oficial de `packages/core/src/plugin/provider/chatgpt.ts`; a troca de tokens e o callback seguem o mecanismo de attempt/authorization do Integration (nada é duplicado). O serviço ganha `Integration.node` nas deps do layer.

- [X] TASK-20 — Gating de exposição de provider/modelo e respeito à política (rastreia: REQ-12, design §2.1, design DD-13, design §1.2; paths: `packages/core/src/subscription/plugin.ts`, `packages/server/test/subscription-exposure.test.ts`; depende: TASK-10, TASK-11, TASK-13; expõe: `GET /api/provider`, `GET /api/model`)
  - Teste (comando): `cd packages/server && bun test test/subscription-exposure.test.ts`
  - Padrão de falha: `Expected: "kimi-for-coding"`

- [X] TASK-21 — Regressão flag-off: providers, modelos e `auth list/login/logout` idênticos ao baseline (rastreia: REQ-01, REQ-12, NFR-03, design §5, design DD-09; paths: `packages/server/test/subscription-regression.test.ts`, `packages/cli/test/auth.test.ts`; depende: TASK-15, TASK-18, TASK-19, TASK-20)
  - Teste (comando): `cd packages/server && bun test test/subscription-regression.test.ts`
  - Padrão de falha: `Expected: true`

- [X] TASK-22 — Sondagem real opt-in e guarda de CI (nunca credencial real em teste) (rastreia: REQ-06, REQ-11, design §6; paths: `packages/core/script/subscription-smoke.ts`, `packages/core/test/subscription-auth/smoke-guard.test.ts`; depende: TASK-17, TASK-20)
  - Teste (comando): `cd packages/core && bun run test test/subscription-auth/smoke-guard.test.ts`
  - Padrão de falha: `Expected: "skipped"`
  - Nota: `smokeKimi` agora faz uma requisição mínima real via `SubscriptionProbe.http` (timeout de 15 s, sem retry, sem expor corpo de erro), mas só quando `OPENCODE_SUBSCRIPTION_SMOKE=1`; sem a flag ou sem credencial devolve `skipped`. A execução real com credencial Kimi continua manual (não há rede/credencial neste ambiente); a guarda de CI cobre skip/opt-in.

- [X] TASK-23 — Documento de produto `specs/v2/subscription-auth.md` com ToS, flag, prioridade e limitações (rastreia: REQ-16, design §4, design §5; paths: `specs/v2/subscription-auth.md`; depende: TASK-18, TASK-19)
  - Teste (comando): `grep -q "subscription_auth.enabled" specs/v2/subscription-auth.md && grep -q "termos de uso" specs/v2/subscription-auth.md`
  - Padrão de falha: `(não se aplica — task documental; a falha é o grep não casar e o comando sair diferente de 0)`

- [X] TASK-24 — Gate final: checagem de tipos, suíte dos pacotes tocados e varredura de segredo (rastreia: NFR-02, design §4, design §6; paths: `packages/schema`, `packages/core`, `packages/protocol`, `packages/server`, `packages/cli`; depende: TASK-21, TASK-22, TASK-23)
  - Teste (comando): `bash .forge/scripts/check-secrets.sh range dev..HEAD`
  - Nota: `check-secrets.sh path` sobre `.forge/specs/active/subscription-auth` é vazio (diretório untracked) e reprova por vacuidade; `range dev..HEAD` varre o diff versionado da implementação.
  - Padrão de falha: `(não se aplica — task de gate; falha esperada é exit code diferente de 0)`
  - Nota: DoD inclui `bun run check` na raiz e `bun run test` (ou `bun run typecheck`) em `packages/schema`, `packages/core`, `packages/protocol`, `packages/server`, `packages/cli`; os resultados reais são registrados em `verification.yaml` na fase `/forge:verify`, não aqui.
  - Resultado final: `check-secrets.sh range dev..HEAD` → OK. Suíte completa `bun turbo test --concurrency=3` → 33/33 tasks, 0 falhas. `spec-verify.sh subscription-auth` → test/typecheck/lint passed. Correções incluídas: fixtures Bash 3.2, width policy da TUI, probe real, consent no refresh e timeout do teste de regressão.

## Rastreabilidade

| REQ / Design § | Tasks |
|---|---|
| REQ-01 | TASK-01, TASK-15, TASK-21 |
| REQ-02 | TASK-02, TASK-03, TASK-04, TASK-11 |
| REQ-03 | TASK-01, TASK-03 |
| REQ-04 | TASK-04, TASK-07 |
| REQ-05 | TASK-04, TASK-08 |
| REQ-06 | TASK-04, TASK-09, TASK-10, TASK-22 |
| REQ-07 | TASK-12, TASK-13, TASK-15 |
| REQ-08 | TASK-13, TASK-18, TASK-25 |
| REQ-09 | TASK-19 |
| REQ-10 | TASK-13, TASK-16 |
| REQ-11 | TASK-13, TASK-17, TASK-22 |
| REQ-12 | TASK-10, TASK-20, TASK-21 |
| REQ-13 | TASK-01, TASK-03 |
| REQ-14 | TASK-02, TASK-05, TASK-11 |
| REQ-15 | TASK-12, TASK-14 |
| REQ-16 | TASK-01, TASK-06, TASK-13, TASK-18, TASK-19, TASK-23 |
| NFR-01 | TASK-15 |
| NFR-02 | TASK-05, TASK-24 |
| NFR-03 | TASK-03, TASK-21 |
| NFR-04 | TASK-13, TASK-17 |
| design §1.2 (normas) | TASK-07, TASK-08, TASK-20 |
| design §6 (riscos) | TASK-20, TASK-21, TASK-22 |
