export * as SquadCheckpoint from "./checkpoint.js"

import { Effect, Schema } from "effect"
import type { Squad } from "@opencode/schema/squad"

export class InvalidCheckpointError extends Schema.TaggedError<InvalidCheckpointError>()("InvalidCheckpointError", {
  message: Schema.String,
  missing: Schema.Array(Schema.String),
}) {}

export interface WriteInput {
  readonly name: string
  readonly body: string
  readonly allowSecretLikeText?: boolean
  readonly reason?: string
  readonly actor?: string
}

export const write = (_input: WriteInput): Effect.Effect<Squad.Checkpoint, InvalidCheckpointError> =>
  Effect.fail(new InvalidCheckpointError({ message: "not implemented", missing: [] }))

export const latest = (_input: { generation: string; name: string }) => Effect.succeed<Squad.Checkpoint | undefined>(undefined)

export const history = (_input: { generation: string; name: string }) => Effect.succeed<Squad.Checkpoint[]>([])

export const exportDocument = (_checkpoint: Squad.Checkpoint) => ({ filename: "", content: "" })
