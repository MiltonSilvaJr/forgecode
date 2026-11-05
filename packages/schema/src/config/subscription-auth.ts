export * as ConfigSubscriptionAuth from "./subscription-auth.js"

import { Schema } from "effect"

export const Info = Schema.Struct({
  _stub: Schema.optional(Schema.Boolean),
})
