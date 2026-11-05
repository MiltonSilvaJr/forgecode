import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Stream } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Squad } from "@opencode/core/squad/index"
import { SquadEvent } from "@opencode/core/squad/event"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { testEffect } from "../lib/effect"

const withSquad = (enabled: boolean) =>
  testEffect(
    AppNodeBuilder.build(LayerNode.group([Squad.node, Config.node, Bus.node]), [
      Config.node.replace(
        Config.testLayer(
          enabled
            ? [new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: true }) }) })]
            : [],
        ),
      ),
    ]),
  )

describe("Squad.disabled", () => {
  const it = withSquad(false)

  it.live("open fails with DisabledError before touching the bus", () =>
    Effect.gen(function* () {
      const squad = yield* Squad.Service
      const exit = yield* squad.open({ generation: "gen-1" }).pipe(Effect.exit)
      const tag = Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string })._tag : undefined
      expect(tag).toBe("Squad.DisabledError")
    }),
  )

  it.live("enabled reports false", () =>
    Effect.gen(function* () {
      const squad = yield* Squad.Service
      expect(yield* squad.enabled()).toBe(false)
    }),
  )
})

describe("Squad.enabled", () => {
  const it = withSquad(true)

  it.live("open publishes squad.generation.opened", () =>
    Effect.gen(function* () {
      const squad = yield* Squad.Service
      const bus = yield* Bus.Service
      const fiber = yield* bus.subscribe(SquadEvent.GenerationOpened).pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.forkScoped,
      )
      yield* squad.open({ generation: "gen-1" })
      const events = yield* Fiber.join(fiber)
      expect(events).toHaveLength(1)
      expect(events[0]?.data.generation).toBe("gen-1")
    }),
  )
})
