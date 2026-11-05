export * as Squad from "./index.js"

import { Context, Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Bus } from "../bus.js"
import { Config } from "../config.js"
import { SquadEvent } from "./event.js"

export class DisabledError extends Schema.TaggedError<DisabledError>()("Squad.DisabledError", {}) {
  override get message() {
    return "squad.enabled is false. Set squad.enabled in config to use squad."
  }
}

export interface Interface {
  readonly enabled: () => Effect.Effect<boolean>
  readonly open: (input: { generation: string }) => Effect.Effect<{ generation: string }, DisabledError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const bus = yield* Bus.Service

    const isEnabled = Effect.fn("Squad.enabled")(function* () {
      const entries = yield* config.entries()
      return Config.latest(entries, "squad")?.enabled === true
    })

    const requireEnabled = () =>
      isEnabled().pipe(Effect.flatMap((on) => (on ? Effect.void : Effect.fail(new DisabledError()))))

    return Service.of({
      enabled: isEnabled,
      open: Effect.fn("Squad.open")(function* (input) {
        yield* requireEnabled()
        yield* bus.publish(SquadEvent.GenerationOpened, { generation: input.generation })
        return { generation: input.generation }
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node, Config.node],
})
