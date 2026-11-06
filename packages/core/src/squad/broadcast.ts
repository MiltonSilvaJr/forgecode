export * as SquadBroadcast from "./broadcast.js"

import { Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { SquadChannel } from "./channel.js"
import { ConflictError, SquadRegistry } from "./registry.js"

export interface BroadcastInput {
  readonly text: string
  readonly from?: string
  readonly includeSelf?: boolean
  readonly idempotencyKey?: string
}

export const broadcast = Effect.fn("SquadBroadcast.broadcast")(function* (input: BroadcastInput) {
  const registry = yield* SquadRegistry.Service
  const channel = yield* SquadChannel.Service
  const active = yield* registry.active()
  if (!active) return yield* new ConflictError({ message: "no active generation", pendencies: [] })
  const generation = yield* registry.generation(active.id)
  const results: (typeof Squad.BroadcastResult.Type)[] = []
  for (const entry of generation!.sessions) {
    if (!input.includeSelf && (entry.name === input.from || entry.sessionID === input.from)) continue
    if (entry.sessionID === undefined) continue
    const enqueued = yield* channel
      .enqueue({ sessionID: entry.sessionID, text: input.text, delivery: "queue", idempotencyKey: input.idempotencyKey })
      .pipe(Effect.orDie)
    results.push(Squad.BroadcastResult.make({ name: entry.name, status: "accepted", messageID: enqueued.messageID }))
  }
  return Squad.BroadcastReport.make({ results })
})
