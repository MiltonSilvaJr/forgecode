import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Bus } from "@opencode/core/bus"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { SubscriptionPlugin } from "@opencode/core/subscription/plugin"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Bus.node])))

describe("SubscriptionPlugin", () => {
  it.effect("publishes subscription.auth.changed", () =>
    Effect.gen(function* () {
      const event = yield* SubscriptionPlugin.publishChanged({ integrationID: "kimi-code", action: "probe" })
      expect(event.type).toBe("subscription.auth.changed")
      expect(event.data.integrationID).toBe("kimi-code")
    }),
  )
})
