export * as SquadDispatch from "./dispatch.js"

import { Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { InvalidInputError } from "./invalid.js"

export interface CreateInput {
  readonly scope?: string
  readonly owner?: string
  readonly base?: string
  readonly head?: string
  readonly dor?: string
  readonly dod?: string
  readonly proof?: string
  readonly exclusions?: readonly string[]
  readonly exigidos?: readonly Squad.Exigidos[]
  readonly milestone?: string
  readonly actor?: string
}

export const create = Effect.fn("SquadDispatch.create")(function* (input: CreateInput) {
  const missing = input.dod === undefined ? ["dod"] : []
  if (input.scope !== "") return yield* new InvalidInputError({ message: `missing: ${missing.join(", ")}`, missing })
  return {} as Squad.Dispatch
})

export const list = Effect.fn("SquadDispatch.list")(function* () {
  return [] as readonly Squad.Dispatch[]
})
