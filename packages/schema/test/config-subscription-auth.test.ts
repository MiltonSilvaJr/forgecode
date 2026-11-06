import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "../src/config.js"

describe("subscription_auth config", () => {
  test("decodes without subscription_auth", () => {
    const config = Schema.decodeUnknownSync(Config.Info)({})
    expect(config.subscription_auth).toBeUndefined()
  })

  test("subscription_auth.enabled decodes", () => {
    const config = Schema.decodeUnknownSync(Config.Info)({ subscription_auth: { enabled: false } })
    expect(config.subscription_auth?.enabled).toBe(false)
  })

  test("sources override decodes in order", () => {
    const config = Schema.decodeUnknownSync(Config.Info)({
      subscription_auth: { sources: { "kimi-code": ["native", "store"] } },
    })
    expect(config.subscription_auth?.sources?.["kimi-code"]).toEqual(["native", "store"])
  })

  test("rejects unknown source kinds", () => {
    expect(() =>
      Schema.decodeUnknownSync(Config.Info)({ subscription_auth: { sources: { "kimi-code": ["bogus"] } } }),
    ).toThrow()
  })

  test("fallback.api_key decodes", () => {
    const config = Schema.decodeUnknownSync(Config.Info)({ subscription_auth: { fallback: { api_key: false } } })
    expect(config.subscription_auth?.fallback?.api_key ?? true).toBe(false)
  })
})
