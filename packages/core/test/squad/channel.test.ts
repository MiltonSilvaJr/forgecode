import { describe, expect } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { Cause, Effect, Exit, Layer } from "effect"
import { ChannelError, SquadChannel } from "@opencode/core/squad/channel"
import { Session } from "@opencode/schema/session"
import { fakeSessionServer } from "../fixture/squad-channel"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const sessionID = Session.ID.make("ses_abc123")
const otherID = Session.ID.make("ses_def456")

const channelFor = (server: ReturnType<typeof fakeSessionServer>) =>
  SquadChannel.layer.pipe(Layer.provide(server.layer))

describe("SquadChannel", () => {
  it.live("derives the message id from the key and the session", () =>
    Effect.gen(function* () {
      const server = fakeSessionServer()
      const ids: string[] = yield* Effect.gen(function* () {
        const channel = yield* SquadChannel.Service
        const first = yield* channel.enqueue({ sessionID, text: "go", idempotencyKey: "k1" })
        const again = yield* channel.enqueue({ sessionID, text: "go", idempotencyKey: "k1" })
        return [first.messageID, again.messageID]
      }).pipe(Effect.provide(channelFor(server)))
      expect(ids[0]).toBe("msg_b38d0726a38317cc0df62a53")
      expect(ids[1]).toBe(ids[0])
      expect(server.admitted.size).toBe(1)
    }),
  )

  it.live("two keys, or two sessions, produce distinct ids", () =>
    Effect.gen(function* () {
      const channel = yield* SquadChannel.Service
      const a = yield* channel.enqueue({ sessionID, text: "go", idempotencyKey: "k1" })
      const b = yield* channel.enqueue({ sessionID, text: "go", idempotencyKey: "k2" })
      const c = yield* channel.enqueue({ sessionID: otherID, text: "go", idempotencyKey: "k1" })
      expect(new Set([a.messageID, b.messageID, c.messageID]).size).toBe(3)
    }).pipe(Effect.provide(channelFor(fakeSessionServer()))),
  )

  it.live("without a key every call is a new message", () =>
    Effect.gen(function* () {
      const server = fakeSessionServer()
      const result = yield* Effect.gen(function* () {
        const channel = yield* SquadChannel.Service
        const a = yield* channel.enqueue({ sessionID, text: "continue" })
        const b = yield* channel.enqueue({ sessionID, text: "continue" })
        return [a.messageID, b.messageID]
      }).pipe(Effect.provide(channelFor(server)))
      expect(result[0]).not.toBe(result[1])
      expect(server.admitted.size).toBe(2)
    }),
  )

  it.live("delivery defaults to queue and steer is opt-in", () =>
    Effect.gen(function* () {
      const server = fakeSessionServer()
      yield* Effect.gen(function* () {
        const channel = yield* SquadChannel.Service
        yield* channel.enqueue({ sessionID, text: "a", idempotencyKey: "a" })
        yield* channel.enqueue({ sessionID, text: "b", idempotencyKey: "b", delivery: "steer" })
      }).pipe(Effect.provide(channelFor(server)))
      expect(server.calls.map((call) => call.delivery)).toEqual(["queue", "steer"])
      expect(server.calls.every((call) => call.resume === undefined)).toBe(true)
    }),
  )

  it.live("an admission failure is a ChannelError and is not retried", () =>
    Effect.gen(function* () {
      const server = fakeSessionServer({ fail: true })
      const exit = yield* Effect.gen(function* () {
        const channel = yield* SquadChannel.Service
        return yield* channel.enqueue({ sessionID, text: "go", idempotencyKey: "k1" })
      }).pipe(Effect.provide(channelFor(server)), Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(ChannelError)
      expect(server.calls.length).toBe(1)
    }),
  )

  it.live("the contract returns an enqueue acknowledgement and never a read receipt", () =>
    Effect.gen(function* () {
      const channel = yield* SquadChannel.Service
      const result = yield* channel.enqueue({ sessionID, text: "go", idempotencyKey: "k1" })
      expect(Object.keys(result)).toEqual(["messageID"])
    }).pipe(Effect.provide(channelFor(fakeSessionServer()))),
  )

  it.live("pending lists the unconsumed inbox items of the session", () =>
    Effect.gen(function* () {
      const channel = yield* SquadChannel.Service
      const sent = yield* channel.enqueue({ sessionID, text: "go", idempotencyKey: "k1" })
      yield* channel.enqueue({ sessionID: otherID, text: "go", idempotencyKey: "k2" })
      const pending = yield* channel.pending(sessionID)
      expect(pending.map((item) => item.id)).toEqual([sent.messageID])
      expect(pending[0]?.delivery).toBe("queue")
    }).pipe(Effect.provide(channelFor(fakeSessionServer()))),
  )
})

describe("squad import boundary", () => {
  it.live("only channel.ts and credential.ts reach the inbox or credential primitives", () =>
    Effect.sync(() => {
      const directory = path.join(import.meta.dir, "../../src/squad")
      const offenders = readdirSync(directory)
        .filter((file) => file.endsWith(".ts") && file !== "channel.ts" && file !== "credential.ts")
        .filter((file) =>
          /from "(\.\.\/session(\.js|\/[^"]*)|\.\.\/subscription\/[^"]*|@opencode\/core\/session[^"]*|@opencode\/core\/subscription[^"]*)"/u.test(
            readFileSync(path.join(directory, file), "utf8"),
          ),
        )
      expect(offenders).toEqual([])
    }),
  )
})
