import { expect, test } from "bun:test"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"

const methods = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const

const operations = () =>
  Object.entries(OpenApi.fromApi(ClientApi).paths).flatMap(([path, item]) =>
    methods.flatMap((method) => {
      const operation = item[method]
      return operation ? [{ identifier: operation.operationId, method: method.toUpperCase(), path }] : []
    }),
  )

test("squad routes carry the canonical experimental.squad identifiers", () => {
  const required = [
    ["experimental.squad.generation.create", "POST", "/api/experimental/squad/generation"],
    ["experimental.squad.session.list", "GET", "/api/experimental/squad/session"],
    ["experimental.squad.check", "GET", "/api/experimental/squad/check"],
    ["experimental.squad.plan", "GET", "/api/experimental/squad/plan"],
    ["experimental.squad.broadcast", "POST", "/api/experimental/squad/broadcast"],
    ["experimental.squad.audit", "GET", "/api/experimental/squad/audit"],
    ["experimental.squad.session.send", "POST", "/api/experimental/squad/session/{sessionRef}/send"],
    ["experimental.squad.session.launch", "POST", "/api/experimental/squad/session/{sessionRef}/launch"],
  ] as const
  const offenders = required
    .filter(
      ([identifier, method, path]) =>
        !operations().some((op) => op.identifier === identifier && op.method === method && op.path === path),
    )
    .map(([identifier, method, path]) => `${identifier} ${method} ${path}`)
  expect(offenders).toEqual([])
})
