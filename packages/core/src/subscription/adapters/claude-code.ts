export * as ClaudeCodeAdapter from "./claude-code.js"

import { Effect } from "effect"
import type { Adapter, CommandRunner, LoginResult } from "./adapter.js"

export const integrationID = "claude-code"
export const providerID = "claude-agent"
export const installUrl = "https://docs.anthropic.com/en/docs/claude-code/setup"

export function make(_runner?: CommandRunner): Adapter {
  return {
    integrationID,
    providerID,
    transport: { provider: providerID },
    sources: () => Effect.sync(() => []),
    report: () => Effect.succeed({ present: false, state: "missing" as const }),
    login: () => Effect.succeed({ status: "authenticated" } as LoginResult),
    logout: () => Effect.succeed({ status: "removed" } as const),
  }
}

export const claudeCode = make()
