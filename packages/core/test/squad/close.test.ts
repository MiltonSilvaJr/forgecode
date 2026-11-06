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
import { ConflictError, SquadRegistry } from "@opencode/core/squad/registry"
import { SquadCheckpointTable, SquadSessionTable } from "@opencode/core/squad/sql"
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

const running = new Set<string>()

const activity = Layer.succeed(
  SquadActivity.Service,
  SquadActivity.Service.of({ isActive: (sessionID) => Effect.succeed(running.has(sessionID)) }),
)

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

const setup = (options: { checkpoints?: string[]; orchestrator?: boolean } = {}) =>
  Effect.gen(function* () {
    running.clear()
    const db = (yield* Database.Service).db
    const registry = yield* SquadRegistry.Service
    yield* registry.init({
      generation: "gen-1",
      sessions: [
        session("ORQ", "ses_orq", options.orchestrator === false ? "worker" : "orchestrator"),
        session("ATLAS", "ses_atlas"),
        session("NOVA", "ses_nova"),
      ],
    })
    yield* db.update(SquadSessionTable).set({ state: "verified" }).run()
    for (const name of options.checkpoints ?? ["ORQ", "ATLAS", "NOVA"])
      yield* SquadCheckpoint.write({ name, body: checkpointBody })
  })

const pendenciesOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) return []
  const error = Cause.squash(exit.cause)
  return error instanceof ConflictError ? error.pendencies : []
}

const stateOf = Effect.gen(function* () {
  const registry = yield* SquadRegistry.Service
  return (yield* registry.get("gen-1"))?.state
})

describe("SquadTransition.close", () => {
  it.live("without a checkpoint the generation stays active and the pending sessions are named", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup({ checkpoints: ["ORQ"] })
          const exit = yield* SquadTransition.close({ generation: "gen-1" }).pipe(Effect.exit)
          expect(yield* stateOf).toBe("active")
          expect(pendenciesOf(exit)).toEqual([
            "ATLAS: checkpoint ausente",
            "NOVA: checkpoint ausente",
          ])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a checkpoint whose stored body no longer matches its hash blocks the close", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const db = (yield* Database.Service).db
          yield* db.update(SquadCheckpointTable).set({ body: "adulterado" }).where(eq(SquadCheckpointTable.name, "NOVA")).run()
          const exit = yield* SquadTransition.close({ generation: "gen-1" }).pipe(Effect.exit)
          expect(yield* stateOf).toBe("active")
          expect(pendenciesOf(exit)).toEqual(["NOVA: checkpoint corrompido"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("an active execution refuses the close", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          running.add("ses_atlas")
          const exit = yield* SquadTransition.close({ generation: "gen-1" }).pipe(Effect.exit)
          expect(yield* stateOf).toBe("active")
          expect(pendenciesOf(exit)).toEqual(["ATLAS: execução ativa"])
          running.clear()
          const receipt = yield* SquadTransition.close({ generation: "gen-1" })
          expect<string>(receipt.sourceGeneration).toBe("gen-1")
          expect(yield* stateOf).toBe("closed")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("the receipt carries the registry digest and keeps the orchestrator open", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const receipt = yield* SquadTransition.close({ generation: "gen-1" })
          const registry = yield* SquadRegistry.Service
          const generation = yield* registry.generation("gen-1")
          const expected = SquadRegistry.registryDigest(
            "gen-1",
            generation!.sessions.map((entry) => ({
              name: entry.name,
              provider: entry.provider,
              model: entry.model,
              variant: entry.variant ?? null,
              location: entry.location.directory,
              branch: entry.branch ?? null,
              sessionID: entry.sessionID ?? null,
              state: entry.state,
            })),
          )
          expect(receipt.sourceRegistryDigest).toBe(expected)
          expect(receipt.previousOrchestratorKeptOpen).toBe(true)
          expect(Object.keys(receipt.closed).sort()).toEqual(["ATLAS", "NOVA"])
          expect(Object.keys(receipt.checkpoints).sort()).toEqual(["ATLAS", "NOVA", "ORQ"])
          const db = (yield* Database.Service).db
          const orq = yield* db
            .select()
            .from(SquadSessionTable)
            .where(and(eq(SquadSessionTable.generation_id, "gen-1"), eq(SquadSessionTable.name, "ORQ")))
            .get()
          expect(orq?.state).toBe("verified")
          expect(yield* registry.active()).toBeUndefined()
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a generation without an orchestrator records that nothing was kept open", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup({ orchestrator: false })
          const receipt = yield* SquadTransition.close({ generation: "gen-1" })
          expect(receipt.previousOrchestratorKeptOpen).toBe(false)
          expect(Object.keys(receipt.closed).sort()).toEqual(["ATLAS", "NOVA", "ORQ"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("repeating the close returns the same receipt and audits it once", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const first = yield* SquadTransition.close({ generation: "gen-1" })
          const again = yield* SquadTransition.close({ generation: "gen-1" })
          expect(again).toEqual(first)
          const audit = yield* SquadAudit.Service
          expect((yield* audit.list()).filter((entry) => entry.kind === "close")).toHaveLength(1)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("an unknown generation is not found", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const error = yield* SquadTransition.close({ generation: "gen-9" }).pipe(Effect.flip)
          expect<string>(error._tag).toBe("SessionNotFoundError")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
