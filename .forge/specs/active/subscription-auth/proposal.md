# Proposal — subscription-auth

> Change `subscription-auth` (type: `feature`, scale 2) — criado em 2026-11-04 por Milton Antonio da Silva Jr.

## 1. Por quê (problema / motivação)

O ForgeCode já sabe autenticar providers por API key, e o fork já traz três peças que tocam assinatura sem que exista uma camada única que as governe:

- `Integration` + `Credential` modelam métodos (`key`, `env`, `external`, `oauth`, `command`) e um store de credenciais com seleção de conta (`packages/core/src/integration.ts:120-260`, `packages/core/src/credential.ts`). `Credential.External` já descreve “referência a uma fonte cujo segredo e renovação são gerenciados fora do store” (`packages/schema/src/credential.ts:44-52`); a sessão nativa é tratada como fonte somente-leitura, sem virar credencial (decisão DD-01 em `design.md`).
- O provider `claude-agent` roda o `claude` do usuário e usa o login que ele já tem (`packages/core/src/plugin/provider/claude-agent/index.ts`, `specs/v2/claude-agent-provider.md`), inclusive assinatura.
- O provider `openai` tem login ChatGPT por OAuth com *token sharing* (`packages/core/src/plugin/provider/chatgpt.ts:170-180`), e `xai` já implementa device-flow OAuth (`packages/core/src/plugin/provider/xai.ts:44-74`).
- O CLI já tem `opencode auth list|login|logout|export|import|switch` (`packages/cli/src/commands/commands.ts:165-237`).

O que falta é o que o PRD §4 pede: (a) reaproveitar, de forma opt-in, as sessões que os CLIs oficiais mantêm (Claude Code, Codex/ChatGPT, Kimi Code); (b) resolver credencial com prioridade explícita e observável; (c) expor `status`/`refresh`/`test` sem revelar segredo; (d) impedir que um provider de assinatura apareça no seletor quando não está autenticado/habilitado; (e) cair para API key de forma declarada, nunca silenciosa.

Evidência de ausência (medida nesta sessão, com controle positivo):

```text
$ grep -rn "subscription_auth" packages .forge/context.md   # nenhuma ocorrência
$ grep -rn "CredentialResolver" packages                     # nenhuma ocorrência
$ git log --all -S'subscription_auth' --oneline              # vazio
$ git log --all -S'credential.updated' --oneline | head -2   # controle: c6056f3931, 1434464f7e
```

A ausência de um resolvedor é o custo real: hoje a “fonte” de uma credencial é inferida pelo chamador (env vs store vs CLI), e cada provider plugin decide sozinho como obter e quando renovar.

## 2. O que muda

Comportamento observável, tudo atrás de `subscription_auth.enabled` (default `false`):

1. **Resolução única.** Uma camada `subscription-auth` resolve, para cada provider de assinatura, a credencial por prioridade fixa — env específica → store do ForgeCode → sessão nativa do CLI → Keychain → API key — e devolve um relatório (`fonte`, `validade`, `conta`, `motivo de descarte` das fontes puladas) sem expor o segredo.
2. **Adapters.** `claude-code`, `codex-chatgpt` e `kimi-code` declaram fontes, login oficial, refresh, logout e o vínculo de transporte com um provider existente/novo. O contrato fica aberto para GLM, MiniMax, Grok, DeepSeek e OpenRouter sem tocar o core.
3. **CLI.** `opencode auth status [--json] [--provider]`, `opencode auth refresh <provider>`, `opencode auth test <provider> [--model]`; `auth login` ganha seleção de fonte, aliases (`claude-code` → `claude-agent`, `codex-chatgpt` → `openai`, `kimi-code` → `kimi-for-coding`) e aceite de ToS; `auth logout` recusa apagar sessão nativa.
4. **ToS.** Aviso versionado por provider, aceite explícito no primeiro uso (interativo ou `--accept-tos`), registrado localmente; versão nova do aviso pede novo aceite.
5. **Exposição.** Provider de assinatura só aparece em `/api/provider` e no seletor de modelos quando a flag está ligada, uma fonte resolveu e existe transporte; com a flag desligada, o comportamento atual de `claude-agent` e do ChatGPT OAuth é preservado.
6. **Fallback.** Ausência/falha de assinatura cai para API key quando `subscription_auth.fallback.api_key` (default `true`), marcando o relatório como `fallback: api_key`; desligado, falha com código acionável.
7. **Segurança.** Token de sessão nativa nunca é gravado no banco, no config, em log ou em mensagem de erro; `auth test` faz uma chamada mínima com timeout e não imprime header nem corpo cru.
8. **API aditiva.** Cinco rotas experimentais (`GET /api/experimental/subscription/status`, `POST /api/experimental/subscription/{integrationID}/{login,consent,refresh,test}`), identificadores `experimental.subscription.*`, client/SDK regenerado. O `login` é a única porta sancionada para fonte de assinatura e é onde o servidor cobra o aceite de ToS.

