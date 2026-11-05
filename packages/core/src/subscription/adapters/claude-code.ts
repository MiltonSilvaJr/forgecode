export * as ClaudeCodeAdapter from "./claude-code.js"

import { Effect } from "effect"
import { Credential } from "@opencode/schema/credential"
import { SubscriptionSource } from "../source.js"
import { SubscriptionNativeSession } from "../native-session.js"
import type { Env } from "../native-session.js"
import type { Adapter, CommandRunner, LoginResult, LogoutResult } from "./adapter.js"

export const integrationID = "claude-code"
export const providerID = "claude-agent"
export const installUrl = "https://docs.anthropic.com/en/docs/claude-code/setup"

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

const apiKeySource = (env: Env) =>
  SubscriptionSource.make({
    kind: "api_key",
    report: () =>
      Effect.sync(() =>
        env.ANTHROPIC_API_KEY
          ? { present: true as const, state: "ready" as const }
          : { present: false as const, state: "missing" as const },
      ),
    acquire: () =>
      Effect.sync(() =>
        env.ANTHROPIC_API_KEY ? Credential.Key.make({ type: "key", key: env.ANTHROPIC_API_KEY }) : undefined,
      ),
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
          report: () =>
            SubscriptionNativeSession.claudePresence(env).pipe(
              Effect.map((presence) => ({
                present: presence.present,
                state: presence.present ? ("ready" as const) : ("missing" as const),
                ...(presence.detail !== undefined ? { detail: presence.detail } : {}),
              })),
            ),
          acquire: () => Effect.succeed(undefined),
        }),
        apiKeySource(env),
      ]),
    report: (env) =>
      SubscriptionNativeSession.claudePresence(env).pipe(
        Effect.map((presence) => ({
          present: presence.present,
          state: presence.present ? ("ready" as const) : ("missing" as const),
          ...(presence.detail !== undefined ? { detail: presence.detail } : {}),
        })),
      ),
    login: (input): Effect.Effect<LoginResult> =>
      Effect.gen(function* () {
        if (input.source === "managed")
          return {
            status: "error",
            code: "transport_unavailable",
            message: "claude-code has no managed OAuth. Run: opencode auth login claude-code --source native",
          }
        const presence = yield* SubscriptionNativeSession.claudePresence(input.env)
        if (presence.present) return { status: "already_authenticated" }
        const version = yield* runner("claude", ["--version"], input.env)
        if (version.exitCode !== 0)
          return {
            status: "error",
            code: "cli_missing",
            message: `claude CLI not found. Install it from ${installUrl}`,
          }
        const result = yield* runner("claude", ["auth", "login", "--claudeai"], input.env)
        if (result.exitCode !== 0)
          return {
            status: "error",
            code: "transport_unavailable",
            message: `claude auth login failed: ${result.stderr.trim() || "unknown error"}`,
          }
        return { status: "authenticated" }
      }),
    logout: (env): Effect.Effect<LogoutResult> =>
      SubscriptionNativeSession.claudePresence(env).pipe(
        Effect.map((presence) =>
          presence.present
            ? {
                status: "error",
                code: "native_session_not_managed",
                message: "run `claude auth logout` to sign out of Claude Code",
              }
            : { status: "removed" },
        ),
      ),
  }
}

export const claudeCode = make()
