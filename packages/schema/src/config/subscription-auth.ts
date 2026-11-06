export * as ConfigSubscriptionAuth from "./subscription-auth.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

/** Resolution order for a provider's credential sources. */
export const SourceKind = Schema.Literals(["env", "store", "native", "keychain", "api_key"]).annotate({
  identifier: "ConfigSubscriptionAuth.SourceKind",
})
export type SourceKind = typeof SourceKind.Type

export class Info extends Schema.Class<Info>("ConfigSubscriptionAuth.Info")({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description:
      "Enable subscription authentication, which reuses the sessions kept by official CLIs (Claude Code, Codex, Kimi Code). Defaults to false.",
  }),
  sources: Schema.Record(Schema.String, Schema.Array(SourceKind))
    .pipe(optional)
    .annotate({
      description: "Per-provider resolution order override, as an ordered list of source kinds.",
    }),
  fallback: Schema.Struct({
    api_key: Schema.Boolean.pipe(optional).annotate({
      description: "Fall back to the provider API key when no subscription source resolves. Defaults to true.",
    }),
  })
    .pipe(optional)
    .annotate({
      description: "Fallback behavior when a subscription source is unavailable.",
    }),
}) {}
