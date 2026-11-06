export * as SquadReplace from "./replace.js"

import { Effect } from "effect"
import { and, eq } from "drizzle-orm"
import { Session } from "@opencode/schema/session"
import { Database } from "../database/database.js"
import { SquadAudit } from "./audit.js"
import { SquadLaunch } from "./launch.js"
import { ConflictError, SessionNotFoundError, SquadRegistry } from "./registry.js"
import { SquadSessionTable } from "./sql.js"
import { SquadStore } from "./store.js"

export interface ReplaceInput {
  readonly name: string
  readonly provider: string
  readonly model?: string
  readonly variant?: string
  readonly reason?: string
  readonly author?: string
  readonly timeout?: number
  readonly pollInterval?: number
}

/**
 * Gives a name a new session on another provider, model or variant and launches it. The registry keeps one
 * entry per `(generation, name)`: the entry points at the new session, inherits the checkpoint, and the old
 * session is left untouched for the operator to inspect or archive.
 */
export const replace = Effect.fn("SquadReplace.replace")(function* (input: ReplaceInput) {
  const registry = yield* SquadRegistry.Service
  const store = yield* SquadStore.Service
  const audit = yield* SquadAudit.Service
  const db = (yield* Database.Service).db
  const active = yield* registry.active()
  if (!active) return yield* new ConflictError({ message: "no active generation", pendencies: [] })
  const row = yield* store.sessionByName(db, active.id, input.name)
  if (!row) return yield* new SessionNotFoundError({ message: `session ${input.name} is not in generation ${active.id}` })
  if (input.provider.trim() === "")
    return yield* new ConflictError({ message: "--provider is required to replace a session", pendencies: [] })
  if (row.state === "closed")
    return yield* new ConflictError({ message: `session ${input.name} is closed and cannot be replaced`, pendencies: [] })

  const sessionID = Session.ID.create()
  const from = row.session_id ?? "none"
  yield* db
    .update(SquadSessionTable)
    .set({
      provider: input.provider,
      model: input.model ?? row.model,
      variant: input.variant ?? row.variant,
      session_id: sessionID,
      adopted_at: null,
      state: "creating",
      last_error: `replaced session ${from}${input.reason ? `: ${input.reason}` : ""}`,
      updated_at: Date.now(),
    })
    .where(and(eq(SquadSessionTable.generation_id, active.id), eq(SquadSessionTable.name, input.name)))
    .run()
    .pipe(Effect.orDie)
  yield* audit.append({
    kind: "session_replace",
    generation: active.id,
    target: input.name,
    sessionID,
    result: "replaced",
    actor: input.author ?? "operator",
    detail: `from ${from} to ${sessionID}${input.reason ? `: ${input.reason}` : ""}`,
  })
  const launched = yield* SquadLaunch.launch({ only: input.name, timeout: input.timeout, pollInterval: input.pollInterval })
  return launched[0]!
})
