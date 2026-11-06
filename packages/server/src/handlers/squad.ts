import { FileSystem } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/core/schema"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadBlock } from "@opencode/core/squad/block"
import { SquadBroadcast } from "@opencode/core/squad/broadcast"
import { SquadCheck } from "@opencode/core/squad/check"
import { SquadLaunch } from "@opencode/core/squad/launch"
import { SquadPlan } from "@opencode/core/squad/plan"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSend } from "@opencode/core/squad/send"
import { SquadStatus } from "@opencode/core/squad/status"
import {
  ConflictError,
  ForbiddenError,
  InvalidRequestError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@opencode/protocol/errors"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"

const squadError = (error: unknown) => {
  const tagged = error as { _tag?: string; message?: string }
  switch (tagged._tag) {
    case "Squad.DisabledError":
      return new ForbiddenError({ message: tagged.message ?? "squad is disabled" })
    case "ConflictError":
      return new ConflictError({ message: tagged.message ?? "conflict" })
    case "ForbiddenError":
      return new ForbiddenError({ message: tagged.message ?? "forbidden" })
    default:
      return new ServiceUnavailableError({ message: tagged.message ?? "squad operation failed" })
  }
}

const sendError = (ref: string) => (error: unknown) => {
  const tagged = error as { _tag?: string; message?: string }
  if (tagged._tag === "SessionNotFoundError")
    return new SessionNotFoundError({ sessionID: ref, message: tagged.message ?? `session ${ref} not found` })
  return squadError(error)
}

export const SquadHandler = HttpApiBuilder.group(Api, "server.squad", (handlers) =>
  Effect.gen(function* () {
    // The squad flag is global, so it is read from the global config Location, which carries managed policy,
    // the Console document, and user config.
    const global = yield* Global.Service
    const locations = yield* LocationServiceMap.Service
    const services = locations.get(Location.Ref.make({ directory: AbsolutePath.make(global.config) }))
    return handlers
      .handle("squad.generation.create", (ctx) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          const created = yield* registry
            .init(ctx.payload)
            .pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          const generation = yield* registry
            .generation(created.id)
            .pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          return { data: generation! }
        }),
      )
      .handle("squad.session.list", () =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          const active = yield* registry.active().pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          if (!active) return yield* new ConflictError({ message: "no active generation" })
          const generation = yield* registry
            .generation(active.id)
            .pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          return { data: { generation: generation!.id, sessions: generation!.sessions } }
        }),
      )
      .handle("squad.check", () =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          const active = yield* registry.active().pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          if (!active) return yield* new ConflictError({ message: "no active generation" })
          const generation = yield* registry
            .generation(active.id)
            .pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          const report = yield* SquadCheck.check({
            sessions: generation!.sessions.map((entry) => ({
              name: entry.name,
              provider: entry.provider,
              model: entry.model,
              variant: entry.variant,
              location: entry.location.directory,
              branch: entry.branch,
            })),
          }).pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          return { data: report }
        }),
      )
      .handle("squad.plan", () =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          const active = yield* registry.active().pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          if (!active) return yield* new ConflictError({ message: "no active generation" })
          const generation = yield* registry
            .generation(active.id)
            .pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          const document = yield* SquadPlan.plan({ generationID: generation!.id, sessions: generation!.sessions }).pipe(
            Effect.provide(services),
            catchMissingGlobal,
            Effect.mapError(squadError),
          )
          return { data: document }
        }),
      )
      .handle("squad.broadcast", (ctx) =>
        SquadBroadcast.broadcast(ctx.payload).pipe(
          Effect.provide(services),
          catchMissingGlobal,
          Effect.mapError(squadError),
          Effect.map((data) => ({ data })),
        ),
      )
      .handle("squad.audit", (ctx) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          const since = ctx.query.since === undefined ? undefined : Date.parse(ctx.query.since)
          if (since !== undefined && Number.isNaN(since))
            return yield* new InvalidRequestError({ message: "since must be an ISO instant", field: "since" })
          // Reading the trail is gated by the same flag as every squad route.
          yield* registry.countActive().pipe(Effect.provide(services), catchMissingGlobal, Effect.mapError(squadError))
          const chain = yield* SquadAudit.chain(since === undefined ? undefined : { since }).pipe(
            Effect.provide(services),
            catchMissingGlobal,
            Effect.mapError(squadError),
          )
          return { data: chain }
        }),
      )
      .handle("squad.block", (ctx) =>
        SquadBlock.block({
          name: ctx.payload.name,
          waitingOn: ctx.payload.waitingOn,
          reason: ctx.payload.reason,
          clear: ctx.payload.clear,
          author: ctx.payload.from,
        }).pipe(
          Effect.provide(services),
          catchMissingGlobal,
          Effect.mapError(sendError(ctx.payload.name)),
          Effect.map((data) => ({ data })),
        ),
      )
      .handle("squad.liveness", () =>
        SquadStatus.status().pipe(
          Effect.provide(services),
          catchMissingGlobal,
          Effect.mapError(squadError),
          Effect.map((data) => ({ data })),
        ),
      )
      .handle("squad.session.launch", (ctx) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          const target = yield* registry.resolve(ctx.params.sessionRef)
          const launched = yield* SquadLaunch.launch({
            only: target.name,
            retry: ctx.payload.retry,
            reason: ctx.payload.reason,
            adopt: ctx.payload.adopt === undefined ? undefined : { [target.name]: ctx.payload.adopt },
            timeout: ctx.payload.timeout,
          })
          return { data: launched[0]! }
        }).pipe(
          Effect.provide(services),
          catchMissingGlobal,
          Effect.mapError(sendError(ctx.params.sessionRef)),
        ),
      )
      .handle("squad.session.send", (ctx) =>
        SquadSend.send({ to: ctx.params.sessionRef, ...ctx.payload }).pipe(
          Effect.provide(services),
          catchMissingGlobal,
          Effect.mapError(sendError(ctx.params.sessionRef)),
          Effect.map((data) => ({ data })),
        ),
      )
  }),
)

// The global config directory always exists, so a missing directory is a defect, not a request error.
const catchMissingGlobal = Effect.catchIf((error) => error instanceof FileSystem.DirectoryNotFoundError, Effect.die)
