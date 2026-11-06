import { Session } from "@opencode/schema/session"
import { Location } from "@opencode/schema/location"
import { Squad } from "@opencode/schema/squad"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, ServiceUnavailableError } from "../errors.js"

const InitSession = Schema.Struct({
  name: Squad.SessionName,
  role: Squad.Role,
  provider: Schema.String,
  model: Schema.String,
  variant: Schema.String.pipe(optional),
  location: Location.Ref,
  branch: Schema.String.pipe(optional),
  sessionID: Session.ID.pipe(optional),
}).annotate({ identifier: "Squad.InitSession" })

const GenerationCreateInput = Schema.Struct({
  generation: Squad.GenerationID,
  sessions: Schema.Array(InitSession),
  replace: Schema.Boolean.pipe(optional),
  reason: Schema.String.pipe(optional),
  idempotencyKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.GenerationCreateInput" })

export const SquadGroup = HttpApiGroup.make("server.squad")
  .add(
    HttpApiEndpoint.post("squad.generation.create", "/api/experimental/squad/generation", {
      payload: GenerationCreateInput,
      success: Schema.Struct({ data: Squad.Generation }),
      error: [ConflictError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.generation.create",
        summary: "Create a squad generation",
        description:
          "Create a squad generation and its declared sessions in one transaction. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("squad.session.list", "/api/experimental/squad/session", {
      success: Schema.Struct({
        data: Schema.Struct({ generation: Squad.GenerationID, sessions: Schema.Array(Squad.SessionEntry) }),
      }),
      error: [ConflictError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.session.list",
        summary: "List the active generation's sessions",
        description:
          "List the sessions of the active squad generation. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "squad" }))
