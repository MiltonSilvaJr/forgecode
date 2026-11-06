import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { Location } from "@opencode/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export class SubscriptionError extends Schema.TaggedError<SubscriptionError>()(
  "SubscriptionError",
  { code: SubscriptionAuth.ErrorCode, message: Schema.String },
  { httpApiStatus: 400 },
) {}

const LoginResponse = Schema.Struct({
  status: Schema.Literals(["already_authenticated", "authenticated", "started"]),
  url: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
}).annotate({ identifier: "SubscriptionLoginResponse" })

const RefreshResponse = Schema.Struct({
  state: Schema.String,
  expiresAt: Schema.optional(Schema.Number),
}).annotate({ identifier: "SubscriptionRefreshResponse" })

const TestResponse = Schema.Struct({
  ok: Schema.Boolean,
  latencyMs: Schema.Number,
  model: Schema.optional(Schema.String),
}).annotate({ identifier: "SubscriptionTestResponse" })

export const SubscriptionGroup = HttpApiGroup.make("server.subscription")
  .add(
    HttpApiEndpoint.get("subscription.status", "/api/experimental/subscription/status", {
      query: LocationQuery,
      success: Location.response(SubscriptionAuth.Status),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.subscription.status",
          summary: "Subscription auth status",
          description: "List each subscription provider's resolved source, state, and consent without any secret.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("subscription.login", "/api/experimental/subscription/:integrationID/login", {
      params: { integrationID: Schema.String },
      query: LocationQuery,
      payload: Schema.Struct({
        source: Schema.optional(Schema.Literals(["managed", "native"])),
        accept: Schema.Boolean,
      }),
      success: Location.response(LoginResponse),
      error: [SubscriptionError, ForbiddenError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.subscription.login",
          summary: "Subscription login",
          description: "Charge terms-of-use consent and delegate to the official subscription login.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("subscription.consent", "/api/experimental/subscription/:integrationID/consent", {
      params: { integrationID: Schema.String },
      query: LocationQuery,
      payload: Schema.Struct({ accept: Schema.Boolean }),
      success: HttpApiSchema.NoContent,
      error: [SubscriptionError, ForbiddenError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.subscription.consent",
          summary: "Subscription consent",
          description: "Record the versioned terms-of-use acceptance for a subscription provider.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("subscription.refresh", "/api/experimental/subscription/:integrationID/refresh", {
      params: { integrationID: Schema.String },
      query: LocationQuery,
      success: Location.response(RefreshResponse),
      error: [SubscriptionError, ForbiddenError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.subscription.refresh",
          summary: "Subscription refresh",
          description: "Refresh a managed OAuth credential or revalidate a native session.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("subscription.test", "/api/experimental/subscription/:integrationID/test", {
      params: { integrationID: Schema.String },
      query: LocationQuery,
      payload: Schema.Struct({ model: Schema.optional(Schema.String) }),
      success: Location.response(TestResponse),
      error: [SubscriptionError, ForbiddenError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "experimental.subscription.test",
          summary: "Subscription test",
          description: "Run one minimal request through the bound transport and report latency.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "subscription" }))
