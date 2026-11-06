import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { formatDispatch, readDispatchFile, writeSquadError } from "../../squad"

const exigidosValues = ["jira", "ci", "merge", "deploy", "acceptance"] as const

const handler = Effect.fn("cli.squad.dispatch.create")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.dispatch.commands.create>,
) {
  const file = Option.getOrUndefined(input.file)
  if (file === undefined) {
    process.stderr.write("missing required --file" + EOL)
    process.exitCode = 2
    return
  }
  const requested = Option.getOrUndefined(input.exigidos)
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
  const exigidos = requested?.flatMap((entry) => exigidosValues.filter((value) => value === entry))
  if (requested !== undefined && exigidos !== undefined && exigidos.length !== requested.length) {
    process.stderr.write(`invalid --exigidos: expected a subset of ${exigidosValues.join(",")}` + EOL)
    process.exitCode = 2
    return
  }
  const dispatch = yield* Effect.promise(() => readDispatchFile(file))
  if (!dispatch.ok) return yield* Effect.fail(Object.assign(new Error(dispatch.error), { code: "invalid_dispatch_file" }))

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const created = yield* Effect.tryPromise({
    try: () =>
      client.experimental.squad.dispatch.create({
        ...dispatch.fields,
        owner: Option.getOrUndefined(input.to),
        exigidos,
        send: input.send,
        from: process.env.OPENCODE_SESSION_ID,
      }),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(created, null, 2) : formatDispatch(created)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.dispatch.commands.create, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)
