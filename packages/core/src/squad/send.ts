export * as SquadSend from "./send.js"

import { DateTime, Effect, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import { Squad } from "@opencode/schema/squad"
import { SquadAudit } from "./audit.js"
import { SquadChannel } from "./channel.js"
import { ConflictError, SquadRegistry } from "./registry.js"
import { DisabledError, ForbiddenError } from "./index.js"

export interface SendInput {
  readonly to: string
  readonly text: string
  readonly delivery?: "queue" | "steer"
  readonly from?: string
  readonly allowSelf?: boolean
  readonly idempotencyKey?: string
  readonly dispatch?: string
}

export const send = Effect.fn("SquadSend.send")(function* (input: SendInput) {
  const registry = yield* SquadRegistry.Service
  const audit = yield* SquadAudit.Service
  const actor = input.from ?? "operator"
  const failed = (generation: string | undefined) => (error: unknown) =>
    error instanceof DisabledError
      ? Effect.void
      : audit.append({
          kind: "send",
          generation,
          target: input.to,
          message: input.text,
          delivery: input.delivery ?? "queue",
          result: "failed",
          idempotencyKey: input.idempotencyKey,
          actor,
          detail: (error as { message?: string }).message ?? "send failed",
        })
  const target = yield* registry.resolve(input.to).pipe(Effect.tapError(failed(undefined)))
  const proof = yield* deliver(input, target).pipe(Effect.tapError(failed(target.generationID)))
  yield* audit.append({
    kind: "send",
    generation: target.generationID,
    target: target.name,
    sessionID: proof.sessionID,
    messageID: proof.messageID,
    message: input.text,
    delivery: proof.delivery,
    result: "accepted",
    idempotencyKey: input.idempotencyKey,
    actor,
  })
  return proof
})

const deliver = Effect.fn("SquadSend.deliver")(function* (input: SendInput, target: SquadRegistry.ResolvedSession) {
  const registry = yield* SquadRegistry.Service
  const channel = yield* SquadChannel.Service
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
