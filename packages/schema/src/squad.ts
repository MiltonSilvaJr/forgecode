export * as Squad from "./squad.js"

import { Schema } from "effect"
import { Location } from "./location.js"
import { DateTimeUtcFromMillis, optional } from "./schema.js"
import { Session } from "./session.js"
import { SessionMessage } from "./session-message.js"
import { SessionInbox } from "./session-inbox.js"

export const GenerationID = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]*$/u)).pipe(
  Schema.brand("Squad.GenerationID"),
  Schema.annotate({ identifier: "Squad.GenerationID" }),
)
export type GenerationID = typeof GenerationID.Type

export const SessionName = Schema.String.check(Schema.isPattern(/^\S+$/u)).pipe(
  Schema.brand("Squad.SessionName"),
  Schema.annotate({ identifier: "Squad.SessionName" }),
)
export type SessionName = typeof SessionName.Type

export const SessionState = Schema.Literals(["creating", "starting", "verified", "closed", "failed"]).annotate({
  identifier: "Squad.SessionState",
})
export type SessionState = typeof SessionState.Type

export const SessionRef = Schema.Union([SessionName, Session.ID]).annotate({ identifier: "Squad.SessionRef" })
export type SessionRef = typeof SessionRef.Type

export const Role = Schema.Literals(["orchestrator", "worker"]).annotate({ identifier: "Squad.Role" })
export type Role = typeof Role.Type

export interface SessionEntry extends Schema.Schema.Type<typeof SessionEntry> {}
export const SessionEntry = Schema.Struct({
  generationID: GenerationID,
  name: SessionName,
  role: Role,
  provider: Schema.String,
  model: Schema.String,
  variant: Schema.String.pipe(optional),
  location: Location.Ref,
  branch: Schema.String.pipe(optional),
  sessionID: Session.ID.pipe(optional),
  adoptedAt: DateTimeUtcFromMillis.pipe(optional),
  state: SessionState,
  marker: Schema.String.pipe(optional),
  promptSha256: Schema.String.pipe(optional),
  checkpointSha256: Schema.String.pipe(optional),
  productive: Schema.Boolean,
  lastError: Schema.String.pipe(optional),
  createdAt: DateTimeUtcFromMillis,
  updatedAt: DateTimeUtcFromMillis,
}).annotate({ identifier: "Squad.SessionEntry" })

export interface Generation extends Schema.Schema.Type<typeof Generation> {}
export const Generation = Schema.Struct({
  id: GenerationID,
  runID: Schema.String,
  state: Schema.Literals(["active", "closed"]),
  configDigest: Schema.String.pipe(optional),
  createdAt: DateTimeUtcFromMillis,
  closedAt: DateTimeUtcFromMillis.pipe(optional),
  closedBy: Schema.String.pipe(optional),
  sourceGenerationID: GenerationID.pipe(optional),
  sessions: Schema.Array(SessionEntry),
}).annotate({ identifier: "Squad.Generation" })

export const Exigidos = Schema.Literals(["jira", "ci", "merge", "deploy", "acceptance"])
export type Exigidos = typeof Exigidos.Type

export const DispatchValidation = Schema.Literals(["verified", "unknown", "failed"])
export type DispatchValidation = typeof DispatchValidation.Type

export const DispatchState = Schema.Literals(["open", "accepted", "done", "blocked"])
export type DispatchState = typeof DispatchState.Type

export interface DispatchInput extends Schema.Schema.Type<typeof DispatchInput> {}
export const DispatchInput = Schema.Struct({
  scope: Schema.String,
  owner: SessionName,
  base: Schema.String,
  head: Schema.String,
  dor: Schema.String,
  dod: Schema.String,
  proof: Schema.String,
  exclusions: Schema.NonEmptyArray(Schema.String),
  exigidos: Schema.NonEmptyArray(Exigidos),
  milestone: Schema.String,
}).annotate({ identifier: "Squad.DispatchInput" })

export interface Dispatch extends Schema.Schema.Type<typeof Dispatch> {}
export const Dispatch = Schema.Struct({
  id: Schema.String,
  generationID: GenerationID,
  orqID: Schema.String,
  seq: Schema.Int,
  ...DispatchInput.fields,
  baseOid: Schema.String.pipe(optional),
  headOid: Schema.String.pipe(optional),
  validation: DispatchValidation,
  state: DispatchState,
  acceptedAt: DateTimeUtcFromMillis.pipe(optional),
  acceptedBy: SessionName.pipe(optional),
  createdAt: DateTimeUtcFromMillis,
}).annotate({ identifier: "Squad.Dispatch" })

export interface Checkpoint extends Schema.Schema.Type<typeof Checkpoint> {}
export const Checkpoint = Schema.Struct({
  generationID: GenerationID,
  name: SessionName,
  sha256: Schema.String,
  body: Schema.String,
  bytes: Schema.Int,
  createdAt: DateTimeUtcFromMillis,
}).annotate({ identifier: "Squad.Checkpoint" })

