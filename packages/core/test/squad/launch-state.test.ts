import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { SquadLaunch } from "@opencode/core/squad/launch"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSessionTable } from "@opencode/core/squad/sql"
import { fakeWorld } from "../fixture/squad-world"
import { squadBase } from "../fixture/squad-env"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const entry = (name: string, role: "orchestrator" | "worker" = "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
})

const layerFor = (directory: string, world: ReturnType<typeof fakeWorld>) =>
  Layer.mergeAll(squadBase(directory), world.sessionLayer, world.channelLayer)

const stateOf = (name: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db.select().from(SquadSessionTable).where(eq(SquadSessionTable.name, name)).get()
  })

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string; message?: string }) : undefined

const init = (...names: string[]) =>
  Effect.gen(function* () {
    const registry = yield* SquadRegistry.Service
    yield* registry.init({ generation: "gen-1", sessions: names.map((name) => entry(name)) })
  })

const run = <A, E, R>(world: ReturnType<typeof fakeWorld>, body: Effect.Effect<A, E, R>) =>
  tmpdirScoped().pipe(Effect.flatMap((dir) => body.pipe(Effect.provide(layerFor(dir.path, world)))))

describe("SquadLaunch state machine", () => {
  it.live("resuming after a crash with the state persisted as starting never creates a second session", () => {
    const world = fakeWorld({ failEnqueues: 1 })
    return run(
      world,
      Effect.gen(function* () {
        yield* init("ATLAS")
        yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 }).pipe(Effect.exit)
        const again = yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 }).pipe(Effect.exit)
        expect(world.creates.length).toBe(1)
        expect(failure(again)).toBeUndefined()
        expect((yield* stateOf("ATLAS"))?.state).toBe("verified")
      }),
    )
  })

  it.live("a creating entry without a session id creates exactly one session and reaches verified", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        yield* init("ATLAS", "NOVA")
        yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 })
        expect(world.creates.length).toBe(2)
        const row = yield* stateOf("ATLAS")
        expect(row?.state).toBe("verified")
        expect(row?.session_id).toBe(world.creates[0] ?? "")
        expect(row?.marker).toBe("SQUAD-gen-1-ATLAS")
        expect(row?.prompt_sha256?.length).toBe(64)
      }),
    )
  })

  it.live("starting reuses the same message id and verified never resends", () => {
    const world = fakeWorld({ failEnqueues: 1 })
    return run(
      world,
      Effect.gen(function* () {
        yield* init("ATLAS")
        yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 }).pipe(Effect.exit)
        yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 })
        expect(world.enqueues.length).toBe(2)
        expect(world.enqueues[1]?.idempotencyKey).toBe(world.enqueues[0]?.idempotencyKey ?? "")
        yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 })
        expect(world.enqueues.length).toBe(2)
        expect(world.creates.length).toBe(1)
      }),
    )
  })

  it.live("a failed entry needs --retry with a reason", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        yield* init("ATLAS")
        const db = (yield* Database.Service).db
        yield* db.update(SquadSessionTable).set({ state: "failed", last_error: "boom" }).where(eq(SquadSessionTable.name, "ATLAS")).run()
        const refused = yield* SquadLaunch.launch({ pollInterval: 10, timeout: 500 }).pipe(Effect.exit)
        expect(failure(refused)?._tag).toBe("ConflictError")
        expect(failure(refused)?.message).toContain("--retry")
        const noReason = yield* SquadLaunch.launch({ retry: true, pollInterval: 10, timeout: 500 }).pipe(Effect.exit)
        expect(failure(noReason)?.message).toContain("--reason")
        yield* SquadLaunch.launch({ retry: true, reason: "provider back", pollInterval: 10, timeout: 500 })
        expect((yield* stateOf("ATLAS"))?.state).toBe("verified")
      }),
    )
  })

  it.live("--only touches only that name and fails when it is not in the active generation", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        yield* init("ATLAS", "NOVA")
        yield* SquadLaunch.launch({ only: "NOVA", pollInterval: 10, timeout: 500 })
        expect((yield* stateOf("NOVA"))?.state).toBe("verified")
        expect((yield* stateOf("ATLAS"))?.state).toBe("creating")
        expect(world.creates.length).toBe(1)
        const missing = yield* SquadLaunch.launch({ only: "GHOST" }).pipe(Effect.exit)
        expect(failure(missing)?._tag).toBe("SessionNotFoundError")
        expect(world.creates.length).toBe(1)
      }),
    )
  })
})
