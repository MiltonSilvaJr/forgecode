export * as SquadRegistry from "./registry.js"

import { Context, Effect, Layer, Schema } from "effect"
import { DisabledError } from "./index.js"

export class ConflictError extends Schema.TaggedError<ConflictError>()("ConflictError", {
  message: Schema.String,
  pendencies: Schema.Array(Schema.String),
}) {}

export interface SessionRecord {
  name: string
  sessionID: string | null
  state: string
}

export interface GenerationResult {
  id: string
  runID: string
  state: "active" | "closed"
  sessions: readonly SessionRecord[]
}

export interface InitSession {
  name: string
  role: "orchestrator" | "worker"
  provider: string
  model: string
  variant?: string
  location: { directory: string; workspaceID?: string }
  branch?: string
  sessionID?: string
}

export interface InitInput {
  generation: string
  sessions: readonly InitSession[]
  replace?: boolean
  reason?: string
  idempotencyKey?: string
}

export interface Interface {
  readonly init: (input: InitInput) => Effect.Effect<GenerationResult, DisabledError | ConflictError>
  readonly get: (id: string) => Effect.Effect<GenerationResult | undefined>
  readonly active: () => Effect.Effect<GenerationResult | undefined>
  readonly countActive: () => Effect.Effect<number>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/Registry") {}

const generations = new Map<string, GenerationResult>()

export const layer = Layer.succeed(
  Service,
  Service.of({
    init: (input) =>
      Effect.sync(() => {
        const generation: GenerationResult = {
          id: input.generation,
          runID: `run-${input.generation}`,
          state: "active",
          sessions: input.sessions.map((entry) => ({
            name: entry.name,
            sessionID: entry.sessionID ?? null,
            state: "creating",
          })),
        }
        generations.set(input.generation, generation)
        return generation
      }),
    get: (id) => Effect.sync(() => generations.get(id)),
    active: () => Effect.sync(() => [...generations.values()].find((entry) => entry.state === "active")),
    countActive: () => Effect.sync(() => [...generations.values()].filter((entry) => entry.state === "active").length),
  }),
)
