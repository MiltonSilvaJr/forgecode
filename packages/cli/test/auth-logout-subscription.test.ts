import { describe, expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

describe("auth logout subscription command", () => {
  test("refuses to log out a native session", async () => {
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

    const result = await cli(["auth", "logout", "claude-code", "--server", server.url.toString()])
    expect(result.exitCode).toBe(1)
    expect(codeOf(result.stderr)).toBe("native_session_not_managed")
    expect(result.stderr).toContain("claude auth logout")
  })

  test("reports nothing to remove when there is no native session", async () => {
    using server = authServer((request, url) => {
      if (url.pathname === "/api/experimental/subscription/status") {
        return Response.json(
          located({
            enabled: true,
            providers: [
              { id: "kimi-code", state: "missing", transport: "kimi-for-coding" },
            ],
          }),
        )
      }
      return new Response("Not found", { status: 404 })
    })

    const result = await cli(["auth", "logout", "kimi-code", "--server", server.url.toString()])
    expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" })
    expect(result.stdout).toContain("kimi-code")
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
