import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { KimiCodeAdapter } from "@opencode/core/subscription/adapters/kimi-code"
import { tmpdir } from "../fixture/tmpdir"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("KimiCodeAdapter", () => {
  test("requires refresh when only a refresh token is present", async () => {
    await using dir = await tmpdir()
    const creds = path.join(dir.path, ".kimi-code", "credentials")
    await fs.mkdir(creds, { recursive: true })
    await fs.writeFile(path.join(creds, "kimi-code.json"), JSON.stringify({ refresh_token: "refresh" }))
    const adapter = KimiCodeAdapter.make()
    const report = await run(adapter.report({ HOME: dir.path }))
    expect(report.state).toBe("refresh_required")
  })

  test("reports ready with a full credential", async () => {
    await using dir = await tmpdir()
    const creds = path.join(dir.path, ".kimi-code", "credentials")
    await fs.mkdir(creds, { recursive: true })
    await fs.writeFile(
      path.join(creds, "kimi-code.json"),
      JSON.stringify({ access_token: "SENTINEL_DO_NOT_LEAK", refresh_token: "refresh" }),
    )
    const adapter = KimiCodeAdapter.make()
    const report = await run(adapter.report({ HOME: dir.path }))
    expect(report.state).toBe("ready")
    expect(JSON.stringify(report)).not.toContain("SENTINEL_DO_NOT_LEAK")
  })

  test("parses the device flow authorization URL and code", async () => {
    const adapter = KimiCodeAdapter.make((command) =>
      Effect.succeed({
        exitCode: 0,
        stdout: command === "kimi"
          ? "Open https://auth.kimi.com/device and enter code ABCD-1234"
          : "",
        stderr: "",
      }),
    )
    const result = await run(adapter.login({ source: "native", env: {} }))
    expect(result.status).toBe("started")
    if (result.status === "started") {
      expect(result.url).toContain("auth.kimi.com")
      expect(result.instructions).not.toContain("SENTINEL")
    }
  })

  test("declares the kimi-for-coding transport", async () => {
    const adapter = KimiCodeAdapter.make()
    expect(adapter.transport.provider).toBe("kimi-for-coding")
    expect(KimiCodeAdapter.baseURL).toBe("https://api.kimi.com/coding/v1")
  })
})
