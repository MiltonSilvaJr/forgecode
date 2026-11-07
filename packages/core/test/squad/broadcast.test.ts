import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadBroadcast } from "@opencode/core/squad/broadcast"
import { ChannelError, SquadChannel } from "@opencode/core/squad/channel"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadAuditTable, SquadSessionTable } from "@opencode/core/squad/sql"
import { SquadStore } from "@opencode/core/squad/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { SessionMessage } from "@opencode/schema/session-message"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const config = (on: boolean) => [
  new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: on }) }) }),
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

const enqueued: { sessionID: string; text: string; key: string | undefined }[] = []

const channel = (options: { failAt?: number } = {}) =>
  Layer.succeed(
    SquadChannel.Service,
    SquadChannel.Service.of({
      enqueue: (input) =>
        Effect.suspend(() => {
          if (options.failAt !== undefined && enqueued.length + 1 === options.failAt)
            return Effect.fail(new ChannelError({ message: "channel down" }))
          enqueued.push({ sessionID: input.sessionID, text: input.text, key: input.idempotencyKey })
          return Effect.succeed({ messageID: SessionMessage.ID.make(`msg_${enqueued.length}`) })
        }),
      pending: () => Effect.succeed([]),
    }),
  )

const layer = (directory: string, options: { failAt?: number; enabled?: boolean } = {}) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    channel(options),
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(config(options.enabled ?? true)),
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

// Declared order is deliberately not alphabetical: the broadcast must follow the configuration.
const setup = (states: Record<string, "verified" | "starting"> = {}, unlaunched: string[] = []) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const registry = yield* SquadRegistry.Service
    yield* registry.init({
      generation: "gen-1",
      sessions: [
        session("ORQ", "ses_orq", "orchestrator"),
        session("ZED", "ses_zed"),
        session("ATLAS", "ses_atlas"),
        session("MID", "ses_mid"),
      ],
    })
    yield* db.update(SquadSessionTable).set({ state: "verified" }).where(eq(SquadSessionTable.generation_id, "gen-1")).run()
    for (const [name, state] of Object.entries(states))
      yield* db.update(SquadSessionTable).set({ state }).where(eq(SquadSessionTable.name, name)).run()
    for (const name of unlaunched)
      yield* db.update(SquadSessionTable).set({ session_id: null }).where(eq(SquadSessionTable.name, name)).run()
    enqueued.length = 0
  })

const run = <A, E, R>(effect: Effect.Effect<A, E, R>, directory: string, options: { failAt?: number; enabled?: boolean } = {}) =>
  effect.pipe(Effect.provide(layer(directory, options)))

describe("SquadBroadcast", () => {
  it.live("queues nothing when any recipient is invalid and lists every invalid one", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        run(
          Effect.gen(function* () {
            yield* setup({ MID: "starting" }, ["MID"])
            const report = yield* SquadBroadcast.broadcast({ text: "go", from: "ORQ" })
            expect(enqueued.length).toBe(0)
            expect(report.results.map((entry) => [String(entry.name), entry.status])).toEqual([
              ["ZED", "not_attempted"],
              ["ATLAS", "not_attempted"],
              ["MID", "rejected"],
            ])
            expect(report.results[2]?.reason).toContain("starting")
          }),
          dir.path,
        ),
      ),
    ),
  )

  it.live("with every recipient valid the report covers all of them in configuration order", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        run(
          Effect.gen(function* () {
            yield* setup()
            const report = yield* SquadBroadcast.broadcast({ text: "go", from: "ORQ", idempotencyKey: "k1" })
            expect(report.results.map((entry) => [String(entry.name), entry.status])).toEqual([
              ["ZED", "accepted"],
              ["ATLAS", "accepted"],
              ["MID", "accepted"],
            ])
            expect(enqueued.map((entry) => entry.sessionID)).toEqual(["ses_zed", "ses_atlas", "ses_mid"])
            expect(report.results.map((entry) => String(entry.messageID))).toEqual(["msg_1", "msg_2", "msg_3"])
            expect(enqueued.every((entry) => entry.key === "k1")).toBe(true)
          }),
          dir.path,
        ),
      ),
    ),
  )

  it.live("never includes the origin, by name or by session id, unless --include-self", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        run(
          Effect.gen(function* () {
            yield* setup()
            const byName = yield* SquadBroadcast.broadcast({ text: "go", from: "ATLAS" })
            expect(byName.results.map((entry) => String(entry.name))).toEqual(["ORQ", "ZED", "MID"])
            const byID = yield* SquadBroadcast.broadcast({ text: "go", from: "ses_atlas" })
            expect(byID.results.map((entry) => String(entry.name))).toEqual(["ORQ", "ZED", "MID"])
            const withSelf = yield* SquadBroadcast.broadcast({ text: "go", from: "ATLAS", includeSelf: true })
            expect(withSelf.results.map((entry) => String(entry.name))).toEqual(["ORQ", "ZED", "ATLAS", "MID"])
          }),
          dir.path,
        ),
      ),
    ),
  )

  it.live("a failure in the middle keeps what was queued and marks the rest not_attempted", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        run(
          Effect.gen(function* () {
            yield* setup()
            const report = yield* SquadBroadcast.broadcast({ text: "go", from: "ORQ" })
            expect(report.results.map((entry) => entry.status)).toEqual(["accepted", "rejected", "not_attempted"])
            expect(report.results[1]?.reason).toContain("channel down")
            expect(report.results[2]?.reason).toContain("ATLAS")
            expect(enqueued.map((entry) => entry.sessionID)).toEqual(["ses_zed"])
          }),
          dir.path,
          { failAt: 2 },
        ),
      ),
    ),
  )

  it.live("audits one broadcast line per recipient, in order, without the message body", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        run(
          Effect.gen(function* () {
            yield* setup()
            yield* SquadBroadcast.broadcast({ text: "SENTINEL-broadcast-body", from: "ORQ", idempotencyKey: "k1" })
            const db = (yield* Database.Service).db
            const rows = yield* db.select().from(SquadAuditTable).orderBy(SquadAuditTable.id).all()
            expect(rows.map((row) => [row.kind, row.target, row.result, row.session_id])).toEqual([
              ["broadcast", "ZED", "accepted", "ses_zed"],
              ["broadcast", "ATLAS", "accepted", "ses_atlas"],
              ["broadcast", "MID", "accepted", "ses_mid"],
            ])
            expect(rows.every((row) => row.actor === "ORQ" && row.idempotency_key === "k1")).toBe(true)
            expect(JSON.stringify(rows).indexOf("SENTINEL-broadcast-body")).toBe(-1)
          }),
          dir.path,
        ),
      ),
    ),
  )

  it.live("fails with the disabled error when the flag is off and with a conflict without an active generation", () =>
    Effect.gen(function* () {
      const off = yield* tmpdirScoped().pipe(
        Effect.flatMap((dir) => run(SquadBroadcast.broadcast({ text: "go" }), dir.path, { enabled: false }).pipe(Effect.exit)),
      )
      expect(Exit.isFailure(off) ? (Cause.squash(off.cause) as { _tag: string })._tag : "ok").toBe("Squad.DisabledError")
      const none = yield* tmpdirScoped().pipe(
        Effect.flatMap((dir) => run(SquadBroadcast.broadcast({ text: "go" }), dir.path).pipe(Effect.exit)),
      )
      expect(Exit.isFailure(none) ? (Cause.squash(none.cause) as { _tag: string })._tag : "ok").toBe("ConflictError")
    }),
  )
})
