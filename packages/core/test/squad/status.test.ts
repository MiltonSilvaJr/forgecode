import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { SquadAudit } from "@opencode/core/squad/audit"
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

const verified = (...names: string[]) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    for (const name of names)
      yield* db.update(SquadSessionTable).set({ state: "verified" }).where(eq(SquadSessionTable.name, name)).run()
  })

const hour = 3_600_000

describe("SquadStatus", () => {
  it.live("previous is null while no generation has been closed", () =>
    scenario((world) =>
      Effect.gen(function* () {
        world.seed("ses_atlas", model)
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS", "ses_atlas")] })
        const report = yield* SquadStatus.status()
        expect<unknown>(report.previous).toBe(null)
        expect<unknown>(report.generation).toBe("gen-1")
        expect<unknown>(report.sessions.map((row) => row.name)).toEqual(["ATLAS"])
      }),
    ),
  )

  it.live("previous carries the closed generation with session ids and the closed state", () =>
    scenario((world) =>
      Effect.gen(function* () {
        world.seed("ses_old", model)
        world.seed("ses_new", model)
        const registry = yield* SquadRegistry.Service
        const db = (yield* Database.Service).db
        yield* registry.init({ generation: "gen-1", sessions: [entry("ATLAS", "ses_old")] })
        yield* db.update(SquadSessionTable).set({ checkpoint_sha256: "abc" }).run()
        yield* registry.init({ generation: "gen-2", replace: true, reason: "next", sessions: [entry("ATLAS", "ses_new")] })
        const report = yield* SquadStatus.status()
        expect<unknown>(report.generation).toBe("gen-2")
        expect<unknown>(report.previous?.id).toBe("gen-1")
        expect<unknown>(report.previous?.sessions.map((row) => [row.name, row.sessionID, row.state])).toEqual([["ATLAS", "ses_old", "closed"]])
        expect<unknown>(report.sessions.map((row) => row.sessionID)).toEqual(["ses_new"])
      }),
    ),
  )

  it.live("reports the measured source of the activity and never mutates registry, audit or inbox", () =>
    scenario((world) =>
      Effect.gen(function* () {
        const now = Date.now()
        world.seed("ses_a", model, [["session.execution.succeeded", {}, now - 1000]], { idle: now - 1000, outcome: "succeeded" })
        world.seed("ses_b", model, [["session.inbox.delivered", { inboxID: "msg_1" }, now - 500]], { idle: now - 3 * hour })
        const registry = yield* SquadRegistry.Service
        const audit = yield* SquadAudit.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("A", "ses_a"), entry("B", "ses_b")] })
        yield* verified("A", "B")
        const before = JSON.stringify(yield* registry.get("gen-1"))
        const auditBefore = (yield* audit.list()).length
        const first = yield* SquadStatus.status()
        const second = yield* SquadStatus.status()
        expect<unknown>(first.sessions.map((row) => [row.name, row.liveness.verdict, row.liveness.source])).toEqual([
          ["A", "idle", "execution"],
          ["B", "idle", "inbox"],
        ])
        expect<unknown>(second.sessions.map((row) => row.name)).toEqual(first.sessions.map((row) => row.name))
        expect<unknown>(JSON.stringify(yield* registry.get("gen-1"))).toBe(before)
        expect<unknown>((yield* audit.list()).length).toBe(auditBefore)
        expect<unknown>(world.enqueues.length).toBe(0)
        expect<unknown>(world.creates.length).toBe(0)
      }),
    ),
  )

  it.live("exposes inbox_pending per session and per generation without touching the verdict", () =>
    scenario((world) =>
      Effect.gen(function* () {
        world.seed("ses_a", model)
        world.seed("ses_b", model)
        world.pending.set("ses_a", [
          { id: "msg_1", delivery: "queue", createdAt: 1 },
          { id: "msg_2", delivery: "steer", createdAt: 2 },
        ])
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("A", "ses_a"), entry("B", "ses_b")] })
        const report = yield* SquadStatus.status()
        expect<unknown>(report.sessions.map((row) => [row.name, row.inboxPending])).toEqual([
          ["A", 2],
          ["B", 0],
        ])
        expect<unknown>(report.inboxPending).toBe(2)
        expect<unknown>(report.sessions.map((row) => row.liveness.verdict)).toEqual(["unknown", "unknown"])
      }),
    ),
  )

  it.live("NFR-01: p95 of 28 runs over 20 sessions stays under 2s", () =>
    scenario((world) =>
      Effect.gen(function* () {
        const names = Array.from({ length: 20 }, (_, index) => `S${index}`)
        for (const name of names) world.seed(`ses_${name}`, model, [["session.execution.succeeded", {}, Date.now()]], { idle: Date.now() })
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: names.map((name) => entry(name, `ses_${name}`)) })
        yield* verified(...names)
        const samples: number[] = []
        for (let run = 0; run < 30; run++) {
          const started = performance.now()
          yield* SquadStatus.status()
          if (run >= 2) samples.push(performance.now() - started)
        }
        const sorted = samples.sort((a, b) => a - b)
        const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1]!
        console.log(`NFR-01 status: min=${sorted[0]!.toFixed(1)}ms p50=${sorted[13]!.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${sorted[27]!.toFixed(1)}ms`)
        expect<unknown>(sorted.length).toBe(28)
        expect(p95).toBeLessThanOrEqual(2000)
      }),
    ),
  )
})
