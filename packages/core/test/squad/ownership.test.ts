import { createHash } from "node:crypto"
import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { and, eq, isNull } from "drizzle-orm"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadOwnership } from "@opencode/core/squad/ownership"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadCheckpointTable, SquadSessionTable, SquadTreeOwnerTable } from "@opencode/core/squad/sql"
import { SquadStore } from "@opencode/core/squad/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const config = (scope?: "worktree" | "repository") => [
  new Document({
    type: "document",
    info: new Info({ squad: new ConfigSquad.Info({ enabled: true, ...(scope ? { writer_scope: scope } : {}) }) }),
  }),
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

// Two linked worktrees of one repository share the common directory.
const gitLayer = Layer.succeed(
  Git.Service,
  {
    repo: {
      discover: (directory: string) =>
        Effect.succeed(
          directory.startsWith("/repo/")
            ? Git.Repository.make({
                worktree: directory as never,
                gitDirectory: `/repo/.git/worktrees/${path.basename(directory)}` as never,
                commonDirectory: "/repo/.git" as never,
              })
            : undefined,
        ),
    },
  } as unknown as Git.Interface,
)

const layer = (directory: string, scope?: "worktree" | "repository") =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    SquadOwnership.checkpointLayer,
    gitLayer,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(config(scope)),
  )

const it = testEffect(Layer.empty)

const session = (name: string, directory: string, role: "orchestrator" | "worker" = "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  location: { directory },
})

const sha = (body: string) => createHash("sha256").update(body).digest("hex")

const setup = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const registry = yield* SquadRegistry.Service
  yield* registry.init({
    generation: "gen-1",
    sessions: [session("ORQ", "/orq", "orchestrator"), session("ATLAS", "/repo/a"), session("NOVA", "/repo/b")],
  })
  yield* db
    .insert(SquadTreeOwnerTable)
    .values({ id: "own-1", tree_key: "/repo/a", tree_scope: "worktree", generation_id: "gen-1", owner_name: "ATLAS", acquired_via: "launch", since: 1 })
    .run()
})

const checkpoint = (body: string, options: { sha256?: string } = {}) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const hash = options.sha256 ?? sha(body)
    yield* db
      .insert(SquadCheckpointTable)
      .values({ generation_id: "gen-1", name: "ATLAS", sha256: hash, body, bytes: body.length, created_at: 1 })
      .run()
    yield* db
      .update(SquadSessionTable)
      .set({ checkpoint_sha256: hash })
      .where(and(eq(SquadSessionTable.generation_id, "gen-1"), eq(SquadSessionTable.name, "ATLAS")))
      .run()
  })

const outcome = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : "released"

describe("SquadOwnership.treeKey", () => {
  it.live("worktree scope tells two worktrees of one repository apart", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const a = yield* SquadOwnership.treeKey("/repo/a")
          const b = yield* SquadOwnership.treeKey("/repo/b")
          expect(a.scope).toBe("worktree")
          expect(a.key).not.toBe(b.key)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("repository scope gives both worktrees the same key", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const a = yield* SquadOwnership.treeKey("/repo/a")
          const b = yield* SquadOwnership.treeKey("/repo/b")
          expect(a.scope).toBe("repository")
          expect(a.key).toBe(b.key)
          expect(a.key).toBe("/repo/.git")
        }).pipe(Effect.provide(layer(dir.path, "repository"))),
      ),
    ),
  )

  it.live("without git the key is the canonical location and the scope is worktree", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const plain = yield* SquadOwnership.treeKey(path.join(dir.path, "plain", "..", "plain"))
          expect(plain.scope).toBe("worktree")
          expect(plain.key).toBe(path.join(dir.path, "plain"))
        }).pipe(Effect.provide(layer(dir.path, "repository"))),
      ),
    ),
  )
})

describe("SquadOwnership.release", () => {
  it.live("refuses to release without a checkpoint of the current owner", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const exit = yield* SquadOwnership.release({ from: "ATLAS", to: "NOVA", reason: "handover" }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("ConflictError")
          const db = (yield* Database.Service).db
          const active = yield* db.select().from(SquadTreeOwnerTable).where(isNull(SquadTreeOwnerTable.released_at)).all()
          expect(active.map((row) => row.owner_name)).toEqual(["ATLAS"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("refuses a checkpoint whose hash no longer matches its body", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          yield* checkpoint("body", { sha256: "f".repeat(64) })
          const exit = yield* SquadOwnership.release({ from: "ATLAS", to: "NOVA", reason: "handover" }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("ConflictError")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("requires a reason and a target in the active generation", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          yield* checkpoint("body")
          const noReason = yield* SquadOwnership.release({ from: "ATLAS", to: "NOVA", reason: " " }).pipe(Effect.exit)
          expect(outcome(noReason)).toBe("InvalidInputError")
          const ghost = yield* SquadOwnership.release({ from: "ATLAS", to: "GHOST", reason: "handover" }).pipe(Effect.exit)
          expect(outcome(ghost)).toBe("ConflictError")
          const stranger = yield* SquadOwnership.release({ from: "NOVA", to: "ATLAS", reason: "handover" }).pipe(Effect.exit)
          expect(outcome(stranger)).toBe("ConflictError")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("closes the old ownership and opens the new one, auditing the checkpoint hash", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          yield* checkpoint("body")
          const done = yield* SquadOwnership.release({ from: "ATLAS", to: "NOVA", reason: "handover", actor: "ORQ" })
          expect(done.checkpointSha256).toBe(sha("body"))
          const db = (yield* Database.Service).db
          const rows = yield* db.select().from(SquadTreeOwnerTable).orderBy(SquadTreeOwnerTable.since).all()
          expect(rows.map((row) => [row.owner_name, row.released_at === null])).toEqual([
            ["ATLAS", false],
            ["NOVA", true],
          ])
          expect(rows[1]?.tree_key).toBe("/repo/a")
          const audit = yield* (yield* SquadAudit.Service).list()
          const entry = audit.find((line) => line.kind === "release")
          expect(entry?.actor).toBe("ORQ")
          expect(entry?.detail).toContain(sha("body"))
          expect(entry?.detail).toContain("handover")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
