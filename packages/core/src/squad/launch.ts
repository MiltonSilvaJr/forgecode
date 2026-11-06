export * as SquadLaunch from "./launch.js"

import { Clock, Duration, Effect } from "effect"
import { and, eq } from "drizzle-orm"
import { Location } from "@opencode/schema/location"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Session as SessionSchema } from "@opencode/schema/session"
import { WorkspaceID } from "@opencode/schema/workspace-id"
import { AbsolutePath } from "../schema.js"
import { Config } from "../config.js"
import { Database } from "../database/database.js"
import { SquadAudit } from "./audit.js"
import { SquadChannel } from "./channel.js"
import { SquadEvidence } from "./evidence.js"
import { bootstrapPrompt, bootstrapSha256 } from "./plan.js"
import { ConflictError, SessionNotFoundError, SquadRegistry } from "./registry.js"
import { SquadSessionTable } from "./sql.js"
import { SquadStore } from "./store.js"

export interface LaunchInput {
  readonly only?: string
  readonly retry?: boolean
  readonly reason?: string
  readonly adopt?: Readonly<Record<string, string>>
  readonly timeout?: number
  readonly pollInterval?: number
}

const DefaultTimeout = 90_000
const DefaultPollInterval = 500

export const launch = Effect.fn("SquadLaunch.launch")(function* (input: LaunchInput) {
  const registry = yield* SquadRegistry.Service
  const store = yield* SquadStore.Service
  const db = (yield* Database.Service).db
  const active = yield* registry.active()
  if (!active) return yield* new ConflictError({ message: "no active generation", pendencies: [] })
  const rows = (yield* store.sessions(db, active.id)).filter((row) => input.only === undefined || row.name === input.only)
  if (input.only !== undefined && rows.length === 0)
    return yield* new SessionNotFoundError({ message: `session ${input.only} is not in generation ${active.id}` })
  const timeout = input.timeout ?? (yield* configuredTimeout())
  const exits = yield* Effect.forEach(rows, (row) => launchOne(row, { ...input, timeout }).pipe(Effect.exit))
  const failed = exits.find((exit) => exit._tag === "Failure")
  if (failed) return yield* Effect.failCause(failed.cause)
  const generation = yield* registry.generation(active.id)
  const names = new Set(rows.map((row) => row.name))
  return generation!.sessions.filter((entry) => names.has(entry.name))
})

const configuredTimeout = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    const value = Config.latest(entries, "squad")?.launch?.verify_timeout
    return value === undefined ? DefaultTimeout : Duration.toMillis(value)
  })

const launchOne = Effect.fn("SquadLaunch.launchOne")(function* (
  row: SquadStore.SessionRow,
  input: LaunchInput & { readonly timeout: number },
) {
  const audit = yield* SquadAudit.Service
  const outcome = yield* advance(row, input).pipe(Effect.exit)
  const latest = yield* currentRow(row)
  yield* audit.append({
    kind: "launch",
    generation: row.generation_id,
    target: row.name,
    sessionID: latest?.session_id ?? undefined,
    result: outcome._tag === "Success" ? "verified" : "failed",
    actor: "operator",
    detail: outcome._tag === "Success" ? input.reason : (latest?.last_error ?? undefined),
  })
  return yield* outcome
})

const currentRow = (row: SquadStore.SessionRow) =>
  Effect.gen(function* () {
    const store = yield* SquadStore.Service
    const db = (yield* Database.Service).db
    return yield* store.sessionByName(db, row.generation_id, row.name)
  })

const patch = (row: SquadStore.SessionRow, fields: Partial<SquadStore.SessionInsert>) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    yield* db
      .update(SquadSessionTable)
      .set({ ...fields, updated_at: Date.now() })
      .where(and(eq(SquadSessionTable.generation_id, row.generation_id), eq(SquadSessionTable.name, row.name)))
      .run()
      .pipe(Effect.orDie)
  })

