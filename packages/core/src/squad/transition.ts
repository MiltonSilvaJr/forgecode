export * as SquadTransition from "./transition.js"

import { DateTime, Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { Database } from "../database/database.js"
import { SquadActivity } from "./activity.js"
import { SquadStore } from "./store.js"

export interface CloseInput {
  readonly generation: string
  readonly by?: string
  readonly idempotencyKey?: string
}

export const close = Effect.fn("SquadTransition.close")(function* (input: CloseInput) {
  const db = (yield* Database.Service).db
  const store = yield* SquadStore.Service
  yield* SquadActivity.Service
  yield* db.transaction((tx) => store.closeGeneration(tx, input.generation, { state: "closed", closed_at: Date.now(), closed_by: "operator" }))
  return Squad.TransitionReceipt.make({
    sourceGeneration: Squad.GenerationID.make(input.generation),
    sourceRegistryDigest: "",
    closed: {},
    checkpoints: {},
    previousSessionsClosed: false,
    previousOrchestratorKeptOpen: false,
    closedBy: "operator",
    createdAt: DateTime.makeUnsafe(Date.now()),
  })
})
