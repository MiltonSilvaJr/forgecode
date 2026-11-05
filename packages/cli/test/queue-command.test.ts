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
  ...(enabled ? { config: { content: JSON.stringify({ experimental: { forgequeue: { enabled: true } } }) } } : {}),
  models: { fetch: false },
  fs: { filewatcher: false },
  fetch: noNetwork,
})

async function createSession(url: string): Promise<{ id: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-session-"))
  const response = await fetch(`${url}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Basic ${btoa("opencode:secret")}` },
    body: JSON.stringify({ location: { directory: dir } }),
  })
  const body = (await response.json()) as { data: { id: string } }
  return { id: body.data.id }
}

describe("queue command", () => {
  test("--help lists the enqueue modes and subcommands", async () => {
    const result = await cli(["queue", "--help"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Queue a message for a session's inbox")
    for (const flag of ["--thread", "--to", "--all", "--message", "--message-file", "--delivery", "--json", "--idempotency-key"])
      expect(result.stdout).toContain(flag)
    expect(result.stdout).toContain("list")
    expect(result.stdout).toContain("activity")
  })

  test("refuses a write without --idempotency-key", async () => {
    const result = await cli(["queue", "--thread", "ses_x", "--message", "hi"])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("missing required --idempotency-key")
  })

  test("rejects mutually exclusive destination modes", async () => {
    const result = await cli(["queue", "--thread", "ses_x", "--to", "foo", "--message", "hi", "--idempotency-key", "k"])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("mutually exclusive")
  })

  test("rejects --message with --message-file", async () => {
    const result = await cli([
      "queue",
      "--thread",
      "ses_x",
      "--message",
      "hi",
      "--message-file",
      "f",
      "--idempotency-key",
      "k",
    ])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain("--message and --message-file are mutually exclusive")
  })

  test("rejects an invalid delivery value", async () => {
    const result = await cli(["queue", "--thread", "ses_x", "--message", "hi", "--idempotency-key", "k", "--delivery", "bogus"])
    expect(result.exitCode).toBe(2)
  })

  test("requires a destination", async () => {
    const result = await cli(["queue", "--message", "hi", "--idempotency-key", "k"])
    expect(result.exitCode).toBe(2)
  })

  test("fails on a missing message file", async () => {
    const result = await cli(["queue", "--thread", "ses_x", "--message-file", "/nonexistent/msg", "--idempotency-key", "k"])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("cannot read message file")
  })

  test("fails on an empty message file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-msg-"))
    const file = path.join(dir, "empty.txt")
    await fs.writeFile(file, "   ")
    const result = await cli(["queue", "--thread", "ses_x", "--message-file", file, "--idempotency-key", "k"])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("message file is empty")
  })

  it.live("rejects writes when the flag is disabled", () =>
    Effect.gen(function* () {
      const server = yield* ServerProcess.start<never, never>(serverOptions(false))
      const url = HttpServer.formatAddress(server.address)
      const result = yield* Effect.promise(() =>
        cli(["queue", "--thread", "ses_x", "--message", "hi", "--idempotency-key", "k", "--server", url], {
          OPENCODE_PASSWORD: "secret",
        }),
      )
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("ForgeQueue is disabled; set experimental.forgequeue.enabled to true in opencode.json")
    }),
  )

  it.live("queues a message and proves only enqueueing", () =>
    Effect.gen(function* () {
      const server = yield* ServerProcess.start<never, never>(serverOptions(true))
      const url = HttpServer.formatAddress(server.address)
      const session = yield* Effect.promise(() => createSession(url))
      const result = yield* Effect.promise(() =>
        cli(["queue", "--thread", session.id, "--message", "hi", "--idempotency-key", "k", "--server", url], {
          OPENCODE_PASSWORD: "secret",
        }),
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Queued message msg_fq_k for thread ${session.id}`)
      expect(result.stdout).not.toContain("delivered")
    }),
  )
})
