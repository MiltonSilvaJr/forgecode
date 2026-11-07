import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { SquadActivate } from "@opencode/core/squad/activate"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadCheckpointTable, SquadSessionTable, SquadTransitionTable } from "@opencode/core/squad/sql"
import { Session } from "@opencode/schema/session"
import { fakeWorld } from "../fixture/squad-world"
import { squadBase } from "../fixture/squad-env"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const entry = (name: string, role: "orchestrator" | "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
})

const SENTINEL = "CHECKPOINT-SENTINEL-BODY"

const run = <A, E, R>(world: ReturnType<typeof fakeWorld>, body: Effect.Effect<A, E, R>) =>
  tmpdirScoped().pipe(
    Effect.flatMap((dir) => body.pipe(Effect.provide(Layer.mergeAll(squadBase(dir.path), world.sessionLayer, world.channelLayer)))),
  )

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string; message?: string }) : undefined

/** gen-1 with an orchestrator and one worker; `states` overrides the worker state; the transition from gen-0 is bound unless `bound` is false. */
const seed = (options: { worker?: "verified" | "starting"; bound?: boolean } = {}) =>
  Effect.gen(function* () {
    const registry = yield* SquadRegistry.Service
    const db = (yield* Database.Service).db
    yield* registry.init({ generation: "gen-1", sessions: [entry("ORQ", "orchestrator"), entry("ATLAS", "worker")] })
    const ids = { ORQ: Session.ID.create(), ATLAS: Session.ID.create() }
    yield* db.update(SquadSessionTable).set({ state: "verified", session_id: ids.ORQ }).where(eq(SquadSessionTable.name, "ORQ")).run()
    yield* db
      .update(SquadSessionTable)
      .set({ state: options.worker ?? "verified", session_id: ids.ATLAS })
      .where(eq(SquadSessionTable.name, "ATLAS"))
      .run()
    yield* db
      .insert(SquadCheckpointTable)
      .values({ generation_id: "gen-1", name: "ATLAS", sha256: "a".repeat(64), body: SENTINEL, bytes: SENTINEL.length, created_at: 1 })
      .run()
    yield* db
      .insert(SquadTransitionTable)
      .values({
        source_generation_id: "gen-0",
        target_generation_id: options.bound === false ? null : "gen-1",
        source_registry_digest: "d".repeat(64),
        previous_sessions_closed: true,
        previous_orchestrator_kept_open: true,
        created_at: 1,
      })
      .run()
    return ids
  })

describe("SquadActivate", () => {
  it.live("a session still starting blocks the activation and nothing is enqueued", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        yield* seed({ worker: "starting" })
        const exit = yield* SquadActivate.activate({}).pipe(Effect.exit)
        expect(world.enqueues.length > 0).toBe(false)
        expect(failure(exit)?._tag).toBe("ConflictError")
        expect(failure(exit)?.message).toContain("ATLAS")
      }),
    )
  })

  it.live("a generation without a bound transition receipt cannot be activated", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        yield* seed({ bound: false })
        const exit = yield* SquadActivate.activate({}).pipe(Effect.exit)
        expect(world.enqueues.length > 0).toBe(false)
        expect(failure(exit)?._tag).toBe("ConflictError")
        expect(failure(exit)?.message).toContain("transition")
      }),
    )
  })

  it.live("a generation other than the active one is a conflict", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        yield* seed()
        const exit = yield* SquadActivate.activate({ generation: "gen-0" }).pipe(Effect.exit)
        expect(world.enqueues.length > 0).toBe(false)
        expect(failure(exit)?._tag).toBe("ConflictError")
      }),
    )
  })

  it.live("delivers the transfer to the orchestrator and keeps productive false", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        const ids = yield* seed()
        const proof = yield* SquadActivate.activate({ registryPath: "/data/opencode.db" })
        expect(world.enqueues.length).toBe(1)
        const sent = world.enqueues[0]!
        expect(sent.sessionID).toBe(ids.ORQ)
        expect(sent.idempotencyKey).toBe("activate:gen-1")
        expect(proof.messageID).toBe(SquadChannel.messageIDFor("activate:gen-1", ids.ORQ))
        for (const part of ["gen-1", "/data/opencode.db", "ORQ", "ATLAS", "bootstrap"]) expect(sent.text).toContain(part)
        expect(sent.text).not.toContain(SENTINEL)
        const db = (yield* Database.Service).db
        const rows = yield* db.select().from(SquadSessionTable).all()
        expect(rows.map((row) => row.productive)).toEqual([false, false])
        const audit = yield* (yield* SquadAudit.Service).list()
        expect(audit.filter((item) => item.kind === "activate").map((item) => item.result)).toEqual(["accepted"])
      }),
    )
  })

  it.live("repeating the activation returns the same message id without a second enqueue", () => {
    const world = fakeWorld()
    return run(
      world,
      Effect.gen(function* () {
        yield* seed()
        const first = yield* SquadActivate.activate({})
        const second = yield* SquadActivate.activate({})
        expect(second.messageID).toBe(first.messageID)
        expect(world.enqueues.length).toBe(1)
      }),
    )
  })
})
