import { describe, expect } from "bun:test"
import { createHash } from "node:crypto"
import path from "path"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadAudit } from "@opencode/core/squad/audit"
import { ChannelError, SquadChannel } from "@opencode/core/squad/channel"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSend } from "@opencode/core/squad/send"
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

const inbox: string[] = []

const channel = (options: { fail?: string } = {}) =>
  Layer.succeed(
    SquadChannel.Service,
    SquadChannel.Service.of({
      enqueue: (input) =>
        Effect.suspend(() => {
          if (options.fail) return Effect.fail(new ChannelError({ message: options.fail }))
          inbox.push(input.text)
          return Effect.succeed({ messageID: SessionMessage.ID.make("msg_1") })
        }),
      pending: () => Effect.succeed([]),
    }),
  )

const layer = (directory: string, options: { fail?: string; enabled?: boolean } = {}) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    channel(options),
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(config(options.enabled ?? true)),
  )

const it = testEffect(Layer.empty)

const session = (name: string, sessionID: string) => ({
  name,
  role: "worker" as const,
  provider: "deepseek",
  model: "deepseek-flash",
  location: { directory: `/squad/${name}` },
  sessionID,
})

const setup = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  const registry = yield* SquadRegistry.Service
  yield* registry.init({ generation: "gen-1", sessions: [session("ORQ", "ses_orq"), session("ATLAS", "ses_atlas")] })
  yield* db.update(SquadSessionTable).set({ state: "verified" }).where(eq(SquadSessionTable.generation_id, "gen-1")).run()
})

const rows = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  return yield* db.select().from(SquadAuditTable).all()
})

const pem = (edge: "BEGIN" | "END") => ["-----", edge, " PRIVATE", " KEY-----"].join("")

const SENTINEL = "SENTINEL-4f9a1c-secret-body"
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

describe("SquadAudit", () => {
  it.live("never persists the message body, only its sha256 and id", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const audit = yield* SquadAudit.Service
          yield* audit.append({
            kind: "send",
            target: "ATLAS",
            messageID: "msg_1",
            message: `please run ${SENTINEL}`,
            result: "accepted",
            actor: "ORQ",
          })
          const stored = yield* rows
          expect(JSON.stringify(stored).indexOf(SENTINEL)).toBe(-1)
          expect(stored[0]?.message_sha256).toBe(sha256(`please run ${SENTINEL}`))
          expect(stored[0]?.message_id).toBe("msg_1")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("send audits the delivery: the sentinel reaches the inbox and not the audit row", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          inbox.length = 0
          yield* SquadSend.send({ to: "ATLAS", text: SENTINEL, from: "ORQ", idempotencyKey: "k1" })
          expect(inbox.join("\n").indexOf(SENTINEL)).toBeGreaterThanOrEqual(0)
          const stored = yield* rows
          expect(stored).toHaveLength(1)
          expect(JSON.stringify(stored).indexOf(SENTINEL)).toBe(-1)
          expect(stored[0]).toMatchObject({
            kind: "send",
            generation_id: "gen-1",
            target: "ATLAS",
            session_id: "ses_atlas",
            message_id: "msg_1",
            message_sha256: sha256(SENTINEL),
            delivery: "queue",
            result: "accepted",
            idempotency_key: "k1",
            actor: "ORQ",
          })
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("redacts Bearer, sk-, ghp_, AKIA, token fields and PEM blocks in detail", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const audit = yield* SquadAudit.Service
          const secrets = [
            "abcdef1234567890TOKENVALUE",
            "sk-proj-1234567890abcdef",
            "ghp_1234567890abcdefghijklmnop",
            ["AK", "IA", "ABCDEFGHIJKLMNOP"].join(""),
            "tok-value-in-json",
            "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
          ]
          const entry = yield* audit.append({
            kind: "send",
            target: "ATLAS",
            result: "failed",
            actor: "ORQ",
            detail: [
              `Authorization: Bearer ${secrets[0]}`,
              `key ${secrets[1]} and ${secrets[2]} and ${secrets[3]}`,
              `{"token": "${secrets[4]}"}`,
              `${pem("BEGIN")}\n${secrets[5]}\n${pem("END")}`,
            ].join("\n"),
          })
          const stored = JSON.stringify(yield* rows)
          for (const secret of secrets) {
            expect(stored.indexOf(secret)).toBe(-1)
            expect((entry.detail ?? "").indexOf(secret)).toBe(-1)
          }
          expect(entry.detail).toContain("[redacted]")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("exposes append and list only: there is no update or delete", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const audit = yield* SquadAudit.Service
          expect(Object.keys(audit).sort()).toEqual(["append", "list"])
          for (const name of ["update", "delete", "remove", "clear", "truncate"]) expect(name in audit).toBe(false)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a failed send is audited with the reason, without stack trace or absolute path", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          yield* SquadSend.send({ to: "ATLAS", text: "go", from: "ORQ" }).pipe(Effect.ignore)
          const stored = yield* rows
          expect(stored).toHaveLength(1)
          expect(stored[0]?.result).toBe("failed")
          expect(stored[0]?.detail).toContain("channel down")
          expect(stored[0]?.detail).not.toContain("/Users/")
          expect(stored[0]?.detail).not.toMatch(/\n\s+at /)
        }).pipe(Effect.provide(layer(dir.path, { fail: "channel down at /Users/milton/proj/file.ts:10\n    at run (/Users/milton/x.ts:1)" }))),
      ),
    ),
  )

  it.live("an unknown destination is audited as failed and a disabled squad writes nothing", () =>
    Effect.gen(function* () {
      const on = yield* tmpdirScoped().pipe(
        Effect.flatMap((dir) =>
          Effect.gen(function* () {
            yield* setup
            yield* SquadSend.send({ to: "GHOST", text: "go" }).pipe(Effect.ignore)
            return (yield* rows).map((row) => [row.result, row.target])
          }).pipe(Effect.provide(layer(dir.path))),
        ),
      )
      expect(on).toEqual([["failed", "GHOST"]])
      const off = yield* tmpdirScoped().pipe(
        Effect.flatMap((dir) =>
          Effect.gen(function* () {
            yield* SquadSend.send({ to: "GHOST", text: "go" }).pipe(Effect.ignore)
            return (yield* rows).length
          }).pipe(Effect.provide(layer(dir.path, { enabled: false }))),
        ),
      )
      expect(off).toBe(0)
    }),
  )

  it.live("list returns entries in append order and filters by since", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const audit = yield* SquadAudit.Service
          const first = yield* audit.append({ kind: "init", target: "—", result: "ok", actor: "operator" })
          yield* audit.append({ kind: "send", target: "ATLAS", result: "accepted", actor: "operator" })
          const all = yield* audit.list()
          expect(all.map((entry) => entry.kind)).toEqual(["init", "send"])
          const none = yield* audit.list({ since: Date.now() + 60_000 })
          expect(none).toEqual([])
          expect(first.id).toBeLessThan(all[1]!.id)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
