export * as SubscriptionNativeSession from "./native-session.js"

import { Effect } from "effect"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import path from "path"

type Env = Readonly<Record<string, string | undefined>>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const fileExists = (file: string) =>
  Effect.tryPromise({
    try: () => Bun.file(file).exists(),
    catch: () => false,
  })

const readJsonFile = (file: string) =>
  Effect.tryPromise({
    try: async () => (await Bun.file(file).json()) as unknown,
    catch: (cause) => cause,
  }).pipe(Effect.orElseSucceed(() => undefined))

const readTextFile = (file: string) =>
  Effect.tryPromise({
    try: async () => await Bun.file(file).text(),
    catch: (cause) => cause,
  }).pipe(Effect.orElseSucceed(() => undefined))

const home = (env: Env) => env.HOME ?? ""

/** The Claude Code credentials file is detected by existence only; its content is never read. */
export const claudeCredentialsPath = (env: Env) =>
  path.join(env.CLAUDE_CONFIG_DIR ?? path.join(home(env), ".claude"), ".credentials.json")

export const claudeOAuthFile = (env: Env) => path.join(home(env), ".claude.json")

export interface KeychainProbe {
  (service: string): Effect.Effect<{ present: boolean; detail?: string }>
}

/** Keychain presence probe: `security find-generic-password -s <service>` without `-w`. */
export const keychainProbe = (service: string): Effect.Effect<{ present: boolean; detail?: string }> =>
  Effect.promise(async () => {
    const child = Bun.spawn(["security", "find-generic-password", "-s", service], {
      stdout: "ignore",
      stderr: "ignore",
    })
    const exitCode = await child.exited
    if (exitCode === 0) return { present: true }
    return { present: false, detail: exitCode === 44 ? "keychain_denied" : "missing" }
  })

export interface ClaudePresence {
  readonly present: boolean
  readonly detail?: string
}

/** Detects a Claude Code session by presence only: credentials file, `oauthAccount` key, or Keychain. */
export const claudePresence = (env: Env, probe: KeychainProbe = keychainProbe): Effect.Effect<ClaudePresence> =>
  Effect.gen(function* () {
    if (yield* fileExists(claudeCredentialsPath(env))) return { present: true }
    const claudeJson = yield* readJsonFile(claudeOAuthFile(env))
    if (isRecord(claudeJson) && "oauthAccount" in claudeJson) return { present: true }
    if (process.platform === "darwin") {
      const result = yield* probe("Claude Code-credentials")
      if (result.present) return { present: true }
      if (result.detail) return { present: false, detail: result.detail }
    }
    return { present: false, detail: "missing" }
  })

export const codexAuthPath = (env: Env) => path.join(env.CODEX_HOME ?? path.join(home(env), ".codex"), "auth.json")

interface CodexAuth {
  readonly auth_mode?: string
  readonly last_refresh?: string
  readonly id_token?: string
  readonly access_token?: string
  readonly refresh_token?: string
}

/** Extracts the ChatGPT account id from an id_token payload without logging the token. */
const codexAccount = (idToken: string | undefined): string | undefined => {
  if (!idToken) return undefined
  const payload = idToken.split(".")[1]
  if (!payload) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>
    const account = claims["https://api.openai.com/auth.chatgpt_account_id"]
    return typeof account === "string" && account ? account : undefined
  } catch {
    return undefined
  }
}

export interface CodexReport extends SubscriptionAuth.Source.Report {
  readonly usable_by_forgecode: boolean
}

/** Detects the Codex CLI session and reports it as not transferable to ForgeCode. */
export const codexSession = (env: Env): Effect.Effect<CodexReport> =>
  Effect.gen(function* () {
    const auth = (yield* readJsonFile(codexAuthPath(env))) as CodexAuth | undefined
    if (!auth) return { present: false, state: "missing", usable_by_forgecode: false }
    if (auth.auth_mode && auth.auth_mode !== "chatgpt")
      return { present: true, state: "incompatible", detail: "auth_mode", usable_by_forgecode: false }
    const accountLabel = codexAccount(auth.id_token)
    return {
      present: true,
      state: "ready",
      ...(accountLabel !== undefined ? { accountLabel } : {}),
      usable_by_forgecode: false,
    }
  })

export const kimiShareDir = (env: Env) => env.KIMI_SHARE_DIR ?? path.join(home(env), ".kimi-code")

export const kimiCredentialsPath = (env: Env) => path.join(kimiShareDir(env), "credentials", "kimi-code.json")

export const kimiConfigPath = (env: Env) => path.join(kimiShareDir(env), "config.toml")

interface KimiCredentials {
  readonly access_token?: string
  readonly refresh_token?: string
}

/** Detects the Kimi Code session in `credentials/kimi-code.json` or the legacy `config.toml`. */
export const kimiSession = (env: Env): Effect.Effect<SubscriptionAuth.Source.Report> =>
  Effect.gen(function* () {
    const credentials = (yield* readJsonFile(kimiCredentialsPath(env))) as KimiCredentials | undefined
    if (credentials?.refresh_token || credentials?.access_token) {
      const state = credentials.access_token ? "ready" : "refresh_required"
      return { present: true, state }
    }
    const config = yield* readTextFile(kimiConfigPath(env))
    if (config && /refresh_token|access_token/.test(config)) return { present: true, state: "refresh_required" }
    return { present: false, state: "missing" }
  })
