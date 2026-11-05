export * as CodexChatGPTAdapter from "./codex-chatgpt.js"

import { Effect } from "effect"
import type { Adapter, CommandRunner, LoginResult } from "./adapter.js"

export const integrationID = "codex-chatgpt"
export const providerID = "openai"
export const installUrl = "https://github.com/openai/codex"

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

export const codexChatGPT = make()
