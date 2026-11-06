export * as PanelJira from "./jira.js"

import { Effect } from "effect"
import { Squad } from "@opencode/schema/squad"

export interface Input {
  readonly command: string | undefined
  readonly orq: string
  readonly head: string
  /** Epoch milliseconds of the dispatch; a snapshot not newer than this proves nothing. */
  readonly since: number
}

export const read = (_input: Input) =>
  Effect.succeed(Squad.Stage.make({ status: "verified", evidence: null, source: "jira_command" }))
