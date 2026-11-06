import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import { ServerProcess } from "../src/process"
import { it } from "../../core/test/lib/effect"

const startWithContent = Effect.fnUntraced(function* (content: string) {
  const server = yield* ServerProcess.start<never, never>({
    hostname: "127.0.0.1",
    port: 0,
    password: "secret",
    app: { version: "test-version" },
    database: { path: ":memory:" },
    config: { content },
    fs: { filewatcher: false },
    models: { fetch: false },
  })
  return {
    base: HttpServer.formatAddress(server.address),
    headers: { authorization: `Basic ${btoa("opencode:secret")}` },
  }
})

const withKimiSession = Effect.fnUntraced(function* () {
  const dir = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-kimi-")))
  const creds = path.join(dir, "credentials")
  yield* Effect.promise(() => fs.mkdir(creds, { recursive: true }))
  yield* Effect.promise(() =>
    fs.writeFile(path.join(creds, "kimi-code.json"), JSON.stringify({ access_token: "sentinel-token" })),
  )
  const previous = process.env.KIMI_SHARE_DIR
  process.env.KIMI_SHARE_DIR = dir
  return {
    dir,
    restore: Effect.sync(() => {
      if (previous === undefined) delete process.env.KIMI_SHARE_DIR
      else process.env.KIMI_SHARE_DIR = previous
    }),
  }
})

it.live("exposes kimi-for-coding when the flag is on and a session is ready", () =>
  Effect.gen(function* () {
    const session = yield* withKimiSession()
    yield* Effect.gen(function* () {
      const server = yield* startWithContent(JSON.stringify({ subscription_auth: { enabled: true } }))
      const response = yield* Effect.promise(() =>
        fetch(new URL("/api/provider", server.base), { headers: server.headers }),
      )
      const body: { data: { id: string }[] } = yield* Effect.promise(() => response.json())
      expect(response.status).toBe(200)
      const kimi = body.data.find((provider) => provider.id === "kimi-for-coding")
      expect(kimi?.id).toBe("kimi-for-coding")
    }).pipe(
      Effect.ensuring(session.restore),
      Effect.ensuring(Effect.promise(() => fs.rm(session.dir, { recursive: true, force: true }))),
    )
  }),
)

it.live("hides kimi-for-coding when the flag is off", () =>
  Effect.gen(function* () {
    const session = yield* withKimiSession()
    yield* Effect.gen(function* () {
      const server = yield* startWithContent("{}")
      const response = yield* Effect.promise(() =>
        fetch(new URL("/api/provider", server.base), { headers: server.headers }),
      )
      const body: { data: { id: string }[] } = yield* Effect.promise(() => response.json())
      expect(response.status).toBe(200)
      expect(body.data.find((provider) => provider.id === "kimi-for-coding")).toBeUndefined()
    }).pipe(
      Effect.ensuring(session.restore),
      Effect.ensuring(Effect.promise(() => fs.rm(session.dir, { recursive: true, force: true }))),
    )
  }),
)
