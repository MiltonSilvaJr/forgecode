import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SubscriptionAuth } from "@opencode/core/subscription"
import { Credential } from "@opencode/schema/credential"

const kinds = ["env", "store", "native", "keychain", "api_key"] as const

function source(
  kind: (typeof kinds)[number],
  opts: { present?: boolean; state?: string; detail?: string; count?: { n: number } } = {},
) {
  return SubscriptionAuth.Source.make({
    kind,
    report: () =>
      Effect.sync(() => {
        if (opts.count) opts.count.n += 1
        return {
          present: opts.present ?? true,
          state: opts.state ?? "ready",
          ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
        }
      }),
    acquire: () => Effect.succeed(Credential.Key.make({ type: "key", key: `sentinel-${kind}` })),
  })
}

const allReady = () => kinds.map((kind) => source(kind))

describe("SubscriptionAuth.Resolver", () => {
  test("resolves env when all five sources are present", async () => {
    const result = await Effect.runPromise(
      SubscriptionAuth.Resolver.resolve({ integrationID: "p", sources: allReady() }),
    )
    expect(result.resolution.source).toBe("env")
  })

  test("falls through the priority order as sources disappear", async () => {
    for (const [index, expected] of kinds.entries()) {
      const present = new Set(kinds.slice(index))
      const sources = kinds
        .filter((kind) => present.has(kind))
        .map((kind) => source(kind))
      const result = await Effect.runPromise(
        SubscriptionAuth.Resolver.resolve({ integrationID: "p", sources }),
      )
      expect(result.resolution.source).toBe(expected)
    }
  })

  test("honours the per-provider override order", async () => {
    const result = await Effect.runPromise(
      SubscriptionAuth.Resolver.resolve({
        integrationID: "p",
        sources: allReady(),
        order: ["native", "store", "env", "keychain", "api_key"],
      }),
    )
    expect(result.resolution.source).toBe("native")
  })

  test("skips an expired source and continues the chain", async () => {
    const sources = [
      source("env", { present: true, state: "expired" }),
      source("store", { present: false, state: "missing" }),
      source("native"),
    ]
    const result = await Effect.runPromise(
      SubscriptionAuth.Resolver.resolve({ integrationID: "p", sources }),
    )
    expect(result.resolution.source).toBe("native")
    expect(result.resolution.skipped).toEqual([
      { kind: "env", reason: "expired" },
      { kind: "store", reason: "missing" },
    ])
  })

  test("marks the api_key fallback with a reason", async () => {
    const result = await Effect.runPromise(
      SubscriptionAuth.Resolver.resolve({
        integrationID: "p",
        sources: [
          source("native", { present: false, state: "missing" }),
          source("api_key"),
        ],
      }),
    )
    expect(result.resolution.source).toBe("api_key")
    expect(result.resolution.fallback).toBe("api_key")
    expect(result.resolution.reason).toBe("missing")
  })

  test("does not fall back when fallbackApiKey is false", async () => {
    const result = await Effect.runPromise(
      SubscriptionAuth.Resolver.resolve({
        integrationID: "p",
        sources: [source("native", { present: false, state: "missing" }), source("api_key")],
        fallbackApiKey: false,
      }),
    )
    expect(result.resolution.source).toBeUndefined()
    expect(result.resolution.state).toBe("missing")
  })

  test("does not fall back after an account mismatch", async () => {
    const result = await Effect.runPromise(
      SubscriptionAuth.Resolver.resolve({
        integrationID: "p",
        sources: [
          source("native", { present: true, state: "incompatible", detail: "account_mismatch" }),
          source("api_key"),
        ],
      }),
    )
    expect(result.resolution.source).toBeUndefined()
    expect(result.resolution.skipped).toContainEqual({ kind: "native", reason: "account_mismatch" })
  })

  test("memoizes resolution per integrationID until invalidated", async () => {
    const count = { n: 0 }
    const resolver = SubscriptionAuth.Resolver.makeResolver()
    const input = { integrationID: "p", sources: [source("env", { count })] }
    await Effect.runPromise(resolver.resolve(input))
    await Effect.runPromise(resolver.resolve(input))
    expect(count.n).toBe(1)
    resolver.invalidate("p")
    await Effect.runPromise(resolver.resolve(input))
    expect(count.n).toBe(2)
  })
})
