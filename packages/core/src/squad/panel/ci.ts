export * as PanelCi from "./ci.js"

import fs from "node:fs/promises"
import { DateTime, Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { parse, run, type Outcome } from "./command.js"

export interface Input {
  readonly command: string | undefined
  readonly evidence: string | undefined
  /** The check that proves the claim. */
  readonly name: string
  readonly headOid: string | undefined
}

interface Check {
  readonly name?: unknown
  readonly conclusion?: unknown
  readonly head_oid?: unknown
  readonly completed_at?: unknown
}

const unknown = (source: string, reason?: string) =>
  Squad.Stage.make({ status: "unknown", evidence: null, source: reason ? `${source}: ${reason}` : source })

/**
 * Reads CI checks from the evidence file or, failing that, the read-only command (`<command> <head_oid> <name>`),
 * both printing `{ "checks": [{ name, conclusion, head_oid }] }`. A check counts only when its name and
 * `head_oid` match this card, so a green check of another ref proves nothing. Only name, oid and instant are kept.
 */
export const read = Effect.fn("PanelCi.read")(function* (input: Input) {
  const source = input.evidence !== undefined ? "ci_evidence" : input.command !== undefined ? "ci_command" : "none"
  if (source === "none") return unknown(source)
  if (input.headOid === undefined) return unknown(source, "dispatch head was not measured")
  const outcome = yield* load(input, input.headOid)
  if (!outcome.ok) return unknown(source, outcome.reason)
  const list = Array.isArray(outcome.value) ? outcome.value : (outcome.value as { checks?: unknown } | null)?.checks
  if (!Array.isArray(list)) return unknown(source, "unrecognized output")
  const match = (list as readonly Check[]).findLast(
    (check) => check?.name === input.name && typeof check.head_oid === "string" && check.head_oid.toLowerCase() === input.headOid,
  )
  if (!match) return unknown(source, "no check with that name at this head")
  const reference = `${input.name}@${input.headOid.slice(0, 12)}`
  const finished = typeof match.completed_at === "string" ? Date.parse(match.completed_at) : Number.NaN
  const evidence = { type: "ci", reference, at: DateTime.makeUnsafe(Number.isNaN(finished) ? Date.now() : finished) }
  if (match.conclusion === "success") return Squad.Stage.make({ status: "verified", evidence, source })
  if (typeof match.conclusion === "string" && match.conclusion !== "")
    return Squad.Stage.make({ status: "failed", evidence, source })
  return unknown(source, "check has not concluded")
})

const load = (input: Input, headOid: string): Effect.Effect<Outcome> => {
  if (input.evidence !== undefined) {
    const file = input.evidence
    return Effect.promise(() =>
      fs.readFile(file, "utf8").then(
        (text) => parse(text),
        (): Outcome => ({ ok: false, reason: "evidence file not readable" }),
      ),
    )
  }
  return run(input.command!, [headOid, input.name])
}
