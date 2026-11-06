export * as SquadActivate from "./activate.js"

import { createHash } from "node:crypto"
import { DateTime, Effect } from "effect"
import { eq } from "drizzle-orm"
import { Session } from "@opencode/schema/session"
import { Squad } from "@opencode/schema/squad"
import { Database } from "../database/database.js"
import { SquadAudit } from "./audit.js"
import { SquadChannel } from "./channel.js"
import { requireEnabled } from "./guard.js"
import { ConflictError } from "./registry.js"
import { SquadTransitionTable } from "./sql.js"
import { SquadStore } from "./store.js"

export interface ActivateInput {
  readonly generation?: string
  readonly registryPath?: string
  readonly actor?: string
}

/**
 * Hand the active generation over to its orchestrator. The generation must be complete (every session
 * verified) and bound to a close receipt. The message authorizes bootstrap and continuity reading only,
 * and `productive` is left untouched: it is an auditable flag, not a gate.
 */
export const activate = Effect.fn("SquadActivate.activate")(function* (input: ActivateInput) {
  yield* requireEnabled()
  const db = (yield* Database.Service).db
  const store = yield* SquadStore.Service
  const channel = yield* SquadChannel.Service
  const audit = yield* SquadAudit.Service

  const active = yield* store.activeGeneration(db)
  if (!active) return yield* new ConflictError({ message: "no active generation; run squad init first", pendencies: [] })
  if (input.generation !== undefined && input.generation !== active.id)
    return yield* new ConflictError({
      message: `generation ${input.generation} is not the active generation (${active.id})`,
      pendencies: [],
    })
  const sessions = yield* store.sessions(db, active.id)
  const orchestrator = sessions.find((entry) => entry.role === "orchestrator")
  const key = createHash("sha256").update(`activate\n${active.id}\n${active.id}`).digest("hex")

  const existing = yield* store.idempotency(db, key)
  if (existing && orchestrator?.session_id)
    return proof(orchestrator, DateTime.makeUnsafe(existing.created_at))

  const transition = yield* db
    .select()
    .from(SquadTransitionTable)
    .where(eq(SquadTransitionTable.target_generation_id, active.id))
    .get()
    .pipe(Effect.orDie)
  const pendencies = [
    ...sessions.filter((entry) => entry.state !== "verified").map((entry) => `${entry.name}: ${entry.state}, not verified`),
    ...(orchestrator ? [] : ["no orchestrator session in the generation"]),
    ...(transition ? [] : [`no transition receipt bound to ${active.id}; run squad transition first`]),
  ]
  if (pendencies.length > 0 || !orchestrator?.session_id)
    return yield* new ConflictError({ message: `activate blocked: ${pendencies.join("; ")}`, pendencies })

  const enqueued = yield* channel.enqueue({
    sessionID: Session.ID.make(orchestrator.session_id),
    text: transferMessage(active.id, transition!.source_generation_id, sessions, input.registryPath),
    delivery: "queue",
    idempotencyKey: `activate:${active.id}`,
  })
  const now = Date.now()
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        if (yield* store.idempotency(tx, key)) return
        yield* store.insertIdempotency(tx, {
          key,
          generation_id: active.id,
          kind: "activate",
          result_ref: enqueued.messageID,
          created_at: now,
        })
      }),
    )
    .pipe(Effect.orDie)
  yield* audit.append({
    kind: "activate",
    generation: active.id,
    target: orchestrator.name,
    sessionID: orchestrator.session_id,
    messageID: enqueued.messageID,
    delivery: "queue",
    result: "accepted",
    idempotencyKey: `activate:${active.id}`,
    actor: input.actor ?? "operator",
    detail: "productive=false",
  })
  return proof(orchestrator, DateTime.makeUnsafe(now), enqueued.messageID)
})

const proof = (
  orchestrator: SquadStore.SessionRow,
  at: DateTime.Utc,
  messageID = SquadChannel.messageIDFor(`activate:${orchestrator.generation_id}`, Session.ID.make(orchestrator.session_id!)),
) =>
  Squad.EnqueueProof.make({
    messageID,
    name: Squad.SessionName.make(orchestrator.name),
    sessionID: Session.ID.make(orchestrator.session_id!),
    delivery: "queue",
    at,
  })

const transferMessage = (
  generation: string,
  source: string,
  sessions: readonly SquadStore.SessionRow[],
  registryPath: string | undefined,
) =>
  [
    `SQUAD activation: generation ${generation} is now handed to you, transferred from ${source}.`,
    `Registry: ${registryPath ?? "squad registry of the server database"} (generation ${generation}).`,
    `Verified sessions: ${sessions.map((entry) => `${entry.name} (${entry.session_id})`).join(", ")}.`,
    "Only bootstrap and reading of your continuity are authorized by this message. Productive execution is not released.",
  ].join("\n")
