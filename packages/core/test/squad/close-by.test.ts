import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadActivity } from "@opencode/core/squad/activity"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadCheckpoint } from "@opencode/core/squad/checkpoint"
import { ConflictError, SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSessionTable } from "@opencode/core/squad/sql"
import { SquadStore } from "@opencode/core/squad/store"
import { SquadTransition } from "@opencode/core/squad/transition"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { SessionMessage } from "@opencode/schema/session-message"
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
const queued = new Map<string, number>()

const activity = Layer.succeed(
  SquadActivity.Service,
  SquadActivity.Service.of({ isActive: (sessionID) => Effect.succeed(running.has(sessionID)) }),
)

const channel = Layer.succeed(
  SquadChannel.Service,
  SquadChannel.Service.of({
    enqueue: () => Effect.die("close never enqueues"),
    pending: (sessionID) =>
      Effect.succeed(
        Array.from({ length: queued.get(sessionID) ?? 0 }, (_, index) => ({
          id: SessionMessage.ID.make(`msg_${index}`),
          delivery: "queue" as const,
          createdAt: 0,
        })),
      ),
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
  location: { directory: `/squad/${name}` },
  sessionID,
})

const setup = (checkpoints = ["ORQ", "ATLAS", "NOVA"]) =>
  Effect.gen(function* () {
    running.clear()
    queued.clear()
    const db = (yield* Database.Service).db
    const registry = yield* SquadRegistry.Service
    yield* registry.init({
      generation: "gen-1",
      sessions: [session("ORQ", "ses_orq", "orchestrator"), session("ATLAS", "ses_atlas"), session("NOVA", "ses_nova")],
    })
    yield* db.update(SquadSessionTable).set({ state: "verified" }).run()
    for (const name of checkpoints) yield* SquadCheckpoint.write({ name, body: checkpointBody })
  })

const pendenciesOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) return []
  const error = Cause.squash(exit.cause)
  return error instanceof ConflictError ? error.pendencies : []
}

const messageOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { message: string }).message : ""

const closeDetail = Effect.gen(function* () {
  const audit = yield* SquadAudit.Service
  const entry = (yield* audit.list()).find((item) => item.kind === "close")
  try {
    return JSON.parse(entry?.detail ?? "{}") as Record<string, unknown>
  } catch {
    return {}
  }
})

describe("SquadTransition.close sender and inbox", () => {
  it.live("records who closed in the receipt and in the audit line", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const receipt = yield* SquadTransition.close({ generation: "gen-1", by: "ATLAS" })
          expect(Object.keys(yield* closeDetail)).toContain("closed_by")
          expect(receipt.closedBy).toBe("ATLAS")
          expect((yield* closeDetail).closed_by).toBe("ATLAS")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("the orchestrator, the default sender, is excluded from the active-execution check", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          running.add("ses_orq")
          const receipt = yield* SquadTransition.close({ generation: "gen-1" })
          expect(receipt.closedBy).toBe("ORQ")
          expect((yield* closeDetail).closed_by).toBe("ORQ")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("another running session still blocks, and --by accepts a name or a session id", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          running.add("ses_orq")
          running.add("ses_atlas")
          const blocked = yield* SquadTransition.close({ generation: "gen-1" }).pipe(Effect.exit)
          expect(pendenciesOf(blocked)).toEqual(["ATLAS: execução ativa"])
          running.delete("ses_orq")
          const receipt = yield* SquadTransition.close({ generation: "gen-1", by: "ses_atlas" })
          expect(receipt.closedBy).toBe("ATLAS")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("the sender still needs an intact checkpoint", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup(["ATLAS", "NOVA"])
          running.add("ses_orq")
          const exit = yield* SquadTransition.close({ generation: "gen-1" }).pipe(Effect.exit)
          expect(pendenciesOf(exit)).toEqual(["ORQ: checkpoint ausente"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("an unknown sender is refused", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const exit = yield* SquadTransition.close({ generation: "gen-1", by: "GHOST" }).pipe(Effect.exit)
          expect(messageOf(exit)).toContain("GHOST")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a pending inbox item refuses the close unless --force comes with a reason, which is audited", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          queued.set("ses_nova", 2)
          const blocked = yield* SquadTransition.close({ generation: "gen-1" }).pipe(Effect.exit)
          expect(pendenciesOf(blocked)).toEqual(["NOVA: inbox_pending 2"])
          const registry = yield* SquadRegistry.Service
          expect((yield* registry.get("gen-1"))?.state).toBe("active")
          const noReason = yield* SquadTransition.close({ generation: "gen-1", force: true }).pipe(Effect.exit)
          expect(messageOf(noReason)).toContain("--reason")
          expect((yield* registry.get("gen-1"))?.state).toBe("active")
          yield* SquadTransition.close({ generation: "gen-1", force: true, reason: "fila abandonada" })
          expect((yield* registry.get("gen-1"))?.state).toBe("closed")
          const detail = yield* closeDetail
          expect(detail.forced_reason).toBe("fila abandonada")
          expect(detail.forced).toEqual(["NOVA: inbox_pending 2"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("--force does not waive a missing checkpoint or a running session", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup(["ORQ", "NOVA"])
          running.add("ses_nova")
          queued.set("ses_nova", 1)
          const exit = yield* SquadTransition.close({ generation: "gen-1", force: true, reason: "x" }).pipe(Effect.exit)
          expect(pendenciesOf(exit)).toEqual(["ATLAS: checkpoint ausente", "NOVA: execução ativa"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
