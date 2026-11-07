export * as SquadCheckpoint from "./checkpoint.js"

import { createHash } from "node:crypto"
import { DateTime, Effect, Schema } from "effect"
import { and, eq } from "drizzle-orm"
import { Squad } from "@opencode/schema/squad"
import { Config } from "../config.js"
import { Database } from "../database/database.js"
import { SquadAudit } from "./audit.js"
import { DisabledError } from "./index.js"
import { ConflictError, SessionNotFoundError, SquadRegistry } from "./registry.js"
import { SquadCheckpointTable, SquadSessionTable } from "./sql.js"

export const REQUIRED_SECTIONS = [
  "Resultado",
  "Fontes",
  "Comandos e provas",
  "Limites",
  "Próximos passos",
  "Posse da árvore",
] as const

const DEFAULT_MAX_BYTES = 1048576

export class InvalidCheckpointError extends Schema.TaggedError<InvalidCheckpointError>()("InvalidCheckpointError", {
  message: Schema.String,
  missing: Schema.Array(Schema.String),
}) {}

export interface WriteInput {
  readonly name: string
  readonly body: string
  readonly allowSecretLikeText?: boolean
  readonly reason?: string
  readonly actor?: string
}

export const normalize = (body: string) => body.replace(/^\uFEFF/u, "").replace(/\r\n/gu, "\n")

export const hash = (body: string) => createHash("sha256").update(normalize(body), "utf8").digest("hex")

/** Required section titles that are absent or have an empty body. A section runs to the next heading of the same or a higher level. */
export const missingSections = (body: string): string[] => {
  const lines = normalize(body).split("\n")
  const headings = lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line)
    return match ? [{ index, level: match[1]!.length, title: match[2]!.trim() }] : []
  })
  const filled = new Set(
    headings.flatMap((heading, position) => {
      const end = headings.slice(position + 1).find((next) => next.level <= heading.level)?.index ?? lines.length
      return lines.slice(heading.index + 1, end).some((line) => line.trim() !== "") ? [heading.title] : []
    }),
  )
  return REQUIRED_SECTIONS.filter((title) => !filled.has(title))
}

export const looksSecret = (body: string) => SquadAudit.redact(body) !== body

const requireEnabled = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    const squad = Config.latest(entries, "squad")
    if (squad?.enabled !== true) return yield* new DisabledError()
    return squad.checkpoint?.max_bytes ?? DEFAULT_MAX_BYTES
  })

const toCheckpoint = (row: typeof SquadCheckpointTable.$inferSelect): Squad.Checkpoint =>
  Squad.Checkpoint.make({
    generationID: Squad.GenerationID.make(row.generation_id),
    name: Squad.SessionName.make(row.name),
    sha256: row.sha256,
    body: row.body,
    bytes: row.bytes,
    createdAt: DateTime.makeUnsafe(row.created_at),
  })

export const write = Effect.fn("SquadCheckpoint.write")(function* (input: WriteInput) {
  const maxBytes = yield* requireEnabled()
  const registry = yield* SquadRegistry.Service
  const audit = yield* SquadAudit.Service
  const db = (yield* Database.Service).db
  const actor = input.actor ?? "operator"
  const active = yield* registry.active()
  if (!active) return yield* new ConflictError({ message: "no active generation", pendencies: [] })
  if (!active.sessions.some((entry) => entry.name === input.name))
    return yield* new SessionNotFoundError({ message: `session ${input.name} not found in generation ${active.id}` })

  const refuse = (message: string, missing: string[] = []) =>
    audit
      .append({ kind: "checkpoint", generation: active.id, target: input.name, result: "refused", actor, detail: message })
      .pipe(Effect.andThen(Effect.fail(new InvalidCheckpointError({ message, missing }))))

  const body = normalize(input.body)
  const bytes = Buffer.byteLength(body, "utf8")
  if (bytes > maxBytes) return yield* refuse(`checkpoint has ${bytes} bytes, above squad.checkpoint.max_bytes (${maxBytes})`)
  const missing = missingSections(body)
  if (missing.length > 0) return yield* refuse(`checkpoint is missing sections: ${missing.join(", ")}`, missing)
  const secret = looksSecret(body)
  if (secret && !input.allowSecretLikeText)
    return yield* refuse("checkpoint contains secret-like text; pass --allow-secret-like-text with --reason to record it anyway")
  if (secret && (input.reason === undefined || input.reason.trim() === ""))
    return yield* refuse("--allow-secret-like-text requires --reason")

  const sha256 = hash(body)
  const now = Date.now()
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        yield* tx
          .insert(SquadCheckpointTable)
          .values({ generation_id: active.id, name: input.name, sha256, body, bytes, created_at: now })
          .onConflictDoNothing()
          .run()
        yield* tx
          .update(SquadSessionTable)
          .set({ checkpoint_sha256: sha256, updated_at: now })
          .where(and(eq(SquadSessionTable.generation_id, active.id), eq(SquadSessionTable.name, input.name)))
          .run()
      }),
    )
    .pipe(Effect.orDie)
  yield* audit.append({
    kind: "checkpoint",
    generation: active.id,
    target: input.name,
    result: secret ? "accepted_secret_like" : "accepted",
    actor,
    detail: secret ? `allow-secret-like-text: ${input.reason}` : sha256,
  })
  return Squad.Checkpoint.make({
    generationID: Squad.GenerationID.make(active.id),
    name: Squad.SessionName.make(input.name),
    sha256,
    body,
    bytes,
    createdAt: DateTime.makeUnsafe(now),
  })
})

/** The checkpoint a session currently points at, or `undefined` when it has none. */
export const latest = Effect.fn("SquadCheckpoint.latest")(function* (input: { generation: string; name: string }) {
  yield* requireEnabled()
  const db = (yield* Database.Service).db
  const session = yield* db
    .select()
    .from(SquadSessionTable)
    .where(and(eq(SquadSessionTable.generation_id, input.generation), eq(SquadSessionTable.name, input.name)))
    .get()
    .pipe(Effect.orDie)
  if (!session?.checkpoint_sha256) return undefined
  const row = yield* db
    .select()
    .from(SquadCheckpointTable)
    .where(
      and(
        eq(SquadCheckpointTable.generation_id, input.generation),
        eq(SquadCheckpointTable.name, input.name),
        eq(SquadCheckpointTable.sha256, session.checkpoint_sha256),
      ),
    )
    .get()
    .pipe(Effect.orDie)
  return row ? toCheckpoint(row) : undefined
})

/** Every checkpoint ever written for a session, oldest first. */
export const history = Effect.fn("SquadCheckpoint.history")(function* (input: { generation: string; name: string }) {
  yield* requireEnabled()
  const db = (yield* Database.Service).db
  const rows = yield* db
    .select()
    .from(SquadCheckpointTable)
    .where(and(eq(SquadCheckpointTable.generation_id, input.generation), eq(SquadCheckpointTable.name, input.name)))
    .orderBy(SquadCheckpointTable.created_at)
    .all()
    .pipe(Effect.orDie)
  return rows.map(toCheckpoint)
})

/** The file a caller writes outside the versioned tree: its content hashes to the checkpoint's `sha256`. */
export const exportDocument = (checkpoint: Squad.Checkpoint) => ({
  filename: `${checkpoint.generationID}-${checkpoint.name}-${checkpoint.sha256.slice(0, 12)}.md`,
  content: checkpoint.body,
})
