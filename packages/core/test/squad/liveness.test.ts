import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { SquadLiveness } from "@opencode/core/squad/liveness"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { info } from "../fixture/squad-info"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const minute = 60_000
const at = (hh: number, mm: number) => (hh * 60 + mm) * minute
const thresholds = { staleAfter: 60 * minute }
const terminal = (created: number): SquadLiveness.LogEvent => ({ type: "session.execution.succeeded", created, seq: 5 })
const delivered = (created: number): SquadLiveness.LogEvent => ({
  type: "session.inbox.delivered",
  created,
  seq: 4,
  inboxID: "msg_1",
})
const enqueued = (created: number): SquadLiveness.LogEvent => ({
  type: "session.inbox.enqueued",
  created,
  seq: 3,
  inboxID: "msg_1",
})

const verdictAt = (clock: number, session: ReturnType<typeof info>, events: SquadLiveness.LogEvent[]) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(clock)
    return yield* SquadLiveness.measure(session, events, thresholds)
  })

describe("SquadLiveness", () => {
  it.effect("classifies idle until stale_after and stalled after it, from the session clock", () =>
    Effect.gen(function* () {
      const session = info({ busy: at(9, 0), idle: at(10, 0), outcome: "succeeded" })
      const events = [terminal(at(10, 0))]
      expect((yield* verdictAt(at(10, 59), session, events)).verdict).toBe("idle")
      expect((yield* verdictAt(at(11, 0), session, events)).verdict).toBe("idle")
      expect((yield* verdictAt(at(11, 1), session, events)).verdict).toBe("stalled")
    }),
  )

  it.effect("is working when busy is after idle, and flags working_stale from the durable busy clock", () =>
    Effect.gen(function* () {
      const session = info({ busy: at(10, 30), idle: at(10, 0) })
      const fresh = yield* verdictAt(at(11, 0), session, [])
      expect(fresh.verdict).toBe("working")
      expect(fresh.workingStale).toBe(false)
      const stale = yield* verdictAt(at(11, 31), session, [])
      expect(stale.verdict).toBe("working")
      expect(stale.workingStale).toBe(true)
    }),
  )

  it.effect("is unknown without durable activity", () =>
    Effect.gen(function* () {
      const verdict = yield* verdictAt(at(12, 0), info(), [])
      expect(verdict.verdict).toBe("unknown")
      expect(verdict.lastActivity).toBeUndefined()
    }),
  )

  it.effect("a session claiming to be alive in its title is still stalled when its clock is old", () =>
    Effect.gen(function* () {
      const session = info({ idle: at(8, 0), updated: at(12, 0), title: "estou viva, trabalhando agora" })
      const verdict = yield* verdictAt(at(12, 0), session, [terminal(at(8, 0))])
      expect(verdict.verdict).toBe("stalled")
    }),
  )

  it.effect("inbox admission is not activity, delivery is; both are reported", () =>
    Effect.gen(function* () {
      const session = info({ idle: at(8, 0), outcome: "succeeded" })
      const events = [terminal(at(8, 0)), enqueued(at(11, 50)), delivered(at(11, 55))]
      const verdict = yield* verdictAt(at(12, 0), session, [terminal(at(8, 0)), enqueued(at(11, 50))])
      expect(verdict.verdict).toBe("stalled")
      expect(verdict.source).toBe("execution")
      const afterDelivery = yield* verdictAt(at(12, 0), session, events)
      expect(afterDelivery.verdict).toBe("idle")
      expect(afterDelivery.source).toBe("inbox")
    }),
  )

  it.effect("rejects a zero stale_after in the configuration", () =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownExit(ConfigSquad.Info)
      expect(decode({ enabled: true, liveness: { stale_after: "0 seconds", dead_after: "24 hours" } })._tag).toBe("Failure")
      expect(decode({ enabled: true, liveness: { stale_after: "60 minutes", dead_after: "24 hours" } })._tag).toBe("Success")
    }),
  )
})
