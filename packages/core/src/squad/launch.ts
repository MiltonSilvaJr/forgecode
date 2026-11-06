export * as SquadLaunch from "./launch.js"

import { Effect } from "effect"
import { eq, and } from "drizzle-orm"
import { Session as SessionSchema } from "@opencode/schema/session"
import { Location } from "@opencode/schema/location"
import { SquadChannel } from "./channel.js"
import { Database } from "../database/database.js"
import { ConflictError, SessionNotFoundError, SquadRegistry } from "./registry.js"
import { SquadSessionTable } from "./sql.js"

export interface LaunchInput {
  readonly only?: string
  readonly retry?: boolean
  readonly reason?: string
  readonly adopt?: Readonly<Record<string, string>>
  readonly timeout?: number
  readonly pollInterval?: number
}

export const launch = Effect.fn("SquadLaunch.launch")(function* (input: LaunchInput) {
  const registry = yield* SquadRegistry.Service
  const sessions = yield* SquadChannel.SessionsService
  const db = (yield* Database.Service).db
  const active = yield* registry.active()
  if (!active) return yield* new ConflictError({ message: "no active generation", pendencies: [] })
  const generation = yield* registry.generation(active.id)
  const entries = generation!.sessions.filter((entry) => input.only === undefined || entry.name === input.only)
  if (input.only !== undefined && entries.length === 0)
    return yield* new SessionNotFoundError({ message: `session ${input.only} is not in generation ${active.id}` })
  for (const entry of entries) {
    const created = yield* sessions.create({ id: SessionSchema.ID.create(), location: Location.Ref.make(entry.location) })
    yield* db
      .update(SquadSessionTable)
      .set({ session_id: created.id, state: "verified" })
      .where(and(eq(SquadSessionTable.generation_id, active.id), eq(SquadSessionTable.name, entry.name)))
      .run()
  }
  return entries
})
