export * as SquadReplace from "./replace.js"

import { Effect } from "effect"
import { ConflictError, SessionNotFoundError, SquadRegistry } from "./registry.js"

export interface ReplaceInput {
  readonly name: string
  readonly provider: string
  readonly model?: string
  readonly variant?: string
  readonly reason?: string
  readonly author?: string
  readonly timeout?: number
  readonly pollInterval?: number
}

export const replace = Effect.fn("SquadReplace.replace")(function* (input: ReplaceInput) {
  const registry = yield* SquadRegistry.Service
  const active = yield* registry.active()
  if (!active) return yield* new ConflictError({ message: "no active generation", pendencies: [] })
  const generation = yield* registry.generation(active.id)
  const found = generation!.sessions.find((entry) => entry.name === input.name)
  if (!found) return yield* new SessionNotFoundError({ message: `session ${input.name} is not in generation ${active.id}` })
  return found
})
