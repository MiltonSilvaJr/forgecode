export * as SubscriptionConsent from "./consent.js"

import { Effect, Option, Schema } from "effect"
import { KV } from "../kv.js"

export const key = (providerID: string) => `subscription_auth/consent/${providerID}`

export interface Consent {
  readonly noticeVersion: number
  readonly acceptedAt: number
}

const ConsentSchema = Schema.Struct({
  noticeVersion: Schema.Number,
  acceptedAt: Schema.Number,
})
const decode = Schema.decodeUnknownOption(ConsentSchema)

export const read = (providerID: string): Effect.Effect<Consent | undefined, never, KV.Service> =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    const value = yield* kv.get(key(providerID))
    return value === undefined ? undefined : Option.getOrUndefined(decode(value))
  })

export const acknowledge = (providerID: string, noticeVersion: number): Effect.Effect<void, never, KV.Service> =>
  Effect.gen(function* () {
    const kv = yield* KV.Service
    yield* kv.set(key(providerID), { noticeVersion, acceptedAt: Date.now() })
  })

export const status = (
  providerID: string,
  currentVersion: number,
): Effect.Effect<"required" | "acknowledged", never, KV.Service> =>
  Effect.gen(function* () {
    const consent = yield* read(providerID)
    if (consent?.noticeVersion === currentVersion) return "acknowledged"
    return "required"
  })
