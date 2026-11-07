import { describe, expect } from "bun:test"
import { Cause, Context, Deferred, Effect, Exit, Layer, LayerMap, Scope } from "effect"
import type { FileSystem } from "@opencode/core/filesystem"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Instance } from "@opencode/core/instance/service"
import { Job } from "@opencode/core/job"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunner } from "@opencode/core/session/runner/index"
import { SessionStore } from "@opencode/core/session/store"
import { KV } from "@opencode/core/kv"
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
import { LayerNode } from "@opencode/util/effect/layer-node"
import { globalProjectNode } from "../lib/project"
import { testEffect } from "../lib/effect"

const enabled = [
  new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: true }) }) }),
]

const sessions = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Job.node, KV.node, Session.node]),
  [Bus.node.replace(Bus.configured({ persist: true })), Project.node.replace(globalProjectNode)],
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
  ).pipe(Layer.provideMerge(sessions)),
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

/** The real execution layer driving a runner that never finishes: a turn in flight that only an interrupt ends. */
const buildExecution = (scope: Scope.Closeable, running: Deferred.Deferred<void>) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    const bus = yield* Bus.Service
    const store = yield* SessionStore.Service
    const jobs = yield* Job.Service
    const runner = Layer.succeed(
      SessionRunner.Service,
      SessionRunner.Service.of({
        drain: () => Deferred.succeed(running, undefined).pipe(Effect.andThen(Effect.never)),
      }),
    )
    const locations = Layer.effect(
      LocationServiceMap.Service,
      LayerMap.make(
        // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
        () => runner as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      ),
    )
    return yield* Layer.buildWithScope(
      Layer.fresh(SessionExecution.layer).pipe(
        Layer.provide(Layer.succeed(Database.Service, database)),
        Layer.provide(Layer.succeed(Bus.Service, bus)),
        Layer.provide(Layer.succeed(SessionStore.Service, store)),
        Layer.provide(Layer.succeed(Job.Service, jobs)),
        Layer.provide(AppNodeBuilder.build(Instance.node, [LocationServiceMap.node.replace(locations)]).pipe(Layer.fresh)),
      ),
      scope,
    )
  })

describe("SquadTransition.close and a user interrupt (REQ-11)", () => {
  it.live("an in-flight turn refuses the close; interrupting it with reason user releases the claim and the close passes", () =>
    Effect.gen(function* () {
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

      const running = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
      const execution = Context.get(yield* buildExecution(scope, running), SessionExecution.Service)
      yield* execution.resume(atlas.id).pipe(Effect.forkScoped)
      yield* Deferred.await(running)

      const activity = SquadActivity.layer.pipe(
        Layer.provideMerge(SquadChannel.sessionsLayer),
        Layer.provide(Layer.succeed(SessionExecution.Service, execution)),
      )
      const closeWith = SquadTransition.close({ generation: "gen-1" }).pipe(Effect.provide(activity))

      const refused = yield* closeWith.pipe(Effect.exit)
      expect(Exit.isFailure(refused) && Cause.squash(refused.cause) instanceof ConflictError).toBe(true)
      expect(Exit.isFailure(refused) && (Cause.squash(refused.cause) as ConflictError).pendencies).toEqual(["ATLAS: execução ativa"])

      expect(yield* execution.interrupt(atlas.id)).toBe(true)
      yield* execution.awaitIdle(atlas.id)
      const receipt = yield* closeWith
      expect<string>(receipt.sourceGeneration).toBe("gen-1")
    }),
  )
})
