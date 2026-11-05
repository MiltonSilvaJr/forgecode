export * as SquadRegistry from "./registry.js"

import { createHash, randomUUID } from "node:crypto"
import { Context, Effect, Layer, Schema } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { Session } from "@opencode/schema/session"
import { Config } from "../config.js"
import { Database } from "../database/database.js"
import { DisabledError } from "./index.js"
import { SquadStore } from "./store.js"

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", {
  message: Schema.String,
  pendencies: Schema.Array(Schema.String),
}) {}

export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()("SessionNotFoundError", {
  message: Schema.String,
}) {}

export interface SessionRecord {
  name: string
  sessionID: string | null
  state: string
}

export interface ResolvedSession {
  generationID: string
  name: string
  sessionID: string | null
  state: string
}

export interface DigestSession {
  name: string
  provider: string
  model: string
  variant: string | null
  location: string
  branch: string | null
  sessionID: string | null
  state: string
}

export interface GenerationResult {
  id: string
  runID: string
  state: "active" | "closed"
  sessions: readonly SessionRecord[]
}

export interface InitSession {
  name: string
  role: "orchestrator" | "worker"
  provider: string
  model: string
  variant?: string
  location: { directory: string; workspaceID?: string }
  branch?: string
  sessionID?: string
}

export interface InitInput {
  generation: string
  sessions: readonly InitSession[]
  replace?: boolean
  reason?: string
  idempotencyKey?: string
}

export interface Interface {
  readonly init: (
    input: InitInput,
  ) => Effect.Effect<GenerationResult, DisabledError | ConflictError | SqlError, Database.Service | SquadStore.Service | Config.Service>
  readonly get: (
    id: string,
  ) => Effect.Effect<GenerationResult | undefined, never, Database.Service | SquadStore.Service>
  readonly active: () => Effect.Effect<GenerationResult | undefined, never, Database.Service | SquadStore.Service>
  readonly countActive: () => Effect.Effect<number, never, Database.Service | SquadStore.Service>
  readonly resolve: (
    ref: string,
  ) => Effect.Effect<ResolvedSession, SessionNotFoundError, Database.Service | SquadStore.Service>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/Registry") {}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

const initKey = (generation: string, idempotencyKey?: string) => sha256(`init\n${generation}\n${idempotencyKey ?? generation}`)

const read = (generation: SquadStore.GenerationRow, sessions: readonly SquadStore.SessionRow[]): GenerationResult => ({
  id: generation.id,
  runID: generation.run_id,
  state: generation.state,
  sessions: sessions.map((entry) => ({ name: entry.name, sessionID: entry.session_id, state: entry.state })),
})

const resolved = (session: SquadStore.SessionRow): ResolvedSession => ({
  generationID: session.generation_id,
  name: session.name,
  sessionID: session.session_id,
  state: session.state,
})

export const registryDigest = (generation: string, sessions: readonly DigestSession[]): string => {
  const sorted = [...sessions].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return sha256(
    JSON.stringify({
      generation,
      sessions: sorted.map((entry) => ({
        name: entry.name,
        provider: entry.provider,
        model: entry.model,
        variant: entry.variant,
        location: entry.location,
        branch: entry.branch,
        sessionID: entry.sessionID,
        state: entry.state,
      })),
    }),
  )
}

const requireEnabled = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    if (Config.latest(entries, "squad")?.enabled !== true) return yield* new DisabledError()
  })

const closePendencies = (store: SquadStore.Interface, tx: SquadStore.Transaction, generationID: string) =>
  Effect.gen(function* () {
    const sessions = yield* store.sessions(tx, generationID)
    const pendencies: string[] = []
    for (const entry of sessions) {
      if (!entry.checkpoint_sha256) pendencies.push(`${entry.name}: checkpoint ausente`)
    }
    return pendencies
  })

export const layer = Layer.succeed(
  Service,
  Service.of({
    init: Effect.fn("SquadRegistry.init")(function* (input) {
      yield* requireEnabled()
      const db = (yield* Database.Service).db
      const store = yield* SquadStore.Service
      const key = initKey(input.generation, input.idempotencyKey)
      const now = Date.now()
      return yield* db.transaction((tx) =>
        Effect.gen(function* () {
          const existing = yield* store.idempotency(tx, key)
          if (existing) {
            if (existing.kind !== "init" || existing.generation_id !== input.generation)
              return yield* new ConflictError({ message: "idempotency key reused for a different operation", pendencies: [] })
            const generation = yield* store.generation(tx, existing.result_ref)
            if (!generation)
              return yield* new ConflictError({ message: "idempotency references a missing generation", pendencies: [] })
            return read(generation, yield* store.sessions(tx, existing.result_ref))
          }
          const active = yield* store.activeGeneration(tx)
          if (active) {
            if (!input.replace)
              return yield* new ConflictError({ message: `generation ${active.id} is already active`, pendencies: [] })
            const pendencies = yield* closePendencies(store, tx, active.id)
            if (pendencies.length > 0)
              return yield* new ConflictError({
                message: "replace blocked: previous generation has open pendencies",
                pendencies,
              })
            yield* store.closeGeneration(tx, active.id, { state: "closed", closed_at: now, closed_by: "replace" })
          }
          yield* store.insertGeneration(tx, { id: input.generation, run_id: randomUUID(), state: "active", created_at: now })
          for (const entry of input.sessions) {
            yield* store.insertSession(tx, {
              generation_id: input.generation,
              name: entry.name,
              role: entry.role,
              provider: entry.provider,
              model: entry.model,
              variant: entry.variant ?? null,
              location: entry.location,
              branch: entry.branch ?? null,
              session_id: entry.sessionID ?? null,
              state: "creating",
              productive: false,
              created_at: now,
              updated_at: now,
            })
          }
          yield* store.insertIdempotency(tx, {
            key,
            generation_id: input.generation,
            kind: "init",
            result_ref: input.generation,
            created_at: now,
          })
          const generation = yield* store.generation(tx, input.generation)
          const sessions = yield* store.sessions(tx, input.generation)
          return read(generation!, sessions)
        }),
      )
    }),
    get: (id) =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const store = yield* SquadStore.Service
        const generation = yield* store.generation(db, id)
        if (!generation) return undefined
        return read(generation, yield* store.sessions(db, id))
      }),
    active: () =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const store = yield* SquadStore.Service
        const generation = yield* store.activeGeneration(db)
        if (!generation) return undefined
        return read(generation, yield* store.sessions(db, generation.id))
      }),
    countActive: () =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const store = yield* SquadStore.Service
        return yield* store.countActive(db)
      }),
    resolve: (ref) =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const store = yield* SquadStore.Service
        if (Schema.is(Session.ID)(ref)) {
          const session = yield* store.sessionByID(db, ref)
          if (!session) return yield* new SessionNotFoundError({ message: `session ${ref} not found` })
          return resolved(session)
        }
        const active = yield* store.activeGeneration(db)
        if (active) {
          const session = yield* store.sessionByName(db, active.id, ref)
          if (session) return resolved(session)
        }
        const found = yield* store.findSessionByName(db, ref)
        if (found)
          return yield* new SessionNotFoundError({
            message: `session ${ref} belongs to generation ${found.generation_id}; use --session-id`,
          })
        return yield* new SessionNotFoundError({ message: `session ${ref} not found` })
      }),
  }),
)
