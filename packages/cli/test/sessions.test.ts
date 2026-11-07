import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import type { SessionInfo } from "@opencode/client/promise"
import { listSessions, sessionRow } from "../src/commands/handlers/sessions"

const client = () => OpenCode.make({ baseUrl: "https://opencode.test" })

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "ses_a",
    projectID: "project",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    location: { directory: "/project" },
    ...overrides,
  }
}

afterEach(() => mock.restore())

describe("sessions command", () => {
  test("maps title, model, directory and idle status", () => {
    const row = sessionRow(
      session({ title: "ORQUESTRADORA", model: { providerID: "openai", id: "gpt-5" }, time: { created: 1, updated: 1, idle: 1000 } }),
    )
    expect(row).toEqual({
      id: "ses_a",
      title: "ORQUESTRADORA",
      model: "openai/gpt-5",
      directory: "/project",
      status: "idle",
    })
  })

  test("falls back to - for a missing title and model", () => {
    const row = sessionRow(session())
    expect(row).toMatchObject({ title: "-", model: "-" })
  })

  test("derives busy and archived status", () => {
    expect(sessionRow(session({ time: { created: 1, updated: 1, busy: 2000, idle: 1000 } })).status).toBe("busy")
    expect(sessionRow(session({ time: { created: 1, updated: 1, archived: 5 } })).status).toBe("archived")
  })

  test("lists top-level sessions following the cursor", async () => {
    const c = client()
    const list = spyOn(c.session, "list")
      .mockResolvedValueOnce({ data: [session({ id: "ses_1" })], cursor: { next: "page_2" } })
      .mockResolvedValueOnce({ data: [session({ id: "ses_2" })], cursor: {} })

    const sessions = await listSessions(c, { project: "project" })
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "page_2" }))
    expect(sessions.map((s) => s.id)).toEqual(["ses_1", "ses_2"])
  })
})
