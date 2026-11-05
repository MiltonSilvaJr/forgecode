import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

describe("auth login subscription command", () => {
  test("requires --accept-tos for a subscription login without consent", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/codex-chatgpt/login" && request.method === "POST") {
        return Response.json(
          { _tag: "SubscriptionError", code: "consent_required", message: "Accept the terms of use first" },
          { status: 400 },
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli([
      "auth", "login", "codex-chatgpt", "--source", "native", "--server", server.url.toString(),
    ])
    expect(result.exitCode).toBe(1)
    expect(codeOf(result.stderr)).toBe("consent_required")
  })

  test("forwards --source and --accept-tos to the subscription login route", async () => {
    const bodies: unknown[] = []
    using server = authServer(async (request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/login" && request.method === "POST") {
        bodies.push(await request.json())
        return Response.json(located({ status: "already_authenticated" }))
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli([
      "auth", "login", "kimi-code", "--source", "native", "--accept-tos", "--server", server.url.toString(),
    ])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(bodies).toEqual([{ source: "native", accept: true }])
    expect(result.stdout).toContain("already_authenticated")
  })

  test("prints the authorization URL for a started device flow", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/kimi-code/login" && request.method === "POST") {
        return Response.json(
          located({ status: "started", url: "https://kimi.ai/device", instructions: "Enter code: ABC-DEFG" }),
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli([
      "auth", "login", "kimi-code", "--source", "native", "--accept-tos", "--server", server.url.toString(),
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("https://kimi.ai/device")
  })

  test("surfaces transport_unavailable for a managed source without OAuth", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/claude-code/login" && request.method === "POST") {
        return Response.json(
          { _tag: "SubscriptionError", code: "transport_unavailable", message: "claude-code has no managed OAuth" },
          { status: 400 },
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli([
      "auth", "login", "claude-code", "--source", "managed", "--accept-tos", "--server", server.url.toString(),
    ])
    expect(result.exitCode).toBe(1)
    expect(codeOf(result.stderr)).toBe("transport_unavailable")
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
  return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/opencode" } })
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
