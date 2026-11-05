import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "@opencode/server/fetch"
import { enqueueOne } from "../src/queue/enqueue"
import { listQueueItems } from "../src/queue/status"
import type { AuditLine } from "../src/queue/audit"

const makeClient = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      (input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)),
      { preconnect: fetch.preconnect },
    ),
  })

it.live("enqueues between two sessions and keeps a single idempotent item", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      database: { path: ":memory:" },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const client = makeClient(handler)
    const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "queue-integration-")))
    const a = yield* Effect.promise(() => client.session.create({ location: { directory } }))
    const b = yield* Effect.promise(() => client.session.create({ location: { directory } }))
    const lines: AuditLine[] = []
    const audit = { append: async (line: AuditLine) => (lines.push(line), true) }
    const common = {
      text: "dispatch",
      delivery: "queue" as const,
      idempotencyKey: "k-1",
      target: "B",
      allowSelf: false,
      serverUrl: "http://opencode.local",
      audit,
    }

    const first = yield* Effect.promise(() => enqueueOne(client, { sessionID: b.id, ...common }))
    expect(first.status).toBe("queued")
    expect(first.messageID).toBe("msg_fq_k-1")

    // Repeating the same key and session reconciles to the same item.
    const again = yield* Effect.promise(() => enqueueOne(client, { sessionID: b.id, ...common }))
    expect(again.messageID).toBe(first.messageID)

    const inbox = yield* Effect.promise(() => client.session.inbox.list({ sessionID: b.id }))
    expect(inbox.map((item) => item.id).filter((id) => id === first.messageID)).toHaveLength(1)

    // A receives no read confirmation: nothing lands in A's inbox.
    const aInbox = yield* Effect.promise(() => client.session.inbox.list({ sessionID: a.id }))
    expect(aInbox).toHaveLength(0)

    // queue list classifies the admitted item as pending before it is delivered.
    const items = yield* Effect.promise(() =>
      listQueueItems(client, { sessionID: b.id, readAudit: async () => lines, limit: 100 }),
    )
    const admitted = items.find((item) => item.id === first.messageID)
    expect(admitted?.state).toBe("pending")
  }),
)
