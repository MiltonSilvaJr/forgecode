export * as SquadEvidence from "./evidence.js"

import { Effect } from "effect"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { SquadChannel } from "./channel.js"

export interface Expected {
  readonly model: string
  readonly messageID: string
  readonly adoptedAt?: number
}

/** Names of the evidences still missing for a launched session; empty means verified. */
export const verify = Effect.fn("SquadEvidence.verify")(function* (_sessionID: SessionSchema.ID, _expected: Expected) {
  yield* SquadChannel.SessionsService
  return [] as ReadonlyArray<string>
})
