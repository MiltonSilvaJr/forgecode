export * as CodexChatGPTAdapter from "./codex-chatgpt.js"

import { Effect } from "effect"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "../../integration.js"
import { SubscriptionSource } from "../source.js"
import { SubscriptionNativeSession } from "../native-session.js"
import type { Adapter, CommandRunner, LoginResult, LogoutResult } from "./adapter.js"

export const integrationID = "codex-chatgpt"
export const providerID = "openai"
export const installUrl = "https://github.com/openai/codex"

const managedIntegrationID = Integration.ID.make("openai")
const managedMethodID = Integration.MethodID.make("chatgpt-token-sharing")

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
          report: () => SubscriptionNativeSession.codexSession(env),
          acquire: () => Effect.succeed(undefined),
        }),
        SubscriptionSource.make({
          kind: "api_key",
          report: () =>
            Effect.sync(() =>
              env.OPENAI_API_KEY
                ? { present: true as const, state: "ready" as const }
                : { present: false as const, state: "missing" as const },
            ),
          acquire: () =>
            Effect.sync(() =>
              env.OPENAI_API_KEY ? Credential.Key.make({ type: "key", key: env.OPENAI_API_KEY }) : undefined,
            ),
        }),
      ]),
    report: (env) => SubscriptionNativeSession.codexSession(env),
    login: (input, integration): Effect.Effect<LoginResult> =>
      Effect.gen(function* () {
        if (input.source === "managed") {
          if (!integration)
            return {
              status: "error",
              code: "transport_unavailable",
              message: "codex-chatgpt managed login is unavailable. Run: opencode auth login openai",
            }
          const attempt = yield* integration.oauth
            .connect({ integrationID: managedIntegrationID, methodID: managedMethodID })
            .pipe(
              Effect.map(
                (attempt): LoginResult => ({
                  status: "started",
                  url: attempt.url,
                  instructions: attempt.instructions,
                }),
              ),
              Effect.catch(
                (error): Effect.Effect<LoginResult> =>
                  Effect.succeed({
                    status: "error",
                    code: "transport_unavailable",
                    message: error.message,
                  }),
              ),
            )
          return attempt
        }
        const presence = yield* SubscriptionNativeSession.codexSession(input.env)
        if (presence.present && presence.state === "ready") return { status: "already_authenticated" }
        const version = yield* runner("codex", ["--version"], input.env)
        if (version.exitCode !== 0)
          return {
            status: "error",
            code: "cli_missing",
            message: `codex CLI not found. Install it from ${installUrl}`,
          }
        const result = yield* runner("codex", ["login"], input.env)
        if (result.exitCode !== 0)
          return {
            status: "error",
            code: "transport_unavailable",
            message: `codex login failed: ${result.stderr.trim() || "unknown error"}`,
          }
        return { status: "authenticated" }
      }),
    logout: (env): Effect.Effect<LogoutResult> =>
      SubscriptionNativeSession.codexSession(env).pipe(
        Effect.map((report) =>
          report.present
            ? {
                status: "error",
                code: "native_session_not_managed",
                message: "run `codex logout` to sign out of the Codex CLI",
              }
            : { status: "removed" },
        ),
      ),
  }
}

export const codexChatGPT = make()
