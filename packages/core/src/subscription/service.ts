export * as SubscriptionService from "./service.js"

import { Clock, Context, Effect, Layer } from "effect"
import { HttpClient } from "effect/http"
import { httpClient } from "@opencode/util/effect/app-node-platform"
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
import { SubscriptionProbe } from "./probe.js"
import { ClaudeIO } from "../plugin/provider/claude-agent/claude/io.js"
import { ClaudeProbe } from "../plugin/provider/claude-agent/claude/probe.js"
import { ClaudeQueryOptions } from "../plugin/provider/claude-agent/claude/query-options.js"
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
    const http = yield* HttpClient.HttpClient
    const context = yield* Effect.context<Config.Service | KV.Service | Integration.Service>()

    const requireConsent = Effect.fnUntraced(function* (integrationID: string) {
      if ((yield* SubscriptionConsent.status(integrationID, SubscriptionNotice.VERSION)) !== "acknowledged")
        return yield* Effect.fail(fail("consent_required", `Accept the terms first: forgecode auth login ${integrationID} --accept-tos`))
    })

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
      }, Effect.provide(context)),

      login: Effect.fnUntraced(function* (input) {
        yield* requireEnabled()
        const adapter = yield* adapterFor(input.integrationID)
        const notice = SubscriptionNotice.notice(adapter.integrationID)
        const consent = yield* SubscriptionConsent.status(adapter.integrationID, notice.version)
        if (!input.accept && consent !== "acknowledged")
          return yield* Effect.fail(
            fail(
              "consent_required",
              `Accept the terms of use first: forgecode auth login ${adapter.integrationID} --accept-tos`,
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
      }, Effect.provide(context)),

      consent: Effect.fnUntraced(function* (integrationID, accept) {
        yield* requireEnabled()
        const adapter = yield* adapterFor(integrationID)
        if (accept) yield* SubscriptionConsent.acknowledge(adapter.integrationID, SubscriptionNotice.VERSION)
      }, Effect.provide(context)),

      refresh: Effect.fnUntraced(function* (integrationID) {
        yield* requireEnabled()
        const adapter = yield* adapterFor(integrationID)
        yield* requireConsent(adapter.integrationID)
        const integration = yield* Integration.Service
        const connection = yield* integration.connection.active(Integration.ID.make(adapter.providerID))
        if (connection?.type === "credential") {
          // Reuse the shared credential lock, 5-minute window, 30-second deadline and atomic update.
          const value = yield* integration.connection.resolve(connection).pipe(
            Effect.mapError(() => fail("refresh_failed", `Refresh failed; the saved credential was preserved. Run forgecode auth login ${adapter.integrationID}.`)),
          )
          if (value?.type === "oauth") {
            const now = yield* Clock.currentTimeMillis
            if (value.expires <= now)
              return yield* Effect.fail(fail("refresh_failed", `OAuth refresh is unavailable. Run forgecode auth login ${adapter.integrationID}.`))
            yield* bus.publish(SubscriptionAuth.Event.Changed, { integrationID, action: "refresh", sourceKind: "store", expiresAt: value.expires })
            return { state: "ready", expiresAt: value.expires }
          }
        }
        const report = yield* adapter.report(process.env)
        if (report.present && report.state === "ready")
          return { state: "ready", ...(report.expiresAt !== undefined ? { expiresAt: report.expiresAt } : {}) }
        return yield* Effect.fail(
          fail(
            "session_expired",
            `The ${adapter.integrationID} session is expired or missing. Run forgecode auth login ${adapter.integrationID}.`,
          ),
        )
      }, Effect.provide(context)),

      test: Effect.fnUntraced(function* (integrationID, model) {
        yield* requireEnabled()
        const adapter = yield* adapterFor(integrationID)
        yield* requireConsent(adapter.integrationID)
        if (adapter.integrationID === "claude-code") {
          const executable = ClaudeIO.real.which()
          if (!executable) return yield* Effect.fail(fail("cli_missing", `Install Claude Code: ${ClaudeCodeAdapter.installUrl}`))
          const started = yield* Clock.currentTimeMillis
          const result = yield* ClaudeProbe.run(ClaudeQueryOptions.base({ executable, io: ClaudeIO.real, connection: {} })).pipe(
            Effect.timeout("15 seconds"),
            Effect.mapError(() => fail("transport_unavailable", "Claude Code probe failed. Run forgecode auth login claude-code.")),
          )
          if (!ClaudeProbe.isLoggedIn(result.account))
            return yield* Effect.fail(fail("session_expired", "Claude Code is signed out. Run forgecode auth login claude-code."))
          const selected = model ?? result.models[0]?.value
          if (!selected || !result.models.some((entry) => entry.value === selected))
            return yield* Effect.fail(fail("transport_unavailable", "Claude Code did not report this model. Run forgecode auth test claude-code --model <id>."))
          return { ok: true, latencyMs: Math.max(0, (yield* Clock.currentTimeMillis) - started), model: selected }
        }
        const integration = yield* Integration.Service
        const connection = yield* integration.connection.active(Integration.ID.make(adapter.providerID))
        const managed = connection ? yield* integration.connection.resolve(connection).pipe(
          Effect.mapError(() => fail("refresh_failed", `Credential resolution failed. Run forgecode auth login ${adapter.integrationID}.`)),
        ) : undefined
        const config = yield* readConfig()
        const resolved = managed ? undefined : yield* SubscriptionResolver.resolve({
          integrationID,
          // Codex's native token is intentionally not transferable. Never inspect it for inference.
          sources: (yield* adapter.sources(process.env)).filter((source) => adapter.integrationID !== "codex-chatgpt" || source.kind === "api_key"),
          order: config?.sources?.[integrationID],
          fallbackApiKey: config?.fallback?.api_key ?? true,
        })
        const value = managed ?? (resolved?.source ? yield* resolved.source.acquire() : undefined)
        if (!value || value.type === "external")
          return yield* Effect.fail(fail("subscription_unavailable", `No usable credential. Run forgecode auth login ${integrationID}${integrationID === "codex-chatgpt" ? " --source managed" : ""}.`))
        if (value.type === "key" && !(config?.fallback?.api_key ?? true) && adapter.integrationID === "codex-chatgpt")
          return yield* Effect.fail(fail("subscription_unavailable", "API key fallback is disabled. Run forgecode auth login codex-chatgpt --source managed."))
        if (value.type === "oauth" && adapter.integrationID === "codex-chatgpt" && value.methodID !== "chatgpt-token-sharing")
          return yield* Effect.fail(fail("transport_unavailable", "This OAuth credential does not support token sharing. Run forgecode auth login codex-chatgpt --source managed."))
        const result = yield* SubscriptionProbe.http({
          url: adapter.integrationID === "kimi-code" ? `${KimiCodeAdapter.baseURL}/messages` : "https://api.openai.com/v1/responses",
          token: value.type === "key" ? value.key : value.access,
          model: model ?? (adapter.integrationID === "kimi-code" ? "k3" : "gpt-5.5"),
          protocol: adapter.integrationID === "kimi-code" ? "messages" : "responses",
        }).pipe(Effect.provideService(HttpClient.HttpClient, http))
        yield* bus.publish(SubscriptionAuth.Event.Changed, { integrationID, action: "probe", sourceKind: managed ? "store" : resolved?.resolution.source, outcome: "ok" })
        return result
      }, Effect.provide(context)),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Config.node, KV.node, Bus.node, Integration.node, httpClient] })
