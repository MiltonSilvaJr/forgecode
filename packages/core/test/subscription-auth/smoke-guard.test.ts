import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { smokeKimi } from "../../script/subscription-smoke"
import { tmpdir } from "../fixture/tmpdir"

describe("subscription smoke guard", () => {
  test("skips without a credential or native session", async () => {
    await using dir = await tmpdir()
    const result = await Effect.runPromise(smokeKimi({ HOME: dir.path }))
    expect(result).toBe("skipped")
  })

  test("skips when the native session is present but expired", async () => {
    await using dir = await tmpdir()
    const result = await Effect.runPromise(smokeKimi({ HOME: dir.path, KIMI_SHARE_DIR: dir.path }))
    expect(result).toBe("skipped")
  })
})
