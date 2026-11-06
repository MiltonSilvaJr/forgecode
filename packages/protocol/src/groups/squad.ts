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

// Every field is optional on the wire so the core can answer with all the missing ones at once.
const DispatchCreateInput = Schema.Struct({
  scope: Schema.String.pipe(optional),
  owner: Schema.String.pipe(optional),
  base: Schema.String.pipe(optional),
  head: Schema.String.pipe(optional),
  dor: Schema.String.pipe(optional),
  dod: Schema.String.pipe(optional),
  proof: Schema.String.pipe(optional),
  exclusions: Schema.Array(Schema.String).pipe(optional),
  exigidos: Schema.Array(Squad.Exigidos).pipe(optional),
  milestone: Schema.String.pipe(optional),
  from: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.DispatchCreateInput" })

const ReleaseInput = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  reason: Schema.String,
  actor: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.ReleaseInput" })

const ReleaseReceipt = Schema.Struct({
  released: Schema.String,
  to: Schema.String,
  trees: Schema.Int,
  checkpointSha256: Schema.String,
}).annotate({ identifier: "Squad.ReleaseReceipt" })

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
    HttpApiEndpoint.post("squad.dispatch.create", "/api/experimental/squad/dispatch", {
      payload: DispatchCreateInput,
      success: Schema.Struct({ data: Squad.Dispatch }),
      error: [InvalidRequestError, ForbiddenError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.dispatch.create",
        summary: "Create a squad dispatch",
        description:
          "Validate and record a dispatch for the active generation, allocating its ORQ id and measuring base and head. Reports every missing field in one answer. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("squad.dispatch.list", "/api/experimental/squad/dispatch", {
      success: Schema.Struct({ data: Schema.Array(Squad.Dispatch) }),
      error: [ForbiddenError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.dispatch.list",
        summary: "List squad dispatches",
        description: "List the dispatches of the active generation. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("squad.release", "/api/experimental/squad/release", {
      payload: ReleaseInput,
      success: Schema.Struct({ data: ReleaseReceipt }),
      error: [InvalidRequestError, ForbiddenError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.release",
        summary: "Release a tree to another squad session",
        description:
          "Hand the trees owned by one session to another. Requires the current owner's persisted checkpoint to match its hash, and records the hash in the audit trail. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "squad" }))
