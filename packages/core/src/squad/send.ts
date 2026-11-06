export * as SquadSend from "./send.js"

import { DateTime, Effect } from "effect"
import { Session } from "@opencode/schema/session"
import { Squad } from "@opencode/schema/squad"
import { SquadChannel } from "./channel.js"
import { SquadRegistry } from "./registry.js"

export interface SendInput {
  readonly to: string
  readonly text: string
  readonly delivery?: "queue" | "steer"
  readonly from?: string
  readonly allowSelf?: boolean
  readonly idempotencyKey?: string
}

export const send = Effect.fn("SquadSend.send")(function* (input: SendInput) {
  const registry = yield* SquadRegistry.Service
  const channel = yield* SquadChannel.Service
  const target = yield* registry.resolve(input.to)
  const delivery = input.delivery ?? "queue"
  const enqueued = yield* channel.enqueue({
    sessionID: Session.ID.make(target.sessionID ?? "ses_"),
    text: input.text,
    delivery,
    idempotencyKey: input.idempotencyKey,
  })
  return Squad.EnqueueProof.make({
    messageID: enqueued.messageID,
    name: Squad.SessionName.make(target.name),
    sessionID: Session.ID.make(target.sessionID ?? "ses_"),
    delivery,
    at: DateTime.makeUnsafe(Date.now()),
  })
})
