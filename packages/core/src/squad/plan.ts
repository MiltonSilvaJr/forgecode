export * as SquadPlan from "./plan.js"

import { createHash } from "node:crypto"
import { Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { Config } from "../config.js"
import { DisabledError } from "./index.js"

const requireEnabled = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    if (Config.latest(entries, "squad")?.enabled !== true) return yield* new DisabledError()
  })

/** The bootstrap message `launch` admits to a session; `plan` renders its hash without sending it. */
export const bootstrapPrompt = (generation: string, name: string) =>
  `SQUAD bootstrap for ${name} in generation ${generation}: continue from your checkpoint and prior context.`

export const bootstrapSha256 = (generation: string, name: string) =>
  createHash("sha256").update(bootstrapPrompt(generation, name)).digest("hex")

export const plan = Effect.fn("Squad.plan")(function* (input: {
  generationID: string
  sessions: readonly Squad.SessionEntry[]
}) {
  yield* requireEnabled()
  const sessions = input.sessions.map((entry) =>
    Squad.PlanEntry.make({
      name: entry.name,
      provider: entry.provider,
      model: entry.model,
      variant: entry.variant,
      location: entry.location,
      branch: entry.branch,
      sessionID: entry.sessionID,
      action: "create",
      promptSha256: bootstrapSha256(input.generationID, entry.name),
    }),
  )
  return Squad.PlanDocument.make({ generationID: Squad.GenerationID.make(input.generationID), sessions })
})
