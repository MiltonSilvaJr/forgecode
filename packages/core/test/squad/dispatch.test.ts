import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadDispatch } from "@opencode/core/squad/dispatch"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadDispatchTable } from "@opencode/core/squad/sql"
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

const repository = Git.Repository.make({
  worktree: "/squad/ATLAS" as never,
  gitDirectory: "/squad/ATLAS/.git" as never,
  commonDirectory: "/squad/ATLAS/.git" as never,
})

const gitLayer = (options: { repository?: boolean; refs?: Record<string, string> } = {}) =>
  Layer.succeed(
    Git.Service,
    {
      repo: { discover: () => Effect.succeed(options.repository === false ? undefined : repository) },
      history: { resolve: (_repository: unknown, ref: string) => Effect.succeed(options.refs?.[ref]) },
    } as unknown as Git.Interface,
  )

const layer = (directory: string, git: ReturnType<typeof gitLayer> = gitLayer({ refs: { dev: "a".repeat(40), "feature/x": "b".repeat(40) } })) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    git,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(enabled),
  )

const it = testEffect(Layer.empty)

const session = (name: string, role: "orchestrator" | "worker" = "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  branch: "feature/x",
})

const setup = Effect.gen(function* () {
  const registry = yield* SquadRegistry.Service
  yield* registry.init({ generation: "gen-1", sessions: [session("ORQ", "orchestrator"), session("ATLAS")] })
})

const full: SquadDispatch.CreateInput = {
  scope: "billing refactor",
  owner: "ATLAS",
  base: "dev",
  head: "feature/x",
  dor: "spec approved",
  dod: "tests green",
  proof: "CI link",
  exclusions: ["no schema change"],
  milestone: "M1",
}

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string; missing?: string[]; message?: string }) : undefined

const sameList = (actual: readonly string[] | undefined, expected: readonly string[]) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`)
}

describe("SquadDispatch.create", () => {
  it.live("reports every missing field in one answer", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const two = yield* SquadDispatch.create({ ...full, dod: undefined, proof: undefined }).pipe(Effect.exit)
          sameList(failure(two)?.missing, ["dod", "proof"])
          const exit = yield* SquadDispatch.create({ ...full, dod: undefined, proof: "  ", exclusions: [] }).pipe(Effect.exit)
          expect(failure(exit)?._tag).toBe("InvalidInputError")
          sameList(failure(exit)?.missing, ["dod", "proof", "exclusions"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("allocates ORQ-<generation>-<NNN> with a monotonic seq and records measured oids", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const first = yield* SquadDispatch.create(full)
          const second = yield* SquadDispatch.create(full)
          expect(first.orqID).toBe("ORQ-gen-1-001")
          expect(second.orqID).toBe("ORQ-gen-1-002")
          expect([first.seq, second.seq]).toEqual([1, 2])
          expect(first.baseOid).toBe("a".repeat(40))
          expect(first.headOid).toBe("b".repeat(40))
          expect(first.validation).toBe("verified")
          expect(first.state).toBe("open")
          expect([...first.exigidos]).toEqual(["ci", "merge", "acceptance"])
          const listed = yield* SquadDispatch.list()
          expect(listed.map((entry) => entry.orqID)).toEqual(["ORQ-gen-1-001", "ORQ-gen-1-002"])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a base that does not resolve is refused and nothing is stored", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const exit = yield* SquadDispatch.create({ ...full, base: "ghost" }).pipe(Effect.exit)
          expect(failure(exit)?._tag).toBe("InvalidInputError")
          expect(failure(exit)?.message).toContain("base")
          const db = (yield* Database.Service).db
          expect((yield* db.select().from(SquadDispatchTable).all()).length).toBe(0)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a valid head that does not exist yet is unknown with a reason, not a failure", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const created = yield* SquadDispatch.create({ ...full, head: "feature/not-yet" })
          expect(created.validation).toBe("unknown")
          expect(created.headOid).toBeUndefined()
          expect(created.baseOid).toBe("a".repeat(40))
          expect(created.warnings?.join(" ")).toContain("feature/not-yet")
          const bad = yield* SquadDispatch.create({ ...full, head: "bad..name" }).pipe(Effect.exit)
          expect(failure(bad)?._tag).toBe("InvalidInputError")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("without git both oids are unknown and the dispatch is accepted with a warning", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const created = yield* SquadDispatch.create(full)
          expect(created.validation).toBe("unknown")
          expect(created.baseOid).toBeUndefined()
          expect(created.headOid).toBeUndefined()
          expect(created.warnings?.length).toBeGreaterThan(0)
        }).pipe(Effect.provide(layer(dir.path, gitLayer({ repository: false })))),
      ),
    ),
  )

  it.live("an owner outside the active generation is refused", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const exit = yield* SquadDispatch.create({ ...full, owner: "GHOST" }).pipe(Effect.exit)
          expect(failure(exit)?._tag).toBe("ConflictError")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("two concurrent dispatches keep seq unique and monotonic", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const created = yield* Effect.all([SquadDispatch.create(full), SquadDispatch.create(full), SquadDispatch.create(full)], {
            concurrency: "unbounded",
          })
          expect(created.map((entry) => entry.seq).sort()).toEqual([1, 2, 3])
          expect(new Set(created.map((entry) => entry.orqID)).size).toBe(3)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})

