export * as SquadBroadcast from "./broadcast.js"

import { Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { SquadAudit } from "./audit.js"
import { SquadChannel } from "./channel.js"
import { ConflictError, SquadRegistry } from "./registry.js"

export interface BroadcastInput {
  readonly text: string
  readonly from?: string
  readonly includeSelf?: boolean
  readonly idempotencyKey?: string
}

type Result = typeof Squad.BroadcastResult.Type

/**
 * Validates every recipient before queueing the first. Delivery after that is best-effort and not
 * transactional: the core inbox has no rollback, so a failure in the middle keeps what was already queued
 * and reports the rest as `not_attempted`.
 */
export const broadcast = Effect.fn("SquadBroadcast.broadcast")(function* (input: BroadcastInput) {
  const registry = yield* SquadRegistry.Service
  const channel = yield* SquadChannel.Service
  const audit = yield* SquadAudit.Service
  const active = yield* registry.active()
  if (!active) return yield* new ConflictError({ message: "no active generation", pendencies: [] })
  const generation = yield* registry.generation(active.id)
  const actor = input.from ?? "operator"
  const recipients = generation!.sessions.filter(
    (entry) => input.includeSelf || (entry.name !== input.from && entry.sessionID !== input.from),
  )

  const record = (entry: Squad.SessionEntry, result: Result) =>
    audit.append({
      kind: "broadcast",
      generation: active.id,
      target: entry.name,
      sessionID: entry.sessionID,
      messageID: result.messageID,
      message: input.text,
      delivery: "queue",
      result: result.status,
      idempotencyKey: input.idempotencyKey,
      actor,
      detail: result.reason,
    })

  const invalid = recipients.filter((entry) => entry.state !== "verified" || entry.sessionID === undefined)
  if (invalid.length > 0) {
    const results = recipients.map((entry) =>
      invalid.includes(entry)
        ? Squad.BroadcastResult.make({
            name: entry.name,
            sessionID: entry.sessionID,
            status: "rejected",
            reason: `session ${entry.name} is ${entry.state}, not verified; run squad launch first`,
          })
        : Squad.BroadcastResult.make({
            name: entry.name,
            sessionID: entry.sessionID,
            status: "not_attempted",
            reason: "nothing was queued: another recipient is invalid",
          }),
    )
    yield* Effect.forEach(recipients, (entry, index) => record(entry, results[index]!))
    return Squad.BroadcastReport.make({ results })
  }

  const results: Result[] = []
  yield* Effect.forEach(recipients, (entry) =>
    Effect.gen(function* () {
      const failed = results.find((result) => result.status === "rejected")
      const result = failed
        ? Squad.BroadcastResult.make({
            name: entry.name,
            sessionID: entry.sessionID,
            status: "not_attempted",
            reason: `not attempted after the channel failed for ${failed.name}`,
          })
        : yield* channel
            .enqueue({ sessionID: entry.sessionID!, text: input.text, delivery: "queue", idempotencyKey: input.idempotencyKey })
            .pipe(
              Effect.map((enqueued) =>
                Squad.BroadcastResult.make({
                  name: entry.name,
                  sessionID: entry.sessionID,
                  status: "accepted",
                  messageID: enqueued.messageID,
                }),
              ),
              Effect.catch((error) =>
                Effect.succeed(
                  Squad.BroadcastResult.make({
                    name: entry.name,
                    sessionID: entry.sessionID,
                    status: "rejected",
                    reason: error.message,
                  }),
                ),
              ),
            )
      yield* record(entry, result)
      results.push(result)
    }),
  )
  return Squad.BroadcastReport.make({ results })
})
