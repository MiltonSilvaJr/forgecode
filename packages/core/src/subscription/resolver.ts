export * as SubscriptionResolver from "./resolver.js"

import { Effect } from "effect"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { SubscriptionSource } from "./source.js"

export const defaultOrder: readonly SubscriptionAuth.Source.Kind[] = [
  "env",
  "store",
  "native",
  "keychain",
  "api_key",
]

export interface Resolved {
  readonly resolution: SubscriptionAuth.Resolution
  readonly source: SubscriptionSource.Source | undefined
}

export interface ResolveInput {
  readonly integrationID: string
  readonly sources: readonly SubscriptionSource.Source[]
  readonly order?: readonly SubscriptionAuth.Source.Kind[]
  readonly fallbackApiKey?: boolean
}

export function resolve(input: ResolveInput): Effect.Effect<Resolved> {
  return Effect.succeed({
    resolution: { integrationID: input.integrationID, state: "missing", skipped: [] },
    source: undefined,
  })
}

export const makeResolver = () => ({
  resolve: (input: ResolveInput): Effect.Effect<Resolved> => resolve(input),
  invalidate: () => {},
})
