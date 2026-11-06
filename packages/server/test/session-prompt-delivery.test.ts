import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Effect } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const makeClient = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      (input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)),
      { preconnect: fetch.preconnect },
    ),
  })

it.live("session.prompt keeps steer by default and honors an explicit queue", () =>
  Effect.gen(function* () {
    const handler = yield* ServerFetch.make({
      database: { path: ":memory:" },
      models: { fetch: false },
      fs: { filewatcher: false },
    })
    const client = makeClient(handler)
    const directory = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "session-prompt-delivery-")))
    const session = yield* Effect.promise(() => client.session.create({ location: { directory } }))

    // Without delivery the item stays steer, exactly as before this change.
    const steered = yield* Effect.promise(() => client.session.prompt({ sessionID: session.id, text: "default" }))
    expect(steered.delivery).toBe("steer")

    // An explicit queue must not be overridden by the default.
    const queued = yield* Effect.promise(() =>
      client.session.prompt({ sessionID: session.id, text: "explicit", delivery: "queue" }),
    )
    expect(queued.delivery).toBe("queue")
  }),
)
