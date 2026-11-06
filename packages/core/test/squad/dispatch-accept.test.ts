import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
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

const head = "b".repeat(40)

const git = Layer.succeed(
  Git.Service,
  {
    repo: {
      discover: () =>
        Effect.succeed(
          Git.Repository.make({
            worktree: "/squad/ATLAS" as never,
            gitDirectory: "/squad/ATLAS/.git" as never,
            commonDirectory: "/squad/ATLAS/.git" as never,
          }),
        ),
    },
    history: { resolve: (_repository: unknown, ref: string) => Effect.succeed(ref === "dev" ? "a".repeat(40) : head) },
  } as unknown as Git.Interface,
)

const layer = (directory: string) =>
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
  location: { directory: `/squad/${name}` },
})

const setup = Effect.gen(function* () {
  const registry = yield* SquadRegistry.Service
  yield* registry.init({ generation: "gen-1", sessions: [session("ORQ", "orchestrator"), session("ATLAS")] })
  return yield* SquadDispatch.create({
    scope: "billing",
    owner: "ATLAS",
    base: "dev",
    head: "feature/x",
    dor: "ready",
    dod: "done",
    proof: "ci",
    exclusions: ["none"],
    milestone: "M1",
  })
})

const outcome = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : "ok"

const acceptLines = Effect.gen(function* () {
  const lines = yield* (yield* SquadAudit.Service).list()
  return lines.filter((line) => line.kind === "dispatch_accept")
})

describe("SquadDispatch.accept", () => {
  it.live("moves an open dispatch to accepted, recording who and when", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const created = yield* setup
          expect(created.state).toBe("open")
          const accepted = yield* SquadDispatch.accept({ orq: created.orqID })
          expect(accepted.state).toBe("accepted")
          expect(accepted.acceptedAt).toBeDefined()
          expect<string | undefined>(accepted.acceptedBy).toBe("ATLAS")
          const lines = yield* acceptLines
          expect(lines.length).toBe(1)
          expect(lines[0]?.target).toBe("ATLAS")
          expect(lines[0]?.detail).toContain(created.orqID)
          expect(lines[0]?.detail).toContain(head)
          const listed = yield* SquadDispatch.list()
          expect(listed[0]?.state).toBe("accepted")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("an explicit acceptor is recorded", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const created = yield* setup
          const accepted = yield* SquadDispatch.accept({ orq: created.orqID, by: "ORQ" })
          expect<string | undefined>(accepted.acceptedBy).toBe("ORQ")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("repeating the accept is a no-op: same instant, one audit line", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const created = yield* setup
          const first = yield* SquadDispatch.accept({ orq: created.orqID })
          const again = yield* SquadDispatch.accept({ orq: created.orqID, by: "ORQ" })
          expect(again.state).toBe("accepted")
          expect(again.acceptedAt).toEqual(first.acceptedAt)
          expect<string | undefined>(again.acceptedBy).toBe("ATLAS")
          expect((yield* acceptLines).length).toBe(1)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("done and blocked dispatches, other generations and unknown ids are refused", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const created = yield* setup
          const db = (yield* Database.Service).db
          for (const state of ["done", "blocked"] as const) {
            yield* db.update(SquadDispatchTable).set({ state }).where(eq(SquadDispatchTable.orq_id, created.orqID)).run()
            expect(outcome(yield* SquadDispatch.accept({ orq: created.orqID }).pipe(Effect.exit))).toBe("ConflictError")
          }
          yield* db.insert(SquadDispatchTable).values({
            id: "old",
            generation_id: "gen-0",
            orq_id: "ORQ-gen-0-001",
            seq: 1,
            scope: "s",
            owner: "ATLAS",
            base: "dev",
            head: "x",
            validation: "unknown",
            dor: "d",
            dod: "d",
            proof: "p",
            exclusions: ["e"],
            milestone: "m",
            state: "open",
            created_at: 1,
          }).run()
          expect(outcome(yield* SquadDispatch.accept({ orq: "ORQ-gen-0-001" }).pipe(Effect.exit))).toBe("ConflictError")
          expect(outcome(yield* SquadDispatch.accept({ orq: "ORQ-gen-1-099" }).pipe(Effect.exit))).toBe("DispatchNotFoundError")
          expect((yield* acceptLines).length).toBe(0)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
