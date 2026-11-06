export * as SquadLiveness from "./liveness.js"

import { Clock, DateTime, Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import type { Session } from "@opencode/schema/session"

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
}

export interface Thresholds {
  readonly staleAfter: number
}

export const factsFrom = (_info: Session.Info, _events: ReadonlyArray<LogEvent>): Facts => ({})

export const classify = (_facts: Facts, now: number, _thresholds: Thresholds): Squad.Liveness =>
  Squad.Liveness.make({
    verdict: "idle",
    measuredAt: DateTime.makeUnsafe(now),
    workingStale: false,
    presumedDead: false,
  })

export const measure = (info: Session.Info, events: ReadonlyArray<LogEvent>, thresholds: Thresholds) =>
  Clock.currentTimeMillis.pipe(Effect.map((now) => classify(factsFrom(info, events), now, thresholds)))
