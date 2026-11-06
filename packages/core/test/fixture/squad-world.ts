import { Effect, Layer } from "effect"
import { ChannelError, SquadChannel } from "@opencode/core/squad/channel"
import { Session as SessionSchema } from "@opencode/schema/session"
import { info, type InfoOptions } from "./squad-info"

export type Script = "full" | "no-execution" | "no-delivery" | "none"

export interface WorldOptions {
  /** What the fake core records after each admission. */
  readonly script?: Script
  /** Model reported by `Session.get` instead of the requested one. */
  readonly measuredModel?: { providerID: string; id: string; variant?: string }
  /** The first N admissions fail, as if the process had died right after persisting `starting`. */
  readonly failEnqueues?: number
}

type Pending = { id: string; delivery: "queue" | "steer"; createdAt: number }

type Stored = { info: ReturnType<typeof info>; events: Array<Record<string, unknown>> }

/**
 * A fake session core: creation is idempotent by id, admission appends the durable events the real core
 * would record, and `log` replays them. It records every call so a test can count effects.
 */
export const fakeWorld = (options: WorldOptions = {}) => {
  const creates: string[] = []
  const enqueues: SquadChannel.EnqueueInput[] = []
  const stored = new Map<string, Stored>()
  const pending = new Map<string, Pending[]>()
  let failures = options.failEnqueues ?? 0

  const append = (sessionID: string, type: string, data: Record<string, unknown> = {}, created = Date.now()) => {
    const entry = stored.get(sessionID)
    if (!entry) return
    entry.events.push({
      id: `evt_${entry.events.length + 1}`,
      type,
      created,
      durable: { aggregateID: sessionID, seq: entry.events.length + 1, version: 1 },
      data: { sessionID, ...data },
    })
  }

  const seed = (
    sessionID: string,
    model: { providerID: string; id: string; variant?: string },
    events: Array<[string, Record<string, unknown>?, number?]> = [],
    clock: InfoOptions = {},
  ) => {
    stored.set(sessionID, { info: info({ ...clock, id: sessionID, model }), events: [] })
    for (const [type, data, created] of events) append(sessionID, type, data, created)
  }

  const sessionLayer = Layer.succeed(
    SquadChannel.SessionsService,
    SquadChannel.SessionsService.of({
      create: (input) =>
        Effect.sync(() => {
          const id = input.id ?? SessionSchema.ID.create()
          creates.push(id)
          const existing = stored.get(id)
          if (existing) return existing.info
          const requested = options.measuredModel ?? input.model
          const created = info({ id, ...(requested ? { model: requested } : {}) })
          stored.set(id, { info: created, events: [] })
          return created
        }),
      get: (sessionID) => Effect.sync(() => stored.get(sessionID)?.info),
      events: (sessionID) =>
        Effect.sync(() =>
          (stored.get(sessionID)?.events ?? []).map((event) => ({
            type: event.type as string,
            created: event.created as number,
            seq: (event.durable as { seq: number }).seq,
            ...((event.data as { inboxID?: string }).inboxID === undefined ? {} : { inboxID: (event.data as { inboxID: string }).inboxID }),
          })),
        ),
    }),
  )

  const channelLayer = Layer.succeed(
    SquadChannel.Service,
    SquadChannel.Service.of({
      enqueue: (input) =>
        Effect.suspend(() => {
          enqueues.push(input)
          if (failures > 0) {
            failures -= 1
            return Effect.fail(new ChannelError({ message: "channel down" }))
          }
          const messageID = SquadChannel.messageIDFor(input.idempotencyKey ?? `anon-${enqueues.length}`, input.sessionID)
          const seen = stored.get(input.sessionID)?.events.some((event) => (event.data as { inboxID?: string }).inboxID === messageID)
          if (!seen && (options.script ?? "full") !== "none") {
            append(input.sessionID, "session.inbox.enqueued", { inboxID: messageID })
            if (options.script !== "no-delivery") append(input.sessionID, "session.inbox.delivered", { inboxID: messageID })
            if (options.script === undefined || options.script === "full") append(input.sessionID, "session.execution.started")
          }
          return Effect.succeed({ messageID })
        }),
      pending: (sessionID) => Effect.succeed((pending.get(sessionID) ?? []) as never),
    }),
  )

  return { creates, enqueues, stored, pending, seed, append, sessionLayer, channelLayer }
}
