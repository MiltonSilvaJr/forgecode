export * as SquadLiveness from "./liveness.js"

import { Clock, DateTime, Duration, Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import type { Session } from "@opencode/schema/session"
import { Config } from "../config.js"

/** One durable event of a session's log, reduced to what liveness reads. */
export interface LogEvent {
  readonly type: string
  readonly created: number
  readonly seq: number
  readonly inboxID?: string
}

export interface Facts {
  readonly busy?: number
  readonly idle?: number
  readonly lastTerminal?: number
  readonly lastDelivered?: number
  readonly lastEnqueued?: number
  readonly claimed?: boolean
  readonly claimSince?: number
}

export interface Thresholds {
  readonly staleAfter: number
  readonly deadAfter?: number
}

/** The durable execution claim of a session: set while a turn is in flight, kept by a shutdown or a crash. */
export interface Claim {
  readonly since?: number
}

const terminals = new Set(["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"])

const latest = (values: ReadonlyArray<number>) => (values.length === 0 ? undefined : Math.max(...values))

const times = (events: ReadonlyArray<LogEvent>, match: (type: string) => boolean) =>
  latest(events.filter((event) => match(event.type)).map((event) => event.created))

/**
 * Reads only the session's own durable clock and its execution and inbox events. Title, metadata and
 * `time.updated` never enter: renaming a session or a message claiming it is alive is not activity.
 */
export const factsFrom = (info: Session.Info, events: ReadonlyArray<LogEvent>, claim?: Claim): Facts => ({
  busy: info.time.busy === undefined ? undefined : DateTime.toEpochMillis(info.time.busy),
  idle: info.time.idle === undefined ? undefined : DateTime.toEpochMillis(info.time.idle),
  lastTerminal: times(events, (type) => terminals.has(type)),
  lastDelivered: times(events, (type) => type === "session.inbox.delivered"),
  lastEnqueued: times(events, (type) => type === "session.inbox.enqueued"),
  claimed: claim !== undefined,
  claimSince: claim?.since,
})

export const classify = (facts: Facts, now: number, thresholds: Thresholds): Squad.Liveness => {
  const running =
    facts.claimed === true ||
    (facts.busy !== undefined &&
      (facts.idle === undefined || facts.busy > facts.idle) &&
      (facts.lastTerminal === undefined || facts.lastTerminal < facts.busy))
  const busyByClock =
    facts.busy !== undefined &&
    (facts.idle === undefined || facts.busy > facts.idle) &&
    (facts.lastTerminal === undefined || facts.lastTerminal < facts.busy)
  const busySince = busyByClock ? facts.busy : facts.claimSince
  const workingStale = running && busySince !== undefined && busySince < now - thresholds.staleAfter
  const presumedDead =
    workingStale && thresholds.deadAfter !== undefined && busySince! < now - thresholds.deadAfter
  const executionActivity = latest([facts.idle, facts.lastTerminal].filter((value) => value !== undefined))
  const lastActivity = latest([executionActivity, facts.lastDelivered].filter((value) => value !== undefined))
  const source: Squad.LivenessSource | undefined =
    lastActivity === undefined ? undefined : lastActivity === executionActivity ? "execution" : "inbox"
  const verdict: Squad.LivenessVerdict = presumedDead
    ? "presumed_dead"
    : running
    ? "working"
    : lastActivity === undefined
      ? "unknown"
      : now - lastActivity <= thresholds.staleAfter
        ? "idle"
        : "stalled"
  return Squad.Liveness.make({
    verdict,
    measuredAt: DateTime.makeUnsafe(now),
    ...(lastActivity === undefined ? {} : { lastActivity: DateTime.makeUnsafe(lastActivity) }),
    ...(facts.lastEnqueued === undefined ? {} : { sentAt: DateTime.makeUnsafe(facts.lastEnqueued) }),
    ...(source === undefined ? {} : { source }),
    workingStale,
    presumedDead,
    ...(presumedDead ? { cause: "presumed dead: execution in flight longer than dead_after, the claim is kept for explicit reconciliation" } : {}),
  })
}

export const measure = (info: Session.Info, events: ReadonlyArray<LogEvent>, thresholds: Thresholds, claim?: Claim) =>
  Clock.currentTimeMillis.pipe(Effect.map((now) => classify(factsFrom(info, events, claim), now, thresholds)))

const DefaultStaleAfter = Duration.toMillis(Duration.minutes(60))
const DefaultDeadAfter = Duration.toMillis(Duration.hours(24))

/** `stale_after` (60 minutes) and `dead_after` (24 hours) from `squad.liveness`. The schema rejects invalid values. */
export const thresholds = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    const liveness = Config.latest(entries, "squad")?.liveness
    return {
      staleAfter: liveness === undefined ? DefaultStaleAfter : Duration.toMillis(liveness.stale_after),
      deadAfter: liveness === undefined ? DefaultDeadAfter : Duration.toMillis(liveness.dead_after),
    } satisfies Thresholds
  })
