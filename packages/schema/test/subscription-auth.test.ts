import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SubscriptionAuth } from "../src/subscription-auth.js"

describe("SubscriptionAuth surface", () => {
  test("Source.Kind covers the five kinds", () => {
    expect(Schema.decodeUnknownSync(SubscriptionAuth.Source.Kind)("native")).toBe("native")
    expect(Schema.decodeUnknownSync(SubscriptionAuth.Source.Kind)("api_key")).toBe("api_key")
    expect(() => Schema.decodeUnknownSync(SubscriptionAuth.Source.Kind)("bogus")).toThrow()
  })

  test("Source.Report round-trips and rejects secret fields", () => {
    const report = Schema.decodeUnknownSync(SubscriptionAuth.Source.Report)({
      present: true,
      state: "ready",
      expiresAt: 123,
      accountLabel: "a@example.com",
      detail: "ok",
    })
    expect(Schema.encodeSync(SubscriptionAuth.Source.Report)(report)).toEqual({
      present: true,
      state: "ready",
      expiresAt: 123,
      accountLabel: "a@example.com",
      detail: "ok",
    })
    expect(() =>
      Schema.decodeUnknownSync(SubscriptionAuth.Source.Report, { onExcessProperty: "error" })({
        present: true,
        state: "ready",
        accessToken: "sentinel",
      }),
    ).toThrow()
  })

  test("Resolution reports the chosen source kind", () => {
    const resolution = Schema.decodeUnknownSync(SubscriptionAuth.Resolution)({
      integrationID: "claude-agent",
      state: "ready",
      source: "native",
      skipped: [{ kind: "env", reason: "not set" }],
    })
    expect(resolution.source).toBe("native")
  })

  test("ErrorCode is a closed set of 13", () => {
    expect(SubscriptionAuth.ErrorCode.literals).toHaveLength(13)
    const error = Schema.decodeUnknownSync(SubscriptionAuth.Error)({
      code: "consent_required",
      message: "accept the terms first",
    })
    expect(error.code).toBe("consent_required")
    expect(() =>
      Schema.decodeUnknownSync(SubscriptionAuth.Error)({ code: "unknown_code", message: "x" }),
    ).toThrow()
  })

  test("event subscription.auth.changed decodes", () => {
    const event = Schema.decodeUnknownSync(SubscriptionAuth.Event.Changed)({
      id: "evt_test",
      created: 1,
      type: "subscription.auth.changed",
      data: { integrationID: "kimi-code", action: "probe", code: "transport_unavailable" },
    })
    expect(event.type).toBe("subscription.auth.changed")
    expect(event.data.integrationID).toBe("kimi-code")
  })
})
