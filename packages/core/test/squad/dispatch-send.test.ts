import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadDispatch } from "@opencode/core/squad/dispatch"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSend } from "@opencode/core/squad/send"
import { SquadDispatchTable, SquadSessionTable, SquadTreeOwnerTable } from "@opencode/core/squad/sql"
import { SquadStore } from "@opencode/core/squad/store"
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

const enqueues: SquadChannel.EnqueueInput[] = []

const channel = Layer.succeed(
  SquadChannel.Service,
  SquadChannel.Service.of({
    enqueue: (input) =>
      Effect.sync(() => {
        enqueues.push(input)
        return { messageID: SessionMessage.ID.make(`msg_${input.idempotencyKey ?? enqueues.length}`) }
      }),
    pending: () => Effect.succeed([]),
  }),
)

const git = Layer.succeed(
  Git.Service,
  {
    repo: {
      discover: (directory: string) =>
        Effect.succeed(
          Git.Repository.make({
            worktree: directory as never,
            gitDirectory: `${directory}/.git` as never,
            commonDirectory: `${directory}/.git` as never,
          }),
        ),
    },
    history: { resolve: () => Effect.succeed("c".repeat(40)) },
  } as unknown as Git.Interface,
)

const layer = (directory: string) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    channel,
    git,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(enabled),
  )

const it = testEffect(Layer.empty)

const session = (name: string, sessionID: string, role: "orchestrator" | "worker" = "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  location: { directory: `/squad/${name}` },
  sessionID,
})

const setup = (states: Record<string, "verified" | "starting"> = {}) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const registry = yield* SquadRegistry.Service
    yield* registry.init({
      generation: "gen-1",
      sessions: [session("ORQ", "ses_orq", "orchestrator"), session("ATLAS", "ses_atlas"), session("NOVA", "ses_nova")],
    })
    for (const name of ["ORQ", "ATLAS", "NOVA"])
      yield* db
        .update(SquadSessionTable)
        .set({ state: states[name] ?? "verified" })
        .where(eq(SquadSessionTable.name, name))
        .run()
    // The first dispatch confirms ownership; here ATLAS already owns its tree and NOVA owns nothing.
    yield* db
      .insert(SquadTreeOwnerTable)
      .values({ id: "own-1", tree_key: "/squad/ATLAS", tree_scope: "worktree", generation_id: "gen-1", owner_name: "ATLAS", acquired_via: "launch", since: 1 })
      .run()
    enqueues.length = 0
  })

const dispatchInput = {
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

const outcome = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : "ok"

describe("dispatch delivery", () => {
  it.live("--send enqueues once, keyed dispatch:<orq_id>, with every field rendered", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const created = yield* SquadDispatch.create({ ...dispatchInput, send: true })
          expect(enqueues.length).toBe(1)
          expect(enqueues[0]?.idempotencyKey).toBe(`dispatch:${created.orqID}`)
          expect(String(enqueues[0]?.sessionID)).toBe("ses_atlas")
          const text = enqueues[0]?.text ?? ""
          for (const field of [
            created.orqID,
            "billing refactor",
            "ATLAS",
            "dev",
            "feature/x",
            "c".repeat(40),
            "spec approved",
            "tests green",
            "CI link",
            "no schema change",
            "M1",
          ])
            expect(text).toContain(field)
          expect(created.sent?.messageID).toBeDefined()
          const again = yield* SquadSend.send({ to: "ATLAS", text, dispatch: created.orqID })
          expect(enqueues[1]?.idempotencyKey).toBe(`dispatch:${created.orqID}`)
          expect(again.messageID).toBe(created.sent!.messageID)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a create without --send enqueues nothing", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const created = yield* SquadDispatch.create(dispatchInput)
          expect(created.sent).toBeUndefined()
          expect(enqueues.length).toBe(0)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("--send to an unverified owner is refused before the dispatch is stored", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup({ ATLAS: "starting" })
          const exit = yield* SquadDispatch.create({ ...dispatchInput, send: true }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("ConflictError")
          expect(enqueues.length).toBe(0)
          expect((yield* SquadDispatch.list()).length).toBe(0)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("send --dispatch to a session that does not own the tree fails; plain send is not blocked", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const created = yield* SquadDispatch.create(dispatchInput)
          const refused = yield* SquadSend.send({ to: "NOVA", text: "go", dispatch: created.orqID }).pipe(Effect.exit)
          expect(outcome(refused)).toBe("ConflictError")
          expect(enqueues.length).toBe(0)
          const plain = yield* SquadSend.send({ to: "NOVA", text: "hello" }).pipe(Effect.exit)
          expect(outcome(plain)).toBe("ok")
          expect(enqueues.length).toBe(1)
          const owner = yield* SquadSend.send({ to: "ATLAS", text: "go", dispatch: created.orqID }).pipe(Effect.exit)
          expect(outcome(owner)).toBe("ok")
          expect(enqueues.length).toBe(2)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("send --dispatch with an unknown dispatch or another generation's is refused", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const created = yield* SquadDispatch.create(dispatchInput)
          const unknown = yield* SquadSend.send({ to: "ATLAS", text: "go", dispatch: "ORQ-gen-1-099" }).pipe(Effect.exit)
          expect(outcome(unknown)).toBe("ConflictError")
          const db = (yield* Database.Service).db
          yield* db.update(SquadDispatchTable).set({ generation_id: "gen-0" }).where(eq(SquadDispatchTable.orq_id, created.orqID)).run()
          const foreign = yield* SquadSend.send({ to: "ATLAS", text: "go", dispatch: created.orqID }).pipe(Effect.exit)
          expect(outcome(foreign)).toBe("ConflictError")
          expect(enqueues.length).toBe(0)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
