import { describe, expect, test } from "bun:test"
import { ServerProcess } from "@opencode/server/process"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import path from "node:path"
import { it } from "../../core/test/lib/effect"

const cliDir = path.join(import.meta.dir, "..")

async function cli(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: cliDir,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

const noNetwork = Object.assign(
  (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    return Promise.reject(new Error(`no network in test: ${url}`))
  },
  { preconnect: fetch.preconnect },
)

const serverOptions = {
  hostname: "127.0.0.1" as const,
  port: 0,
  password: "secret",
  database: { path: ":memory:" as const },
  models: { fetch: false },
  fs: { filewatcher: false },
  fetch: noNetwork,
}

const subcommands = ["init", "check", "plan", "broadcast", "status", "session", "block", "launch", "audit", "close", "transition", "activate", "checkpoint", "send", "dispatch", "panel", "release"]

describe("squad regression", () => {
  test("squad subcommands stay discoverable in the help without the flag", async () => {
    const result = await cli(["squad", "--help"])
    expect(result.exitCode).toBe(0)
    expect(subcommands.filter((name) => !new RegExp(`^  ${name}\\s`, "mu").test(result.stdout))).toEqual([])
  })

  test("queue and auth keep their command surface", async () => {
    const queue = await cli(["queue", "--help"])
    expect(queue.exitCode).toBe(0)
    for (const flag of ["--thread", "--to", "--all", "--message", "--delivery", "--idempotency-key"])
      expect(queue.stdout).toContain(flag)
    const auth = await cli(["auth", "--help"])
    expect(auth.exitCode).toBe(0)
    expect(auth.stdout).toContain("login")
  })

  it.live("read-only squad commands fail with the actionable flag message when squad.enabled is absent", () =>
    Effect.gen(function* () {
      const server = yield* ServerProcess.start<never, never>(serverOptions)
      const url = HttpServer.formatAddress(server.address)
      const results = yield* Effect.promise(() =>
        Promise.all(
          [["status"], ["check"], ["plan"], ["panel", "build"]].map((name) =>
            cli(["squad", ...name, "--server", url], { OPENCODE_PASSWORD: "secret" }),
          ),
        ),
      )
      for (const result of results) {
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain("squad.enabled is false")
      }
    }),
  )
})
