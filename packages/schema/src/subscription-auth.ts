export * as SubscriptionAuth from "./subscription-auth.js"

import { Schema } from "effect"
import { ephemeral, inventory } from "./event.js"

export namespace Source {
  export const Kind = Schema.String
  export const State = Schema.String
  export const Report = Schema.Struct({ present: Schema.Boolean })
  export const Skipped = Schema.Struct({ kind: Schema.String, reason: Schema.String })
}

export const Resolution = Schema.Struct({ integrationID: Schema.String })
export const ErrorCode = Schema.Literals(["unknown"])
export const Error = Schema.Struct({ code: Schema.String, message: Schema.String })
export const StatusProvider = Schema.Struct({ id: Schema.String })
export const Status = Schema.Struct({ enabled: Schema.Boolean })

const Changed = ephemeral({ type: "subscription.auth.changed", schema: { integrationID: Schema.String } })
export const Event = { Changed, Definitions: inventory(Changed) }
