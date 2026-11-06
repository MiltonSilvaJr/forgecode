export * as SquadChannel from "./channel.js"

import { createHash } from "node:crypto"
import { Context, DateTime, Effect, Layer, Schema, Stream } from "effect"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import { Session as Sessions } from "../session.js"
import { SessionExecution } from "../session/execution.js"
import { SessionStore } from "../session/store.js"
import type { Claim, LogEvent } from "./liveness.js"

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

type CreateInput = Parameters<Sessions.Interface["create"]>[0]

/**
 * The session reads and the one write `launch` needs besides the inbox. Like `SquadChannel`, it keeps every
 * touch of the core session service in this file; a missing session is `undefined`, any other failure is a
 * `ChannelError`.
 */
export interface SessionsInterface {
  readonly create: (input: CreateInput) => Effect.Effect<Session.Info, ChannelError>
  readonly get: (sessionID: Session.ID) => Effect.Effect<Session.Info | undefined, ChannelError>
  readonly events: (sessionID: Session.ID) => Effect.Effect<ReadonlyArray<LogEvent>, ChannelError>
  /** The durable execution claim, or `undefined` when the session holds none. Reading it never releases it. */
  readonly claim: (sessionID: Session.ID) => Effect.Effect<Claim | undefined, ChannelError>
}

export class SessionsService extends Context.Service<SessionsService, SessionsInterface>()("@opencode/Squad/Sessions") {}

const durableTypes = new Set([
  "session.inbox.enqueued",
  "session.inbox.delivered",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
])

export const sessionsLayer = Layer.effect(
  SessionsService,
  Effect.gen(function* () {
    const sessions = yield* Sessions.Service
    const store = yield* SessionStore.Service
    const execution = yield* Effect.serviceOption(SessionExecution.Service)
    return SessionsService.of({
      create: Effect.fn("SquadSessions.create")(function* (input) {
        return yield* sessions
          .create(input)
          .pipe(Effect.catch(() => rejected("session could not be created")), Effect.catchDefect(() => rejected("session could not be created")))
      }),
      get: Effect.fn("SquadSessions.get")(function* (sessionID) {
        return yield* sessions.get(sessionID).pipe(
          Effect.catchTag("Session.NotFoundError", () => Effect.succeed(undefined)),
          Effect.catchDefect(() => rejected(`session ${sessionID} is unavailable`)),
        )
      }),
      claim: Effect.fn("SquadSessions.claim")(function* (sessionID) {
        const since = yield* store.claimedAt(sessionID).pipe(Effect.catchDefect(() => rejected(`claim of session ${sessionID} is unavailable`)))
        if (since !== undefined) return { since }
        const local = execution._tag === "Some" ? yield* execution.value.isActive(sessionID) : false
        return local ? {} : undefined
      }),
      events: Effect.fn("SquadSessions.events")(function* (sessionID) {
        const items = yield* Stream.runCollect(sessions.log({ sessionID, after: 0 })).pipe(
          Effect.catch(() => rejected(`log of session ${sessionID} is unavailable`)),
          Effect.catchDefect(() => rejected(`log of session ${sessionID} is unavailable`)),
        )
        return items.flatMap((item): LogEvent[] => {
          if (item.type === "log.synced" || !durableTypes.has(item.type)) return []
          const inboxID = "inboxID" in item.data ? String(item.data.inboxID) : undefined
          return [{ type: item.type, created: item.created, seq: item.durable.seq, ...(inboxID === undefined ? {} : { inboxID }) }]
        })
      }),
    })
  }),
)
