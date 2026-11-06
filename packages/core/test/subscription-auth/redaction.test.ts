import { describe, expect, test } from "bun:test"
import { SubscriptionRedaction } from "@opencode/core/subscription/redaction"

describe("SubscriptionRedaction", () => {
  test("masks a secret value with the token marker", () => {
    expect(SubscriptionRedaction.redactValue("sentinel")).toBe("[redacted:token]")
  })

  test("redacts bearer tokens and refresh tokens from an error body", () => {
    const body = "failed: Authorization: Bearer abc.def.ghi refresh_token=secret"
    const redacted = SubscriptionRedaction.redact(body)
    expect(redacted).not.toContain("abc.def.ghi")
    expect(redacted).not.toContain("secret")
    expect(redacted).toContain("[redacted:token]")
  })

  test("truncates long bodies to 200 characters", () => {
    const long = "x".repeat(500)
    expect(SubscriptionRedaction.truncate(long).length).toBeLessThanOrEqual(201)
  })

  test("builds a tagged error", () => {
    expect(SubscriptionRedaction.error("consent_required", "accept terms")).toEqual({
      code: "consent_required",
      message: "accept terms",
    })
  })
})
