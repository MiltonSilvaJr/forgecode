export * as PanelJira from "./jira.js"

import { DateTime, Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { run } from "./command.js"

export interface Input {
  readonly command: string | undefined
  readonly orq: string
  readonly head: string
  /** Epoch milliseconds of the dispatch; a snapshot not newer than this proves nothing. */
  readonly since: number
}

const source = "jira_command"
const key = /^[A-Za-z][A-Za-z0-9_]*-\d+$/u

const unknown = (reason?: string) =>
  Squad.Stage.make({ status: "unknown", evidence: null, source: reason ? `${source}: ${reason}` : "none" })

/**
 * Reads one Jira snapshot through the configured read-only command, called as `<command> <orq> <head>`
 * and printing `{ "key", "updated" }`. Only the key and the instant are kept; nothing else of the
 * output reaches the document. Jira never answers `failed`: a missing or stale item proves nothing.
 */
export const read = Effect.fn("PanelJira.read")(function* (input: Input) {
  if (input.command === undefined) return unknown()
  const outcome = yield* run(input.command, [input.orq, input.head])
  if (!outcome.ok) return unknown(outcome.reason)
  const snapshot = outcome.value as { key?: unknown; updated?: unknown } | null
  const updated = typeof snapshot?.updated === "string" ? Date.parse(snapshot.updated) : Number.NaN
  if (typeof snapshot?.key !== "string" || !key.test(snapshot.key) || Number.isNaN(updated)) return unknown("unrecognized output")
  if (updated <= input.since) return unknown("snapshot is not newer than the dispatch")
  return Squad.Stage.make({
    status: "verified",
    evidence: { type: "jira", reference: snapshot.key, at: DateTime.makeUnsafe(updated) },
    source,
  })
})
