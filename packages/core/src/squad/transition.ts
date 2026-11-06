export * as SquadTransition from "./transition.js"

import { createHash } from "node:crypto"
import { DateTime, Effect } from "effect"
import { and, eq, ne } from "drizzle-orm"
import { Session } from "@opencode/schema/session"
import { Squad } from "@opencode/schema/squad"
import { Config } from "../config.js"
import { Database } from "../database/database.js"
import { SquadActivity } from "./activity.js"
import { SquadAudit } from "./audit.js"
import { SquadCheckpoint } from "./checkpoint.js"
import { DisabledError } from "./index.js"
import { ConflictError, SessionNotFoundError, registryDigest } from "./registry.js"
import { SquadCheckpointTable, SquadSessionTable, SquadTransitionEntryTable, SquadTransitionTable } from "./sql.js"
import { SquadStore } from "./store.js"

export interface CloseInput {
  readonly generation: string
  readonly by?: string
  readonly idempotencyKey?: string
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

const closeKey = (generation: string) => sha256(`close\n${generation}\n${generation}`)

const requireEnabled = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    if (Config.latest(entries, "squad")?.enabled !== true) return yield* new DisabledError()
  })

const digestOf = (generation: string, sessions: readonly SquadStore.SessionRow[]) =>
  registryDigest(
    generation,
    sessions.map((entry) => ({
      name: entry.name,
      provider: entry.provider,
      model: entry.model,
      variant: entry.variant,
      location: entry.location.directory,
      branch: entry.branch,
      sessionID: entry.session_id,
      state: entry.state,
    })),
  )

const receiptOf = Effect.fn("SquadTransition.receipt")(function* (q: SquadStore.Querier, generation: string) {
  const row = yield* q
    .select()
    .from(SquadTransitionTable)
    .where(eq(SquadTransitionTable.source_generation_id, generation))
    .get()
    .pipe(Effect.orDie)
  if (!row) return undefined
  const entries = yield* q
    .select()
    .from(SquadTransitionEntryTable)
    .where(eq(SquadTransitionEntryTable.source_generation_id, generation))
    .all()
    .pipe(Effect.orDie)
  return Squad.TransitionReceipt.make({
    sourceGeneration: Squad.GenerationID.make(generation),
    sourceRegistryDigest: row.source_registry_digest,
    closed: Object.fromEntries(
      entries.flatMap((entry) =>
        entry.closed_at === null
          ? []
          : [
              [
                entry.name,
                {
                  ...(entry.session_id ? { sessionID: Session.ID.make(entry.session_id) } : {}),
                  closedAt: DateTime.makeUnsafe(entry.closed_at),
                },
              ] as const,
            ],
      ),
    ),
    checkpoints: Object.fromEntries(
      entries.flatMap((entry) => (entry.checkpoint_sha256 ? [[entry.name, { sha256: entry.checkpoint_sha256 }] as const] : [])),
    ),
    previousSessionsClosed: row.previous_sessions_closed,
    previousOrchestratorKeptOpen: row.previous_orchestrator_kept_open,
    closedBy: row.closed_by ?? "operator",
    ...(row.target_generation_id ? { targetGenerationID: Squad.GenerationID.make(row.target_generation_id) } : {}),
    createdAt: DateTime.makeUnsafe(row.created_at),
  })
})

/**
 * Close the active generation and write the transition receipt. Refused, with the generation left `active`,
 * while any session lacks an intact checkpoint or has an execution in flight. The orchestrator is recorded
 * as kept open and is never ended by squad.
 */
export const close = Effect.fn("SquadTransition.close")(function* (input: CloseInput) {
  yield* requireEnabled()
  const db = (yield* Database.Service).db
  const store = yield* SquadStore.Service
  const audit = yield* SquadAudit.Service
  const activity = yield* SquadActivity.Service
  const by = input.by ?? "operator"
  const key = closeKey(input.generation)
  const now = Date.now()

  const result = yield* db.transaction((tx) =>
    Effect.gen(function* () {
      const existing = yield* store.idempotency(tx, key)
      if (existing) {
        if (existing.kind !== "close" || existing.generation_id !== input.generation)
          return yield* new ConflictError({ message: "idempotency key reused for a different operation", pendencies: [] })
        const receipt = yield* receiptOf(tx, input.generation)
        if (receipt) return { receipt, fresh: false }
      }
      const generation = yield* store.generation(tx, input.generation)
      if (!generation) return yield* new SessionNotFoundError({ message: `generation ${input.generation} not found` })
      if (generation.state !== "active")
        return yield* new ConflictError({ message: `generation ${generation.id} is ${generation.state}, not active`, pendencies: [] })
      const sessions = yield* store.sessions(tx, generation.id)

      const pendencies: string[] = []
      for (const entry of sessions) {
        const stored = entry.checkpoint_sha256
          ? yield* tx
              .select()
              .from(SquadCheckpointTable)
              .where(
                and(
                  eq(SquadCheckpointTable.generation_id, generation.id),
                  eq(SquadCheckpointTable.name, entry.name),
                  eq(SquadCheckpointTable.sha256, entry.checkpoint_sha256),
                ),
              )
              .get()
              .pipe(Effect.orDie)
          : undefined
        if (!entry.checkpoint_sha256) pendencies.push(`${entry.name}: checkpoint ausente`)
        else if (!stored || SquadCheckpoint.hash(stored.body) !== entry.checkpoint_sha256)
          pendencies.push(`${entry.name}: checkpoint corrompido`)
        if (entry.session_id !== null && (yield* activity.isActive(Session.ID.make(entry.session_id))))
          pendencies.push(`${entry.name}: execução ativa`)
      }
      if (pendencies.length > 0)
        return yield* new ConflictError({ message: "close blocked: the generation has open pendencies", pendencies })

      // The orchestrator stays open; only the other sessions are recorded as closed.
      yield* tx
        .update(SquadSessionTable)
        .set({ state: "closed", updated_at: now })
        .where(and(eq(SquadSessionTable.generation_id, generation.id), ne(SquadSessionTable.role, "orchestrator")))
        .run()
        .pipe(Effect.orDie)
      const closed = yield* store.sessions(tx, generation.id)
      yield* store.closeGeneration(tx, generation.id, { state: "closed", closed_at: now, closed_by: by })
      yield* tx
        .insert(SquadTransitionTable)
        .values({
          source_generation_id: generation.id,
          source_registry_digest: digestOf(generation.id, closed),
          previous_sessions_closed: true,
          previous_orchestrator_kept_open: closed.some((entry) => entry.role === "orchestrator"),
          closed_by: by,
          created_at: now,
        })
        .run()
        .pipe(Effect.orDie)
      for (const entry of closed)
        yield* tx
          .insert(SquadTransitionEntryTable)
          .values({
            source_generation_id: generation.id,
            name: entry.name,
            session_id: entry.session_id,
            checkpoint_sha256: entry.checkpoint_sha256,
            closed_at: entry.role === "orchestrator" ? null : now,
          })
          .run()
          .pipe(Effect.orDie)
      yield* store.insertIdempotency(tx, { key, generation_id: generation.id, kind: "close", result_ref: generation.id, created_at: now })
      const receipt = yield* receiptOf(tx, generation.id)
      return { receipt: receipt!, fresh: true }
    }),
  )
  if (result.fresh)
    yield* audit.append({
      kind: "close",
      generation: input.generation,
      target: input.generation,
      result: "accepted",
      actor: by,
      detail: result.receipt.sourceRegistryDigest,
    })
  return result.receipt
})
