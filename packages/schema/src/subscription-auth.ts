export * as SubscriptionAuth from "./subscription-auth.js"

import { Schema } from "effect"
import { optional } from "./schema.js"
import { ephemeral, inventory } from "./event.js"

export namespace Source {
  export const Kind = Schema.Literals(["env", "store", "native", "keychain", "api_key"]).annotate({
    identifier: "SubscriptionAuth.Source.Kind",
  })
  export type Kind = typeof Kind.Type

  export const State = Schema.Literals([
    "ready",
    "disabled",
    "expired",
    "refresh_required",
    "incompatible",
    "missing",
  ]).annotate({ identifier: "SubscriptionAuth.Source.State" })
  export type State = typeof State.Type

  /**
   * Presence and validity window of one credential source, without the secret.
   * A report carrying a secret field (`accessToken`, `refreshToken`, `idToken`, `key`,
   * `code`, `user_code`, `authorization`, `x-api-key`, `cookie`, `set-cookie`) is
   * rejected on strict decoding.
   */
  export const Report = Schema.Struct({
    present: Schema.Boolean,
    state: State,
    expiresAt: optional(Schema.Number),
    accountLabel: optional(Schema.String),
    detail: optional(Schema.String),
  }).annotate({ identifier: "SubscriptionAuth.Source.Report" })
  export type Report = typeof Report.Type

  export const Skipped = Schema.Struct({
    kind: Kind,
    reason: Schema.String,
  }).annotate({ identifier: "SubscriptionAuth.Source.Skipped" })
  export type Skipped = typeof Skipped.Type
}

export const Resolution = Schema.Struct({
  integrationID: Schema.String,
  state: Source.State,
  source: optional(Source.Kind),
  fallback: optional(Schema.String),
  reason: optional(Schema.String),
  skipped: Schema.Array(Source.Skipped),
  expiresAt: optional(Schema.Number),
  accountLabel: optional(Schema.String),
}).annotate({ identifier: "SubscriptionAuth.Resolution" })
export type Resolution = typeof Resolution.Type

export const ErrorCode = Schema.Literals([
  "subscription_auth_disabled",
  "provider_unsupported",
  "source_missing",
  "session_expired",
  "refresh_failed",
  "cli_missing",
  "keychain_denied",
  "account_mismatch",
  "transport_unavailable",
  "consent_required",
  "native_session_not_managed",
  "subscription_unavailable",
  "rate_limited",
]).annotate({ identifier: "SubscriptionAuth.ErrorCode" })
export type ErrorCode = typeof ErrorCode.Type

export const Error = Schema.Struct({
  code: ErrorCode,
  message: Schema.String,
}).annotate({ identifier: "SubscriptionAuth.Error" })
export type Error = typeof Error.Type

export const StatusProvider = Schema.Struct({
  id: Schema.String,
  state: Source.State,
  source: optional(Source.Kind),
  expiresAt: optional(Schema.Number),
  accountLabel: optional(Schema.String),
  consent: optional(Schema.Literals(["required", "acknowledged"])),
  transport: optional(Schema.String),
  reason: optional(Schema.String),
  usable_by_forgecode: optional(Schema.Boolean),
}).annotate({ identifier: "SubscriptionAuth.StatusProvider" })
export type StatusProvider = typeof StatusProvider.Type

export const Status = Schema.Struct({
  enabled: Schema.Boolean,
  providers: Schema.Array(StatusProvider),
}).annotate({ identifier: "SubscriptionAuth.Status" })
export type Status = typeof Status.Type

const Changed = ephemeral({
  type: "subscription.auth.changed",
  schema: {
    integrationID: Schema.String,
    action: Schema.Literals(["consent", "login", "logout", "refresh", "probe"]),
    sourceKind: optional(Schema.String),
    outcome: optional(Schema.String),
    code: optional(Schema.String),
    expiresAt: optional(Schema.Number),
    noticeVersion: optional(Schema.Number),
  },
})

export const Event = { Changed, Definitions: inventory(Changed) }
