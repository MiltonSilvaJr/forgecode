export * as SquadBlock from "./block.js"

import { DateTime, Effect } from "effect"
import { Squad } from "@opencode/schema/squad"

export interface BlockInput {
  readonly name: string
  readonly waitingOn: Squad.WaitingOn
  readonly reason: string
  readonly clear?: boolean
  readonly author?: string
}

/** The active declared block of a session in the active generation, or `null`. */
export const current = Effect.fn("SquadBlock.current")(function* (_name: string) {
  return null as Squad.Block | null
})

export const block = Effect.fn("SquadBlock.block")(function* (input: BlockInput) {
  return Squad.Block.make({
    generationID: Squad.GenerationID.make("gen-stub"),
    name: Squad.SessionName.make(input.name),
    waitingOn: input.waitingOn,
    reason: input.reason,
    author: input.author ?? "operator",
    createdAt: DateTime.makeUnsafe(0),
  })
})
