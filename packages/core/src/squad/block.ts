export * as SquadBlock from "./block.js"

import { DateTime, Effect } from "effect"
import { and, eq, isNull } from "drizzle-orm"
import { Squad } from "@opencode/schema/squad"
import { Database } from "../database/database.js"
import { SquadAudit } from "./audit.js"
import { ConflictError, SessionNotFoundError, SquadRegistry } from "./registry.js"
import { SquadBlockTable } from "./sql.js"
import { SquadStore } from "./store.js"

export interface BlockInput {
  readonly name: string
  readonly waitingOn: Squad.WaitingOn
  readonly reason: string
  readonly clear?: boolean
  readonly author?: string
}

type Row = typeof SquadBlockTable.$inferSelect

const toBlock = (row: Row): Squad.Block =>
  Squad.Block.make({
    generationID: Squad.GenerationID.make(row.generation_id),
    name: Squad.SessionName.make(row.name),
    waitingOn: row.waiting_on,
    reason: row.reason,
    author: row.author,
    createdAt: DateTime.makeUnsafe(row.created_at),
    ...(row.cleared_at === null ? {} : { clearedAt: DateTime.makeUnsafe(row.cleared_at) }),
  })

/** The text `cause` carries for a declared block. */
export const causeOf = (block: Squad.Block) => `waiting on ${block.waitingOn}: ${block.reason}`

const activeRow = (generationID: string, name: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db
      .select()
      .from(SquadBlockTable)
      .where(
        and(
          eq(SquadBlockTable.generation_id, generationID),
          eq(SquadBlockTable.name, name),
          isNull(SquadBlockTable.cleared_at),
        ),
      )
      .get()
      .pipe(Effect.orDie)
  })

/** The active declared block of a session in the given generation, or `null`. */
export const activeBlock = Effect.fn("SquadBlock.activeBlock")(function* (generationID: string, name: string) {
  const row = yield* activeRow(generationID, name)
  return row ? toBlock(row) : null
})

/** The active declared block of a session in the active generation, or `null`. */
export const current = Effect.fn("SquadBlock.current")(function* (name: string) {
  const registry = yield* SquadRegistry.Service
  const active = yield* registry.active()
  if (!active) return null
  return yield* activeBlock(active.id, name)
})

/**
 * Declares or clears why a session is stopped. It only annotates liveness with a cause: it never touches the
 * session, its verdict or its execution claim.
 */
export const block = Effect.fn("SquadBlock.block")(function* (input: BlockInput) {
  const registry = yield* SquadRegistry.Service
  const store = yield* SquadStore.Service
  const audit = yield* SquadAudit.Service
  const db = (yield* Database.Service).db
  const active = yield* registry.active()
  if (!active) return yield* new ConflictError({ message: "no active generation", pendencies: [] })
  const session = yield* store.sessionByName(db, active.id, input.name)
  if (!session) return yield* new SessionNotFoundError({ message: `session ${input.name} is not in generation ${active.id}` })
  const author = input.author ?? "operator"
  const existing = yield* activeRow(active.id, input.name)
  const now = Date.now()

  if (input.clear) {
    if (!existing) return yield* new ConflictError({ message: `session ${input.name} has no active block`, pendencies: [] })
    yield* db
      .update(SquadBlockTable)
      .set({ cleared_at: now })
      .where(and(eq(SquadBlockTable.generation_id, active.id), eq(SquadBlockTable.name, input.name)))
      .run()
      .pipe(Effect.orDie)
    yield* audit.append({
      kind: "block_clear",
      generation: active.id,
      target: input.name,
      sessionID: session.session_id ?? undefined,
      result: "cleared",
      actor: author,
    })
    return toBlock({ ...existing, cleared_at: now })
  }

  if (input.reason.trim() === "")
    return yield* new ConflictError({ message: "--reason is required to declare a block", pendencies: [] })
  if (session.state !== "verified")
    return yield* new ConflictError({
      message: `session ${input.name} is ${session.state}, not verified; only a verified session can be blocked`,
      pendencies: [],
    })
  if (existing && existing.waiting_on === input.waitingOn && existing.reason === input.reason) return toBlock(existing)

  const row = yield* db
    .insert(SquadBlockTable)
    .values({
      generation_id: active.id,
      name: input.name,
      waiting_on: input.waitingOn,
      reason: input.reason,
      author,
      created_at: now,
      cleared_at: null,
    })
    .onConflictDoUpdate({
      target: [SquadBlockTable.generation_id, SquadBlockTable.name],
      set: { waiting_on: input.waitingOn, reason: input.reason, author, created_at: now, cleared_at: null },
    })
    .returning()
    .get()
    .pipe(Effect.orDie)
  yield* audit.append({
    kind: "block",
    generation: active.id,
    target: input.name,
    sessionID: session.session_id ?? undefined,
    result: "declared",
    actor: author,
    detail: `waiting on ${input.waitingOn}: ${input.reason}`,
  })
  return toBlock(row)
})
