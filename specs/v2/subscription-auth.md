# Subscription Authentication

Status: **Implemented.**

## Purpose

Subscription authentication lets opencode reuse the session already kept by an official coding CLI (Claude Code, Codex, or Kimi Code) instead of asking for a separate API key. The feature is opt-in, off by default, and never reads a saved Claude Code login.

## Terms of Use (termos de uso)

Each subscription provider requires a versioned terms-of-use notice before its session is reused. The notice (`subscription_auth` notice, currently version `1`) states, in the user's own language, that reusing the official CLI session may violate that provider's **termos de uso**, and that connecting an API key is the officially supported path.

Acceptance is recorded per provider and per notice version in KV (`subscription_auth/consent/<providerID>` → `{ noticeVersion, acceptedAt }`). When the notice version changes, `auth status` reports `consent: "required"` again and `auth login` refuses to proceed without `--accept-tos`. The check is enforced in the server (`POST /api/experimental/subscription/:integrationID/login`), not only in the CLI.

## Feature flag

The whole layer is governed by `subscription_auth.enabled` in `opencode.json`. The default is `false`:

- When absent or `false`, subscription authentication is inert: no native session is read, no Keychain probe runs, no subscription transport is registered, `auth status` reports `enabled: false`, and `auth login --source native` fails with `subscription_auth_disabled`.
- Pre-existing providers (`claude-agent`, and the ChatGPT login for `openai`) are unchanged — they are already-delivered behavior, not part of this layer.
- An additional `subscription_auth.fallback.api_key` (default `true`) allows falling back to the provider API key when no subscription source resolves; `false` fails with `subscription_unavailable`.

## Source priority

For each provider, the resolver tries credential sources in a fixed order and reports the chosen source plus the reason each earlier source was skipped:

```text
env → store → native → keychain → api_key
```

`subscription_auth.sources.<provider>` reorders that list per provider, and an unknown `kind` is rejected at config decode. A present-but-expired source becomes `state: "expired"` and the search continues. The API key fallback never runs after an `account_mismatch`.

## Providers and limitations

### `claude-code` (binds to `claude-agent`)

- Detects the Claude Code session by presence only (`$CLAUDE_CONFIG_DIR/.credentials.json`, the `oauthAccount` key in `~/.claude.json`, or the Keychain item without `-w`). The credentials file content is never read and the token never enters the process.
- Login delegates to `claude auth login --claudeai`; `expiresAt` is `null`/unknown by design because the real validity belongs to `claude-agent`.
- `auth test claude-code` runs the `claude-agent` probe, not a new prompt.

### `codex-chatgpt` (binds to `openai`)

- The native `~/.codex/auth.json` session is detected and reported as `usable_by_forgecode: false`: the Codex CLI token is not transferable, so it is never turned into a credential.
- `--source managed` delegates to the **official OpenAI OAuth with token sharing** (`Integration` method `chatgpt-token-sharing`, the same flow as `opencode auth login openai`), not a native token. The token exchange and callback follow the existing Integration attempt/authorization mechanism; nothing is duplicated.
- `--source native` only runs `codex login` and records no credential.

### `kimi-code` (binds to `kimi-for-coding`)

- Detects the session in `$KIMI_SHARE_DIR/credentials/kimi-code.json` (default `~/.kimi-code`) or the legacy `config.toml`.
- Login delegates to `kimi login` (device flow). The `kimi-for-coding` provider uses `https://api.kimi.com/coding/v1` with `Authorization: Bearer` applied per request; the token is never stored in provider `settings`/`headers`.
- `kimi-for-coding` is exposed in `/api/provider` and `/api/model` only when `subscription_auth.enabled` is `true` and a source resolved `ready`. A `provider.use: deny` still removes it.

## Probe and limits

- `auth test` performs exactly one minimal request (`max_tokens <= 8`), no streaming and no retry, with a 15-second timeout. `429` → `rate_limited`, `401/403` → `session_expired`, network failure → `transport_unavailable`.
- `auth status` is offline by default; `--probe` delegates to `auth test`.
- Secrets are redacted everywhere: `access_token`, `refresh_token`, `id_token`, `Authorization`, `x-api-key`, `cookie`, `set-cookie`, `code`, and `user_code` never appear in logs, errors, events, or JSON output.
