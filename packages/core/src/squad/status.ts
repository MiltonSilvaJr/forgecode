export * as SquadStatus from "./status.js"

import { DateTime, Effect } from "effect"
import { Squad } from "@opencode/schema/squad"

/** Read-only report of the active generation and, when there is one, the last closed generation. */
export const status = Effect.fn("SquadStatus.status")(function* () {
  return Squad.LivenessReport.make({
    generation: null,
    sessions: [],
    inboxPending: 0,
    previous: Squad.PreviousGeneration.make({
      id: Squad.GenerationID.make("gen-stub"),
      closedAt: DateTime.makeUnsafe(0),
      sessions: [],
    }),
  })
})
