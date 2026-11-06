import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { ClaudeCodeAdapter } from "@opencode/core/subscription/adapters/claude-code"
import { tmpdir } from "../fixture/tmpdir"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

const noKeychain = () => Effect.succeed({ present: false })

const runner = (versions: Record<string, number> = { claude: 0 }) => (command: string) =>
  Effect.succeed({ exitCode: versions[command] ?? 0, stdout: "", stderr: "" })

describe("ClaudeCodeAdapter", () => {
  test("login returns already_authenticated when a session is present", async () => {
    await using dir = await tmpdir()
    await fs.mkdir(path.join(dir.path, ".claude"), { recursive: true })
    await fs.writeFile(path.join(dir.path, ".claude", ".credentials.json"), "{}")
    const adapter = ClaudeCodeAdapter.make(runner(), noKeychain)
    const result = await run(adapter.login({ source: "native", env: { HOME: dir.path } }))
    expect(result.status).toBe("already_authenticated")
  })

  test("login fails with cli_missing when the claude binary is absent", async () => {
    await using dir = await tmpdir()
    const adapter = ClaudeCodeAdapter.make(runner({ claude: 1 }), noKeychain)
    const result = await run(adapter.login({ source: "native", env: { HOME: dir.path } }))
    expect(result.status).toBe("error")
    if (result.status === "error") expect(result.code).toBe("cli_missing")
  })

  test("report detects the native session without a token", async () => {
    await using dir = await tmpdir()
    await fs.mkdir(path.join(dir.path, ".claude"), { recursive: true })
    await fs.writeFile(
      path.join(dir.path, ".claude", ".credentials.json"),
      JSON.stringify({ accessToken: "SENTINEL_DO_NOT_LEAK" }),
    )
    const adapter = ClaudeCodeAdapter.make(undefined, noKeychain)
    const report = await run(adapter.report({ HOME: dir.path }))
    expect(report.present).toBe(true)
    expect(JSON.stringify(report)).not.toContain("SENTINEL_DO_NOT_LEAK")
  })

  test("declares native and api_key sources", async () => {
    const adapter = ClaudeCodeAdapter.make()
    const sources = await run(adapter.sources({}))
    expect(sources.map((source) => source.kind)).toEqual(["native", "api_key"])
    expect(adapter.transport.provider).toBe("claude-agent")
  })
})
