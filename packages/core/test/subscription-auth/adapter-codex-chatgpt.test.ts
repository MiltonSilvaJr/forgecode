import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { CodexChatGPTAdapter } from "@opencode/core/subscription/adapters/codex-chatgpt"
import { SubscriptionNativeSession } from "@opencode/core/subscription/native-session"
import { tmpdir } from "../fixture/tmpdir"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("CodexChatGPTAdapter", () => {
  test("reports the native session as not transferable", async () => {
    await using dir = await tmpdir()
    const codex = path.join(dir.path, ".codex")
    await fs.mkdir(codex, { recursive: true })
    const idToken = `header.${Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth.chatgpt_account_id": "acct_1" }),
    ).toString("base64url")}.sig`
    await fs.writeFile(path.join(codex, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", id_token: idToken }))
    const adapter = CodexChatGPTAdapter.make()
    const report = (await run(adapter.report({ HOME: dir.path }))) as SubscriptionNativeSession.CodexReport
    expect(report.usable_by_forgecode).toBe(false)
    expect(report.accountLabel).toBe("acct_1")
  })

  test("marks a non-chatgpt auth mode as incompatible", async () => {
    await using dir = await tmpdir()
    const codex = path.join(dir.path, ".codex")
    await fs.mkdir(codex, { recursive: true })
    await fs.writeFile(path.join(codex, "auth.json"), JSON.stringify({ auth_mode: "credentials" }))
    const adapter = CodexChatGPTAdapter.make()
    const report = await run(adapter.report({ HOME: dir.path }))
    expect(report.state).toBe("incompatible")
  })

  test("managed login returns the ChatGPT OAuth path without creating a credential", async () => {
    const adapter = CodexChatGPTAdapter.make()
    const result = await run(adapter.login({ source: "managed", env: {} }))
    expect(result.status).toBe("started")
    expect(adapter.transport.provider).toBe("openai")
  })
})
