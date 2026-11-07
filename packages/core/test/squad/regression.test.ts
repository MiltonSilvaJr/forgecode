import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { Database } from "@opencode/core/database/database"
import { SessionInboxTable, SessionTable } from "@opencode/core/session/sql"
import { SquadActivate } from "@opencode/core/squad/activate"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadBlock } from "@opencode/core/squad/block"
import { SquadBroadcast } from "@opencode/core/squad/broadcast"
import { SquadCheckpoint } from "@opencode/core/squad/checkpoint"
import { SquadDispatch } from "@opencode/core/squad/dispatch"
import { SquadLaunch } from "@opencode/core/squad/launch"
import { SquadOwnership } from "@opencode/core/squad/ownership"
import { SquadPanel } from "@opencode/core/squad/panel"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadReplace } from "@opencode/core/squad/replace"
import { SquadSend } from "@opencode/core/squad/send"
import {
  SquadAuditTable,
  SquadBlockTable,
  SquadCheckpointTable,
  SquadDispatchTable,
  SquadGenerationTable,
  SquadIdempotencyTable,
  SquadSessionTable,
  SquadTransitionTable,
  SquadTreeOwnerTable,
} from "@opencode/core/squad/sql"
import { SquadStatus } from "@opencode/core/squad/status"
import { SquadTransition } from "@opencode/core/squad/transition"
import { fakeWorld } from "../fixture/squad-world"
import { squadBase } from "../fixture/squad-env"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const tag = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : "succeeded"

const guarded = {
  "registry.init": () =>
    Effect.gen(function* () {
      const registry = yield* SquadRegistry.Service
      return yield* registry.init({
        generation: "gen-1",
        sessions: [
          {
            name: "ATLAS",
            role: "worker",
            provider: "deepseek",
            model: "deepseek-flash",
            variant: "high",
            location: { directory: "/squad/atlas" },
          },
        ],
      })
    }),
  "registry.resolve": () =>
    Effect.gen(function* () {
      const registry = yield* SquadRegistry.Service
      return yield* registry.resolve("ATLAS")
    }),
  "registry.active": () =>
    Effect.gen(function* () {
      const registry = yield* SquadRegistry.Service
      return yield* registry.active()
    }),
  send: () => SquadSend.send({ to: "ATLAS", text: "go" }),
  broadcast: () => SquadBroadcast.broadcast({ text: "go" }),
  checkpoint: () => SquadCheckpoint.write({ name: "ATLAS", body: "x" }),
  "generation.close": () => SquadTransition.close({ generation: "gen-1" }),
  transition: () => SquadTransition.transition({ from: "gen-1" }),
  activate: () => SquadActivate.activate({}),
  "dispatch.create": () => SquadDispatch.create({}),
  "dispatch.list": () => SquadDispatch.list(),
  "dispatch.accept": () => SquadDispatch.accept({ orq: "ORQ-gen-1-001" }),
  release: () => SquadOwnership.release({ from: "A", to: "B", reason: "r" }),
  launch: () => SquadLaunch.launch({}),
  replace: () => SquadReplace.replace({ name: "ATLAS", provider: "openai" }),
  block: () => SquadBlock.block({ name: "ATLAS", waitingOn: "human", reason: "approval" }),
  status: () => SquadStatus.status(),
  panel: () => SquadPanel.build(),
}

const tables = [
  SessionTable,
  SessionInboxTable,
  SquadGenerationTable,
  SquadSessionTable,
  SquadTreeOwnerTable,
  SquadCheckpointTable,
  SquadTransitionTable,
  SquadDispatchTable,
  SquadAuditTable,
  SquadIdempotencyTable,
  SquadBlockTable,
]

describe("squad disabled by default", () => {
  it.live("every guarded operation fails with Squad.DisabledError and no session or inbox path is touched", () => {
    const world = fakeWorld()
    return tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const failures = yield* Effect.forEach(Object.entries(guarded), ([name, run]) =>
            (run() as Effect.Effect<unknown, unknown, never>).pipe(Effect.exit, Effect.map((exit) => [name, tag(exit)] as const)),
          )
          expect(failures.filter(([, value]) => value !== "Squad.DisabledError")).toEqual([])
          expect(world.creates).toEqual([])
          expect(world.enqueues).toEqual([])
          const counts = yield* Effect.forEach(tables, (table) => db.select().from(table).all().pipe(Effect.map((rows) => rows.length)))
          expect(counts.every((count) => count === 0)).toBe(true)
          expect(yield* SquadAudit.chain().pipe(Effect.map((chain) => chain.entries.length))).toBe(0)
        }).pipe(Effect.provide(Layer.mergeAll(squadBase(dir.path, { enabled: false }), world.sessionLayer, world.channelLayer))),
      ),
    )
  })

  it.live("the default configuration without a squad block is also disabled", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          expect(tag(yield* registry.active().pipe(Effect.exit))).toBe("Squad.DisabledError")
        }).pipe(Effect.provide(squadBase(dir.path, { enabled: false }))),
      ),
    ),
  )
})
