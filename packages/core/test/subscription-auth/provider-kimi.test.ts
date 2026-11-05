import { describe, expect, test } from "bun:test"
import { KimiProvider } from "@opencode/core/plugin/provider/kimi"

describe("KimiProvider", () => {
  test("targets the kimi coding endpoint", () => {
    expect(KimiProvider.baseURL).toBe("https://api.kimi.com/coding/v1")
  })

  test("identifies the provider and catalog", () => {
    expect(String(KimiProvider.providerID)).toBe("kimi-for-coding")
    expect(KimiProvider.catalogID).toBe("kimi-code-plan-global")
  })

  test("builds a per-request bearer header without persisting the token", () => {
    expect(KimiProvider.bearerHeader("secret")).toEqual({ Authorization: "Bearer secret" })
  })
})
