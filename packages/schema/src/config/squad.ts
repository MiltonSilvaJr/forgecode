export * as ConfigSquad from "./squad.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export const Info = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional),
  liveness: Schema.Struct({
    stale_after: Schema.DurationFromString,
    dead_after: Schema.DurationFromString,
  }).pipe(optional),
}).annotate({ identifier: "Config.Squad" })
