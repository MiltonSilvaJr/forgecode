import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

describe("auth test command", () => {
  test("reports ok and latency as JSON", async () => {
    const bodies: unknown[] = []
    using server = authServer(async (request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/test" && request.method === "POST") {
        bodies.push(await request.json())
        return Response.json(located({ ok: true, latencyMs: 7, model: "kimi-k3" }))
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "test", "kimi-code", "--json", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    const parsed = JSON.parse(result.stdout)
    expect(parsed.ok).toBe(true)
    expect(parsed.latencyMs).toBe(7)
    expect(parsed.model).toBe("kimi-k3")
  })

  test("forwards --model to the server", async () => {
    const bodies: unknown[] = []
    using server = authServer(async (request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/test" && request.method === "POST") {
        bodies.push(await request.json())
        return Response.json(located({ ok: true, latencyMs: 3 }))
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli([
      "auth", "test", "kimi-code", "--model", "kimi-k3.1-pro", "--server", server.url.toString(),
    ])
    expect(result.exitCode).toBe(0)
    expect(bodies).toEqual([{ model: "kimi-k3.1-pro" }])
  })

  test("prints a minimal text line", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/test" && request.method === "POST") {
        return Response.json(located({ ok: true, latencyMs: 11, model: "kimi-k3" }))
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "test", "kimi-code", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("ok: true")
  })

  test("surfaces the session_expired code", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/test" && request.method === "POST") {
        return Response.json(
          { _tag: "SubscriptionError", code: "session_expired", message: "Run forgecode auth login kimi-code." },
          { status: 400 },
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "test", "kimi-code", "--server", server.url.toString()])
    expect(result.exitCode).toBe(1)
    expect(codeOf(result.stderr)).toBe("session_expired")
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

function codeOf(stderr: string) {
  return stderr.trim().split(":")[0]
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
