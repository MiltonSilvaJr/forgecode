export * as SubscriptionSource from "./source.js"

import { Effect } from "effect"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { Credential } from "@opencode/schema/credential"

/**
 * One credential source a subscription adapter declares for its provider. `report()` returns
 * presence, state and a validity window without the secret; `acquire()` returns the typed
 * material (`Credential.Key`, `Credential.OAuth` or `Credential.External`) or `undefined`
 * when the source is a native CLI session, which never becomes a credential.
 */
export interface Source {
  readonly kind: SubscriptionAuth.Source.Kind
  readonly report: () => Effect.Effect<SubscriptionAuth.Source.Report>
  readonly acquire: () => Effect.Effect<Credential.Value | undefined>
}

export const make = <R, E>(
  input: {
    readonly kind: SubscriptionAuth.Source.Kind
    readonly report: () => Effect.Effect<SubscriptionAuth.Source.Report, E, R>
    readonly acquire: () => Effect.Effect<Credential.Value | undefined, E, R>
  },
): Source => input
