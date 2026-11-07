import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Location } from "@opencode/core/location"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { SquadActivity } from "@opencode/core/squad/activity"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadCheckpoint } from "@opencode/core/squad/checkpoint"
import { SquadLiveness } from "@opencode/core/squad/liveness"
import { ConflictError, SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSessionTable } from "@opencode/core/squad/sql"
import { SquadStore } from "@opencode/core/squad/store"
import { SquadTransition } from "@opencode/core/squad/transition"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { globalProjectNode } from "../lib/project"
import { testEffect } from "../lib/effect"

const enabled = [
  new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: true }) }) }),
]

// The real session service, store and projector on a real database. Execution is process-local and empty,
// which is exactly what a freshly restarted server sees: nothing in flight in memory.
const sessions = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
  [
    Bus.node.replace(Bus.configured({ persist: true })),
    Project.node.replace(globalProjectNode),
    SessionExecution.node.replace(SessionExecution.noopLayer),
  ],
)

const channel = Layer.succeed(
  SquadChannel.Service,
  SquadChannel.Service.of({
    enqueue: () => Effect.die("close never enqueues"),
    pending: () => Effect.succeed([]),
  }),
)

const it = testEffect(
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    channel,
    Config.testLayer(enabled),
    SquadActivity.layer.pipe(Layer.provideMerge(SquadChannel.sessionsLayer)),
  ).pipe(Layer.provideMerge(Layer.merge(sessions, SessionExecution.noopLayer))),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const checkpointBody = ["Resultado", "Fontes", "Comandos e provas", "Limites", "Próximos passos", "Posse da árvore"]
  .map((title) => `## ${title}\nok`)
  .join("\n")

const entry = (name: string, sessionID: string, role: "orchestrator" | "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  branch: "feature/x",
  sessionID,
})

const setup = Effect.gen(function* () {
  const created = yield* Session.Service
  const orq = yield* created.create({ location })
  const atlas = yield* created.create({ location })
  const db = (yield* Database.Service).db
  const registry = yield* SquadRegistry.Service
  yield* registry.init({
    generation: "gen-1",
    sessions: [entry("ORQ", orq.id, "orchestrator"), entry("ATLAS", atlas.id, "worker")],
  })
  yield* db.update(SquadSessionTable).set({ state: "verified" }).run()
  for (const name of ["ORQ", "ATLAS"]) yield* SquadCheckpoint.write({ name, body: checkpointBody })
  return { atlas: atlas.id }
})

const pendenciesOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) return []
  const error = Cause.squash(exit.cause)
  return error instanceof ConflictError ? error.pendencies : []
}

const claimOf = (sessionID: Session.ID) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const row = yield* db.select({ since: SessionTable.time_suspended }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get()
    return row?.since ?? undefined
  })

describe("SquadTransition.close and the durable execution claim (REQ-11)", () => {
  it.live("a claim preserved across a restart refuses the close, names the session and keeps the claim", () =>
    Effect.gen(function* () {
      const { atlas } = yield* setup
      const store = yield* SessionStore.Service
      yield* store.claim(atlas)
      const before = yield* claimOf(atlas)
      expect(before).toBeDefined()

      const exit = yield* SquadTransition.close({ generation: "gen-1" }).pipe(Effect.exit)
      expect(pendenciesOf(exit)).toEqual(["ATLAS: execução ativa"])
      expect((yield* (yield* SquadRegistry.Service).get("gen-1"))?.state).toBe("active")
      // Refusing must not reconcile anything on the caller's behalf.
      expect(yield* claimOf(atlas)).toBe(before)
    }),
  )

  it.live("releasing the claim, as a user interrupt terminal does, lets the close pass", () =>
    Effect.gen(function* () {
      const { atlas } = yield* setup
      const store = yield* SessionStore.Service
      yield* store.claim(atlas)
      expect(pendenciesOf(yield* SquadTransition.close({ generation: "gen-1" }).pipe(Effect.exit))).toEqual(["ATLAS: execução ativa"])

      yield* store.release(atlas)
      const receipt = yield* SquadTransition.close({ generation: "gen-1" })
      expect<string>(receipt.sourceGeneration).toBe("gen-1")
    }),
  )

  it.live("close and liveness agree on whether a preserved claim is execution in flight", () =>
    Effect.gen(function* () {
      const { atlas } = yield* setup
      const store = yield* SessionStore.Service
      const sessionsPort = yield* SquadChannel.SessionsService
      const activity = yield* SquadActivity.Service

      expect(yield* activity.isActive(atlas)).toBe(false)
      expect(yield* sessionsPort.claim(atlas)).toBeUndefined()

      yield* store.claim(atlas)
      expect(yield* activity.isActive(atlas)).toBe(true)
      const claim = yield* sessionsPort.claim(atlas)
      expect(claim?.since).toBeDefined()
      const info = yield* sessionsPort.get(atlas)
      const verdict = yield* SquadLiveness.measure(info!, [], { staleAfter: 3_600_000, deadAfter: 86_400_000 }, claim)
      expect(verdict.verdict).toBe("working")

      yield* store.release(atlas)
      expect(yield* activity.isActive(atlas)).toBe(false)
      expect(yield* sessionsPort.claim(atlas)).toBeUndefined()
    }),
  )
})
