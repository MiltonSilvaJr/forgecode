import { expect } from "bun:test"
import { ServerProcess } from "@opencode/server/process"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import path from "node:path"
import { it } from "../../core/test/lib/effect"

const cliDir = path.join(import.meta.dir, "..")

const noNetwork = Object.assign(
  (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    return Promise.reject(new Error(`no network in test: ${url}`))
  },
  { preconnect: fetch.preconnect },
)

it.live("session list --format json keeps its pre-existing keys", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      database: { path: ":memory:" },
      models: { fetch: false },
      fs: { filewatcher: false },
      fetch: noNetwork,
    })
    const url = HttpServer.formatAddress(server.address)
    const session = yield* Effect.promise(async () => {
      const response = await fetch(`${url}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Basic ${btoa("opencode:secret")}` },
        body: JSON.stringify({ location: { directory: cliDir }, title: "ORQUESTRADORA" }),
      })
      return ((await response.json()) as { data: { id: string } }).data.id
    })
    const result = yield* Effect.promise(async () => {
      const child = Bun.spawn(
        [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "session", "list", "--format", "json", "--server", url],
        {
          cwd: cliDir,
          env: { ...process.env, OPENCODE_PASSWORD: "secret" },
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return { stdout, stderr, exitCode }
    })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toBeInstanceOf(Array)
    const [row] = JSON.parse(result.stdout)
    expect(Object.keys(row).sort()).toEqual(
      ["id", "title", "updated", "created", "projectId", "directory"].sort(),
    )
    expect(row.id).toBe(session)
    expect(row.title).toBe("ORQUESTRADORA")
  }),
)
