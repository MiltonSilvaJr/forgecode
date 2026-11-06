export * as KimiProvider from "./kimi.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Provider } from "../../provider.js"

export const providerID = Provider.ID.make("kimi-for-coding")
export const baseURL = "https://api.kimi.com/coding/v1"
export const catalogID = "kimi-code-plan-global"

/** Builds the per-request authorization header from a resolved token. */
export const bearerHeader = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` })

/**
 * Provider `kimi-for-coding` over the moonshot messages protocol. The subscription token is never
 * stored in provider settings or headers — `bearerHeader` is applied per request by the host plugin.
 */
export const KimiProviderPlugin = define({
  id: "opencode.provider.kimi",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((providers) => {
      const item = providers.get(providerID)
      if (!item) return
      providers.update(providerID, (provider) => {
        provider.settings = Provider.mergeOverlay(provider.settings, { baseURL, transport: "http" })
      })
    })
  }),
})
