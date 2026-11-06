import { Effect } from "effect"
import { SubscriptionNativeSession } from "../src/subscription/native-session.js"

export type SmokeOutcome = "skipped" | "ok" | "failed"

const baseURL = "https://api.kimi.com/coding/v1"

/**
 * Opt-in real probe of the Kimi subscription endpoint (REQ-06/REQ-11). Reports "skipped"
 * without touching the network when neither a native session nor a KIMI_API_KEY is present,
 * so CI and tests never run with a real credential.
 */
export function smokeKimi(env: Record<string, string | undefined>): Effect.Effect<SmokeOutcome> {
  return Effect.gen(function* () {
    const session = yield* SubscriptionNativeSession.kimiSession(env)
    const apiKey = env.KIMI_API_KEY
    const token = session.present && session.state === "ready" ? yield* readAccessToken(env) : apiKey
    if (!token) return "skipped"
    const response = yield* Effect.promise(() =>
      fetch(`${baseURL}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "k3", messages: [{ role: "user", content: "ping" }], max_tokens: 8 }),
        signal: AbortSignal.timeout(15_000),
      }),
    ).pipe(Effect.orElseSucceed(() => undefined))
    if (!response) return "failed"
    return response.ok ? "ok" : "failed"
  })
}

function readAccessToken(env: Record<string, string | undefined>): Effect.Effect<string | undefined> {
  const file = SubscriptionNativeSession.kimiCredentialsPath(env)
  return Effect.tryPromise({
    try: async () => {
      const data = (await Bun.file(file).json()) as { access_token?: string }
      return data.access_token
    },
    catch: (cause) => cause,
  }).pipe(
    Effect.orElseSucceed(() => undefined),
    Effect.map((token) => (typeof token === "string" ? token : undefined)),
  )
}
