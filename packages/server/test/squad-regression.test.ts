import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const make = (content?: string) =>
  Effect.gen(function* () {
    const dir = (yield* tmpdirScoped("opencode-squad-regression-")).path
    const global = path.join(dir, "global")
    yield* Effect.promise(() => fs.mkdir(global, { recursive: true }))
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: path.join(dir, "opencode.db") },
      config: { directory: global, project: false, claude: false, content },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const statuses: Array<{ path: string; status: number }> = []
    const api = OpenCode.make({
      baseUrl: "http://opencode.local",
      fetch: Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = new Request(input, init)
          const response = await handler(request)
          statuses.push({ path: new URL(request.url).pathname, status: response.status })
          return response
        },
        { preconnect: fetch.preconnect },
      ),
    })
    return { api, statuses, directory: dir }
  })

it.live("with squad.enabled absent every squad route answers 403 and session prompt and inbox keep working", () =>
  Effect.gen(function* () {
    const { api, statuses, directory } = yield* make()
    yield* Effect.promise(async () => {
      const squad = api.experimental.squad
      const calls = [
        () => squad.generation.create({ generation: "gen-1", sessions: [] }),
        () => squad.session.list(),
        () => squad.check(),
        () => squad.plan(),
        () => squad.session.send({ sessionRef: "ATLAS", text: "go" }),
        () => squad.session.launch({ sessionRef: "ATLAS" }),
        () => squad.session.replace({ sessionRef: "ATLAS", provider: "openai" }),
        () => squad.broadcast({ text: "go" }),
        () => squad.block({ name: "ATLAS", waitingOn: "human", reason: "approval" }),
        () => squad.liveness(),
        () => squad.audit(),
        () => squad.checkpoint({ name: "ATLAS", body: "x" }),
        () => squad.generation.close({ generationID: "gen-1" }),
        () => squad.transition({ from: "gen-1" }),
        () => squad.activate(),
        () => squad.dispatch.create({}),
        () => squad.dispatch.list(),
        () => squad.dispatch.accept({ orqId: "ORQ-gen-1-001" }),
        () => squad.release({ from: "A", to: "B", reason: "r" }),
        () => squad.panel(),
      ]
      for (const call of calls) await expect(call()).rejects.toMatchObject({ _tag: "ForbiddenError" })
      expect(statuses.map((entry) => entry.status)).toEqual(calls.map(() => 403))
      expect(statuses.every((entry) => entry.path.startsWith("/api/experimental/squad/"))).toBe(true)

      const session = await api.session.create({ location: { directory } })
      const queued = await api.session.prompt({ sessionID: session.id, text: "hello", delivery: "queue", resume: false })
      const pending = await api.session.inbox.list({ sessionID: session.id })
      expect(pending.map((item) => item.id)).toEqual([queued.id])
      await api.session.inbox.cancel({ sessionID: session.id, inboxID: queued.id })
      expect(await api.session.inbox.list({ sessionID: session.id })).toEqual([])
    })
  }),
)

it.live("enabling squad leaves the session inbox contract unchanged", () =>
  Effect.gen(function* () {
    const { api, directory } = yield* make(JSON.stringify({ squad: { enabled: true } }))
    yield* Effect.promise(async () => {
      expect(await api.experimental.squad.dispatch.list()).toEqual([])
      const session = await api.session.create({ location: { directory } })
      const queued = await api.session.prompt({ sessionID: session.id, text: "hello", delivery: "steer", resume: false })
      expect((await api.session.inbox.list({ sessionID: session.id })).map((item) => item.id)).toEqual([queued.id])
    })
  }),
)
