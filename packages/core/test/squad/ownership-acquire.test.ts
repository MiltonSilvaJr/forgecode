import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq, isNull } from "drizzle-orm"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadDispatch } from "@opencode/core/squad/dispatch"
import { SquadOwnership } from "@opencode/core/squad/ownership"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadTreeOwnerTable } from "@opencode/core/squad/sql"
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

const git = Layer.succeed(
  Git.Service,
  {
    repo: {
      discover: (directory: string) =>
        Effect.succeed(
          Git.Repository.make({
            worktree: directory as never,
            gitDirectory: `/repo/.git/worktrees/${path.basename(directory)}` as never,
            commonDirectory: "/repo/.git" as never,
          }),
        ),
    },
    history: { resolve: () => Effect.succeed("c".repeat(40)) },
  } as unknown as Git.Interface,
)

const unusedChannel = Layer.succeed(
  SquadChannel.Service,
  SquadChannel.Service.of({ enqueue: () => Effect.die("unexpected enqueue"), pending: () => Effect.succeed([]) }),
)

const layer = (directory: string) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    SquadOwnership.checkpointLayer,
    unusedChannel,
    git,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(enabled),
  )

const it = testEffect(Layer.empty)

const session = (name: string, directory: string, role: "orchestrator" | "worker" = "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  location: { directory },
})

const outcome = (exit: Exit.Exit<{ status: string }, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : exit.value.status

const active = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  return yield* db.select().from(SquadTreeOwnerTable).where(isNull(SquadTreeOwnerTable.released_at)).all()
})

const dispatchFor = (owner: string) => ({
  scope: "billing",
  owner,
  base: "dev",
  head: "feature/x",
  dor: "ready",
  dod: "done",
  proof: "ci",
  exclusions: ["none"],
  milestone: "M1",
})

describe("SquadOwnership.acquireTree", () => {
  it.live("the first acquire opens the row and a second session on the same tree is refused", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const first = yield* SquadOwnership.acquireTree({ generationID: "gen-1", name: "ATLAS", directory: "/repo/a", via: "launch" }).pipe(Effect.exit)
          expect(outcome(first)).toBe("acquired")
          const again = yield* SquadOwnership.acquireTree({ generationID: "gen-1", name: "ATLAS", directory: "/repo/a", via: "launch" }).pipe(Effect.exit)
          expect(outcome(again)).toBe("held")
          const other = yield* SquadOwnership.acquireTree({ generationID: "gen-1", name: "NOVA", directory: "/repo/a", via: "launch" }).pipe(Effect.exit)
          expect(outcome(other)).toBe("ConflictError")
          const rows = yield* active
          expect(rows.map((row) => [row.owner_name, row.acquired_via, row.tree_key])).toEqual([["ATLAS", "launch", "/repo/a"]])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("ownership is global: a new generation cannot acquire until the previous one releases", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* SquadOwnership.acquireTree({ generationID: "gen-1", name: "ATLAS", directory: "/repo/a", via: "launch" })
          const sameName = yield* SquadOwnership.acquireTree({ generationID: "gen-2", name: "ATLAS", directory: "/repo/a", via: "launch" }).pipe(Effect.exit)
          expect(outcome(sameName)).toBe("ConflictError")
          const db = (yield* Database.Service).db
          yield* db.update(SquadTreeOwnerTable).set({ released_at: 2 }).where(eq(SquadTreeOwnerTable.owner_name, "ATLAS")).run()
          const after = yield* SquadOwnership.acquireTree({ generationID: "gen-2", name: "ATLAS", directory: "/repo/a", via: "launch" }).pipe(Effect.exit)
          expect(outcome(after)).toBe("acquired")
          expect((yield* active).map((row) => row.generation_id)).toEqual(["gen-2"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("two concurrent acquires leave exactly one owner", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const exits = yield* Effect.all(
            ["ATLAS", "NOVA", "ZED"].map((name) =>
              SquadOwnership.acquireTree({ generationID: "gen-1", name, directory: "/repo/a", via: "launch" }).pipe(Effect.exit),
            ),
            { concurrency: "unbounded" },
          )
          expect(exits.map(outcome).filter((entry) => entry === "acquired").length).toBe(1)
          expect(exits.map(outcome).filter((entry) => entry === "ConflictError").length).toBe(2)
          expect((yield* active).length).toBe(1)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})

describe("dispatch confirms ownership", () => {
  it.live("the first dispatch acquires via dispatch; a launch acquisition is kept; another owner is refused", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          yield* registry.init({
            generation: "gen-1",
            sessions: [session("ORQ", "/orq", "orchestrator"), session("ATLAS", "/repo/a"), session("NOVA", "/repo/b"), session("ZED", "/repo/a")],
          })
          yield* SquadDispatch.create(dispatchFor("ATLAS"))
          expect((yield* active).map((row) => [row.owner_name, row.acquired_via])).toEqual([["ATLAS", "dispatch"]])
          const second = yield* SquadDispatch.create(dispatchFor("ATLAS"))
          expect(second.seq).toBe(2)
          const taken = yield* SquadDispatch.create(dispatchFor("ZED")).pipe(Effect.exit)
          expect(Exit.isFailure(taken) ? (Cause.squash(taken.cause) as { _tag?: string })._tag : "created").toBe("ConflictError")
          expect((yield* SquadDispatch.list()).length).toBe(2)
          yield* SquadOwnership.acquireTree({ generationID: "gen-1", name: "NOVA", directory: "/repo/b", via: "launch" })
          yield* SquadDispatch.create(dispatchFor("NOVA"))
          expect((yield* active).map((row) => [row.owner_name, row.acquired_via]).sort()).toEqual([
            ["ATLAS", "dispatch"],
            ["NOVA", "launch"],
          ])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
