import { HttpApiGroup, OpenApi } from "effect/http-api"

export const SubscriptionGroup = HttpApiGroup.make("server.subscription").annotateMerge(
  OpenApi.annotations({ title: "subscription" }),
)
