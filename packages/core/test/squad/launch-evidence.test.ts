import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { SquadLaunch } from "@opencode/core/squad/launch"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSessionTable } from "@opencode/core/squad/sql"
import { fakeWorld, type WorldOptions } from "../fixture/squad-world"
import { squadBase } from "../fixture/squad-env"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const entry = (name: string, sessionID?: string) => ({
  name,
  role: "worker" as const,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  ...(sessionID === undefined ? {} : { sessionID }),
})

const row = (name: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db.select().from(SquadSessionTable).where(eq(SquadSessionTable.name, name)).get()
  })

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string; message?: string }) : undefined

const scenario = <A, E, R>(
  options: WorldOptions,
  body: (world: ReturnType<typeof fakeWorld>) => Effect.Effect<A, E, R>,
) =>
  tmpdirScoped().pipe(
    Effect.flatMap((dir) => {
      const world = fakeWorld(options)
      return body(world).pipe(Effect.provide(Layer.mergeAll(squadBase(dir.path), world.sessionLayer, world.channelLayer)))
    }),
  )

const fast = { pollInterval: 10, timeout: 300 }

describe("SquadLaunch evidence", () => {
  it.live("admitted and delivered but never executing stays starting and names execution", () =>
    scenario({ script: "no-execution" }, () =>
      Effect.gen(function* () {
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS")] })
        const exit = yield* SquadLaunch.launch(fast).pipe(Effect.exit)
        expect((yield* row("ATLAS"))?.state).toBe("starting")
        expect(failure(exit)?._tag).toBe("ConflictError")
        expect(failure(exit)?.message).toContain("execution")
        expect(failure(exit)?.message).not.toContain("enqueued")
        expect((yield* row("ATLAS"))?.last_error).toContain("execution")
      }),
    ),
  )

  it.live("a delivery that never happened is named as delivered", () =>
    scenario({ script: "no-delivery" }, () =>
      Effect.gen(function* () {
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS")] })
        const exit = yield* SquadLaunch.launch(fast).pipe(Effect.exit)
        expect((yield* row("ATLAS"))?.state).toBe("starting")
        expect(failure(exit)?.message).toContain("delivered")
      }),
    ),
  )

  it.live("a diverging model fails naming the expected and the measured value", () =>
    scenario({ measuredModel: { providerID: "deepseek", id: "deepseek-pro", variant: "low" } }, () =>
      Effect.gen(function* () {
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS")] })
        const exit = yield* SquadLaunch.launch(fast).pipe(Effect.exit)
        expect((yield* row("ATLAS"))?.state).toBe("starting")
        expect(failure(exit)?.message).toContain("deepseek/deepseek-flash#high")
        expect(failure(exit)?.message).toContain("deepseek/deepseek-pro#low")
      }),
    ),
  )

  it.live("a verification timeout keeps the record and the session", () =>
    scenario({ script: "none" }, (world) =>
      Effect.gen(function* () {
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS")] })
        const started = Date.now()
        const exit = yield* SquadLaunch.launch({ pollInterval: 50, timeout: 1000 }).pipe(Effect.exit)
        expect(Date.now() - started).toBeGreaterThanOrEqual(900)
        const kept = yield* row("ATLAS")
        expect(kept?.state).toBe("starting")
        expect(kept?.session_id).toBeTruthy()
        expect(world.stored.has(kept?.session_id ?? "")).toBe(true)
        expect(failure(exit)?.message).toContain("enqueued")
      }),
    ),
  )

  it.live("an execution older than the adoption does not promote an adopted session", () =>
    scenario({ script: "no-execution" }, (world) =>
      Effect.gen(function* () {
        world.seed("ses_adopted", { providerID: "deepseek", id: "deepseek-flash", variant: "high" }, [["session.execution.started"]])
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS", "ses_adopted")] })
        const exit = yield* SquadLaunch.launch(fast).pipe(Effect.exit)
        const adopted = yield* row("ATLAS")
        expect(adopted?.state).toBe("starting")
        expect(adopted?.adopted_at).not.toBeNull()
        expect(failure(exit)?.message).toContain("execution")
        expect(world.creates.length).toBe(0)
      }),
    ),
  )

  it.live("an adopted session verifies once it runs after the marker was admitted", () =>
    scenario({}, (world) =>
      Effect.gen(function* () {
        world.seed("ses_adopted", { providerID: "deepseek", id: "deepseek-flash", variant: "high" }, [["session.execution.started"]])
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS", "ses_adopted")] })
        yield* SquadLaunch.launch(fast)
        expect((yield* row("ATLAS"))?.state).toBe("verified")
      }),
    ),
  )
})
