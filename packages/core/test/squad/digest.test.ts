import { describe, expect, test } from "bun:test"
import { SquadRegistry } from "@opencode/core/squad/registry"

describe("SquadRegistry.registryDigest", () => {
  test("matches the canonical fixture from design.md §2.3", () => {
    const digest = SquadRegistry.registryDigest("gen-2026-11-04", [
      { name: "ATLAS", provider: "kimi", model: "k3.1-pro", variant: "high", location: "/w/atlas", branch: "feature/y", sessionID: "ses_2", state: "verified" },
      { name: "ORQUESTRADORA", provider: "deepseek", model: "deepseek-flash", variant: "high", location: "/w/orq", branch: "feature/x", sessionID: "ses_1", state: "verified" },
    ])
    expect(digest).toBe("786d7eb4896706ae559887f05468829c12e45eed0763e4cb3ea3bef925e01498")
  })

  test("sorts by name code point, not localeCompare", () => {
    const digest = SquadRegistry.registryDigest("gen-2026-11-04", [
      { name: "ORQUESTRADORA", provider: "deepseek", model: "deepseek-flash", variant: "high", location: "/w/orq", branch: "feature/x", sessionID: "ses_1", state: "verified" },
      { name: "ATLAS", provider: "kimi", model: "k3.1-pro", variant: "high", location: "/w/atlas", branch: "feature/y", sessionID: "ses_2", state: "verified" },
    ])
    expect(digest).toBe("786d7eb4896706ae559887f05468829c12e45eed0763e4cb3ea3bef925e01498")
  })
})
