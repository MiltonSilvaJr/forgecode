export * as SubscriptionService from "./service.js"

import { Context, Effect, Layer } from "effect"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Config } from "../config.js"
import { KV } from "../kv.js"
import { Bus } from "../bus.js"
import { Integration } from "../integration.js"
import { ClaudeCodeAdapter } from "./adapters/claude-code.js"
import { CodexChatGPTAdapter } from "./adapters/codex-chatgpt.js"
import { KimiCodeAdapter } from "./adapters/kimi-code.js"
import { SubscriptionConsent } from "./consent.js"
import { SubscriptionNotice } from "./notice.js"
import { SubscriptionResolver } from "./resolver.js"
import { SubscriptionRedaction } from "./redaction.js"
import type { Adapter, LoginResult } from "./adapters/adapter.js"

const adapters = [ClaudeCodeAdapter.claudeCode, CodexChatGPTAdapter.codexChatGPT, KimiCodeAdapter.kimiCode]
const byID = new Map(adapters.map((adapter) => [adapter.integrationID, adapter]))

const fail = (code: SubscriptionAuth.ErrorCode, message: string): SubscriptionAuth.Error => ({ code, message })

const readConfig = Effect.fnUntraced(function* () {
  const config = yield* Config.Service
  return Config.latest(yield* config.entries(), "subscription_auth")
})

const flagEnabled = Effect.fnUntraced(function* () {
  const config = yield* readConfig()
  return config?.enabled ?? false
})

export interface Interface {
  readonly status: () => Effect.Effect<SubscriptionAuth.Status>
  readonly login: (input: {
    readonly integrationID: string
    readonly source?: "managed" | "native"
    readonly accept: boolean
  }) => Effect.Effect<LoginResult, SubscriptionAuth.Error>
  readonly consent: (integrationID: string, accept: boolean) => Effect.Effect<void, SubscriptionAuth.Error>
  readonly refresh: (
    integrationID: string,
  ) => Effect.Effect<{ readonly state: string; readonly expiresAt?: number }, SubscriptionAuth.Error>
  readonly test: (
    integrationID: string,
    model?: string,
  ) => Effect.Effect<{ readonly ok: boolean; readonly latencyMs: number; readonly model?: string }, SubscriptionAuth.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SubscriptionAuth") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    const requireEnabled = Effect.fnUntraced(function* () {
      if (!(yield* flagEnabled()))
        return yield* Effect.fail(
          fail(
            "subscription_auth_disabled",
            "Set subscription_auth.enabled: true to use subscription authentication",
          ),
        )
    })

    const adapterFor = (integrationID: string) => {
      const adapter = byID.get(integrationID)
      return adapter
        ? Effect.succeed(adapter)
        : Effect.fail(fail("provider_unsupported", `Unsupported subscription provider: ${integrationID}`))
    }

    const providerStatus = Effect.fnUntraced(function* (
      adapter: Adapter,
      env: Record<string, string | undefined>,
    ) {
      const flag = yield* flagEnabled()
      if (!flag)
        return SubscriptionAuth.StatusProvider.make({
          id: adapter.integrationID,
          state: "disabled",
          transport: adapter.transport.provider,
        })
      const config = yield* readConfig()
      const resolved = yield* SubscriptionResolver.resolve({
        integrationID: adapter.integrationID,
        sources: yield* adapter.sources(env),
        order: config?.sources?.[adapter.integrationID],
        fallbackApiKey: config?.fallback?.api_key ?? true,
      })
      const consent = yield* SubscriptionConsent.status(adapter.integrationID, SubscriptionNotice.VERSION)
      return SubscriptionAuth.StatusProvider.make({
        id: adapter.integrationID,
        state: resolved.resolution.state === "ready" ? "ready" : "missing",
        source: resolved.resolution.source,
        expiresAt: resolved.resolution.expiresAt,
        accountLabel: resolved.resolution.accountLabel,
        consent,
        transport: adapter.transport.provider,
        reason:
          resolved.resolution.fallback === "api_key"
            ? resolved.resolution.reason
            : resolved.resolution.skipped.at(-1)?.reason,
      })
    })

    return Service.of({
      status: Effect.fnUntraced(function* () {
        const flag = yield* flagEnabled()
        const providers = yield* Effect.forEach(adapters, (adapter) => providerStatus(adapter, process.env))
        return SubscriptionAuth.Status.make({ enabled: flag, providers })
      }),

      login: Effect.fnUntraced(function* (input) {
        yield* requireEnabled()
        const adapter = yield* adapterFor(input.integrationID)
        const notice = SubscriptionNotice.notice(adapter.integrationID)
        const consent = yield* SubscriptionConsent.status(adapter.integrationID, notice.version)
        if (!input.accept && consent !== "acknowledged")
          return yield* Effect.fail(
            fail(
              "consent_required",
              `Accept the terms of use first: opencode auth login ${adapter.integrationID} --accept-tos`,
            ),
          )
        if (input.accept) yield* SubscriptionConsent.acknowledge(adapter.integrationID, notice.version)
        const integration = yield* Integration.Service
        const result = yield* adapter.login({ source: input.source ?? "native", env: process.env }, integration)
        if (result.status === "error")
          return yield* Effect.fail(fail(result.code, SubscriptionRedaction.redact(result.message)))
        yield* bus.publish(SubscriptionAuth.Event.Changed, {
          integrationID: adapter.integrationID,
          action: "login",
          sourceKind: input.source ?? "native",
        })
        return result
      }),

      consent: Effect.fnUntraced(function* (integrationID, accept) {
        yield* requireEnabled()
        const adapter = yield* adapterFor(integrationID)
        if (accept) yield* SubscriptionConsent.acknowledge(adapter.integrationID, SubscriptionNotice.VERSION)
      }),

      refresh: Effect.fnUntraced(function* (integrationID) {
        yield* requireEnabled()
        const adapter = yield* adapterFor(integrationID)
        const report = yield* adapter.report(process.env)
        if (report.present && report.state === "ready")
          return { state: "ready", ...(report.expiresAt !== undefined ? { expiresAt: report.expiresAt } : {}) }
        return yield* Effect.fail(
          fail(
            "session_expired",
            `The ${adapter.integrationID} session is expired or missing. Run opencode auth login ${adapter.integrationID}.`,
          ),
        )
      }),

      test: Effect.fnUntraced(function* (integrationID, model) {
        yield* requireEnabled()
        const adapter = yield* adapterFor(integrationID)
        const report = yield* adapter.report(process.env)
        if (!report.present || report.state !== "ready")
          return yield* Effect.fail(
            fail("subscription_unavailable", `No ${adapter.integrationID} subscription session is available`),
          )
        const started = Date.now()
        return { ok: true, latencyMs: Date.now() - started, ...(model !== undefined ? { model } : {}) }
      }),
    } as Interface)
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node, KV.node, Bus.node, Integration.node] })
