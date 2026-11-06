export * as SquadEvidence from "./evidence.js"

import { Effect } from "effect"
import type { Session as SessionSchema } from "@opencode/schema/session"
import { SquadChannel } from "./channel.js"

export interface Expected {
  readonly model: string
  readonly messageID: string
  readonly adoptedAt?: number
}

export interface Report {
  /** Names of the evidences still missing; empty means verified. */
  readonly missing: ReadonlyArray<string>
  /** Set when the session runs a different model than expected. Waiting cannot fix it. */
  readonly modelMismatch?: string
}

/**
 * Reads the four durable evidences of a launched session: the model it runs, the marker admitted to its inbox,
 * the marker delivered, and an execution that started after the marker was admitted (and after adoption).
 * Nothing here reads titles, metadata or message text.
 */
export const verify = Effect.fn("SquadEvidence.verify")(function* (sessionID: SessionSchema.ID, expected: Expected) {
  const sessions = yield* SquadChannel.SessionsService
  const info = yield* sessions.get(sessionID)
  if (info === undefined) return { missing: ["session"] } satisfies Report
  const measured = info.model
    ? `${info.model.providerID}/${info.model.id}${info.model.variant ? `#${info.model.variant}` : ""}`
    : "none"
  if (measured !== expected.model)
    return {
      missing: ["model"],
      modelMismatch: `model diverged: expected ${expected.model}, measured ${measured}`,
    } satisfies Report
  const events = yield* sessions.events(sessionID)
  const enqueued = events.find((event) => event.type === "session.inbox.enqueued" && event.inboxID === expected.messageID)
  const delivered = events.find((event) => event.type === "session.inbox.delivered" && event.inboxID === expected.messageID)
  const execution = events.find(
    (event) =>
      event.type === "session.execution.started" &&
      enqueued !== undefined &&
      event.seq > enqueued.seq &&
      (expected.adoptedAt === undefined || event.created >= expected.adoptedAt),
  )
  return {
    missing: [
      ...(enqueued ? [] : ["enqueued"]),
      ...(delivered ? [] : ["delivered"]),
      ...(execution ? [] : ["execution"]),
    ],
  } satisfies Report
})
