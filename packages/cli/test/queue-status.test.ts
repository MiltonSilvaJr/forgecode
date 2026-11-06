import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import type { SessionInboxInfo } from "@opencode/client/promise"
import { ClientError } from "@opencode/client/promise"
import type { AuditLine } from "../src/queue/audit"
import { listQueueItems } from "../src/queue/status"

const client = () => OpenCode.make({ baseUrl: "https://opencode.test" })

function inboxItem(id: string, created = 1000): SessionInboxInfo {
  return { id, sessionID: "ses_a", time: { created }, type: "user", payload: { text: "hi" }, delivery: "queue" }
}

function line(overrides: Partial<AuditLine> = {}): AuditLine {
  return {
    schema_version: 1,
    timestamp: "2026-11-04T12:00:00.000Z",
    command: "queue",
    target: "ORQUESTRADORA",
    sessionID: "ses_a",
    messageID: "msg_1",
    delivery: "queue",
    idempotencyKey: "k",
    result: "queued",
    error: null,
    ...overrides,
  }
}

const readAudit = (lines: AuditLine[]) => async () => lines

const input = (overrides: Partial<Parameters<typeof listQueueItems>[1]> = {}) => ({
  sessionID: "ses_a",
  readAudit: readAudit([]),
  limit: 100,
  ...overrides,
})

afterEach(() => mock.restore())

describe("queue status", () => {
  test("reports an inbox item as pending", async () => {
    const c = client()
    spyOn(c.session.inbox, "list").mockResolvedValue([inboxItem("msg_1")])
    const items = await listQueueItems(c, input())
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: "msg_1", state: "pending" })
  })

  test("reports a delivered item when the projected message exists", async () => {
    const c = client()
    spyOn(c.session.inbox, "list").mockResolvedValue([])
    spyOn(c.session.message, "get").mockResolvedValue({ id: "msg_2", type: "user" } as never)
    const items = await listQueueItems(c, input({ readAudit: readAudit([line({ messageID: "msg_2" })]) }))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: "msg_2", state: "delivered" })
  })

  test("reports a cancelled item when the message is gone", async () => {
    const c = client()
    spyOn(c.session.inbox, "list").mockResolvedValue([])
    spyOn(c.session.message, "get").mockRejectedValue(
      Object.assign(new Error("gone"), { _tag: "MessageNotFoundError", name: "MessageNotFoundError" }),
    )
    const items = await listQueueItems(c, input({ readAudit: readAudit([line({ messageID: "msg_3" })]) }))
    expect(items[0]).toMatchObject({ id: "msg_3", state: "cancelled" })
  })

  test("reports unknown when the proof fails by transport, never delivered", async () => {
    const c = client()
    spyOn(c.session.inbox, "list").mockResolvedValue([])
    spyOn(c.session.message, "get").mockRejectedValue(new ClientError("Transport", { cause: new Error("down") }))
    const items = await listQueueItems(c, input({ readAudit: readAudit([line({ messageID: "msg_4" })]) }))
    expect(items[0]).toMatchObject({ id: "msg_4", state: "unknown" })
  })

  test("shows a pending item created outside the CLI with an empty target", async () => {
    const c = client()
    spyOn(c.session.inbox, "list").mockResolvedValue([inboxItem("msg_5")])
    const items = await listQueueItems(c, input())
    expect(items[0].target).toBeNull()
  })

  test("limits message proofs to --limit", async () => {
    const c = client()
    spyOn(c.session.inbox, "list").mockResolvedValue([])
    const get = spyOn(c.session.message, "get").mockResolvedValue({ id: "x", type: "user" } as never)
    const lines = Array.from({ length: 20 }, (_, i) => line({ messageID: `msg_${i}` }))
    const items = await listQueueItems(c, input({ readAudit: readAudit(lines), limit: 5 }))
    expect(items).toHaveLength(5)
    expect(get).toHaveBeenCalledTimes(5)
  })
})
