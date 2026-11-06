import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

describe("auth status command", () => {
  test("reports subscription auth disabled by default as JSON", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/status") {
        return Response.json(
          located({
            enabled: false,
            providers: [
              { id: "claude-code", state: "disabled", transport: "claude-agent" },
              { id: "codex-chatgpt", state: "disabled", transport: "openai" },
              { id: "kimi-code", state: "disabled", transport: "kimi-for-coding" },
            ],
          }),
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "status", "--json", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    const parsed = JSON.parse(result.stdout)
    expect(parsed.enabled).toBe(false)
    expect(parsed.providers).toHaveLength(3)
  })

  test("reports provider source, state and consent in JSON", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/status") {
        return Response.json(
          located({
            enabled: true,
            providers: [
              {
                id: "kimi-code",
                state: "ready",
                source: "native",
                expiresAt: 1700000000000,
                accountLabel: "user@example.com",
                consent: "acknowledged",
                transport: "kimi-for-coding",
              },
            ],
          }),
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "status", "--json", "--server", server.url.toString()])
    expect(result.exitCode).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.enabled).toBe(true)
    expect(parsed.providers[0].source).toBe("native")
    expect(parsed.providers[0].state).toBe("ready")
    expect(parsed.providers[0].consent).toBe("acknowledged")
  })

  test("prints one line per provider in text mode", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/status") {
        return Response.json(
          located({
            enabled: true,
            providers: [
              { id: "claude-code", state: "ready", source: "native", transport: "claude-agent" },
              { id: "codex-chatgpt", state: "missing", transport: "openai" },
              { id: "kimi-code", state: "ready", source: "native", transport: "kimi-for-coding" },
            ],
          }),
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "status", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("claude-code")
    expect(result.stdout).toContain("codex-chatgpt")
    expect(result.stdout).toContain("kimi-code")
  })

  test("rejects an unknown provider filter", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/status") {
        return Response.json(
          located({
            enabled: true,
            providers: [
              { id: "claude-code", state: "ready", source: "native", transport: "claude-agent" },
            ],
          }),
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "status", "--provider", "grok", "--server", server.url.toString()])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("provider_unsupported")
    expect(result.stderr).toContain("claude-code")
  })
})

function authServer(fetch: (request: Request, url: URL) => Response | Promise<Response>) {
  return Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info") return status()
      return fetch(request, url)
    },
  })
}

function status() {
  return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/forgecode" } })
}

function located<T>(data: T) {
  return {
    location: {
      directory: process.cwd(),
      project: { id: "project", directory: process.cwd(), canonical: process.cwd() },
    },
    data,
  }
}

async function cli(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
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
