export * as CredentialPresence from "./credential.js"

import { Context, Duration, Effect, Layer, Option } from "effect"
import { Squad } from "@opencode/schema/squad"
import { Config } from "../config.js"
import { SubscriptionService } from "../subscription/service.js"

export interface Status {
  readonly presence: Squad.CredentialPresence
  /** When the credential expires, if the source knows. Informational: it never changes `presence`. */
  readonly expiresAt?: number
  /** True when `expiresAt` falls inside `squad.credential.expiry_warn`. */
  readonly expiryWarn?: boolean
}

export interface Interface {
  readonly status: (providerID: string) => Effect.Effect<Status>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/CredentialPresence") {}

const DefaultExpiryWarn = Duration.toMillis(Duration.days(7))

const presenceFor = (state: string): Squad.CredentialPresence => {
  if (state === "ready") return "present"
  if (state === "missing") return "absent"
  return "unknown"
}

/**
 * Presence of one provider's credential, projected from the subscription auth report without ever
 * reading a secret. With the `subscription_auth` flag off (or the service absent), it falls back to
 * `unknown` — the check then reports what it can prove and nothing more. An expiry inside `expiry_warn` is a
 * warning only: it never changes the presence verdict.
 */
export const layer = Layer.succeed(
  Service,
  Service.of({
    status: Effect.fn("CredentialPresence.status")(function* (providerID) {
      const config = yield* Effect.serviceOption(Config.Service)
      if (Option.isNone(config)) return { presence: "unknown" }
      const entries = yield* config.value.entries()
      if (Config.latest(entries, "subscription_auth")?.enabled !== true) return { presence: "unknown" }
      const warnWindow = Config.latest(entries, "squad")?.credential?.expiry_warn
      const window = warnWindow === undefined ? DefaultExpiryWarn : Duration.toMillis(warnWindow)
      const subscription = yield* Effect.serviceOption(SubscriptionService.Service)
      if (Option.isNone(subscription)) return { presence: "unknown" }
      const status = yield* subscription.value.status()
      const provider = status.providers.find((entry) => entry.transport === providerID || entry.id === providerID)
      if (!provider) return { presence: "unknown" }
      return {
        presence: presenceFor(provider.state),
        ...(provider.expiresAt === undefined ? {} : { expiresAt: provider.expiresAt }),
        expiryWarn: provider.expiresAt !== undefined && provider.expiresAt - Date.now() <= window,
      }
    }),
  }),
)
