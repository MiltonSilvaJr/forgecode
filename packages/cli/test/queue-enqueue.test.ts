import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import type { SessionInboxUser } from "@opencode/client/promise"
import { deriveMessageID, enqueueOne, validateIdempotencyKey, type AuditSink } from "../src/queue/enqueue"
import type { AuditLine } from "../src/queue/audit"

const client = () => OpenCode.make({ baseUrl: "https://opencode.test" })

function inbox(id: string): SessionInboxUser {
  return {
    id,
    sessionID: "ses_a",
    time: { created: 1 },
    type: "user",
    payload: { text: "hello" },
    delivery: "queue",
  }
}

function sink(lines: AuditLine[]): AuditSink {
  return { append: async (line) => (lines.push(line), true) }
}

const input = (overrides: Partial<Parameters<typeof enqueueOne>[1]> = {}) => ({
  sessionID: "ses_a",
  text: "hello",
  delivery: "queue" as const,
  idempotencyKey: "k-1",
  target: null,
  allowSelf: false,
  serverUrl: "https://opencode.test",
  audit: { append: async () => true },
  ...overrides,
})

afterEach(() => {
  mock.restore()
  delete process.env.OPENCODE_SESSION_ID
})

describe("queue enqueue", () => {
  test("derives a deterministic message id from the idempotency key", () => {
    expect(deriveMessageID("dispatch-42")).toBe("msg_fq_dispatch-42")
  })

  test("requires a valid idempotency key", () => {
    expect(validateIdempotencyKey(undefined)).toMatchObject({ ok: false, code: 2, message: "missing required --idempotency-key" })
    expect(validateIdempotencyKey("bad key!")).toMatchObject({ ok: false, code: 2, message: "invalid idempotency key" })
    expect(validateIdempotencyKey("ok-key_1.2")).toMatchObject({ ok: true, key: "ok-key_1.2" })
  })

  test("admits with delivery queue by default and the derived id", async () => {
    const c = client()
    const prompt = spyOn(c.session, "prompt").mockResolvedValue(inbox("msg_fq_k-1"))
    const result = await enqueueOne(c, input())

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledWith({
      sessionID: "ses_a",
      text: "hello",
      delivery: "queue",
      id: "msg_fq_k-1",
    })
    expect(result).toMatchObject({ status: "queued", messageID: "msg_fq_k-1", delivery: "queue" })
  })

  test("sends steer when requested", async () => {
    const c = client()
    const prompt = spyOn(c.session, "prompt").mockResolvedValue(inbox("msg_fq_k-1"))
    await enqueueOne(c, input({ delivery: "steer" }))
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ delivery: "steer" }))
  })

  test("refuses self-send by default and allows it with --allow-self", async () => {
    process.env.OPENCODE_SESSION_ID = "ses_a"
    const c = client()
    const prompt = spyOn(c.session, "prompt").mockResolvedValue(inbox("msg_fq_k-1"))

    const refused = await enqueueOne(c, input())
    expect(refused).toMatchObject({
      status: "failed",
      messageID: null,
      error: "Refusing to queue for the calling session ses_a; pass --allow-self to override",
    })
    expect(prompt).not.toHaveBeenCalled()

    const allowed = await enqueueOne(c, input({ allowSelf: true }))
    expect(allowed.status).toBe("queued")
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  test("maps a 404 to Session not found without admitting", async () => {
    const c = client()
    const lines: AuditLine[] = []
    spyOn(c.session, "prompt").mockRejectedValue(Object.assign(new Error("nope"), { _tag: "SessionNotFoundError", name: "SessionNotFoundError" }))
    const result = await enqueueOne(c, input({ audit: sink(lines) }))
    expect(result).toMatchObject({ status: "failed", messageID: null, error: "Session ses_a not found" })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ result: "failed", messageID: null, idempotencyKey: "k-1" })
  })

  test("maps a 409 to the idempotency conflict message", async () => {
    const c = client()
    spyOn(c.session, "prompt").mockRejectedValue(Object.assign(new Error("conflict"), { _tag: "ConflictError", name: "ConflictError" }))
    const result = await enqueueOne(c, input())
    expect(result.error).toBe("idempotency key k-1 is already used by another item")
  })

  test("writes one audit line per attempt, with queued or failed", async () => {
    const c = client()
    const lines: AuditLine[] = []
    spyOn(c.session, "prompt").mockResolvedValue(inbox("msg_fq_k-1"))
    await enqueueOne(c, input({ target: "ORQUESTRADORA", audit: sink(lines) }))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      schema_version: 1,
      command: "queue",
      target: "ORQUESTRADORA",
      sessionID: "ses_a",
      messageID: "msg_fq_k-1",
      delivery: "queue",
      idempotencyKey: "k-1",
      result: "queued",
      error: null,
    })
  })
})
