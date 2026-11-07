import { describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { $ } from "bun"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadDispatch } from "@opencode/core/squad/dispatch"
import { SquadPanel } from "@opencode/core/squad/panel"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadStore } from "@opencode/core/squad/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { initRepo } from "../fixture/git"
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

// These tests never ask for delivery.
const unusedChannel = Layer.succeed(
  SquadChannel.Service,
  SquadChannel.Service.of({ enqueue: () => Effect.die("unexpected enqueue"), pending: () => Effect.succeed([]) }),
)

const layer = (directory: string) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    unusedChannel,
    LayerNode.compile(Git.node),
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(enabled),
  )

const it = testEffect(Layer.empty)

const sh = (directory: string, ...args: string[]) => Effect.promise(() => $`git ${args}`.cwd(directory).quiet())

/** A repository with `main` at one commit and `feature/x` one commit ahead of it. */
const fixtureRepo = Effect.gen(function* () {
  const root = yield* tmpdirScoped()
  yield* Effect.promise(() => initRepo(root.path))
  yield* sh(root.path, "branch", "-M", "main")
  yield* sh(root.path, "checkout", "-q", "-b", "feature/x")
  yield* Effect.promise(() => fs.writeFile(path.join(root.path, "x.txt"), "x\n"))
  yield* sh(root.path, "add", "x.txt")
  yield* sh(root.path, "commit", "-q", "-m", "feature")
  yield* sh(root.path, "checkout", "-q", "main")
  return yield* Effect.promise(() => fs.realpath(root.path))
})

const dispatchIn = (directory: string, exigidos?: string[]) =>
  Effect.gen(function* () {
    const registry = yield* SquadRegistry.Service
    yield* registry.init({
      generation: "gen-1",
      sessions: [
        { name: "ORQ", role: "orchestrator", provider: "deepseek", model: "deepseek-flash", location: { directory: "/squad/ORQ" } },
        { name: "ATLAS", role: "worker", provider: "deepseek", model: "deepseek-flash", location: { directory } },
      ],
    })
    return yield* SquadDispatch.create({
      scope: "billing",
      owner: "ATLAS",
      base: "main",
      head: "feature/x",
      dor: "ready",
      dod: "done",
      proof: "ci",
      exclusions: ["none"],
      milestone: "M1",
      exigidos,
    })
  })

describe("SquadPanel.build", () => {
  it.live("a card with no evidence has every stage unknown, sits in backlog and does not progress", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const repo = yield* fixtureRepo
          const created = yield* dispatchIn(repo)
          const document = yield* SquadPanel.build()
          const card = document.cards[created.orqID]!
          expect(card.coluna).toBe("backlog")
          expect(card.estagios.jira.status).toBe("unknown")
          expect(card.estagios.ci.status).toBe("unknown")
          expect(card.estagios.deploy.status).toBe("unknown")
          expect(card.desconhecido).toContain("ci")
          expect(card.progressa).toBe(false)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("merge is verified by ancestry in the repository and not before", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const repo = yield* fixtureRepo
          const created = yield* dispatchIn(repo)
          const before = (yield* SquadPanel.build()).cards[created.orqID]!
          expect(before.estagios.merge.status).toBe("failed")
          yield* sh(repo, "merge", "-q", "--ff-only", "feature/x")
          const after = (yield* SquadPanel.build()).cards[created.orqID]!
          expect(after.estagios.merge.status).toBe("verified")
          expect(after.estagios.merge.evidence?.type).toBe("git")
          expect(after.coluna).toBe("in_review")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("done needs every required stage verified; a missing required stage forbids progress", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const repo = yield* fixtureRepo
          const created = yield* dispatchIn(repo, ["merge", "acceptance"])
          yield* sh(repo, "merge", "-q", "--ff-only", "feature/x")
          const pending = (yield* SquadPanel.build()).cards[created.orqID]!
          expect(pending.estagios.acceptance.status).toBe("unknown")
          expect(pending.coluna).not.toBe("done")
          yield* SquadDispatch.accept({ orq: created.orqID })
          const done = (yield* SquadPanel.build()).cards[created.orqID]!
          expect(done.estagios.acceptance.status).toBe("verified")
          expect(done.coluna).toBe("done")
          // jira, ci and deploy are not required but have no source, so the card still must not draw a progress bar.
          expect(done.desconhecido).toEqual(["jira", "ci", "deploy"])
          expect(done.progressa).toBe(false)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("the document carries the keys the kanban consumer reads", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const repo = yield* fixtureRepo
          const created = yield* dispatchIn(repo)
          const kanban = JSON.parse(JSON.stringify(SquadPanel.toKanban(yield* SquadPanel.build())))
          for (const key of ["versao_schema", "revisao", "atualizado_em", "colunas", "cards", "fonte"]) expect(kanban).toHaveProperty(key)
          expect(kanban.versao_schema).toBe(1)
          expect(kanban.colunas).toEqual(["backlog", "in_progress", "in_review", "blocked", "done"])
          const card = kanban.cards[created.orqID]
          for (const key of ["id", "titulo", "coluna", "agente", "prioridade", "refs", "evidencias", "estagios", "exigidos", "desconhecido", "progressa"])
            expect(card).toHaveProperty(key)
          expect(Object.keys(card.estagios)).toEqual(["jira", "ci", "merge", "deploy", "acceptance"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
