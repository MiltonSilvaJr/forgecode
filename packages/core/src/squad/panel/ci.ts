export * as PanelCi from "./ci.js"

import { Effect } from "effect"
import { Squad } from "@opencode/schema/squad"

export interface Input {
  readonly command: string | undefined
  readonly evidence: string | undefined
  /** The check that proves the claim. */
  readonly name: string
  readonly headOid: string | undefined
}

export const read = (_input: Input) =>
  Effect.succeed(Squad.Stage.make({ status: "verified", evidence: null, source: "ci" }))
