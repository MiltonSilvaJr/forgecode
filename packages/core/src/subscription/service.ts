export * as SubscriptionService from "./service.js"

import { Context, Effect, Layer } from "effect"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Config } from "../config.js"
import { KV } from "../kv.js"
import { Bus } from "../bus.js"

const fail = (code: SubscriptionAuth.ErrorCode, message: string): SubscriptionAuth.Error => ({ code, message })

export interface Interface {
  readonly status: () => Effect.Effect<SubscriptionAuth.Status>
  readonly login: (input: {
    readonly integrationID: string
    readonly source?: "managed" | "native"
    readonly accept: boolean
  }) => Effect.Effect<unknown, SubscriptionAuth.Error>
  readonly consent: (integrationID: string, accept: boolean) => Effect.Effect<void, SubscriptionAuth.Error>
  readonly refresh: (
    integrationID: string,
  ) => Effect.Effect<{ readonly state: string }, SubscriptionAuth.Error>
  readonly test: (
    integrationID: string,
    model?: string,
  ) => Effect.Effect<{ readonly ok: boolean; readonly latencyMs: number }, SubscriptionAuth.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubscriptionAuth") {}

const layer = Layer.effect(
  Service,
  Effect.sync(() =>
    Service.of({
      status: () =>
        Effect.succeed(SubscriptionAuth.Status.make({ enabled: false, providers: [] })),
      login: () => Effect.fail(fail("subscription_auth_disabled", "disabled")),
      consent: () => Effect.void,
      refresh: () => Effect.fail(fail("subscription_auth_disabled", "disabled")),
      test: () => Effect.fail(fail("subscription_auth_disabled", "disabled")),
    }),
  ),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node, KV.node, Bus.node] })
