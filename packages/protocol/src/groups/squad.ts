import { Session } from "@opencode/schema/session"
import { Location } from "@opencode/schema/location"
import { Squad } from "@opencode/schema/squad"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { SessionInbox } from "@opencode/schema/session-inbox"
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "../errors.js"

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

const SendInput = Schema.Struct({
  text: Schema.String,
  delivery: SessionInbox.Delivery.pipe(optional),
  from: Schema.String.pipe(optional),
  allowSelf: Schema.Boolean.pipe(optional),
  idempotencyKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.SendInput" })

const BroadcastInput = Schema.Struct({
  text: Schema.String,
  from: Schema.String.pipe(optional),
  includeSelf: Schema.Boolean.pipe(optional),
  idempotencyKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.BroadcastInput" })

const CheckpointInput = Schema.Struct({
  name: Squad.SessionName,
  body: Schema.String,
  from: Schema.String.pipe(optional),
  allowSecretLikeText: Schema.Boolean.pipe(optional),
  reason: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.CheckpointInput" })

const CloseInput = Schema.Struct({
  from: Schema.String.pipe(optional),
  idempotencyKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.CloseInput" })

const TransitionInput = Schema.Struct({
  from: Squad.GenerationID,
  idempotencyKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.TransitionInput" })

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
  .add(
    HttpApiEndpoint.get("squad.check", "/api/experimental/squad/check", {
      success: Schema.Struct({ data: Squad.CheckReport }),
      error: [ConflictError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.check",
        summary: "Check the active generation's sessions",
        description:
          "Validate configuration, model, location, branch and credential presence for each session of the active squad generation. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("squad.plan", "/api/experimental/squad/plan", {
      success: Schema.Struct({ data: Squad.PlanDocument }),
      error: [ConflictError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.plan",
        summary: "Plan the active generation's launch",
        description:
          "Simulate the launch of the active squad generation without side effects: per session, whether it would be created or adopted and the SHA-256 of the bootstrap prompt. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("squad.session.send", "/api/experimental/squad/session/:sessionRef/send", {
      params: { sessionRef: Squad.SessionRef },
      payload: SendInput,
      success: Schema.Struct({ data: Squad.EnqueueProof }),
      error: [InvalidRequestError, ForbiddenError, SessionNotFoundError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.session.send",
        summary: "Send a message to a squad session",
        description:
          "Enqueue a message in a verified squad session's inbox and return the enqueue proof (message id and acceptance, never a read receipt). Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("squad.broadcast", "/api/experimental/squad/broadcast", {
      payload: BroadcastInput,
      success: Schema.Struct({ data: Squad.BroadcastReport }),
      error: [InvalidRequestError, ForbiddenError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.broadcast",
        summary: "Broadcast a message to the active generation",
        description:
          "Validate every recipient first, then enqueue in configuration order. Delivery is best-effort and not transactional: a failure in the middle keeps what was queued and reports the rest as not_attempted. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("squad.audit", "/api/experimental/squad/audit", {
      query: { since: Schema.String.pipe(optional) },
      success: Schema.Struct({ data: Squad.AuditChain }),
      error: [InvalidRequestError, ConflictError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.audit",
        summary: "List the squad audit trail",
        description:
          "List the append-only audit lines in order, optionally since an ISO instant, with the chain digest and its integrity. Read-only: there is no write parameter. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("squad.checkpoint", "/api/experimental/squad/checkpoint", {
      payload: CheckpointInput,
      success: Schema.Struct({ data: Squad.Checkpoint }),
      error: [InvalidRequestError, ForbiddenError, SessionNotFoundError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.checkpoint",
        summary: "Record a session checkpoint",
        description:
          "Validate the six required sections, normalize the body, scan for secret-like text and store it under its SHA-256. History is kept; the session points at the most recent checkpoint. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("squad.generation.close", "/api/experimental/squad/generation/:generationID/close", {
      params: { generationID: Squad.GenerationID },
      payload: CloseInput,
      success: Schema.Struct({ data: Squad.TransitionReceipt }),
      error: [InvalidRequestError, ForbiddenError, SessionNotFoundError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.generation.close",
        summary: "Close a squad generation",
        description:
          "Close the active generation once every session has an intact checkpoint and no execution is in flight, and return the transition receipt with the source registry digest. The orchestrator is kept open. Repeating the close returns the same receipt. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("squad.transition", "/api/experimental/squad/transition", {
      payload: TransitionInput,
      success: Schema.Struct({ data: Squad.TransitionReceipt }),
      error: [InvalidRequestError, ForbiddenError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.transition",
        summary: "Bind a closed generation to the active one",
        description:
          "Prove that the closed generation's receipt, session set and registry digest still match and bind it to the active generation. Repeating with the same target is a no-op; a different target is a conflict. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "squad" }))
