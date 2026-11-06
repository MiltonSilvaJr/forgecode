import { Effect } from "effect"
import { FetchHttpClient } from "effect/http"
import { SubscriptionNativeSession } from "../src/subscription/native-session.js"
import { SubscriptionProbe } from "../src/subscription/probe.js"

export type SmokeOutcome = "skipped" | "ok" | "failed"

const baseURL = "https://api.kimi.com/coding/v1"

/**
 * Opt-in real probe of the Kimi subscription endpoint (REQ-06/REQ-11). Reports "skipped"
 * without reading credentials unless OPENCODE_SUBSCRIPTION_SMOKE=1 is explicitly supplied.
 */
export function smokeKimi(env: Record<string, string | undefined>): Effect.Effect<SmokeOutcome> {
  return Effect.gen(function* () {
    if (env.OPENCODE_SUBSCRIPTION_SMOKE !== "1") return "skipped"
    const session = yield* SubscriptionNativeSession.kimiSession(env)
    const apiKey = env.KIMI_API_KEY
    const token = session.present && session.state === "ready" ? yield* SubscriptionNativeSession.kimiAccessToken(env) : apiKey
    if (!token) return "skipped"
    return yield* SubscriptionProbe.http({ url: `${baseURL}/messages`, token, model: "k3", protocol: "messages" }).pipe(
      Effect.as<SmokeOutcome>("ok"),
      Effect.orElseSucceed((): SmokeOutcome => "failed"),
      Effect.provide(FetchHttpClient.layer),
    )
  })
}
