import { describe, expect, test } from "bun:test"
import { ServerProcess } from "@opencode/server/process"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it } from "../../core/test/lib/effect"
import { formatEnqueue, readMessageFile } from "../src/commands/squad"

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

  it.live("--json reports errors as {error:{code,message,details}}; audit export writes its file", () =>
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

      // The audit export writes the lines to --out and prints the chain digest.
      const enabledServer = yield* ServerProcess.start<never, never>(serverOptions(true))
      const enabledUrl = HttpServer.formatAddress(enabledServer.address)
      const dir = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "squad-audit-")))
      const out = path.join(dir, "audit.jsonl")
      const exported = yield* Effect.promise(() =>
        cli(["squad", "audit", "export", "--out", out, "--json", "--server", enabledUrl], { OPENCODE_PASSWORD: "secret" }),
      )
      expect(exported.exitCode).toBe(0)
      const summary = JSON.parse(exported.stdout) as { lines: number; digest: string; integrity: string }
      expect(summary.integrity).toBe("integrity_ok")
      expect(summary.digest).toMatch(/^[0-9a-f]{64}$/u)
      expect(yield* Effect.promise(() => fs.readFile(out, "utf8"))).toBe("")
    }),
  )

  test("squad send --help shows the send flags", async () => {
    const result = await cli(["squad", "send", "--help"])
    expect(result.exitCode).toBe(0)
    for (const flag of ["--to", "--session-id", "--message-file", "--delivery", "--idempotency-key", "--allow-self"])
      expect(result.stdout).toContain(flag)
  })

  test("squad broadcast --help shows the broadcast flags", async () => {
    const result = await cli(["squad", "broadcast", "--help"])
    expect(result.exitCode).toBe(0)
    for (const flag of ["--message-file", "--include-self", "--idempotency-key", "--json"])
      expect(result.stdout).toContain(flag)
  })

  test("broadcast fails on a missing message file before reaching the server", async () => {
    const result = await cli(["squad", "broadcast", "--message-file", "/nonexistent/message.txt"])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("cannot read message file")
  })

  test("squad audit export --help shows the export flags", async () => {
    const result = await cli(["squad", "audit", "export", "--help"])
    expect(result.exitCode).toBe(0)
    for (const flag of ["--since", "--out", "--json"]) expect(result.stdout).toContain(flag)
  })

  test("squad launch --help shows the launch flags", async () => {
    const result = await cli(["squad", "launch", "--help"])
    expect(result.exitCode).toBe(0)
    for (const flag of ["--only", "--retry", "--reason", "--adopt", "--timeout", "--json"])
      expect(result.stdout).toContain(flag)
  })

  test("launch --retry without --reason is a usage error before reaching the server", async () => {
    const result = await cli(["squad", "launch", "--retry"])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("--reason")
  })

  test("send rejects an invalid delivery before any effect", async () => {
    const result = await cli(["squad", "send", "--to", "ATLAS", "--message-file", "/nonexistent", "--delivery", "now"])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("invalid delivery")
  })

  test("send fails on a missing message file before reaching the server", async () => {
    const result = await cli(["squad", "send", "--to", "ATLAS", "--message-file", "/nonexistent/message.txt"])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("cannot read message file")
  })

  test("readMessageFile rejects an empty file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "squad-msg-"))
    const file = path.join(dir, "empty.txt")
    await fs.writeFile(file, "  \n")
    expect(await readMessageFile(file)).toEqual({ ok: false, error: "message file is empty" })
  })

  test("the enqueue output states acceptance and never claims reading or completion", () => {
    const output = formatEnqueue({ messageID: "msg_1", name: "ATLAS", sessionID: "ses_1", delivery: "queue", at: 0 })
    expect(output).toContain("Queued message msg_1")
    for (const word of ["lida", "processada", "concluída", "read", "processed", "completed"])
      expect(output.toLowerCase()).not.toContain(word)
  })
})
