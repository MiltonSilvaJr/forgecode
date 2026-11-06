import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadBlock } from "@opencode/core/squad/block"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSessionTable } from "@opencode/core/squad/sql"
import { SquadStatus } from "@opencode/core/squad/status"
import { fakeWorld } from "../fixture/squad-world"
import { squadBase } from "../fixture/squad-env"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const model = { providerID: "deepseek", id: "deepseek-flash", variant: "high" }

const entry = (name: string, sessionID: string) => ({
  name,
  role: "worker" as const,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  sessionID,
})

const scenario = <A, E, R>(body: (world: ReturnType<typeof fakeWorld>) => Effect.Effect<A, E, R>) =>
  tmpdirScoped().pipe(
    Effect.flatMap((dir) => {
      const world = fakeWorld()
      return body(world).pipe(Effect.provide(Layer.mergeAll(squadBase(dir.path), world.sessionLayer, world.channelLayer)))
    }),
  )

const setup = (world: ReturnType<typeof fakeWorld>, states: Record<string, "verified" | "starting"> = {}) =>
  Effect.gen(function* () {
    world.seed("ses_a", model, [], { busy: Date.now() - 1000 })
    world.seed("ses_b", model)
    const registry = yield* SquadRegistry.Service
    const db = (yield* Database.Service).db
    yield* registry.init({ generation: "gen-1", sessions: [entry("A", "ses_a"), entry("B", "ses_b")] })
    for (const name of ["A", "B"])
      yield* db
        .update(SquadSessionTable)
        .set({ state: states[name] ?? "verified" })
        .where(eq(SquadSessionTable.name, name))
        .run()
  })

const tag = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : undefined

describe("SquadBlock", () => {
  it.live("records who a session is waiting on and the reason", () =>
    scenario((world) =>
      Effect.gen(function* () {
        yield* setup(world)
        yield* SquadBlock.block({ name: "A", waitingOn: "human", reason: "approval of the migration", author: "ORQ" })
        const active = yield* SquadBlock.current("A")
        expect<unknown>(active?.waitingOn ?? null).toBe("human")
        expect<unknown>(active?.reason).toBe("approval of the migration")
        expect<unknown>(active?.author).toBe("ORQ")
        expect<unknown>(yield* SquadBlock.current("B")).toBe(null)
      }),
    ),
  )

  it.live("repeating the same block is a no-op and a changed one replaces it, each audited once", () =>
    scenario((world) =>
      Effect.gen(function* () {
        yield* setup(world)
        const audit = yield* SquadAudit.Service
        yield* SquadBlock.block({ name: "A", waitingOn: "tool", reason: "build stuck" })
        yield* SquadBlock.block({ name: "A", waitingOn: "tool", reason: "build stuck" })
        expect((yield* audit.list()).filter((line) => line.kind === "block").length).toBe(1)
        yield* SquadBlock.block({ name: "A", waitingOn: "human", reason: "needs a decision" })
        expect<unknown>((yield* SquadBlock.current("A"))?.waitingOn).toBe("human")
        expect((yield* audit.list()).filter((line) => line.kind === "block").length).toBe(2)
      }),
    ),
  )

  it.live("only a verified session of the active generation can be blocked", () =>
    scenario((world) =>
      Effect.gen(function* () {
        yield* setup(world, { B: "starting" })
        expect<unknown>(tag(yield* SquadBlock.block({ name: "B", waitingOn: "human", reason: "x" }).pipe(Effect.exit))).toBe("ConflictError")
        expect<unknown>(tag(yield* SquadBlock.block({ name: "GHOST", waitingOn: "human", reason: "x" }).pipe(Effect.exit))).toBe(
          "SessionNotFoundError",
        )
      }),
    ),
  )

  it.live("--clear removes the declared block and audits block_clear without a message body", () =>
    scenario((world) =>
      Effect.gen(function* () {
        yield* setup(world)
        const audit = yield* SquadAudit.Service
        yield* SquadBlock.block({ name: "A", waitingOn: "human", reason: "waiting" })
        yield* SquadBlock.block({ name: "A", waitingOn: "human", reason: "", clear: true })
        expect<unknown>(yield* SquadBlock.current("A")).toBe(null)
        const cleared = (yield* audit.list()).find((line) => line.kind === "block_clear")
        expect<unknown>(cleared?.target).toBe("A")
        expect<unknown>(cleared?.messageSha256).toBeUndefined()
      }),
    ),
  )

  it.live("liveness reports the cause but a block never changes working to idle or frees the claim", () =>
    scenario((world) =>
      Effect.gen(function* () {
        yield* setup(world)
        world.claims.set("ses_a", { since: Date.now() - 1000 })
        const before = yield* SquadStatus.status()
        yield* SquadBlock.block({ name: "A", waitingOn: "human", reason: "approval pending" })
        const after = yield* SquadStatus.status()
        const row = after.sessions.find((entry) => entry.name === "A")
        expect<unknown>(row?.liveness.verdict).toBe(before.sessions.find((entry) => entry.name === "A")?.liveness.verdict)
        expect<unknown>(row?.liveness.verdict).toBe("working")
        expect<unknown>(row?.liveness.cause).toContain("human")
        expect<unknown>(row?.liveness.cause).toContain("approval pending")
        expect<unknown>(world.claims.has("ses_a")).toBe(true)
        expect<unknown>(after.sessions.find((entry) => entry.name === "B")?.liveness.cause).toBeUndefined()
      }),
    ),
  )
})
