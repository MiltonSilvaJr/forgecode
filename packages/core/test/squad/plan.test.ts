import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadStore } from "@opencode/core/squad/store"
import { SquadAuditTable } from "@opencode/core/squad/sql"
import { plan } from "@opencode/core/squad/plan"
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

const session = (name: string, extra: { role?: "orchestrator" | "worker"; sessionID?: string } = {}) => ({
  name,
  role: extra.role ?? "worker",
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  branch: "feature/x",
  sessionID: extra.sessionID,
})

const auditCount = () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const rows = yield* db.select().from(SquadAuditTable).all()
    return rows.length
  })

describe("SquadPlan", () => {
  it.live("renders adopt for an existing session_id and create otherwise", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-1", sessions: [session("A"), session("B", { sessionID: "ses_1" })] })
          const generation = yield* registry.generation("gen-1")
          const result = yield* plan({ generationID: generation!.id, sessions: generation!.sessions })
          // A session that already has a session_id must never be planned for "create".
          expect(
            result.sessions.filter((entry) => entry.sessionID !== undefined && entry.action === "create").length,
          ).toBe(0)
          expect(result.sessions.map((entry) => String(entry.name))).toEqual(["A", "B"])
          expect(result.sessions[0]?.action).toBe("create")
          expect(result.sessions[1]?.action).toBe("adopt")
          expect(String(result.sessions[1]?.sessionID)).toBe("ses_1")
          expect(result.sessions[0]?.promptSha256).toMatch(/^[0-9a-f]{64}$/)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("has zero effect on the registry and audit", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          yield* registry.init({ generation: "gen-1", sessions: [session("A")] })
          const before = yield* registry.generation("gen-1")
          const auditBefore = yield* auditCount()
          yield* plan({ generationID: before!.id, sessions: before!.sessions })
          const after = yield* registry.generation("gen-1")
          const auditAfter = yield* auditCount()
          expect(auditAfter - auditBefore).toBe(0)
          expect(after).toEqual(before)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
