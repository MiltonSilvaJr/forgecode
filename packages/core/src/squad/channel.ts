export * as SquadChannel from "./channel.js"

import { createHash } from "node:crypto"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import { Session as Sessions } from "../session.js"

export class ChannelError extends Schema.TaggedError<ChannelError>()("ChannelError", {
  message: Schema.String,
}) {}

export interface EnqueueInput {
  readonly sessionID: Session.ID
  readonly text: string
  readonly delivery?: SessionInbox.Delivery
  readonly idempotencyKey?: string
  readonly metadata?: Record<string, unknown>
}

export interface PendingItem {
  readonly id: SessionMessage.ID
  readonly delivery: SessionInbox.Delivery
  readonly createdAt: number
}

export interface Interface {
  readonly enqueue: (input: EnqueueInput) => Effect.Effect<{ messageID: SessionMessage.ID }, ChannelError>
  readonly pending: (sessionID: Session.ID) => Effect.Effect<ReadonlyArray<PendingItem>, ChannelError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/Channel") {}

export const messageIDFor = (idempotencyKey: string, sessionID: Session.ID): SessionMessage.ID =>
  SessionMessage.ID.make("msg_" + createHash("sha256").update(`${idempotencyKey}\n${sessionID}`).digest("hex").slice(0, 24))

const rejected = (message: string) => Effect.fail(new ChannelError({ message }))

/**
 * The only door to a session's inbox. It resolves nothing and measures nothing: the result is an enqueue
 * acknowledgement, never proof that the other end read the message. A failed admission is surfaced once,
 * without retry, so the caller decides what a retry means.
 */
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Sessions.Service
    return Service.of({
      enqueue: Effect.fn("SquadChannel.enqueue")(function* (input) {
        const messageID =
          input.idempotencyKey === undefined
            ? SessionMessage.ID.create()
            : messageIDFor(input.idempotencyKey, input.sessionID)
        yield* sessions
          .prompt({
            sessionID: input.sessionID,
            id: messageID,
            text: input.text,
            delivery: input.delivery ?? "queue",
            ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
          })
          .pipe(Effect.catch(() => rejected(`session ${input.sessionID} did not accept the message`)), Effect.catchDefect(() => rejected(`session ${input.sessionID} did not accept the message`)))
        return { messageID }
      }),
      pending: Effect.fn("SquadChannel.pending")(function* (sessionID) {
        const items = yield* sessions
          .inbox(sessionID)
          .pipe(Effect.catch(() => rejected(`inbox of session ${sessionID} is unavailable`)), Effect.catchDefect(() => rejected(`inbox of session ${sessionID} is unavailable`)))
        return items.map((item) => ({ id: item.id, delivery: item.delivery, createdAt: DateTime.toEpochMillis(item.time.created) }))
      }),
    })
  }),
)
