export * as SquadStatus from "./status.js"

import { DateTime, Effect } from "effect"
import { desc, eq } from "drizzle-orm"
import { Session } from "@opencode/schema/session"
import { Squad } from "@opencode/schema/squad"
import { Location } from "@opencode/schema/location"
import { WorkspaceID } from "@opencode/schema/workspace-id"
import { Config } from "../config.js"
import { Database } from "../database/database.js"
import { AbsolutePath } from "../schema.js"
import { SquadBlock } from "./block.js"
import { SquadChannel } from "./channel.js"
import { DisabledError } from "./index.js"
import { SquadLiveness } from "./liveness.js"
import { SquadGenerationTable } from "./sql.js"
import { SquadStore } from "./store.js"

const requireEnabled = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    if (Config.latest(entries, "squad")?.enabled !== true) return yield* new DisabledError()
  })

/**
 * Read-only report of the active generation and the last closed one. It measures activity from each
 * session's durable clock and events and creates, enqueues and writes nothing.
 */
export const status = Effect.fn("SquadStatus.status")(function* () {
  yield* requireEnabled()
  const db = (yield* Database.Service).db
  const store = yield* SquadStore.Service
  const thresholds = yield* SquadLiveness.thresholds()
  const active = yield* store.activeGeneration(db)
  const rows = active ? yield* store.sessions(db, active.id) : []
  const sessions = yield* Effect.forEach(rows, (row) => sessionStatus(row, thresholds), { concurrency: 8 })
  const closed = yield* db
    .select()
    .from(SquadGenerationTable)
    .where(eq(SquadGenerationTable.state, "closed"))
    .orderBy(desc(SquadGenerationTable.closed_at))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  const previous = closed
    ? Squad.PreviousGeneration.make({
        id: Squad.GenerationID.make(closed.id),
        ...(closed.closed_at === null ? {} : { closedAt: DateTime.makeUnsafe(closed.closed_at) }),
        ...(closed.closed_by === null ? {} : { closedBy: closed.closed_by }),
        sessions: (yield* store.sessions(db, closed.id)).map((row) =>
          Squad.PreviousSession.make({
            name: Squad.SessionName.make(row.name),
            ...(row.session_id === null ? {} : { sessionID: Session.ID.make(row.session_id) }),
            state: "closed",
          }),
        ),
      })
    : null
  return Squad.LivenessReport.make({
    generation: active ? Squad.GenerationID.make(active.id) : null,
    sessions,
    inboxPending: sessions.reduce((total, row) => total + row.inboxPending, 0),
    previous,
  })
})

const sessionStatus = Effect.fn("SquadStatus.sessionStatus")(function* (
  row: SquadStore.SessionRow,
  thresholds: SquadLiveness.Thresholds,
) {
  const channel = yield* SquadChannel.Service
  const sessions = yield* SquadChannel.SessionsService
  const sessionID = row.session_id === null ? undefined : Session.ID.make(row.session_id)
  const info = sessionID === undefined ? undefined : yield* sessions.get(sessionID)
  const events = sessionID === undefined || info === undefined ? [] : yield* sessions.events(sessionID)
  const claim = sessionID === undefined || info === undefined ? undefined : yield* sessions.claim(sessionID)
  const pending = sessionID === undefined || info === undefined ? [] : yield* channel.pending(sessionID)
  const measured =
    info === undefined
      ? Squad.Liveness.make({
          verdict: "unknown",
          measuredAt: DateTime.makeUnsafe(Date.now()),
          workingStale: false,
          presumedDead: false,
        })
      : yield* SquadLiveness.measure(info, events, thresholds, claim)
  const declared = yield* SquadBlock.activeBlock(row.generation_id, row.name)
  const cause = [declared ? SquadBlock.causeOf(declared) : undefined, measured.cause].filter((part) => part !== undefined).join("; ")
  return Squad.SessionStatus.make({
    name: Squad.SessionName.make(row.name),
    role: row.role,
    provider: row.provider,
    model: row.model,
    ...(row.variant === null ? {} : { variant: row.variant }),
    location: Location.Ref.make({
      directory: AbsolutePath.make(row.location.directory),
      ...(row.location.workspaceID ? { workspaceID: WorkspaceID.make(row.location.workspaceID) } : {}),
    }),
    ...(row.branch === null ? {} : { branch: row.branch }),
    ...(sessionID === undefined ? {} : { sessionID }),
    state: row.state,
    liveness: Squad.Liveness.make({ ...measured, sessionState: row.state, ...(cause === "" ? {} : { cause }) }),
    inboxPending: pending.length,
  })
})
