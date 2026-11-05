export * as KimiCodeAdapter from "./kimi-code.js"

import { Effect } from "effect"
import type { Adapter, CommandRunner, LoginResult } from "./adapter.js"

export const integrationID = "kimi-code"
export const providerID = "kimi-for-coding"
export const baseURL = "https://api.kimi.com/coding/v1"
export const installUrl = "https://www.kimi.ai/code"

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

export const kimiCode = make()
