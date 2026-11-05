export * as KimiProvider from "./kimi.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Provider } from "../../provider.js"

export const providerID = Provider.ID.make("kimi-for-coding")
export const baseURL = ""
export const catalogID = ""

export const bearerHeader = (_token: string): Record<string, string> => ({})

export const KimiProviderPlugin = define({
  id: "opencode.provider.kimi",
  effect: Effect.fn(function* (_ctx) {}),
})
