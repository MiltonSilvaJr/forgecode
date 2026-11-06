import { expect, test } from "bun:test"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"

const methods = ["get", "post"] as const

function operations() {
  return Object.entries(OpenApi.fromApi(ClientApi).paths).flatMap(([path, item]) =>
    methods.flatMap((method) => {
      const operation = item[method]
      return operation ? [{ path, method, identifier: operation.operationId }] : []
    }),
  )
}

test("registers the subscription status route with an experimental identifier", () => {
  const status = operations().find(
    (operation) => operation.path === "/api/experimental/subscription/status" && operation.method === "get",
  )
  expect(status?.identifier).toBe("experimental.subscription.status")
})

test("registers the four subscription mutation routes", () => {
  const identifiers = operations()
    .filter((operation) => operation.path.startsWith("/api/experimental/subscription/"))
    .map((operation) => operation.identifier)
  for (const identifier of [
    "experimental.subscription.login",
    "experimental.subscription.consent",
    "experimental.subscription.refresh",
    "experimental.subscription.test",
  ]) {
    expect(identifiers).toContain(identifier)
  }
})
