import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { and, eq, isNull } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { SquadLaunch } from "@opencode/core/squad/launch"
import { SquadOwnership } from "@opencode/core/squad/ownership"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSessionTable, SquadTreeOwnerTable } from "@opencode/core/squad/sql"
import { fakeWorld } from "../fixture/squad-world"
import { squadBase } from "../fixture/squad-env"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const entry = (name: string) => ({
  name,
  role: "worker" as const,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
})

const run = <A, E, R>(world: ReturnType<typeof fakeWorld>, body: Effect.Effect<A, E, R>) =>
  tmpdirScoped().pipe(
    Effect.flatMap((dir) =>
      body.pipe(
        Effect.provide(
          Layer.mergeAll(squadBase(dir.path), world.sessionLayer, world.channelLayer, SquadOwnership.checkpointLayer),
        ),
      ),
    ),
  )

const owners = (name: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db
      .select()
      .from(SquadTreeOwnerTable)
      .where(and(eq(SquadTreeOwnerTable.tree_key, `/squad/${name}`), isNull(SquadTreeOwnerTable.released_at)))
      .all()
  })

describe("SquadLaunch tree ownership", () => {
  it.live("a verified session owns its tree via launch", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS")] })
        yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 })
        const rows = yield* owners("ATLAS")
        expect(rows.map((row) => [row.owner_name, row.generation_id, row.acquired_via])).toEqual([["ATLAS", "gen-1", "launch"]])
      }),
    )
  })

  it.live("a tree still owned by an older generation fails the launch without marking verified", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        const registry = yield* SquadRegistry.Service
        yield* SquadOwnership.acquireTree({ generationID: "gen-0", name: "OLD", directory: "/squad/ATLAS", via: "dispatch" })
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS")] })
        const exit = yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 }).pipe(Effect.exit)
        const error = Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string; message?: string }) : undefined
        expect(error?._tag).toBe("ConflictError")
        expect(error?.message).toContain("OLD")
        const db = (yield* Database.Service).db
        const row = yield* db.select().from(SquadSessionTable).where(eq(SquadSessionTable.name, "ATLAS")).get()
        expect(row?.state).toBe("starting")
        yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 }).pipe(Effect.exit)
        expect(world.creates.length).toBe(1)
        expect((yield* owners("ATLAS")).map((owner) => owner.owner_name)).toEqual(["OLD"])
      }),
    )
  })
})
