export * as SquadAudit from "./audit.js"

import { createHash } from "node:crypto"
import { Context, DateTime, Effect, Layer } from "effect"
import { desc, gte } from "drizzle-orm"
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

const GENESIS = "0".repeat(64)

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

const secretPatterns: ReadonlyArray<readonly [RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gu, "[redacted]"],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gu, "Bearer [redacted]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/gu, "[redacted]"],
  [/\bghp_[A-Za-z0-9]{8,}/gu, "[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/gu, "[redacted]"],
  [/"token"\s*:\s*"[^"]*"/gu, '"token": "[redacted]"'],
]

/** Replace credential-shaped values with `[redacted]`. */
export const redact = (text: string) => secretPatterns.reduce((out, [pattern, to]) => out.replace(pattern, to), text)

/**
 * A failure reason that is safe to persist: no stack frames, no absolute user path, no secret.
 * Applied to every `detail` on write, so no caller can bypass it.
 */
export const scrub = (text: string) =>
  redact(
    text
      .split("\n")
      .filter((line) => !/^\s+at\s/u.test(line))
      .join("\n")
      .replace(/(?:[A-Za-z]:)?(?:[\\/][\w.@~+-]+){2,}/gu, "[path]"),
  )

type Row = typeof SquadAuditTable.$inferSelect

/** Hash of a stored line; the next line records it as `prev_hash`. */
export const rowHash = (row: Row) =>
  sha256(
    JSON.stringify([
      row.id,
      row.at,
      row.kind,
      row.generation_id,
      row.target,
      row.session_id,
      row.message_id,
      row.message_sha256,
      row.delivery,
      row.result,
      row.idempotency_key,
      row.actor,
      row.prev_hash,
      row.detail,
    ]),
  )

const toEntry = (row: Row): Squad.AuditEntry =>
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
        .transaction((tx) =>
          Effect.gen(function* () {
            const last = yield* tx.select().from(SquadAuditTable).orderBy(desc(SquadAuditTable.id)).limit(1).get()
            return yield* tx
              .insert(SquadAuditTable)
              .values({
                at: Date.now(),
                kind: input.kind,
                generation_id: input.generation ?? null,
                target: input.target,
                session_id: input.sessionID ?? null,
                message_id: input.messageID ?? null,
                message_sha256: input.message === undefined ? null : sha256(input.message),
                delivery: input.delivery ?? null,
                result: input.result,
                idempotency_key: input.idempotencyKey ?? null,
                actor: input.actor,
                prev_hash: last ? rowHash(last) : GENESIS,
                detail: input.detail === undefined ? null : scrub(input.detail),
              })
              .returning()
              .get()
          }),
        )
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

export const chain = Effect.fn("SquadAudit.chain")(function* (filter?: { since?: number }) {
  const audit = yield* Service
  const entries = yield* audit.list(filter)
  return Squad.AuditChain.make({ entries, digest: "", integrity: "integrity_broken" })
})
