export * as SubscriptionProbe from "./probe.js"

import { Clock, Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"

/** One bounded request; never retry or include a remote error body in diagnostics. */
export const http = Effect.fn("subscription.auth.probe")(function* (input: {
  readonly url: string
  readonly token: string
  readonly model: string
  readonly protocol: "messages" | "responses"
}) {
  const client = yield* HttpClient.HttpClient
  const started = yield* Clock.currentTimeMillis
  const response = yield* client.execute(
    HttpClientRequest.post(input.url).pipe(
      HttpClientRequest.setHeader("Authorization", `Bearer ${input.token}`),
      HttpClientRequest.bodyJsonUnsafe(
        input.protocol === "messages"
          ? { model: input.model, messages: [{ role: "user", content: "ping" }], max_tokens: 8, stream: false }
          : { model: input.model, input: "ping", max_output_tokens: 8, stream: false, store: false },
      ),
    ),
  ).pipe(
    Effect.timeout("15 seconds"),
    Effect.mapError((): SubscriptionAuth.Error => ({
      code: "transport_unavailable",
      message: "Subscription probe could not reach the provider. Retry opencode auth test.",
    })),
  )
  if (response.status < 200 || response.status >= 300) {
    const code = response.status === 401 || response.status === 403
      ? "session_expired"
      : response.status === 429 ? "rate_limited" : "transport_unavailable"
    return yield* Effect.fail<SubscriptionAuth.Error>({
      code,
      message: code === "session_expired"
        ? "The provider rejected the credential. Run opencode auth login."
        : code === "rate_limited"
          ? "The provider rate limit was reached. Retry opencode auth test later."
          : "The provider rejected the probe. Check the model with opencode auth test --model.",
    })
  }
  return { ok: true, latencyMs: Math.max(0, (yield* Clock.currentTimeMillis) - started), model: input.model }
})
