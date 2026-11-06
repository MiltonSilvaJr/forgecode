export * as SquadDispatch from "./dispatch.js"

import { randomUUID } from "node:crypto"
import { DateTime, Effect, Schema } from "effect"
import { eq, sql } from "drizzle-orm"
import { Squad } from "@opencode/schema/squad"
import { Database } from "../database/database.js"
import { Git } from "../git.js"
import { AbsolutePath } from "../schema.js"
import { SquadAudit } from "./audit.js"
import { requireEnabled } from "./guard.js"
import { InvalidInputError } from "./invalid.js"
import { ConflictError } from "./registry.js"
import { SquadDispatchTable } from "./sql.js"
import { SquadStore } from "./store.js"

export interface CreateInput {
  readonly scope?: string
  readonly owner?: string
  readonly base?: string
  readonly head?: string
  readonly dor?: string
  readonly dod?: string
  readonly proof?: string
  readonly exclusions?: readonly string[]
  readonly exigidos?: readonly string[]
  readonly milestone?: string
  readonly actor?: string
}

export class DispatchNotFoundError extends Schema.TaggedError<DispatchNotFoundError>()("DispatchNotFoundError", {
  message: Schema.String,
}) {}

const defaultExigidos: readonly Squad.Exigidos[] = ["ci", "merge", "acceptance"]

