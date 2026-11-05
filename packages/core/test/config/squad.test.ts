import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { Info } from "@opencode/schema/config"

const options = { errors: "all", onExcessProperty: "ignore" } as const

function normalized(input: unknown) {
  const result = ConfigNormalize.normalize(input)
  expect(result.type).toBe("normalized")
  if (result.type !== "normalized") throw new Error("expected normalized config")
  return result
}

function decoded(input: unknown) {
  return Schema.decodeUnknownSync(Info, options)(normalized(input).encoded)
}

describe("ConfigSquad", () => {
  test("squad.enabled defaults to false", () => {
    expect(decoded({ squad: {} }).squad?.enabled).toBe(false)
  })

  test("squad.enabled decodes true", () => {
    expect(decoded({ squad: { enabled: true } }).squad?.enabled).toBe(true)
  })

  test("omits squad from encoded output when absent", () => {
    expect(normalized({}).encoded).not.toHaveProperty("squad")
  })

  test("rejects unknown keys within squad with a diagnostic", () => {
    const result = normalized({ squad: { enabled: true, bogus: 1 } })
    expect(result.diagnostics.some((d) => d.kind === "invalid" && d.path.join(".") === "squad.bogus")).toBe(true)
  })

  test("rejects a zero or malformed liveness duration with a diagnostic", () => {
    for (const stale of [0, "bogus", "0 minutes"]) {
      const result = normalized({ squad: { liveness: { stale_after: stale, dead_after: "24 hours" } } })
      expect(
        result.diagnostics.some(
          (d) => d.kind === "invalid" && d.path.join(".") === "squad.liveness.stale_after",
        ),
      ).toBe(true)
    }
  })

  test("normalizes valid liveness durations", () => {
    const result = normalized({ squad: { liveness: { stale_after: "60 minutes", dead_after: "24 hours" } } })
    expect(result.encoded.squad).toEqual({
      enabled: false,
      liveness: { stale_after: "3600000 millis", dead_after: "86400000 millis" },
    })
  })
})
