import { describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { Effect, Exit, Scope } from "effect"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import type { SqlClient } from "effect/sql/SqlClient"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { DatabaseMigration } from "@opencode/core/database/migration"
import { SquadGenerationTable } from "@opencode/core/squad/sql"
import { Global } from "@opencode/util/global"

const makeDb = EffectDrizzleSqlite.makeWithDefaults()

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient | Scope.Scope | Global.Service>) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(
        Effect.provideService(Global.Service, Global.make({ data: "/tmp/squad-schema-test" })),
        Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })),
      ),
    ),
  )

const required = [
  "squad_generation",
  "squad_session",
  "squad_tree_owner",
  "squad_checkpoint",
  "squad_transition",
  "squad_transition_entry",
  "squad_dispatch",
  "squad_audit",
  "squad_idempotency",
  "squad_block",
] as const

const tableNames = () =>
  run(
    Effect.gen(function* () {
      const db = yield* makeDb
      yield* DatabaseMigration.apply(db)
      const rows = yield* db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'squad_%'`,
      )
      return rows.map((row) => row.name).toSorted()
    }),
  )

describe("Squad store schema", () => {
  test("creates all ten squad tables", async () => {
    const names = await tableNames()
    expect(names.length).toBe(required.length)
    expect(names).toEqual([...required].toSorted())
  })

  test("enforces a single active generation via the partial index", async () => {
    await run(
      Effect.gen(function* () {
        const db = yield* makeDb
        yield* DatabaseMigration.apply(db)
        yield* db
          .insert(SquadGenerationTable)
          .values({ id: "gen-1", run_id: "run-1", state: "active", created_at: 1 })
          .run()
        const exit = yield* db
          .insert(SquadGenerationTable)
          .values({ id: "gen-2", run_id: "run-2", state: "active", created_at: 2 })
          .run()
          .pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
      }),
    )
  })
})
