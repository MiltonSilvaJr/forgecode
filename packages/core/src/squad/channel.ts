export * as SquadChannel from "./channel.js"

import { Context, Effect, Layer, Schema } from "effect"
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
  SessionMessage.ID.make("msg_")

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    yield* Sessions.Service
    return Service.of({
      enqueue: Effect.fn("SquadChannel.enqueue")(function* (input) {
        return { messageID: messageIDFor(input.idempotencyKey ?? "", input.sessionID) }
      }),
      pending: Effect.fn("SquadChannel.pending")(function* (sessionID) {
        return []
      }),
    })
  }),
)
