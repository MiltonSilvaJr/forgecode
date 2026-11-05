export * as SubscriptionNativeSession from "./native-session.js"

import { Effect } from "effect"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import path from "path"

type Env = Readonly<Record<string, string | undefined>>

export const claudeCredentialsPath = (env: Env) => path.join(env.CLAUDE_CONFIG_DIR ?? ".claude", ".credentials.json")
export const claudeOAuthFile = (env: Env) => path.join(env.HOME ?? "", ".claude.json")
export const keychainProbe = (_service: string) => Effect.succeed({ present: false })
export const claudePresence = (_env: Env, _probe = keychainProbe) => Effect.succeed({ present: false, detail: "missing" })
export const codexAuthPath = (env: Env) => path.join(env.CODEX_HOME ?? ".codex", "auth.json")
export const codexSession = (_env: Env) =>
  Effect.succeed({ present: false, state: "missing" as const, usable_by_forgecode: false })
export const kimiShareDir = (env: Env) => env.KIMI_SHARE_DIR ?? ".kimi-code"
export const kimiCredentialsPath = (env: Env) => path.join(kimiShareDir(env), "credentials", "kimi-code.json")
export const kimiConfigPath = (env: Env) => path.join(kimiShareDir(env), "config.toml")
export const kimiSession = (_env: Env) => Effect.succeed({ present: false, state: "missing" as const })
