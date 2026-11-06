import { FileSystem } from "@opencode/core/filesystem"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { AbsolutePath } from "@opencode/core/schema"
import { SquadCheck } from "@opencode/core/squad/check"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { ConflictError, ForbiddenError, ServiceUnavailableError } from "@opencode/protocol/errors"
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
    default:
      return new ServiceUnavailableError({ message: tagged.message ?? "squad operation failed" })
  }
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
  }),
)

// The global config directory always exists, so a missing directory is a defect, not a request error.
const catchMissingGlobal = Effect.catchIf((error) => error instanceof FileSystem.DirectoryNotFoundError, Effect.die)
