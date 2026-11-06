import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

describe("auth refresh command", () => {
  test("surfaces the refresh_failed code", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/refresh" && request.method === "POST") {
        return Response.json(
          { _tag: "SubscriptionError", code: "refresh_failed", message: "the provider rejected the refresh" },
          { status: 400 },
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "refresh", "kimi-code", "--server", server.url.toString()])
    expect(result.exitCode).toBe(1)
    expect(codeOf(result.stderr)).toBe("refresh_failed")
    expect(result.stderr).toContain("the provider rejected the refresh")
  })

  test("reports a renewed native session", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/refresh" && request.method === "POST") {
        return Response.json(located({ state: "ready", expiresAt: 1700000000000 }))
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "refresh", "kimi-code", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("ready")
  })

  test("surfaces the session_expired code with the official login command", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/refresh" && request.method === "POST") {
        return Response.json(
          { _tag: "SubscriptionError", code: "session_expired", message: "Run forgecode auth login kimi-code." },
          { status: 400 },
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "refresh", "kimi-code", "--server", server.url.toString()])
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
