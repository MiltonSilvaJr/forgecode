import { expect } from "bun:test"
import { Clock, Deferred, Effect, Fiber, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { Config } from "@opencode/core/config"
import { Info } from "@opencode/schema/config"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { SubscriptionService } from "@opencode/core/subscription/service"
import { SubscriptionConsent } from "@opencode/core/subscription/consent"
import { SubscriptionNotice } from "@opencode/core/subscription/notice"
import { SubscriptionProbe } from "@opencode/core/subscription/probe"
import { KV } from "@opencode/core/kv"
import { it } from "../lib/effect"

const integrationID = Integration.ID.make("openai")
const methodID = Integration.MethodID.make("chatgpt-token-sharing")
const services = (client = HttpClient.make(() => Effect.die("unexpected provider request")), enabled = true) =>
  AppNodeBuilder.build(LayerNode.group([SubscriptionService.node, Credential.node, Integration.node, KV.node]), [
    Config.node.replace(Config.testLayer([{ type: "document", info: Info.make({ subscription_auth: { enabled } }) }])),
    httpClient.replace(Layer.succeed(HttpClient.HttpClient, client)),
  ])

const consent = SubscriptionConsent.acknowledge("codex-chatgpt", SubscriptionNotice.VERSION)

it.effect("test and refresh enforce consent before credential resolution or transport", () =>
  Effect.gen(function* () {
    const service = yield* SubscriptionService.Service
    const kv = yield* KV.Service
    yield* kv.remove(SubscriptionConsent.key("codex-chatgpt"))
    expect((yield* service.test("codex-chatgpt").pipe(Effect.flip)).code).toBe("consent_required")
    expect((yield* service.refresh("codex-chatgpt").pipe(Effect.flip)).code).toBe("consent_required")
  }).pipe(Effect.provide(services())),
)

it.effect("disabled test never opens a connection", () =>
  Effect.gen(function* () {
    const service = yield* SubscriptionService.Service
    expect((yield* service.test("codex-chatgpt").pipe(Effect.flip)).code).toBe("subscription_auth_disabled")
  }).pipe(Effect.provide(services(undefined, false))),
)

it.effect("managed Codex test makes one bounded request without needing the native session", () => {
  const requests: HttpClientRequest.HttpClientRequest[] = []
  const client = HttpClient.make((request) => {
    requests.push(request)
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}")))
  })
  return Effect.gen(function* () {
    const service = yield* SubscriptionService.Service
    const credentials = yield* Credential.Service
    yield* consent
    yield* credentials.create({ integrationID, value: Credential.OAuth.make({ type: "oauth", methodID, access: "managed-sentinel", refresh: "refresh", expires: (yield* Clock.currentTimeMillis) + 3_600_000 }) })
    const result = yield* service.test("codex-chatgpt", "gpt-5.5")
    expect(result).toMatchObject({ ok: true, model: "gpt-5.5" })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe("https://api.openai.com/v1/responses")
    expect(requests[0].method).toBe("POST")
    expect(requests[0].headers.authorization).toBe("Bearer managed-sentinel")
    const body = requests[0].body
    expect(body._tag).toBe("Uint8Array")
    if (body._tag === "Uint8Array") expect(JSON.parse(new TextDecoder().decode(body.body))).toMatchObject({ max_output_tokens: 8, stream: false, model: "gpt-5.5" })
  }).pipe(Effect.provide(services(client)))
})

it.effect("managed refresh shares the real credential lock and persists the renewed credential", () =>
  Effect.gen(function* () {
    const service = yield* SubscriptionService.Service
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service
    yield* consent
    const gate = yield* Deferred.make<void>()
    const calls = { count: 0 }
    const expires = (yield* Clock.currentTimeMillis) + 3_600_000
    yield* integrations.transform((editor) => editor.method.update({
      integrationID, method: { type: "oauth", id: methodID, label: "ChatGPT" },
      authorize: () => Effect.die("unused authorization"),
      refresh: (value) => Effect.gen(function* () {
        calls.count++
        yield* Deferred.await(gate)
        return Credential.OAuth.make({ ...value, access: "renewed", expires })
      }),
    }))
    const original = yield* credentials.create({ integrationID, value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "refresh", expires: 1 }) })
    const running = yield* Effect.all([service.refresh("codex-chatgpt"), service.refresh("codex-chatgpt")], { concurrency: "unbounded" }).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Deferred.succeed(gate, undefined)
    expect(yield* Fiber.join(running)).toEqual([{ state: "ready", expiresAt: expires }, { state: "ready", expiresAt: expires }])
    expect(calls.count).toBe(1)
    expect((yield* credentials.get(original.id))?.value).toMatchObject({ access: "renewed", expires })
  }).pipe(Effect.provide(services())),
)

it.effect("failed managed refresh preserves the previous credential and hides provider errors", () =>
  Effect.gen(function* () {
    const service = yield* SubscriptionService.Service
    const integrations = yield* Integration.Service
    const credentials = yield* Credential.Service
    yield* consent
    yield* integrations.transform((editor) => editor.method.update({
      integrationID, method: { type: "oauth", id: methodID, label: "ChatGPT" },
      authorize: () => Effect.die("unused authorization"),
      refresh: () => Effect.fail(new Error("Bearer private-sentinel")),
    }))
    const original = yield* credentials.create({ integrationID, value: Credential.OAuth.make({ type: "oauth", methodID, access: "old", refresh: "refresh", expires: 1 }) })
    const error = yield* service.refresh("codex-chatgpt").pipe(Effect.flip)
    expect(error.code).toBe("refresh_failed")
    expect(JSON.stringify(error)).not.toContain("private-sentinel")
    expect((yield* credentials.get(original.id))?.value).toEqual(original.value)
  }).pipe(Effect.provide(services())),
)

for (const [status, code] of [[401, "session_expired"], [403, "session_expired"], [429, "rate_limited"], [500, "transport_unavailable"]] as const) {
  it.effect(`probe maps ${status} without retry or exposing the response body`, () => {
    const requests = { count: 0 }
    return SubscriptionProbe.http({ url: "https://provider.invalid/messages", token: "sentinel", model: "k3", protocol: "messages" }).pipe(
      Effect.flip,
      Effect.tap((error) => Effect.sync(() => {
        expect(error.code).toBe(code)
        expect(JSON.stringify(error)).not.toContain("private-sentinel")
        expect(requests.count).toBe(1)
      })),
      Effect.provideService(HttpClient.HttpClient, HttpClient.make((request) => {
        requests.count++
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response("private-sentinel", { status })))
      })),
    )
  })
}

it.effect("probe times out at 15 seconds without retry", () =>
  Effect.gen(function* () {
    const requests = { count: 0 }
    const running = yield* SubscriptionProbe.http({ url: "https://provider.invalid/messages", token: "sentinel", model: "k3", protocol: "messages" }).pipe(
      Effect.provideService(HttpClient.HttpClient, HttpClient.make(() => { requests.count++; return Effect.never })),
      Effect.flip,
      Effect.forkChild({ startImmediately: true }),
    )
    yield* TestClock.adjust("15 seconds")
    expect((yield* Fiber.join(running)).code).toBe("transport_unavailable")
    expect(requests.count).toBe(1)
  }),
)
