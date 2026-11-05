import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/http-api"
import { Config } from "@opencode/core/config"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { SubscriptionService } from "@opencode/core/subscription/service"
import { Api } from "../api"
import { SubscriptionError } from "@opencode/protocol/groups/subscription"
import { ForbiddenError } from "@opencode/protocol/errors"
import { response } from "../location"

const statements = Effect.fnUntraced(function* () {
  const config = yield* Config.Service
  return ManagedPolicy.statements(yield* config.entries())
})

export const SubscriptionHandler = HttpApiBuilder.group(Api, "server.subscription", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("subscription.status", () =>
        Effect.gen(function* () {
          const service = yield* SubscriptionService.Service
          return yield* response(service.status())
        }),
      )
      .handle("subscription.login", (ctx) =>
        Effect.gen(function* () {
          yield* requireConnect(ctx.params.integrationID)
          const service = yield* SubscriptionService.Service
          return yield* response(
            service
              .login({ integrationID: ctx.params.integrationID, source: ctx.payload.source, accept: ctx.payload.accept })
              .pipe(Effect.mapError((error) => new SubscriptionError({ code: error.code, message: error.message })))
              .pipe(Effect.map((result) => result as { status: "already_authenticated" | "authenticated" | "started"; url?: string; instructions?: string })),
          )
        }),
      )
      .handle("subscription.consent", (ctx) =>
        Effect.gen(function* () {
          yield* requireConnect(ctx.params.integrationID)
          const service = yield* SubscriptionService.Service
          yield* service
            .consent(ctx.params.integrationID, ctx.payload.accept)
            .pipe(Effect.mapError((error) => new SubscriptionError({ code: error.code, message: error.message })))
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle("subscription.refresh", (ctx) =>
        Effect.gen(function* () {
          yield* requireConnect(ctx.params.integrationID)
          const service = yield* SubscriptionService.Service
          return yield* response(
            service
              .refresh(ctx.params.integrationID)
              .pipe(Effect.mapError((error) => new SubscriptionError({ code: error.code, message: error.message }))),
          )
        }),
      )
      .handle("subscription.test", (ctx) =>
        Effect.gen(function* () {
          yield* requireProviderUse(ctx.params.integrationID)
          const service = yield* SubscriptionService.Service
          return yield* response(
            service
              .test(ctx.params.integrationID, ctx.payload.model)
              .pipe(Effect.mapError((error) => new SubscriptionError({ code: error.code, message: error.message }))),
          )
        }),
      )
  }),
)

const requireConnect = Effect.fnUntraced(function* (integrationID: string) {
  const denied = ManagedPolicy.match(yield* statements(), "integration.connect", integrationID)
  if (denied?.effect === "deny")
    return yield* new ForbiddenError({ message: `${denied.message}: connecting ${integrationID} is not allowed` })
})

const requireProviderUse = Effect.fnUntraced(function* (integrationID: string) {
  const denied = ManagedPolicy.match(yield* statements(), "provider.use", integrationID)
  if (denied?.effect === "deny")
    return yield* new ForbiddenError({ message: `${denied.message}: using ${integrationID} is not allowed` })
})
