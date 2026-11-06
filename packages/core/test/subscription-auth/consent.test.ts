import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { KV } from "@opencode/core/kv"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { SubscriptionConsent } from "@opencode/core/subscription/consent"
import { SubscriptionNotice } from "@opencode/core/subscription/notice"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([KV.node])))

describe("SubscriptionConsent", () => {
  it.effect("requires consent on first use", () =>
    Effect.gen(function* () {
      expect(yield* SubscriptionConsent.status("first-provider", SubscriptionNotice.VERSION)).toBe("required")
    }),
  )

  it.effect("acknowledges and reports acknowledged", () =>
    Effect.gen(function* () {
      yield* SubscriptionConsent.acknowledge("second-provider", SubscriptionNotice.VERSION)
      expect(yield* SubscriptionConsent.status("second-provider", SubscriptionNotice.VERSION)).toBe(
        "acknowledged",
      )
    }),
  )

  it.effect("a new notice version requires consent again", () =>
    Effect.gen(function* () {
      yield* SubscriptionConsent.acknowledge("third-provider", 1)
      expect(yield* SubscriptionConsent.status("third-provider", 2)).toBe("required")
    }),
  )
})