const advance = Effect.fn("SquadLaunch.advance")(function* (
  row: SquadStore.SessionRow,
  input: LaunchInput & { readonly timeout: number },
) {
  if (row.state === "closed") return
  if (row.state === "failed" || (input.retry && row.state === "starting")) {
    if (row.state === "failed" && !input.retry)
      return yield* new ConflictError({
        message: `session ${row.name} is failed (${row.last_error ?? "no reason recorded"}); rerun with --retry --reason <text>`,
        pendencies: [],
      })
    if (!input.reason)
      return yield* new ConflictError({ message: `--retry on session ${row.name} requires --reason <text>`, pendencies: [] })
  }
  const sessions = yield* SquadChannel.SessionsService
  const channel = yield* SquadChannel.Service
  const marker = `SQUAD-${row.generation_id}-${row.name}`
  const adoptTarget = input.adopt?.[row.name]
  const verifyOnce = (sessionID: SessionSchema.ID, adoptedAt: number | null) =>
    SquadEvidence.verify(sessionID, {
      model: expectedModel(row),
      messageID: SquadChannel.messageIDFor(launchKey(row), sessionID),
      ...(adoptedAt === null ? {} : { adoptedAt }),
    })

  if (row.state === "verified") {
    const report = yield* verifyOnce(SessionSchema.ID.make(row.session_id!), row.adopted_at)
    if (report.missing.length > 0)
      return yield* new ConflictError({
        message: `session ${row.name} is verified but evidence is now missing: ${report.missing.join(", ")}`,
        pendencies: [],
      })
    return
  }

  if (row.state === "failed") yield* patch(row, { state: "creating" })
  const current = (yield* currentRow(row)) ?? row

  if (current.state === "creating") {
    const sessionID = SessionSchema.ID.make(current.session_id ?? adoptTarget ?? SessionSchema.ID.create())
    yield* patch(row, {
      session_id: sessionID,
      marker,
      prompt_sha256: bootstrapSha256(row.generation_id, row.name),
    })
    const existing = yield* sessions.get(sessionID)
    if (existing !== undefined) {
      yield* patch(row, { adopted_at: current.adopted_at ?? Date.now() })
    } else {
      const created = yield* sessions
        .create({
          id: sessionID,
          location: locationRef(current),
          model: modelRef(current),
          metadata: { squad: { generation: row.generation_id, name: row.name, role: row.role, marker } },
        })
        .pipe(Effect.exit)
      if (created._tag === "Failure") {
        yield* patch(row, { state: "failed", last_error: `session.create failed for ${row.name}` })
        return yield* new ConflictError({ message: `session.create failed for ${row.name}`, pendencies: [] })
      }
    }
    yield* patch(row, { state: "starting", last_error: null })
  }

  const started = (yield* currentRow(row)) ?? row
  const sessionID = SessionSchema.ID.make(started.session_id!)
  yield* channel
    .enqueue({
      sessionID,
      text: bootstrapPrompt(row.generation_id, row.name),
      delivery: "queue",
      idempotencyKey: launchKey(row),
      metadata: { squad: { marker } },
    })
    .pipe(Effect.tapError((error) => patch(row, { last_error: error.message })))
  const deadline = (yield* Clock.currentTimeMillis) + input.timeout
  const report = yield* verifyUntil(() => verifyOnce(sessionID, started.adopted_at), deadline, input.pollInterval ?? DefaultPollInterval)
  if (report.missing.length > 0) {
    const reason = report.modelMismatch ?? `evidence missing: ${report.missing.join(", ")}`
    yield* patch(row, { last_error: reason })
    return yield* new ConflictError({ message: `session ${row.name} stays starting; ${reason}`, pendencies: [] })
  }
  yield* patch(row, { state: "verified", last_error: null })
})

const verifyUntil = (
  measure: () => ReturnType<typeof SquadEvidence.verify>,
  deadline: number,
  pollInterval: number,
): ReturnType<typeof SquadEvidence.verify> =>
  Effect.gen(function* () {
    const report = yield* measure()
    if (report.missing.length === 0 || report.modelMismatch !== undefined) return report
    if ((yield* Clock.currentTimeMillis) >= deadline) return report
    yield* Effect.sleep(pollInterval)
    return yield* verifyUntil(measure, deadline, pollInterval)
  })

const launchKey = (row: SquadStore.SessionRow) => `launch:${row.generation_id}:${row.name}`

const expectedModel = (row: SquadStore.SessionRow) =>
  `${row.provider}/${row.model}${row.variant ? `#${row.variant}` : ""}`

const modelRef = (row: SquadStore.SessionRow) =>
  Model.Ref.make({
    providerID: Provider.ID.make(row.provider),
    id: Model.ID.make(row.model),
    ...(row.variant ? { variant: Model.VariantID.make(row.variant) } : {}),
  })

const locationRef = (row: SquadStore.SessionRow) =>
  Location.Ref.make({
    directory: AbsolutePath.make(row.location.directory),
    ...(row.location.workspaceID ? { workspaceID: WorkspaceID.make(row.location.workspaceID) } : {}),
  })
