import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { ChannelError, SquadChannel } from "@opencode/core/squad/channel"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSend } from "@opencode/core/squad/send"
import { SquadSessionTable } from "@opencode/core/squad/sql"
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

const channel = (options: { fail?: boolean } = {}) =>
  Layer.succeed(
    SquadChannel.Service,
    SquadChannel.Service.of({
      enqueue: (input) =>
        Effect.suspend(() => {
          enqueues.push(input)
          if (options.fail) return Effect.fail(new ChannelError({ message: "channel down" }))
          return Effect.succeed({
            messageID: input.idempotencyKey === undefined ? SessionMessage.ID.make("msg_1") : SessionMessage.ID.make(`msg_${input.idempotencyKey}`),
          })
        }),
      pending: () => Effect.succeed([]),
    }),
  )

const layer = (directory: string, options: { fail?: boolean } = {}) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    channel(options),
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(enabled),
  )

const it = testEffect(Layer.empty)

const session = (name: string, sessionID: string, role: "orchestrator" | "worker" = "worker") => ({
  name,
  role,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  branch: "feature/x",
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
  })

const outcome = (exit: Exit.Exit<{ messageID: string }, unknown>) =>
  Exit.isFailure(exit)
    ? (Cause.squash(exit.cause) as { _tag?: string })._tag
    : `Queued message ${exit.value.messageID}`

describe("SquadSend", () => {
  it.live("refuses a send to the calling session unless --allow-self", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const refused = yield* SquadSend.send({ to: "ATLAS", text: "go", from: "ses_atlas" }).pipe(Effect.exit)
          expect(outcome(refused)).toBe("ForbiddenError")
          const allowed = yield* SquadSend.send({ to: "ATLAS", text: "go", from: "ses_atlas", allowSelf: true }).pipe(Effect.exit)
          expect(outcome(allowed)).toBe("Queued message msg_1")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("recognises the origin by name as well as by session id", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const byName = yield* SquadSend.send({ to: "ses_atlas", text: "go", from: "ATLAS" }).pipe(Effect.exit)
          expect(outcome(byName)).toBe("ForbiddenError")
          const other = yield* SquadSend.send({ to: "ATLAS", text: "go", from: "ORQ" }).pipe(Effect.exit)
          expect(outcome(other)).toBe("Queued message msg_1")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("refuses a destination that is not verified and names the state and squad launch", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup({ NOVA: "starting" })
          enqueues.length = 0
          const exit = yield* SquadSend.send({ to: "NOVA", text: "go" }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("ConflictError")
          const message = Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { message: string }).message : ""
          expect(message).toContain("starting")
          expect(message).toContain("squad launch")
          expect(enqueues).toEqual([])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("an unknown destination is SessionNotFoundError and nothing is enqueued", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          enqueues.length = 0
          const exit = yield* SquadSend.send({ to: "GHOST", text: "go" }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("SessionNotFoundError")
          expect(enqueues).toEqual([])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("returns an enqueue proof with name, session, delivery and instant, defaulting to queue", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          enqueues.length = 0
          const proof = yield* SquadSend.send({ to: "ATLAS", text: "go" })
          expect(Object.keys(proof).sort()).toEqual(["at", "delivery", "messageID", "name", "sessionID"])
          expect<string>(proof.name).toBe("ATLAS")
          expect<string>(proof.sessionID).toBe("ses_atlas")
          expect(proof.delivery).toBe("queue")
          expect(enqueues[0]?.delivery).toBe("queue")
          const steered = yield* SquadSend.send({ to: "ATLAS", text: "go", delivery: "steer" })
          expect(steered.delivery).toBe("steer")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("an explicit idempotency key reaches the channel; without one each call is new", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          enqueues.length = 0
          const first = yield* SquadSend.send({ to: "ATLAS", text: "go", idempotencyKey: "k1" })
          const again = yield* SquadSend.send({ to: "ATLAS", text: "go", idempotencyKey: "k1" })
          expect(again.messageID).toBe(first.messageID)
          yield* SquadSend.send({ to: "ATLAS", text: "go" })
          expect(enqueues.map((call) => call.idempotencyKey)).toEqual(["k1", "k1", undefined])
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a channel failure is a named error", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup()
          const exit = yield* SquadSend.send({ to: "ATLAS", text: "go" }).pipe(Effect.exit)
          expect(outcome(exit)).toBe("ChannelError")
        }).pipe(Effect.provide(layer(dir.path, { fail: true }))),
      ),
    ),
  )
})
