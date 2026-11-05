export * as SubscriptionConsent from "./consent.js"

import { Effect } from "effect"

export const key = (providerID: string) => `subscription_auth/consent/${providerID}`

export interface Consent {
  readonly noticeVersion: number
  readonly acceptedAt: number
}

export const read = (_providerID: string) => Effect.succeed(undefined)

export const acknowledge = (_providerID: string, _noticeVersion: number) => Effect.void

export const status = (_providerID: string, _currentVersion: number) => Effect.succeed("acknowledged")
