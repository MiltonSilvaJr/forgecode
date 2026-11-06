export * as SquadActivate from "./activate.js"

import { Effect } from "effect"
import { Session } from "@opencode/schema/session"
import { Database } from "../database/database.js"
import { SquadChannel } from "./channel.js"
import { SquadRegistry } from "./registry.js"

export interface ActivateInput {
  readonly generation?: string
  readonly registryPath?: string
}

export const activate = Effect.fn("SquadActivate.activate")(function* (_input: ActivateInput) {
  yield* Database.Service
  const registry = yield* SquadRegistry.Service
  const channel = yield* SquadChannel.Service
  const active = yield* registry.active()
  const orchestrator = active!.sessions.find((entry) => entry.sessionID !== null)!
  return yield* channel.enqueue({ sessionID: Session.ID.make(orchestrator.sessionID!), text: "activate" })
})