## 3. O que NÃO muda (fora de escopo)

- Burlar limite de plano ou termo de uso; compartilhar credencial entre pessoas, contas ou projetos.
- Ler o login salvo do Claude Code e falar com a Anthropic no lugar dele. `specs/v2/claude-agent-provider.md` (“Login”) fixa que o opencode **nunca** lê o login salvo do Claude Code e **nunca** se coloca entre Claude Code e Anthropic; este change cumpre essa norma.
- Reimplementar o endpoint do Codex CLI (`chatgpt.com/backend-api/codex`) ou seu app-server. A sessão nativa do Codex continua sendo do `codex`; para o ForgeCode o caminho ChatGPT é o OAuth gerenciado que já existe.
- Implementar GLM, MiniMax, Grok, DeepSeek e OpenRouter agora — apenas o contrato fica pronto.
- Substituir `Integration`/`Credential`, `auth list/export/import/switch`, ou o seletor de modelos.
- Guardar token de sessão nativa, exportá-lo em `auth export` ou migrá-lo entre máquinas.
- UI de desktop/app além do que o seletor de modelos já consome; nada de tela nova.
- Providers de assinatura habilitados por padrão.

## 4. Impacto

- **Capacidades afetadas:** `subscription-auth` (nova). Espelhado em `manifest.yaml > affected_capabilities`.
- **Paths afetados:** `packages/schema` (config + tipos + evento), `packages/core` (serviço de resolução, adapters, fonte nativa, provider `kimi-for-coding`, registro de plugins), `packages/protocol` (grupo experimental), `packages/server` (handlers), `packages/client` (gerado), `packages/cli` (subcomandos e testes), `specs/v2` (documento de produto). Lista completa em `manifest.yaml > affected_paths`.
- **Dependências:** nenhuma dependência de spec rígida de outro change; `forgequeue` é independente e `squad-orchestration` depende deste contrato (PRD §6). Há **sobreposição aditiva** de paths com as specs irmãs nos arquivos de registro compartilhados (`packages/schema/src/config.ts`, `packages/protocol/src/api.ts`, `packages/server/src/handlers.ts`, `packages/cli/src/commands/commands.ts`, `packages/client`), reconciliada por merge aditivo (ver `design.md` §1.2). Consome `Integration`, `Credential`, `KV`, `Config`, `Provider`, `ModelsDev` e `@opencode/ai/providers/moonshot/messages`.
- **Riscos:** ver `design.md` §6. Os três primeiros: vazamento de token em log/erro; sessão nativa tratada como transferível quando não é (Codex); premissa de transporte Kimi (`api.kimi.com/coding` com Bearer) falhar na sondagem.

## 5. Próximos passos

`/forge:requirements` → `/forge:design` → `/forge:tasks` → `/forge:analyze` → `/forge:implement` → `/forge:verify` (scale 2). Decisões assumidas nesta proposal e registradas em `design.md` §2/§3: transporte Claude reutiliza `claude-agent` (sem tocar o token); Codex nativo não é transferível, o caminho suportado é o OAuth gerenciado; Kimi usa o endpoint de código com Bearer e a hipótese é validada por `auth test` antes de expor modelos.