// A branch name Git would accept, decided without Git: no leading "-" or "/", no "..", "@{", "//", trailing "/" or ".lock".
const headSyntax = /^(?!-)(?!.*\.\.)(?!.*@\{)(?!\/)(?!.*\/\/)(?!.*\/$)(?!.*\.lock$)[A-Za-z0-9._/-]+$/u

type Row = typeof SquadDispatchTable.$inferSelect

export const toDispatch = (row: Row, warnings?: readonly string[]): Squad.Dispatch =>
  Squad.Dispatch.make({
    id: row.id,
    generationID: Squad.GenerationID.make(row.generation_id),
    orqID: row.orq_id,
    seq: row.seq,
    scope: row.scope,
    owner: Squad.SessionName.make(row.owner),
    base: row.base,
    head: row.head,
    dor: row.dor,
    dod: row.dod,
    proof: row.proof,
    exclusions: row.exclusions as [string, ...string[]],
    exigidos: row.exigidos as [Squad.Exigidos, ...Squad.Exigidos[]],
    milestone: row.milestone,
    baseOid: row.base_oid ?? undefined,
    headOid: row.head_oid ?? undefined,
    validation: row.validation,
    state: row.state,
    acceptedAt: row.accepted_at === null ? undefined : DateTime.makeUnsafe(row.accepted_at),
    acceptedBy: row.accepted_by === null ? undefined : Squad.SessionName.make(row.accepted_by),
    createdAt: DateTime.makeUnsafe(row.created_at),
    ...(warnings === undefined || warnings.length === 0 ? {} : { warnings }),
  })

const blank = (value: string | undefined) => value === undefined || value.trim() === ""

const missingFields = (input: CreateInput) =>
  [
    ["scope", blank(input.scope)],
    ["owner", blank(input.owner)],
    ["base", blank(input.base)],
    ["head", blank(input.head)],
    ["dor", blank(input.dor)],
    ["dod", blank(input.dod)],
    ["proof", blank(input.proof)],
    ["exclusions", input.exclusions === undefined || input.exclusions.filter((entry) => entry.trim() !== "").length === 0],
    ["milestone", blank(input.milestone)],
  ].flatMap(([name, absent]) => (absent ? [name as string] : []))

const requireValid = (input: CreateInput) => {
  const missing = missingFields(input)
  if (missing.length > 0) return new InvalidInputError({ message: `missing required fields: ${missing.join(", ")}`, missing })
  const unknown = (input.exigidos ?? []).filter((entry) => !Squad.Exigidos.literals.some((literal) => literal === entry))
  if (unknown.length > 0)
    return new InvalidInputError({
      message: `invalid exigidos: ${unknown.join(", ")}; expected a subset of ${Squad.Exigidos.literals.join(", ")}`,
      missing: [],
    })
  if (input.exigidos !== undefined && input.exigidos.length === 0)
    return new InvalidInputError({ message: "exigidos must not be empty", missing: ["exigidos"] })
  return undefined
}

export const create = Effect.fn("SquadDispatch.create")(function* (input: CreateInput) {
  yield* requireEnabled()
  const invalid = requireValid(input)
  if (invalid) return yield* invalid
  const owner = input.owner!.trim()
  const base = input.base!.trim()
  const head = input.head!.trim()
  const db = (yield* Database.Service).db
  const store = yield* SquadStore.Service
  const audit = yield* SquadAudit.Service
  const git = yield* Git.Service

  const generation = yield* store.activeGeneration(db)
  if (!generation) return yield* new ConflictError({ message: "no active generation; run squad init first", pendencies: [] })
  const ownerSession = yield* store.sessionByName(db, generation.id, owner)
  if (!ownerSession)
    return yield* new ConflictError({ message: `owner ${owner} is not a session of generation ${generation.id}`, pendencies: [] })
  if (!headSyntax.test(head))
    return yield* new InvalidInputError({ message: `head ${head} is not a valid branch name`, missing: [] })
  if (base.startsWith("-"))
    return yield* new InvalidInputError({ message: `base ${base} is not a valid reference`, missing: [] })

  const warnings: string[] = []
  const repository = yield* git.repo.discover(AbsolutePath.make(ownerSession.location.directory))
  let baseOid: string | undefined
  let headOid: string | undefined
  if (!repository) {
    warnings.push("not a git repository: base and head could not be measured (validation unknown)")
  } else {
    baseOid = yield* git.history.resolve(repository, base)
    if (baseOid === undefined) return yield* new InvalidInputError({ message: `base ${base} does not exist`, missing: [] })
    headOid = yield* git.history.resolve(repository, head)
    if (headOid === undefined) warnings.push(`head ${head} does not exist yet; its commit could not be measured (validation unknown)`)
  }
  const validation = baseOid !== undefined && headOid !== undefined ? "verified" : "unknown"

  const now = Date.now()
  const row = yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        const last = yield* tx
          .select({ seq: sql<number>`coalesce(max(${SquadDispatchTable.seq}), 0)` })
          .from(SquadDispatchTable)
          .where(eq(SquadDispatchTable.generation_id, generation.id))
          .get()
        const seq = (last?.seq ?? 0) + 1
        return yield* tx
          .insert(SquadDispatchTable)
          .values({
            id: randomUUID(),
            generation_id: generation.id,
            orq_id: `ORQ-${generation.id}-${String(seq).padStart(3, "0")}`,
            seq,
            scope: input.scope!.trim(),
            owner,
            base,
            head,
            base_oid: baseOid ?? null,
            head_oid: headOid ?? null,
            validation,
            dor: input.dor!.trim(),
            dod: input.dod!.trim(),
            proof: input.proof!.trim(),
            exclusions: input.exclusions!.filter((entry) => entry.trim() !== ""),
            exigidos: [...(input.exigidos ?? defaultExigidos)],
            milestone: input.milestone!.trim(),
            state: "open",
            created_at: now,
          })
          .returning()
          .get()
      }),
    )
    .pipe(Effect.orDie)

  yield* audit.append({
    kind: "dispatch",
    generation: generation.id,
    target: owner,
    result: "created",
    actor: input.actor ?? "operator",
    detail: `${row.orq_id} base=${baseOid ?? "unknown"} head=${headOid ?? "unknown"} validation=${validation}`,
  })
  return toDispatch(row, warnings)
})

export const list = Effect.fn("SquadDispatch.list")(function* () {
  yield* requireEnabled()
  const db = (yield* Database.Service).db
  const store = yield* SquadStore.Service
  const generation = yield* store.activeGeneration(db)
  if (!generation) return [] as readonly Squad.Dispatch[]
  const rows = yield* db
    .select()
    .from(SquadDispatchTable)
    .where(eq(SquadDispatchTable.generation_id, generation.id))
    .orderBy(SquadDispatchTable.seq)
    .all()
    .pipe(Effect.orDie)
  return rows.map((row) => toDispatch(row))
})

export interface AcceptInput {
  readonly orq: string
  readonly by?: string
}

export const accept = Effect.fn("SquadDispatch.accept")(function* (input: AcceptInput) {
  const db = (yield* Database.Service).db
  const row = yield* db.select().from(SquadDispatchTable).where(eq(SquadDispatchTable.orq_id, input.orq)).get().pipe(Effect.orDie)
  if (!row) return yield* new DispatchNotFoundError({ message: `dispatch ${input.orq} not found` })
  return toDispatch(row)
})
