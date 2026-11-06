export * as SquadActivity from "./activity.js"

import { Context, Effect, Layer } from "effect"
import { DateTime } from "effect"
import { Session as SessionSchema } from "@opencode/schema/session"
import { Session } from "../session.js"
import { SessionExecution } from "../session/execution.js"

export interface Interface {
  /** Whether the session has an execution in flight, or one a restart left claimed (`busy` newer than `idle`). */
  readonly isActive: (sessionID: SessionSchema.ID) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/Activity") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const execution = yield* SessionExecution.Service
    return Service.of({
      isActive: Effect.fn("SquadActivity.isActive")(function* (sessionID) {
        if (yield* execution.isActive(sessionID)) return true
        const info = yield* sessions.get(sessionID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const busy = info?.time.busy
        if (busy === undefined) return false
        const idle = info?.time.idle
        return idle === undefined || DateTime.toEpochMillis(busy) > DateTime.toEpochMillis(idle)
      }),
    })
  }),
)
