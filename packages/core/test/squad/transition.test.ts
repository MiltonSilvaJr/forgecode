import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { and, eq } from "drizzle-orm"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadActivity } from "@opencode/core/squad/activity"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadCheckpoint } from "@opencode/core/squad/checkpoint"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadGenerationTable, SquadSessionTable, SquadTransitionEntryTable, SquadTransitionTable } from "@opencode/core/squad/sql"
import { SquadStore } from "@opencode/core/squad/store"
import { SquadTransition } from "@opencode/core/squad/transition"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const enabled = [
  new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: true }) }) }),
]

const globalFor = (directory: string) =>
  Global.layerWith({
    data: directory,
    cache: directory,
    config: directory,
    state: directory,
    tmp: directory,
    bin: directory,
    log: directory,
    repos: directory,
  })

const activity = Layer.succeed(SquadActivity.Service, SquadActivity.Service.of({ isActive: () => Effect.succeed(false) }))

const channel = Layer.succeed(
  SquadChannel.Service,
  SquadChannel.Service.of({
    enqueue: () => Effect.die("close and transition never enqueue"),
    pending: () => Effect.succeed([]),
  }),
)

const layer = (directory: string) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    activity,
    channel,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(enabled),
  )

const it = testEffect(Layer.empty)

const checkpointBody = ["Resultado", "Fontes", "Comandos e provas", "Limites", "Próximos passos", "Posse da árvore"]
  .map((title) => `## ${title}\nok`)
  .join("\n")

const session = (name: string, sessionID: string, role: "orchestrator" | "worker" = "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  branch: "feature/x",
  sessionID,
})

const names = ["ORQ", "ATLAS", "NOVA"]

/** gen-1 closed with a receipt; gen-2 is the new active generation. */
const setup = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const registry = yield* SquadRegistry.Service
  yield* registry.init({
    generation: "gen-1",
    sessions: [session("ORQ", "ses_orq", "orchestrator"), session("ATLAS", "ses_atlas"), session("NOVA", "ses_nova")],
  })
  yield* db.update(SquadSessionTable).set({ state: "verified" }).run()
  for (const name of names) yield* SquadCheckpoint.write({ name, body: checkpointBody })
  yield* SquadTransition.close({ generation: "gen-1" })
  yield* registry.init({
    generation: "gen-2",
    sessions: [session("ORQ", "ses_orq2", "orchestrator"), session("ATLAS", "ses_atlas2"), session("NOVA", "ses_nova2")],
  })
})

const outcome = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : "ok"

const messageOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { message: string }).message : ""

const targetOf = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const row = yield* db.select().from(SquadTransitionTable).where(eq(SquadTransitionTable.source_generation_id, "gen-1")).get()
  return row?.target_generation_id
})

describe("SquadTransition.transition", () => {
  it.live("a registry changed after the close is a conflict and the new generation stays intact", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const db = (yield* Database.Service).db
          yield* db
            .update(SquadSessionTable)
            .set({ model: "other-model" })
            .where(and(eq(SquadSessionTable.generation_id, "gen-1"), eq(SquadSessionTable.name, "ATLAS")))
            .run()
          const exit = yield* SquadTransition.transition({ from: "gen-1" }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("ConflictError")
          expect(yield* targetOf).toBeNull()
          const registry = yield* SquadRegistry.Service
          expect((yield* registry.active())?.id).toBe("gen-2")
          expect((yield* registry.get("gen-2"))?.sessions).toHaveLength(3)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a diverging session set fails naming the session", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const db = (yield* Database.Service).db
          yield* db.delete(SquadTransitionEntryTable).where(eq(SquadTransitionEntryTable.name, "NOVA")).run()
          const exit = yield* SquadTransition.transition({ from: "gen-1" }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("ConflictError")
          expect(messageOf(exit)).toContain("NOVA")
          expect(yield* targetOf).toBeNull()
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("binds to the active generation and repeating with the same target is a no-op", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const first = yield* SquadTransition.transition({ from: "gen-1" })
          expect<string | undefined>(first.targetGenerationID).toBe("gen-2")
          const again = yield* SquadTransition.transition({ from: "gen-1" })
          expect(again).toEqual(first)
          expect(yield* targetOf).toBe("gen-2")
          const audit = yield* SquadAudit.Service
          expect((yield* audit.list()).filter((entry) => entry.kind === "transition")).toHaveLength(1)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a different target is a conflict", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          yield* SquadTransition.transition({ from: "gen-1" })
          const db = (yield* Database.Service).db
          yield* db.update(SquadGenerationTable).set({ state: "closed" }).where(eq(SquadGenerationTable.id, "gen-2")).run()
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-3", sessions: [session("ORQ", "ses_orq3", "orchestrator")] })
          const exit = yield* SquadTransition.transition({ from: "gen-1" }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("ConflictError")
          expect(yield* targetOf).toBe("gen-2")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("afterwards the new generation is the only active one and the old one is reachable by session id only", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          yield* SquadTransition.transition({ from: "gen-1" })
          const registry = yield* SquadRegistry.Service
          expect(yield* registry.countActive()).toBe(1)
          expect((yield* registry.get("gen-1"))?.state).toBe("closed")
          expect((yield* registry.resolve("ses_atlas")).generationID).toBe("gen-1")
          expect((yield* registry.resolve("ATLAS")).generationID).toBe("gen-2")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("without a close receipt or without an active generation it fails with an actionable message", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const missing = yield* SquadTransition.transition({ from: "gen-7" }).pipe(Effect.exit)
          expect(outcome(missing)).toBe("ConflictError")
          expect(messageOf(missing)).toContain("squad close")
          const db = (yield* Database.Service).db
          yield* db.update(SquadGenerationTable).set({ state: "closed" }).where(eq(SquadGenerationTable.id, "gen-2")).run()
          const none = yield* SquadTransition.transition({ from: "gen-1" }).pipe(Effect.exit)
          expect(outcome(none)).toBe("ConflictError")
          expect(messageOf(none)).toContain("squad init")
          const registry = yield* SquadRegistry.Service
          expect(yield* registry.countActive()).toBe(0)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
