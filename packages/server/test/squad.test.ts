import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

const make = (content?: string) =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-squad-api-")).path
    const global = path.join(dir, "global")
    yield* Effect.promise(() => fs.mkdir(global, { recursive: true }))
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: global, project: false, claude: false, content },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    return client(handler)
  })

const generation = {
  generation: "gen-1",
  sessions: [
    { name: "ATLAS", role: "worker" as const, provider: "deepseek", model: "deepseek-flash", variant: "high", location: { directory: "/squad/atlas" } },
  ],
}

it.live("forbids squad routes when the flag is off", () =>
  Effect.gen(function* () {
    const api = yield* make()
    yield* Effect.promise(async () => {
      await expect(api.experimental.squad.generation.create(generation)).rejects.toMatchObject({ _tag: "ForbiddenError" })
      await expect(api.experimental.squad.session.list()).rejects.toMatchObject({ _tag: "ForbiddenError" })
      await expect(api.experimental.squad.session.send({ sessionRef: "GHOST", text: "go" })).rejects.toMatchObject({
        _tag: "ForbiddenError",
      })
      await expect(api.experimental.squad.audit()).rejects.toMatchObject({ _tag: "ForbiddenError" })
      await expect(api.experimental.squad.broadcast({ text: "go" })).rejects.toMatchObject({ _tag: "ForbiddenError" })
      await expect(api.experimental.squad.session.launch({ sessionRef: "GHOST" })).rejects.toMatchObject({
        _tag: "ForbiddenError",
      })
      await expect(api.experimental.squad.liveness()).rejects.toMatchObject({ _tag: "ForbiddenError" })
      await expect(
        api.experimental.squad.block({ name: "ATLAS", waitingOn: "human", reason: "approval" }),
      ).rejects.toMatchObject({ _tag: "ForbiddenError" })
    })
  }),
)

it.live("creates and lists a generation when the flag is on", () =>
  Effect.gen(function* () {
    const api = yield* make(JSON.stringify({ squad: { enabled: true } }))
    const created = yield* Effect.promise(() => api.experimental.squad.generation.create(generation))
    expect(created.id).toBe("gen-1")
    const listed = yield* Effect.promise(() => api.experimental.squad.session.list())
    expect(listed.generation).toBe("gen-1")
    expect(listed.sessions).toHaveLength(1)
    expect(listed.sessions[0]?.name).toBe("ATLAS")
    yield* Effect.promise(async () => {
      await expect(api.experimental.squad.session.send({ sessionRef: "GHOST", text: "go" })).rejects.toMatchObject({
        _tag: "SessionNotFoundError",
      })
      await expect(api.experimental.squad.session.launch({ sessionRef: "GHOST" })).rejects.toMatchObject({
        _tag: "SessionNotFoundError",
      })
      await expect(
        api.experimental.squad.block({ name: "ATLAS", waitingOn: "human", reason: "approval" }),
      ).rejects.toMatchObject({ _tag: "ConflictError" })
      const liveness = await api.experimental.squad.liveness()
      expect(liveness.generation).toBe("gen-1")
      expect(liveness.previous).toBeNull()
      expect(liveness.sessions.map((row) => row.name)).toEqual(["ATLAS"])
      const report = await api.experimental.squad.broadcast({ text: "go", from: "ATLAS" })
      expect(report.results).toEqual([])
      const trail = await api.experimental.squad.audit()
      expect(trail.entries.map((entry) => [entry.kind, entry.result, entry.target])).toEqual([["send", "failed", "GHOST"]])
      expect(trail.integrity).toBe("integrity_ok")
      expect(trail.digest).toMatch(/^[0-9a-f]{64}$/u)
      await expect(api.experimental.squad.audit({ since: "not-a-date" })).rejects.toMatchObject({
        _tag: "InvalidRequestError",
      })
    })
  }),
)
