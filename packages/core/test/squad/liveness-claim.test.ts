import { describe, expect } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { SquadLiveness } from "@opencode/core/squad/liveness"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { info } from "../fixture/squad-info"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const hour = 3_600_000
const thresholds = { staleAfter: hour, deadAfter: 24 * hour }

const measureAt = (
  clock: number,
  session: ReturnType<typeof info>,
  events: SquadLiveness.LogEvent[] = [],
  claim?: SquadLiveness.Claim,
) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(clock)
    return yield* SquadLiveness.measure(session, events, thresholds, claim)
  })

describe("SquadLiveness claim and presumed_dead", () => {
  it.effect("working for longer than dead_after is presumed_dead without releasing anything", () =>
    Effect.gen(function* () {
      const session = info({ busy: 1 * hour, idle: 0 })
      const dead = yield* measureAt(26 * hour, session)
      expect(dead.verdict).toBe("presumed_dead")
      expect(dead.presumedDead).toBe(true)
      expect(dead.workingStale).toBe(true)
      const before = yield* measureAt(24 * hour, session)
      expect(before.verdict).toBe("working")
      expect(before.presumedDead).toBe(false)
      expect(before.workingStale).toBe(true)
    }),
  )

  it.effect("a preserved claim without a busy clock is working, and ages into presumed_dead from the claim start", () =>
    Effect.gen(function* () {
      const session = info({ idle: 0, outcome: "interrupted" })
      const held = yield* measureAt(3 * hour, session, [], { since: 2 * hour })
      expect(held.verdict).toBe("working")
      expect(held.workingStale).toBe(false)
      const stuck = yield* measureAt(30 * hour, session, [], { since: 2 * hour })
      expect(stuck.verdict).toBe("presumed_dead")
      expect(stuck.cause).toBeDefined()
    }),
  )

  it.effect("admission of an inbox item is sent_at and never lastActivity", () =>
    Effect.gen(function* () {
      const session = info({ idle: 1 * hour, outcome: "succeeded" })
      const events: SquadLiveness.LogEvent[] = [
        { type: "session.execution.succeeded", created: 1 * hour, seq: 2 },
        { type: "session.inbox.enqueued", created: 9 * hour, seq: 3, inboxID: "msg_1" },
      ]
      const verdict = yield* measureAt(10 * hour, session, events)
      expect(verdict.verdict).toBe("stalled")
      expect(verdict.lastActivity).toBeDefined()
      expect(verdict.sentAt).toBeDefined()
      expect(Number(verdict.sentAt) === Number(verdict.lastActivity)).toBe(false)
    }),
  )

  it.effect("rejects dead_after that is not greater than stale_after", () =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownExit(ConfigSquad.Info)
      expect(decode({ enabled: true, liveness: { stale_after: "60 minutes", dead_after: "30 minutes" } })._tag).toBe("Failure")
      expect(decode({ enabled: true, liveness: { stale_after: "60 minutes", dead_after: "60 minutes" } })._tag).toBe("Failure")
      expect(decode({ enabled: true, liveness: { stale_after: "60 minutes", dead_after: "24 hours" } })._tag).toBe("Success")
    }),
  )
})
