export * as SquadAudit from "./audit.js"

import { Context, DateTime, Effect, Layer } from "effect"
import { gte } from "drizzle-orm"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { Squad } from "@opencode/schema/squad"
import { Database } from "../database/database.js"
import { SquadAuditTable } from "./sql.js"

export interface AppendInput {
  readonly kind: Squad.AuditKind
  readonly generation?: string
  readonly target: string
  readonly sessionID?: string
  readonly messageID?: string
  readonly message?: string
  readonly delivery?: "queue" | "steer"
  readonly result: string
  readonly idempotencyKey?: string
  readonly actor: string
  readonly detail?: string
}

export interface Interface {
  readonly append: (input: AppendInput) => Effect.Effect<Squad.AuditEntry, never, Database.Service>
  readonly list: (filter?: { since?: number }) => Effect.Effect<ReadonlyArray<Squad.AuditEntry>, never, Database.Service>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/Audit") {}

export const redact = (text: string) => text

const toEntry = (row: typeof SquadAuditTable.$inferSelect): Squad.AuditEntry =>
  Squad.AuditEntry.make({
    id: row.id,
    at: DateTime.makeUnsafe(row.at),
    kind: row.kind as Squad.AuditKind,
    generation: row.generation_id ? Squad.GenerationID.make(row.generation_id) : undefined,
    target: row.target,
    sessionID: row.session_id ? Session.ID.make(row.session_id) : undefined,
    messageID: row.message_id ? SessionMessage.ID.make(row.message_id) : undefined,
    messageSha256: row.message_sha256 ?? undefined,
    delivery: row.delivery ?? undefined,
    result: row.result,
    idempotencyKey: row.idempotency_key ?? undefined,
    actor: row.actor,
    prevHash: row.prev_hash,
    detail: row.detail ?? undefined,
  })

export const layer = Layer.succeed(
  Service,
  Service.of({
    append: Effect.fn("SquadAudit.append")(function* (input) {
      const db = (yield* Database.Service).db
      const row = yield* db
        .insert(SquadAuditTable)
        .values({
          at: Date.now(),
          kind: input.kind,
          generation_id: input.generation ?? null,
          target: input.target,
          session_id: input.sessionID ?? null,
          message_id: input.messageID ?? null,
          message_sha256: null,
          delivery: input.delivery ?? null,
          result: input.result,
          idempotency_key: input.idempotencyKey ?? null,
          actor: input.actor,
          prev_hash: "",
          detail: input.detail ?? input.message ?? null,
        })
        .returning()
        .get()
        .pipe(Effect.orDie)
      return toEntry(row)
    }),
    list: Effect.fn("SquadAudit.list")(function* (filter) {
      const db = (yield* Database.Service).db
      const rows = yield* (filter?.since === undefined
        ? db.select().from(SquadAuditTable).orderBy(SquadAuditTable.id).all()
        : db.select().from(SquadAuditTable).where(gte(SquadAuditTable.at, filter.since)).orderBy(SquadAuditTable.id).all()
      ).pipe(Effect.orDie)
      return rows.map(toEntry)
    }),
  }),
)
