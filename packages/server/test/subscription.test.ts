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

it.live("reports the subscription flag disabled by default", () =>
  Effect.gen(function* () {
    const server = yield* startWithContent("{}")
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/subscription/status", server.base), { headers: server.headers }),
    )
    const body: { data: { enabled: boolean; providers: unknown[] } } = yield* Effect.promise(() => response.json())
    expect(response.status).toBe(200)
    expect(body.data.enabled).toBe(false)
    expect(body.data.providers).toHaveLength(3)
  }),
)

it.live("rejects a login without terms acceptance", () =>
  Effect.gen(function* () {
    const server = yield* startWithContent(JSON.stringify({ subscription_auth: { enabled: true } }))
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/subscription/kimi-code/login", server.base), {
        method: "POST",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ source: "native", accept: false }),
      }),
    )
    const body: { _tag: string; code: string } = yield* Effect.promise(() => response.json())
    expect(response.status).toBe(400)
    expect(body.code).toBe("consent_required")
  }),
)

it.live("rejects refresh without terms acceptance", () =>
  Effect.gen(function* () {
    const server = yield* startWithContent(JSON.stringify({ subscription_auth: { enabled: true } }))
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/subscription/kimi-code/refresh", server.base), {
        method: "POST",
        headers: server.headers,
      }),
    )
    const body: { _tag: string; code: string } = yield* Effect.promise(() => response.json())
    expect(response.status).toBe(400)
    expect(body.code).toBe("consent_required")
  }),
)

it.live("returns session_expired when refreshing an unready native session", () =>
  Effect.gen(function* () {
    const home = os.homedir()
    const creds = path.join(home, ".kimi-code", "credentials")
    yield* Effect.promise(() => fs.mkdir(creds, { recursive: true }))
    yield* Effect.promise(() =>
      fs.writeFile(path.join(creds, "kimi-code.json"), JSON.stringify({ refresh_token: "refresh" })),
    )
    const server = yield* startWithContent(JSON.stringify({ subscription_auth: { enabled: true } }))
    const consent = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/subscription/kimi-code/consent", server.base), {
        method: "POST",
        headers: { ...server.headers, "content-type": "application/json" },
        body: JSON.stringify({ accept: true }),
      }),
    )
    expect(consent.status).toBe(204)
    const response = yield* Effect.promise(() =>
      fetch(new URL("/api/experimental/subscription/kimi-code/refresh", server.base), {
        method: "POST",
        headers: server.headers,
      }),
    )
    const body: { _tag: string; code: string } = yield* Effect.promise(() => response.json())
    expect(response.status).toBe(400)
    expect(body.code).toBe("session_expired")
  }),
)
