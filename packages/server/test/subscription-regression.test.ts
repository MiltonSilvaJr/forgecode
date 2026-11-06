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

type Item = { readonly id: string }
const listIDs = (body: { data: Item[] }) => body.data.map((item) => item.id)
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n")

it.live(
  "flag-off provider and model catalogs are identical to the no-flag baseline",
  () =>
    Effect.gen(function* () {
      const baseline = yield* startWithContent("{}")
      const flagOff = yield* startWithContent(JSON.stringify({ subscription_auth: { enabled: false } }))
      const fetch = (base: { base: string; headers: Record<string, string> }, path: string) =>
        Effect.promise(async () => {
          const response = await globalThis.fetch(new URL(path, base.base), { headers: base.headers })
          return response.json() as Promise<{ data: Item[] }>
        })
      const providersMatch = sameSet(
        listIDs(yield* fetch(baseline, "/api/provider")),
        listIDs(yield* fetch(flagOff, "/api/provider")),
      )
      const modelsMatch = sameSet(
        listIDs(yield* fetch(baseline, "/api/model")),
        listIDs(yield* fetch(flagOff, "/api/model")),
      )
      const flagOffProviders = listIDs(yield* fetch(flagOff, "/api/provider"))
      const subscriptionHidden = !flagOffProviders.includes("kimi-for-coding")
      expect(providersMatch && modelsMatch && subscriptionHidden).toBe(true)
    }),
  // Two server bootstraps plus an npx MCP start: real process setup, not a slow assertion.
  20_000,
)
