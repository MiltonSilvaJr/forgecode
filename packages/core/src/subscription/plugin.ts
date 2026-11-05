export * as SubscriptionPlugin from "./plugin.js"

import { Effect, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { Bus } from "../bus.js"
import { Credential } from "../credential.js"

export interface ChangedPayload {
  readonly integrationID: string
  readonly action: "consent" | "login" | "logout" | "refresh" | "probe"
  readonly sourceKind?: string
  readonly outcome?: string
  readonly code?: string
  readonly expiresAt?: number
  readonly noticeVersion?: number
}

/** Publishes the ephemeral audit event `subscription.auth.changed`. */
export const publishChanged = Effect.fn("SubscriptionAuth.publishChanged")(function* (payload: ChangedPayload) {
  const bus = yield* Bus.Service
  return yield* bus.publish(SubscriptionAuth.Event.Changed, payload)
})

/**
 * Host plugin: relays credential switches and removals to the `subscription.auth.changed` audit
 * event so every subscription mutation (login, logout, refresh, consent, probe) is observable.
 */
export const SubscriptionAuthPlugin = define({
  id: "opencode.subscription-auth",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.event
      .subscribe({ types: [Credential.Event.Switched.type, Credential.Event.Updated.type] })
      .pipe(
        Stream.runForEach((event) =>
          publishChanged({
            integrationID: event.data.integrationID ?? "",
            action: event.type === Credential.Event.Switched.type ? "login" : "logout",
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
  }),
})
