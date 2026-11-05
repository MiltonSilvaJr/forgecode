export * as SquadStore from "./store.js"

import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { EffectDrizzleSqlite } from "../database/drizzle.js"
import { SquadGenerationTable, SquadIdempotencyTable, SquadSessionTable } from "./sql.js"

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

const voidRun = (effect: Effect.Effect<unknown, unknown>) => effect.pipe(Effect.orDie, Effect.asVoid)

export const Default: Interface = {
  insertGeneration: (tx, row) => voidRun(tx.insert(SquadGenerationTable).values(row).run()),
  insertSession: (tx, row) => voidRun(tx.insert(SquadSessionTable).values(row).run()),
  insertIdempotency: (tx, row) => voidRun(tx.insert(SquadIdempotencyTable).values(row).run()),
  closeGeneration: (tx, id, patch) =>
    voidRun(
      tx.update(SquadGenerationTable).set({ state: "closed", closed_at: patch.closed_at, closed_by: patch.closed_by }).where(eq(SquadGenerationTable.id, id)).run(),
    ),
  activeGeneration: (q) =>
    q
      .select()
      .from(SquadGenerationTable)
      .where(eq(SquadGenerationTable.state, "active"))
      .get()
      .pipe(Effect.orDie),
  generation: (q, id) => q.select().from(SquadGenerationTable).where(eq(SquadGenerationTable.id, id)).get().pipe(Effect.orDie),
  sessions: (q, generationID) =>
    q
      .select()
      .from(SquadSessionTable)
      .where(eq(SquadSessionTable.generation_id, generationID))
      .all()
      .pipe(Effect.orDie),
  countActive: (q) =>
    q
      .select({ id: SquadGenerationTable.id })
      .from(SquadGenerationTable)
      .where(eq(SquadGenerationTable.state, "active"))
      .all()
      .pipe(Effect.orDie, Effect.map((rows) => rows.length)),
  idempotency: (q, key) => q.select().from(SquadIdempotencyTable).where(eq(SquadIdempotencyTable.key, key)).get().pipe(Effect.orDie),
}

export const layer = Layer.succeed(Service, Service.of(Default))
