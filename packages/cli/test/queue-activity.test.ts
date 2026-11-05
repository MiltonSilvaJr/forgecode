import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import type { SessionInfo } from "@opencode/client/promise"
import { snapshotActivity, watchActivity, type ActivityEvent } from "../src/queue/activity"

const client = () => OpenCode.make({ baseUrl: "https://opencode.test" })

function session(time: Partial<SessionInfo["time"]> = {}, outcome?: SessionInfo["outcome"]): SessionInfo {
  return {
    id: "ses_a",
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1, ...time },
    ...(outcome ? { outcome } : {}),
    location: { directory: "/x" },
  }
}

function events(...list: ActivityEvent[]): AsyncIterable<ActivityEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of list) yield event
    },
  }
}

function hangingEvents(): AsyncIterable<ActivityEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      await new Promise(() => {})
      yield { type: "unreachable", created: 0 }
    },
  }
}

afterEach(() => mock.restore())

describe("queue activity", () => {
  test("derives busy from time.busy greater than time.idle", async () => {
    const c = client()
    spyOn(c.session, "get").mockResolvedValue(session({ busy: 2000, idle: 1000 }, "succeeded"))
    spyOn(c.session.message, "list").mockResolvedValue({ data: [], cursor: {} })
    spyOn(c.session.inbox, "list").mockResolvedValue([])
    const snapshot = await snapshotActivity(c, { sessionID: "ses_a" })
    expect(snapshot).toMatchObject({ state: "busy", outcome: "succeeded", pendingCount: 0 })
  })

  test("derives idle when time.idle exists without a newer busy", async () => {
    const c = client()
    spyOn(c.session, "get").mockResolvedValue(session({ idle: 1000 }))
    spyOn(c.session.message, "list").mockResolvedValue({ data: [], cursor: {} })
    spyOn(c.session.inbox, "list").mockResolvedValue([])
    expect((await snapshotActivity(c, { sessionID: "ses_a" })).state).toBe("idle")
  })

  test("derives unknown when neither busy nor idle exists", async () => {
    const c = client()
    spyOn(c.session, "get").mockResolvedValue(session())
    spyOn(c.session.message, "list").mockResolvedValue({ data: [], cursor: {} })
    spyOn(c.session.inbox, "list").mockResolvedValue([])
    expect((await snapshotActivity(c, { sessionID: "ses_a" })).state).toBe("unknown")
  })

  test("reports lastMessageAt from the newest message and a null outcome", async () => {
    const c = client()
    spyOn(c.session, "get").mockResolvedValue(session({ idle: 1000 }))
    spyOn(c.session.message, "list").mockResolvedValue({
      data: [{ id: "m1", time: { created: 1700000000000 }, type: "user", text: "hi" }],
      cursor: {},
    })
    spyOn(c.session.inbox, "list").mockResolvedValue([])
    const snapshot = await snapshotActivity(c, { sessionID: "ses_a" })
    expect(snapshot.lastMessageAt).toBe(new Date(1700000000000).toISOString())
    expect(snapshot.outcome).toBeNull()
  })

  test("watch returns the first event for the target session", async () => {
    const result = await watchActivity({
      events: events(
        { type: "session.inbox.delivered", created: 1, data: { sessionID: "ses_other" } },
        { type: "session.execution.started", created: 2, data: { sessionID: "ses_a" } },
      ),
      sessionID: "ses_a",
      timeoutMs: 1000,
    })
    expect(result).toEqual({ type: "session.execution.started", created: 2 })
  })

  test("watch times out when no event matches", async () => {
    const result = await watchActivity({ events: hangingEvents(), sessionID: "ses_a", timeoutMs: 20 })
    expect(result).toBeNull()
  })
})
