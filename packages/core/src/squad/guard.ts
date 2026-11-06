import { Effect } from "effect"
import { Config } from "../config.js"
import { DisabledError } from "./index.js"

export const requireEnabled = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    if (Config.latest(entries, "squad")?.enabled !== true) return yield* new DisabledError()
  })
