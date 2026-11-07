import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadGenerationTable, SquadSessionTable } from "@opencode/core/squad/sql"
import { SquadStore } from "@opencode/core/squad/store"
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

const layer = (directory: string) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(enabled),
  )

const it = testEffect(Layer.empty)

const session = (name: string, sessionID?: string) => ({
  name,
  role: "worker" as const,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  branch: "feature/x",
  sessionID,
})

const closedRow = (generationID: string, name: string, sessionID: string) => ({
  generation_id: generationID,
  name,
  role: "worker" as const,
  provider: "kimi",
  model: "k3.1-pro",
  variant: "high",
  location: { directory: `/squad/${name}` },
  branch: "feature/y",
  session_id: sessionID,
  state: "verified" as const,
  productive: false,
  created_at: 1,
  updated_at: 1,
})

const failureTag = (exit: Exit.Exit<SquadRegistry.ResolvedSession, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : exit.value.sessionID

describe("SquadRegistry.resolve", () => {
  it.live("resolves a name in the active generation", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-1", sessions: [session("ATLAS", "ses_1")] })
          const result = yield* registry.resolve("ATLAS")
          expect(result.name).toBe("ATLAS")
          expect(result.sessionID).toBe("ses_1")
          expect(result.generationID).toBe("gen-1")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("refuses to resolve a name from a closed generation", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-1", sessions: [session("OTHER", "ses_2")] })
          yield* db.insert(SquadGenerationTable).values({ id: "gen-0", run_id: "run-0", state: "closed", created_at: 1 }).run()
          yield* db.insert(SquadSessionTable).values(closedRow("gen-0", "ATLAS", "ses_1")).run()
          const result = yield* registry.resolve("ATLAS").pipe(Effect.exit)
          expect(failureTag(result)).toBe("SessionNotFoundError")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("resolves a session id in a closed generation", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-1", sessions: [session("OTHER", "ses_2")] })
          yield* db.insert(SquadGenerationTable).values({ id: "gen-0", run_id: "run-0", state: "closed", created_at: 1 }).run()
          yield* db.insert(SquadSessionTable).values(closedRow("gen-0", "ATLAS", "ses_1")).run()
          const result = yield* registry.resolve("ses_1")
          expect(result.name).toBe("ATLAS")
          expect(result.generationID).toBe("gen-0")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("does not rewrite or copy a previous generation's session", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const db = (yield* Database.Service).db
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-1", sessions: [session("OTHER", "ses_2")] })
          yield* db.insert(SquadGenerationTable).values({ id: "gen-0", run_id: "run-0", state: "closed", created_at: 1 }).run()
          yield* db.insert(SquadSessionTable).values(closedRow("gen-0", "ATLAS", "ses_1")).run()
          yield* registry.resolve("ses_1")
          const active = yield* registry.active()
          expect(active?.sessions.some((entry) => entry.name === "ATLAS")).toBe(false)
          const closed = yield* registry.get("gen-0")
          expect(closed?.sessions[0]?.sessionID).toBe("ses_1")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
