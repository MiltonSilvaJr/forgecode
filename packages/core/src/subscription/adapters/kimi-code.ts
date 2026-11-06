export * as KimiCodeAdapter from "./kimi-code.js"

import { Effect } from "effect"
import { Credential } from "@opencode/schema/credential"
import { SubscriptionSource } from "../source.js"
import { SubscriptionNativeSession } from "../native-session.js"
import type { Adapter, CommandRunner, LoginResult, LogoutResult } from "./adapter.js"

export const integrationID = "kimi-code"
export const providerID = "kimi-for-coding"
export const baseURL = "https://api.kimi.com/coding/v1"
export const installUrl = "https://www.kimi.ai/code"

const realRunner: CommandRunner = (command, args, env) =>
  Effect.promise(async () => {
    const child = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { exitCode, stdout, stderr }
  })

export function make(runner: CommandRunner = realRunner): Adapter {
  return {
    integrationID,
    providerID,
    transport: { provider: providerID },
    sources: (env) =>
      Effect.sync(() => [
        SubscriptionSource.make({
          kind: "native",
          report: () => SubscriptionNativeSession.kimiSession(env),
          acquire: () => SubscriptionNativeSession.kimiAccessToken(env).pipe(
            Effect.map((token) => token ? Credential.Key.make({ type: "key", key: token }) : undefined),
          ),
        }),
        SubscriptionSource.make({
          kind: "api_key",
          report: () =>
            Effect.sync(() =>
              env.KIMI_API_KEY
                ? { present: true as const, state: "ready" as const }
                : { present: false as const, state: "missing" as const },
            ),
          acquire: () =>
            Effect.sync(() =>
              env.KIMI_API_KEY ? Credential.Key.make({ type: "key", key: env.KIMI_API_KEY }) : undefined,
            ),
        }),
      ]),
    report: (env) => SubscriptionNativeSession.kimiSession(env),
    login: (input): Effect.Effect<LoginResult> =>
      Effect.gen(function* () {
        if (input.source === "managed")
          return {
            status: "error",
            code: "transport_unavailable",
            message: "kimi-code has no managed OAuth. Run: forgecode auth login kimi-code --source native",
          }
        const session = yield* SubscriptionNativeSession.kimiSession(input.env)
        if (session.present && session.state === "ready") return { status: "already_authenticated" }
        const version = yield* runner("kimi", ["--version"], input.env)
        if (version.exitCode !== 0)
          return {
            status: "error",
            code: "cli_missing",
            message: `kimi CLI not found. Install it from ${installUrl}`,
          }
        const result = yield* runner("kimi", ["login"], input.env)
        if (result.exitCode !== 0)
          return {
            status: "error",
            code: "transport_unavailable",
            message: `kimi login failed: ${result.stderr.trim() || "unknown error"}`,
          }
        const parsed = parseDeviceFlow(result.stdout)
        if (!parsed)
          return {
            status: "error",
            code: "transport_unavailable",
            message: "kimi login did not return an authorization URL and code",
          }
        return {
          status: "started",
          url: parsed.url,
          instructions: `Open ${parsed.url} and enter code: ${parsed.code}`,
        }
      }),
    logout: (env): Effect.Effect<LogoutResult> =>
      SubscriptionNativeSession.kimiSession(env).pipe(
        Effect.map((session) =>
          session.present
            ? {
                status: "error",
                code: "native_session_not_managed",
                message: "run `kimi logout` to sign out of Kimi Code",
              }
            : { status: "removed" },
        ),
      ),
  }
}

function parseDeviceFlow(stdout: string): { url: string; code: string } | undefined {
  const url = stdout.match(/https?:\/\/[^\s"']+/)?.[0]
  const code = stdout.match(/\b([A-Z0-9]{4,}[- ][A-Z0-9]{4,})\b/i)?.[1]?.replace(/\s/g, "-")
  if (!url || !code) return undefined
  return { url, code }
}

export const kimiCode = make()
