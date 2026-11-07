export * as SquadActivity from "./activity.js"

import { Context, DateTime, Effect, Layer } from "effect"
import { Session as SessionSchema } from "@opencode/schema/session"
import { SquadChannel } from "./channel.js"

export interface Interface {
  /**
   * Whether the session has an execution in flight, one the process still owns, or a durable claim a shutdown or
   * crash left behind. Liveness reads the same claim, so `close` and `status` never disagree about it.
   */
  readonly isActive: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/Activity") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* SquadChannel.SessionsService
    return Service.of({
      isActive: Effect.fn("SquadActivity.isActive")(function* (sessionID) {
        // An unreadable session is not proof of activity: `close` names what it can observe.
        if ((yield* sessions.claim(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))) !== undefined) return true
        const info = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const busy = info?.time.busy
        if (busy === undefined) return false
        const idle = info?.time.idle
        return idle === undefined || DateTime.toEpochMillis(busy) > DateTime.toEpochMillis(idle)
      }),
    })
  }),
)
