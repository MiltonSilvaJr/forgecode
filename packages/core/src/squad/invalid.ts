export * as SquadInvalid from "./invalid.js"

import { Schema } from "effect"

export class InvalidInputError extends Schema.TaggedError<InvalidInputError>()("InvalidInputError", {
  message: Schema.String,
  missing: Schema.Array(Schema.String),
}) {}
