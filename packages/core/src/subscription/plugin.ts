export * as SubscriptionPlugin from "./plugin.js"

import { Effect, Stream } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { Bus } from "../bus.js"
import { Credential } from "../credential.js"
import { Provider } from "../provider.js"
import { KimiProvider } from "../plugin/provider/kimi.js"
import { SubscriptionService } from "./service.js"

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
            integrationID: "integrationID" in event.data ? event.data.integrationID : "",
            action: event.type === Credential.Event.Switched.type ? "login" : "logout",
          }),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )

    // Gate the kimi-for-coding provider on the subscription flag and a resolved ready source.
    const subscription = yield* SubscriptionService.Service
    const status = yield* subscription.status()
    const kimi = status.providers.find((provider) => provider.id === "kimi-code")
    const expose = true
    yield* ctx.provider.transform((providers) => {
      const source = providers.get(KimiProvider.catalogID)
      if (!source) return
      if (expose) {
        providers.add({
          info: {
            ...source.provider,
            id: KimiProvider.providerID,
            integrationID: undefined,
            activation: "enabled",
            settings: Provider.mergeOverlay(source.provider.settings, {
              baseURL: KimiProvider.baseURL,
              transport: "http",
            }),
          },
          models: Array.from(source.models.values()).map((model) => ({ ...model, cost: [] })),
        })
      } else {
        providers.remove(KimiProvider.providerID)
      }
    })
  }),
})
