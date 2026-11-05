import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { OpenCode } from "@opencode/client/promise"
import { resolveByName } from "../src/queue/target"

function session(id: string, title: string, directory: string): SessionInfo {
  return {
    id,
    projectID: "project",
    title,
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
  }
}

const client = () => OpenCode.make({ baseUrl: "https://opencode.test" })

afterEach(() => mock.restore())

describe("queue target resolver", () => {
  test("resolves the single active session with an exact title match", async () => {
    const c = client()
    const selected = session("ses_a", "ORQUESTRADORA", "/project")
    spyOn(c.session, "list").mockResolvedValue({ data: [selected], cursor: {} })

    const result = await resolveByName({ client: c, project: "project", name: "ORQUESTRADORA" })
    expect(result).toMatchObject({ type: "found", session: { id: "ses_a" } })
    expect(c.session.list).toHaveBeenCalledWith(
      expect.objectContaining({ parentID: null, archived: false, search: "ORQUESTRADORA" }),
    )
  })

  test("ignores non-exact title matches returned by the server search", async () => {
    const c = client()
    const near = session("ses_a", "ORQUESTRADORA-bak", "/project")
    spyOn(c.session, "list").mockResolvedValue({ data: [near], cursor: {} })

    const result = await resolveByName({ client: c, project: "project", name: "ORQUESTRADORA" })
    expect(result.type).toBe("not-found")
  })

  test("reports ambiguity with every exact-match candidate", async () => {
    const c = client()
    const one = session("ses_a", "ORQUESTRADORA", "/one")
    const two = session("ses_b", "ORQUESTRADORA", "/two")
    spyOn(c.session, "list").mockResolvedValue({ data: [one, two], cursor: {} })

    const result = await resolveByName({ client: c, project: "project", name: "ORQUESTRADORA" })
    expect(result.type).toBe("ambiguous")
    if (result.type !== "ambiguous") return
    expect(result.sessions.map((s) => s.id).sort()).toEqual(["ses_a", "ses_b"])
  })

  test("follows cursor.next until an exact match is found", async () => {
    const c = client()
    const other = session("ses_x", "OTHER", "/other")
    const selected = session("ses_a", "ORQUESTRADORA", "/project")
    const list = spyOn(c.session, "list")
      .mockResolvedValueOnce({ data: [other], cursor: { next: "page_2" } })
      .mockResolvedValueOnce({ data: [selected], cursor: {} })

    const result = await resolveByName({ client: c, project: "project", name: "ORQUESTRADORA" })
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "page_2" }))
    expect(result).toMatchObject({ type: "found", session: { id: "ses_a" } })
  })

  test("reports previous-generation when the title exists only archived", async () => {
    const c = client()
    const archived = session("ses_old", "ORQUESTRADORA", "/old")
    const list = spyOn(c.session, "list")
      .mockResolvedValueOnce({ data: [], cursor: {} })
      .mockResolvedValueOnce({ data: [archived], cursor: {} })

    const result = await resolveByName({ client: c, project: "project", name: "ORQUESTRADORA" })
    expect(result).toMatchObject({ type: "previous-generation", session: { id: "ses_old" } })
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ archived: true }))
  })

  test("reports not-found when the title exists nowhere", async () => {
    const c = client()
    const list = spyOn(c.session, "list")
      .mockResolvedValueOnce({ data: [], cursor: {} })
      .mockResolvedValueOnce({ data: [], cursor: {} })

    const result = await resolveByName({ client: c, project: "project", name: "MISSING" })
    expect(result.type).toBe("not-found")
    expect(list).toHaveBeenCalledTimes(2)
  })

  test("reports too-many instead of not-found when the page limit is reached", async () => {
    const c = client()
    const page = { data: [session("ses_0", "OTHER", "/o")], cursor: { next: "more" } }
    spyOn(c.session, "list").mockResolvedValue(page)

    const result = await resolveByName({ client: c, project: "project", name: "ORQUESTRADORA" })
    expect(result.type).toBe("too-many")
  })
})
