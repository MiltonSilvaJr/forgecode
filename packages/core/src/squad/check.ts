export * as SquadCheck from "./check.js"

import { Effect } from "effect"
import { Squad } from "@opencode/schema/squad"

export interface CheckSession {
  name: string
  provider: string
  model: string
  variant?: string
  location: string
  branch?: string
}

export const check = Effect.fn("Squad.check")(function* (input: { sessions: readonly CheckSession[] }) {
  return Squad.CheckReport.make({
    sessions: input.sessions.map((session) =>
      Squad.SessionCheck.make({
        name: Squad.SessionName.make(session.name),
        checks: [Squad.CheckItem.make({ check: "variant", verdict: "ok" })],
        credential: "unknown",
      }),
    ),
  })
})
