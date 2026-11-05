import { describe, expect, test } from "bun:test"
import { resolveForgeQueueEnabled } from "../src/queue/flag"

const doc = (enabled: boolean) => ({ type: "document", info: { experimental: { forgequeue: { enabled } } } })
const directory = () => ({ type: "directory", path: "/x" })

describe("queue feature flag", () => {
  test("defaults to disabled when no document defines the key", () => {
    expect(resolveForgeQueueEnabled([])).toBe(false)
    expect(resolveForgeQueueEnabled([{ type: "document", info: {} }])).toBe(false)
  })

  test("the last document defining the key wins, including false over true", () => {
    expect(resolveForgeQueueEnabled([doc(true), doc(false)])).toBe(false)
    expect(resolveForgeQueueEnabled([doc(false), doc(true)])).toBe(true)
  })

  test("ignores directory entries and documents without the key", () => {
    expect(resolveForgeQueueEnabled([directory(), doc(true)])).toBe(true)
    expect(resolveForgeQueueEnabled([directory(), doc(false), { type: "document", info: { experimental: {} } }])).toBe(false)
  })
})