export interface TransitionReceipt extends Schema.Schema.Type<typeof TransitionReceipt> {}
export const TransitionReceipt = Schema.Struct({
  sourceGeneration: GenerationID,
  sourceRegistryDigest: Schema.String,
  closed: Schema.Record(Schema.String, Schema.Struct({ sessionID: Session.ID.pipe(optional), closedAt: DateTimeUtcFromMillis })),
  checkpoints: Schema.Record(Schema.String, Schema.Struct({ sha256: Schema.String })),
  previousSessionsClosed: Schema.Boolean,
  previousOrchestratorKeptOpen: Schema.Boolean,
  closedBy: Schema.String,
  targetGenerationID: GenerationID.pipe(optional),
  createdAt: DateTimeUtcFromMillis,
}).annotate({ identifier: "Squad.TransitionReceipt" })

export const LivenessVerdict = Schema.Literals(["working", "idle", "stalled", "presumed_dead", "unknown"])
export type LivenessVerdict = typeof LivenessVerdict.Type

export const LivenessSource = Schema.Literals(["execution", "inbox"])
export type LivenessSource = typeof LivenessSource.Type

export interface Liveness extends Schema.Schema.Type<typeof Liveness> {}
export const Liveness = Schema.Struct({
  verdict: LivenessVerdict,
  measuredAt: DateTimeUtcFromMillis,
  lastActivity: DateTimeUtcFromMillis.pipe(optional),
  sentAt: DateTimeUtcFromMillis.pipe(optional),
  source: LivenessSource.pipe(optional),
  sessionState: SessionState.pipe(optional),
  workingStale: Schema.Boolean,
  presumedDead: Schema.Boolean,
  cause: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.Liveness" })

export const WaitingOn = Schema.Literals(["human", "tool"])
export type WaitingOn = typeof WaitingOn.Type

export interface Block extends Schema.Schema.Type<typeof Block> {}
export const Block = Schema.Struct({
  generationID: GenerationID,
  name: SessionName,
  waitingOn: WaitingOn,
  reason: Schema.String,
  author: Schema.String,
  createdAt: DateTimeUtcFromMillis,
  clearedAt: DateTimeUtcFromMillis.pipe(optional),
}).annotate({ identifier: "Squad.Block" })

export interface CostSnapshot extends Schema.Schema.Type<typeof CostSnapshot> {}
export const CostSnapshot = Schema.Struct({
  cost: Schema.Finite.pipe(optional),
  tokens: Schema.Struct({
    input: Schema.Int.pipe(optional),
    output: Schema.Int.pipe(optional),
  }).pipe(optional),
  unknown: Schema.Boolean,
}).annotate({ identifier: "Squad.CostSnapshot" })

export const StageStatus = Schema.Literals(["verified", "failed", "unknown"])
export type StageStatus = typeof StageStatus.Type

export const StageEvidence = Schema.Struct({
  type: Schema.String,
  reference: Schema.String,
  at: DateTimeUtcFromMillis.pipe(optional),
}).pipe(Schema.NullOr)

export const Stage = Schema.Struct({
  status: StageStatus,
  evidence: StageEvidence,
  source: Schema.String,
}).annotate({ identifier: "Squad.Stage" })

export const CardColumn = Schema.Literals(["backlog", "in_progress", "in_review", "blocked", "done"])
export type CardColumn = typeof CardColumn.Type

export const PanelCard = Schema.Struct({
  id: Schema.String,
  titulo: Schema.String,
  coluna: CardColumn,
  agente: Schema.String,
  prioridade: Schema.String.pipe(optional),
  refs: Schema.Array(Schema.String),
  evidencias: Schema.Array(Schema.String),
  bloqueio: Schema.String.pipe(optional),
  atualizadoEm: DateTimeUtcFromMillis.pipe(optional),
  estagios: Schema.Struct({
    jira: Stage,
    ci: Stage,
    merge: Stage,
    deploy: Stage,
    acceptance: Stage,
  }),
  exigidos: Schema.Array(Exigidos),
  desconhecido: Schema.Array(Exigidos),
  progressa: Schema.Boolean,
}).annotate({ identifier: "Squad.PanelCard" })

export interface PanelDocument extends Schema.Schema.Type<typeof PanelDocument> {}
export const PanelDocument = Schema.Struct({
  versaoSchema: Schema.Int,
  revisao: Schema.String,
  atualizadoEm: DateTimeUtcFromMillis,
  colunas: Schema.Array(Schema.String),
  cards: Schema.Record(Schema.String, PanelCard),
  fonte: Schema.Record(Schema.String, Schema.String),
}).annotate({ identifier: "Squad.PanelDocument" })

export const AuditKind = Schema.Literals([
  "init",
  "launch",
  "send",
  "broadcast",
  "dispatch",
  "dispatch_accept",
  "checkpoint",
  "close",
  "transition",
  "activate",
  "release",
  "block",
  "block_clear",
  "session_replace",
])
export type AuditKind = typeof AuditKind.Type

export interface AuditEntry extends Schema.Schema.Type<typeof AuditEntry> {}
export const AuditEntry = Schema.Struct({
  id: Schema.Int,
  at: DateTimeUtcFromMillis,
  kind: AuditKind,
  generation: GenerationID.pipe(optional),
  target: Schema.String,
  sessionID: Session.ID.pipe(optional),
  messageID: SessionMessage.ID.pipe(optional),
  messageSha256: Schema.String.pipe(optional),
  delivery: SessionInbox.Delivery.pipe(optional),
  result: Schema.String,
  idempotencyKey: Schema.String.pipe(optional),
  actor: Schema.String,
  prevHash: Schema.String,
  detail: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.AuditEntry" })

export const AuditIntegrity = Schema.Literals(["integrity_ok", "integrity_broken"])
export type AuditIntegrity = typeof AuditIntegrity.Type

export interface AuditChain extends Schema.Schema.Type<typeof AuditChain> {}
export const AuditChain = Schema.Struct({
  entries: Schema.Array(AuditEntry),
  digest: Schema.String,
  integrity: AuditIntegrity,
}).annotate({ identifier: "Squad.AuditChain" })

export interface EnqueueProof extends Schema.Schema.Type<typeof EnqueueProof> {}
export const EnqueueProof = Schema.Struct({
  messageID: SessionMessage.ID,
  name: SessionName,
  sessionID: Session.ID,
  delivery: SessionInbox.Delivery,
  at: DateTimeUtcFromMillis,
}).annotate({ identifier: "Squad.EnqueueProof" })

export const BroadcastStatus = Schema.Literals(["accepted", "rejected", "not_attempted"])
export type BroadcastStatus = typeof BroadcastStatus.Type

export const BroadcastResult = Schema.Struct({
  name: SessionName,
  sessionID: Session.ID.pipe(optional),
  status: BroadcastStatus,
  messageID: SessionMessage.ID.pipe(optional),
  reason: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.BroadcastResult" })

export interface BroadcastReport extends Schema.Schema.Type<typeof BroadcastReport> {}
export const BroadcastReport = Schema.Struct({
  results: Schema.Array(BroadcastResult),
}).annotate({ identifier: "Squad.BroadcastReport" })

export const CheckVerdict = Schema.Literals(["ok", "warn", "fail"])
export type CheckVerdict = typeof CheckVerdict.Type

export const CheckItem = Schema.Struct({
  check: Schema.String,
  verdict: CheckVerdict,
  reason: Schema.String.pipe(optional),
}).annotate({ identifier: "Squad.CheckItem" })

export const CredentialPresence = Schema.Literals(["present", "absent", "unknown"])
export type CredentialPresence = typeof CredentialPresence.Type

export const SessionCheck = Schema.Struct({
  name: SessionName,
  checks: Schema.Array(CheckItem),
  credential: CredentialPresence,
}).annotate({ identifier: "Squad.SessionCheck" })

export interface CheckReport extends Schema.Schema.Type<typeof CheckReport> {}
export const CheckReport = Schema.Struct({
  sessions: Schema.Array(SessionCheck),
}).annotate({ identifier: "Squad.CheckReport" })

export const PlanEntry = Schema.Struct({
  name: SessionName,
  provider: Schema.String,
  model: Schema.String,
  variant: Schema.String.pipe(optional),
  location: Location.Ref,
  branch: Schema.String.pipe(optional),
  sessionID: Session.ID.pipe(optional),
  action: Schema.Literals(["adopt", "create"]),
  promptSha256: Schema.String,
}).annotate({ identifier: "Squad.PlanEntry" })

export interface PlanDocument extends Schema.Schema.Type<typeof PlanDocument> {}
export const PlanDocument = Schema.Struct({
  generationID: GenerationID,
  sessions: Schema.Array(PlanEntry),
}).annotate({ identifier: "Squad.PlanDocument" })

export const SessionStatus = Schema.Struct({
  name: SessionName,
  role: Role,
  provider: Schema.String,
  model: Schema.String,
  variant: Schema.String.pipe(optional),
  location: Location.Ref,
  branch: Schema.String.pipe(optional),
  sessionID: Session.ID.pipe(optional),
  state: SessionState,
  liveness: Liveness,
  inboxPending: Schema.Int,
}).annotate({ identifier: "Squad.SessionStatus" })

export const PreviousSession = Schema.Struct({
  name: SessionName,
  sessionID: Session.ID.pipe(optional),
  state: Schema.Literal("closed"),
}).annotate({ identifier: "Squad.PreviousSession" })

export const PreviousGeneration = Schema.Struct({
  id: GenerationID,
  closedAt: DateTimeUtcFromMillis.pipe(optional),
  closedBy: Schema.String.pipe(optional),
  sessions: Schema.Array(PreviousSession),
}).annotate({ identifier: "Squad.PreviousGeneration" })

export interface LivenessReport extends Schema.Schema.Type<typeof LivenessReport> {}
export const LivenessReport = Schema.Struct({
  generation: Schema.NullOr(GenerationID),
  sessions: Schema.Array(SessionStatus),
  inboxPending: Schema.Int,
  previous: Schema.NullOr(PreviousGeneration),
}).annotate({ identifier: "Squad.LivenessReport" })
