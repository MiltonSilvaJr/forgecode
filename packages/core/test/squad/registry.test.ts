import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Exit, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadStore } from "@opencode/core/squad/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const enabled = [
  new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: true }) }) }),
]

const layer = (directory: string) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    Database.layer({ path: path.join(directory, "opencode.db") }),
    Config.testLayer(enabled),
  )

const it = testEffect(Layer.empty)

const session = (
  name: string,
  extra: { role?: "orchestrator" | "worker"; sessionID?: string } = {},
) => ({
  name,
  role: extra.role ?? "worker",
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  branch: "feature/x",
  sessionID: extra.sessionID,
})

describe("SquadRegistry.init", () => {
  it.live("creates an active generation with its sessions", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          const generation = yield* registry.init({ generation: "gen-1", sessions: [session("A"), session("B")] })
          expect(generation.id).toBe("gen-1")
          expect(generation.state).toBe("active")
          expect(generation.sessions).toHaveLength(2)
          expect(yield* registry.countActive()).toBe(1)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("rejects a second init without replace", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-1", sessions: [session("A")] })
          const second = yield* registry.init({ generation: "gen-2", sessions: [session("A")] }).pipe(Effect.exit)
          expect(Exit.isFailure(second)).toBe(true)
          expect(yield* registry.countActive()).toBe(1)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("keeps a single active generation when replace is unsatisfied", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-1", sessions: [session("A")] })
          const replace = yield* registry
            .init({ generation: "gen-2", sessions: [session("A")], replace: true, reason: "roll forward" })
            .pipe(Effect.exit)
          expect(yield* registry.countActive()).toBe(1)
          expect(Exit.isFailure(replace)).toBe(true)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("reuses the same generation id for the same idempotency key", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          const first = yield* registry.init({ generation: "gen-1", sessions: [session("A")], idempotencyKey: "key-1" })
          const second = yield* registry.init({ generation: "gen-1", sessions: [session("A")], idempotencyKey: "key-1" })
          expect(second.id).toBe(first.id)
          expect(yield* registry.countActive()).toBe(1)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("rolls back a partial init", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          let inserts = 0
          const failing = SquadStore.Service.of({
            ...SquadStore.Default,
            insertSession: (tx, row) =>
              Effect.suspend(() => {
                inserts += 1
                if (inserts === 2) return Effect.die(new Error("injected store failure"))
                return SquadStore.Default.insertSession(tx, row)
              }),
          })
          const exit = yield* registry
            .init({ generation: "gen-x", sessions: [session("A"), session("B")] })
            .pipe(Effect.provideService(SquadStore.Service, failing), Effect.exit)
          expect(Exit.isFailure(exit)).toBe(true)
          expect(yield* registry.countActive()).toBe(0)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("survives a restart over the same database", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* Effect.gen(function* () {
            const registry = yield* SquadRegistry.Service
            yield* registry.init({ generation: "gen-1", sessions: [session("A", { sessionID: "ses_1" })] })
          }).pipe(Effect.provide(layer(dir.path)))
          yield* Effect.gen(function* () {
            const registry = yield* SquadRegistry.Service
            const active = yield* registry.active()
            expect(active?.id).toBe("gen-1")
            expect(active?.sessions[0]?.sessionID).toBe("ses_1")
          }).pipe(Effect.provide(layer(dir.path)))
        }),
      ),
    ),
  )
})
