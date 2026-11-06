export * as SquadSend from "./send.js"

import { DateTime, Effect, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import { Squad } from "@opencode/schema/squad"
import { SquadChannel } from "./channel.js"
import { ConflictError, SquadRegistry } from "./registry.js"
import { ForbiddenError } from "./index.js"

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
  const targetSessionID = yield* requireVerified(target)
  if (input.from !== undefined && !input.allowSelf) {
    const origin = Schema.is(Session.ID)(input.from) ? input.from : (yield* registry.resolve(input.from)).sessionID
    if (origin === targetSessionID)
      return yield* new ForbiddenError({
        message: `refusing to send to the calling session ${target.name}; pass --allow-self to override`,
      })
  }
  const delivery = input.delivery ?? "queue"
  const enqueued = yield* channel.enqueue({
    sessionID: targetSessionID,
    text: input.text,
    delivery,
    idempotencyKey: input.idempotencyKey,
  })
  return Squad.EnqueueProof.make({
    messageID: enqueued.messageID,
    name: Squad.SessionName.make(target.name),
    sessionID: targetSessionID,
    delivery,
    at: DateTime.makeUnsafe(Date.now()),
  })
})

const requireVerified = (target: SquadRegistry.ResolvedSession) =>
  target.state === "verified" && target.sessionID !== null
    ? Effect.succeed(Session.ID.make(target.sessionID))
    : Effect.fail(
        new ConflictError({
          message: `session ${target.name} is ${target.state}, not verified; run squad launch first`,
          pendencies: [],
        }),
      )
