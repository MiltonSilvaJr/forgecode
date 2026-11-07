import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import type { SessionInboxUser } from "@opencode/client/promise"
import { enqueueAll } from "../src/queue/enqueue"
import type { AuditLine } from "../src/queue/audit"

const client = () => OpenCode.make({ baseUrl: "https://opencode.test" })

function inbox(id: string): SessionInboxUser {
  return { id, sessionID: "ses_a", time: { created: 1 }, type: "user", payload: { text: "hi" }, delivery: "queue" }
}

const targets = [
  { sessionID: "ses_a", target: "A" },
  { sessionID: "ses_b", target: "B" },
  { sessionID: "ses_c", target: "C" },
]

const input = (overrides: Partial<Parameters<typeof enqueueAll>[1]> = {}) => ({
  targets,
  text: "hi",
  delivery: "queue" as const,
  idempotencyKey: "k",
  allowSelf: false,
  serverUrl: "https://opencode.test",
  audit: { append: async () => true },
  ...overrides,
})

afterEach(() => {
  mock.restore()
  delete process.env.OPENCODE_SESSION_ID
})

describe("queue broadcast", () => {
  test("excludes the calling session before any admission", async () => {
    process.env.OPENCODE_SESSION_ID = "ses_b"
    const c = client()
    const prompt = spyOn(c.session, "prompt").mockResolvedValue(inbox("msg_fq_k"))
    const results = await enqueueAll(c, input())
    expect(results.map((r) => r.sessionID)).toEqual(["ses_a", "ses_c"])
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  test("includes the calling session with --allow-self", async () => {
    process.env.OPENCODE_SESSION_ID = "ses_b"
    const c = client()
    const prompt = spyOn(c.session, "prompt").mockResolvedValue(inbox("msg_fq_k"))
    await enqueueAll(c, input({ allowSelf: true }))
    expect(prompt).toHaveBeenCalledTimes(3)
  })

  test("keeps queued and failed results without rolling back", async () => {
    const c = client()
    spyOn(c.session, "prompt")
      .mockResolvedValueOnce(inbox("msg_fq_k"))
      .mockRejectedValueOnce(Object.assign(new Error("x"), { _tag: "SessionNotFoundError", name: "SessionNotFoundError" }))
      .mockResolvedValueOnce(inbox("msg_fq_k"))
    const results = await enqueueAll(c, input())
    expect(results.map((r) => r.status)).toEqual(["queued", "failed", "queued"])
  })

  test("writes one audit line per destination, including failures", async () => {
    const c = client()
    spyOn(c.session, "prompt")
      .mockResolvedValueOnce(inbox("msg_fq_k"))
      .mockRejectedValueOnce(Object.assign(new Error("x"), { _tag: "SessionNotFoundError", name: "SessionNotFoundError" }))
      .mockResolvedValueOnce(inbox("msg_fq_k"))
    const lines: AuditLine[] = []
    await enqueueAll(c, input({ audit: { append: async (line) => (lines.push(line), true) } }))
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.result)).toEqual(["queued", "failed", "queued"])
  })

  test("derives the same id per key, one item per session", async () => {
    const c = client()
    const prompt = spyOn(c.session, "prompt").mockResolvedValue(inbox("msg_fq_k"))
    await enqueueAll(c, input({ idempotencyKey: "k" }))
    expect(prompt).toHaveBeenCalledTimes(3)
    for (const call of prompt.mock.calls) expect(call[0].id).toBe("msg_fq_k")
  })
})
