import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { SubscriptionNativeSession } from "@opencode/core/subscription/native-session"
import { tmpdir } from "../fixture/tmpdir"

const sentinel = "SENTINEL_ACCESS_TOKEN_DO_NOT_LEAK"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.runPromise(effect)

describe("SubscriptionNativeSession.claude", () => {
  test("detects the credentials file by existence, without reading it", async () => {
    await using dir = await tmpdir()
    const env = { HOME: dir.path }
    await fs.mkdir(path.join(dir.path, ".claude"), { recursive: true })
    await fs.writeFile(path.join(dir.path, ".claude", ".credentials.json"), JSON.stringify({ accessToken: sentinel }))
    const report = await run(SubscriptionNativeSession.claudePresence(env))
    expect(report.present).toBe(true)
    expect(JSON.stringify(report)).not.toContain(sentinel)
  })

  test("respects CLAUDE_CONFIG_DIR for the credentials path", async () => {
    await using dir = await tmpdir()
    const configDir = path.join(dir.path, "custom")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(path.join(configDir, ".credentials.json"), "{}")
    const report = await run(
      SubscriptionNativeSession.claudePresence({ HOME: dir.path, CLAUDE_CONFIG_DIR: configDir }),
    )
    expect(report.present).toBe(true)
  })

  test("detects an oauthAccount key in ~/.claude.json", async () => {
    await using dir = await tmpdir()
    await fs.writeFile(path.join(dir.path, ".claude.json"), JSON.stringify({ oauthAccount: "x" }))
    const report = await run(SubscriptionNativeSession.claudePresence({ HOME: dir.path }))
    expect(report.present).toBe(true)
  })

  test("reports missing without a session and no keychain item", async () => {
    await using dir = await tmpdir()
    const report = await run(
      SubscriptionNativeSession.claudePresence({ HOME: dir.path }, () => Effect.succeed({ present: false })),
    )
    expect(report.present).toBe(false)
    expect(report.detail).toBe("missing")
  })
})

describe("SubscriptionNativeSession.codex", () => {
  test("reports the native session as not transferable", async () => {
    await using dir = await tmpdir()
    const codex = path.join(dir.path, ".codex")
    await fs.mkdir(codex, { recursive: true })
    const idToken = `header.${Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth.chatgpt_account_id": "acct_123" }),
    ).toString("base64url")}.sig`
    await fs.writeFile(
      path.join(codex, "auth.json"),
      JSON.stringify({ auth_mode: "chatgpt", id_token: idToken, access_token: sentinel }),
    )
    const report = await run(SubscriptionNativeSession.codexSession({ HOME: dir.path }))
    expect(report.present).toBe(true)
    expect(report.usable_by_forgecode).toBe(false)
    expect(report.accountLabel).toBe("acct_123")
    expect(JSON.stringify(report)).not.toContain(sentinel)
    expect(JSON.stringify(report)).not.toContain("acct_123_access") // no token leak
  })

  test("marks a non-chatgpt auth mode as incompatible", async () => {
    await using dir = await tmpdir()
    const codex = path.join(dir.path, ".codex")
    await fs.mkdir(codex, { recursive: true })
    await fs.writeFile(path.join(codex, "auth.json"), JSON.stringify({ auth_mode: "credentials" }))
    const report = await run(SubscriptionNativeSession.codexSession({ HOME: dir.path }))
    expect(report.state).toBe("incompatible")
  })

  test("respects CODEX_HOME", async () => {
    await using dir = await tmpdir()
    const codexHome = path.join(dir.path, "codex-home")
    await fs.mkdir(codexHome, { recursive: true })
    await fs.writeFile(
      path.join(codexHome, "auth.json"),
      JSON.stringify({ auth_mode: "chatgpt", id_token: "h.p.s" }),
    )
    const report = await run(SubscriptionNativeSession.codexSession({ HOME: dir.path, CODEX_HOME: codexHome }))
    expect(report.present).toBe(true)
  })
})

describe("SubscriptionNativeSession.kimi", () => {
  test("reports present with a full credential", async () => {
    await using dir = await tmpdir()
    const creds = path.join(dir.path, ".kimi-code", "credentials")
    await fs.mkdir(creds, { recursive: true })
    await fs.writeFile(
      path.join(creds, "kimi-code.json"),
      JSON.stringify({ access_token: sentinel, refresh_token: "refresh" }),
    )
    const report = await run(SubscriptionNativeSession.kimiSession({ HOME: dir.path }))
    expect(report.present).toBe(true)
    expect(report.state).toBe("ready")
    expect(JSON.stringify(report)).not.toContain(sentinel)
  })

  test("requires refresh when only a refresh token is present", async () => {
    await using dir = await tmpdir()
    const creds = path.join(dir.path, ".kimi-code", "credentials")
    await fs.mkdir(creds, { recursive: true })
    await fs.writeFile(path.join(creds, "kimi-code.json"), JSON.stringify({ refresh_token: "refresh" }))
    const report = await run(SubscriptionNativeSession.kimiSession({ HOME: dir.path }))
    expect(report.present).toBe(true)
    expect(report.state).toBe("refresh_required")
  })

  test("respects KIMI_SHARE_DIR", async () => {
    await using dir = await tmpdir()
    const share = path.join(dir.path, "kimi-share")
    const creds = path.join(share, "credentials")
    await fs.mkdir(creds, { recursive: true })
    await fs.writeFile(path.join(creds, "kimi-code.json"), JSON.stringify({ access_token: "a" }))
    const report = await run(SubscriptionNativeSession.kimiSession({ HOME: dir.path, KIMI_SHARE_DIR: share }))
    expect(report.present).toBe(true)
  })
})
