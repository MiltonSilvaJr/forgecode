import { Session } from "@opencode/schema/session"
import { Location } from "@opencode/schema/location"
import { Squad } from "@opencode/schema/squad"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { SessionInbox } from "@opencode/schema/session-inbox"
import {
  ConflictError,
  DispatchNotFoundError,
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
  dispatch: Schema.String.pipe(optional),
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
  force: Schema.Boolean.pipe(optional),
  reason: Schema.String.pipe(optional),
  idempotencyKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.CloseInput" })

const TransitionInput = Schema.Struct({
  from: Squad.GenerationID,
  idempotencyKey: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.TransitionInput" })
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
  send: Schema.Boolean.pipe(optional),
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
const LaunchInput = Schema.Struct({
  retry: Schema.Boolean.pipe(optional),
  reason: Schema.String.pipe(optional),
  adopt: Session.ID.pipe(optional),
  timeout: Schema.Int.pipe(optional).annotate({ description: "Verification timeout in milliseconds." }),
}).annotate({ identifier: "Squad.LaunchInput" })

const BlockInput = Schema.Struct({
  name: Squad.SessionName,
  waitingOn: Squad.WaitingOn,
  reason: Schema.String,
  clear: Schema.Boolean.pipe(optional),
  from: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.BlockInput" })

const ReplaceInput = Schema.Struct({
  provider: Schema.String,
  model: Schema.String.pipe(optional),
  variant: Schema.String.pipe(optional),
  reason: Schema.String.pipe(optional),
  from: Schema.String.pipe(optional),
  timeout: Schema.Int.pipe(optional).annotate({ description: "Verification timeout in milliseconds." }),
}).annotate({ identifier: "Squad.ReplaceInput" })

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
    HttpApiEndpoint.post("squad.session.launch", "/api/experimental/squad/session/:sessionRef/launch", {
      params: { sessionRef: Squad.SessionRef },
      payload: LaunchInput,
      success: Schema.Struct({ data: Squad.SessionEntry }),
      error: [InvalidRequestError, ForbiddenError, SessionNotFoundError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.session.launch",
        summary: "Launch a squad session",
        description:
          "Create or adopt the session, admit the bootstrap marker and verify it by durable evidence (model, enqueued, delivered, execution started). A session that lacks evidence stays starting and the error names what is missing. Experimental: may change without compatibility guarantees.",
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
    HttpApiEndpoint.post("squad.session.replace", "/api/experimental/squad/session/:sessionRef/replace", {
      params: { sessionRef: Squad.SessionRef },
      payload: ReplaceInput,
      success: Schema.Struct({ data: Squad.SessionEntry }),
      error: [InvalidRequestError, ForbiddenError, SessionNotFoundError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.session.replace",
        summary: "Replace a squad session",
        description:
          "Give the name a new session on another provider, model or variant, inheriting the checkpoint, and launch it. The registry keeps one entry per generation and name; the old session is left untouched. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("squad.block", "/api/experimental/squad/block", {
      payload: BlockInput,
      success: Schema.Struct({ data: Squad.Block }),
      error: [InvalidRequestError, ForbiddenError, SessionNotFoundError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.block",
        summary: "Declare or clear why a squad session is stopped",
        description:
          "Record that a verified session waits on a human or a tool, with a reason, or clear that declaration. It only feeds the liveness cause: it never changes the verdict or releases the execution claim. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("squad.liveness", "/api/experimental/squad/liveness", {
      success: Schema.Struct({ data: Squad.LivenessReport }),
      error: [ConflictError, ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.liveness",
        summary: "Report squad status and liveness",
        description:
          "Read-only report of the active and previous generation: per session its registry state, measured activity (instant and source) and liveness verdict, and the pending inbox count. Experimental: may change without compatibility guarantees.",
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
  .add(
    HttpApiEndpoint.post("squad.dispatch.accept", "/api/experimental/squad/dispatch/:orqId/accept", {
      params: { orqId: Schema.String },
      success: Schema.Struct({ data: Squad.Dispatch }),
      error: [InvalidRequestError, ForbiddenError, DispatchNotFoundError, ConflictError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.dispatch.accept",
        summary: "Accept a squad dispatch",
        description:
          "Mark an open dispatch of the active generation as accepted by its owner. Repeating it is a no-op. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("squad.panel", "/api/experimental/squad/panel", {
      success: Schema.Struct({ data: Squad.PanelDocument }),
      error: [ForbiddenError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.squad.panel",
        summary: "Build the squad kanban panel document",
        description:
          "Build the kanban document from the active generation's dispatches, with per-stage evidence and explicit unknown. Read-only. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "squad" }))
