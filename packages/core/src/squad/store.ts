export * as SquadStore from "./store.js"

import { Context, Effect, Layer } from "effect"
import { EffectDrizzleSqlite } from "../database/drizzle.js"
import type { SquadGenerationTable, SquadIdempotencyTable, SquadSessionTable } from "./sql.js"

export type Database = EffectDrizzleSqlite.EffectSQLiteDatabase
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]
export type Querier = Database | Transaction
export type GenerationRow = typeof SquadGenerationTable.$inferSelect
export type SessionRow = typeof SquadSessionTable.$inferSelect
export type GenerationInsert = typeof SquadGenerationTable.$inferInsert
export type SessionInsert = typeof SquadSessionTable.$inferInsert
export type IdempotencyRow = typeof SquadIdempotencyTable.$inferSelect
export type IdempotencyInsert = typeof SquadIdempotencyTable.$inferInsert

export interface Interface {
  readonly insertGeneration: (tx: Transaction, row: GenerationInsert) => Effect.Effect<void>
  readonly insertSession: (tx: Transaction, row: SessionInsert) => Effect.Effect<void>
  readonly insertIdempotency: (tx: Transaction, row: IdempotencyInsert) => Effect.Effect<void>
  readonly closeGeneration: (
    tx: Transaction,
    id: string,
    patch: { state: "closed"; closed_at: number; closed_by: string },
  ) => Effect.Effect<void>
  readonly activeGeneration: (q: Querier) => Effect.Effect<GenerationRow | undefined>
  readonly generation: (q: Querier, id: string) => Effect.Effect<GenerationRow | undefined>
  readonly sessions: (q: Querier, generationID: string) => Effect.Effect<readonly SessionRow[]>
  readonly countActive: (q: Querier) => Effect.Effect<number>
  readonly idempotency: (q: Querier, key: string) => Effect.Effect<IdempotencyRow | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/Store") {}

export const Default: Interface = {
  insertGeneration: () => Effect.void,
  insertSession: () => Effect.void,
  insertIdempotency: () => Effect.void,
  closeGeneration: () => Effect.void,
  activeGeneration: () => Effect.succeed(undefined),
  generation: () => Effect.succeed(undefined),
  sessions: () => Effect.succeed([]),
  countActive: () => Effect.succeed(0),
  idempotency: () => Effect.succeed(undefined),
}

export const layer = Layer.succeed(Service, Service.of(Default))
