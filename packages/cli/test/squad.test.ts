import { describe, expect, test } from "bun:test"
import { ServerProcess } from "@opencode/server/process"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import fs from "node:fs/promises"
import os from "node:os"
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

const serverOptions = (enabled: boolean) => ({
  hostname: "127.0.0.1" as const,
  port: 0,
  password: "secret",
  database: { path: ":memory:" as const },
  ...(enabled ? { config: { content: JSON.stringify({ squad: { enabled: true } }) } } : {}),
  models: { fetch: false },
  fs: { filewatcher: false },
  fetch: noNetwork,
})

async function squadConfig(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "squad-config-"))
  const file = path.join(dir, "squad.json")
  await fs.writeFile(
    file,
    JSON.stringify({
      sessions: [
        { name: "ATLAS", role: "worker", provider: "deepseek", model: "deepseek-flash", location: { directory: "/squad/atlas" } },
      ],
    }),
  )
  return file
}

describe("squad command", () => {
  test("squad --help lists the init subcommand", async () => {
    const result = await cli(["squad", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("init")
  })

  test("squad init --help shows the init flags", async () => {
    const result = await cli(["squad", "init", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("squad init")
    expect(result.stdout).toContain("--generation")
    expect(result.stdout).toContain("--config")
    expect(result.stdout).toContain("--json")
  })

  it.live("init fails with the disabled-flag message when squad.enabled is false", () =>
    Effect.gen(function* () {
      const server = yield* ServerProcess.start<never, never>(serverOptions(false))
      const url = HttpServer.formatAddress(server.address)
      const config = yield* Effect.promise(() => squadConfig())
      const result = yield* Effect.promise(() =>
        cli(["squad", "init", "--generation", "gen-1", "--config", config, "--server", url], {
          OPENCODE_PASSWORD: "secret",
        }),
      )
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("squad.enabled is false")
    }),
  )

  it.live("--json reports errors as {error:{code,message,details}}", () =>
    Effect.gen(function* () {
      const server = yield* ServerProcess.start<never, never>(serverOptions(false))
      const url = HttpServer.formatAddress(server.address)
      const config = yield* Effect.promise(() => squadConfig())
      const result = yield* Effect.promise(() =>
        cli(["squad", "init", "--generation", "gen-1", "--config", config, "--json", "--server", url], {
          OPENCODE_PASSWORD: "secret",
        }),
      )
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toContain('"error"')
      const parsed = JSON.parse(result.stdout) as { error: { code: string; message: string; details: unknown } }
      expect(parsed.error.code).toBe("ForbiddenError")
      expect(parsed.error.message).toContain("squad.enabled is false")
      expect(parsed.error).toHaveProperty("details")
    }),
  )
})
