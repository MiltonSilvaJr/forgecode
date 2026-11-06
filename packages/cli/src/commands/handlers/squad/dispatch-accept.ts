import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { formatDispatch, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.dispatch.accept")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.dispatch.commands.accept>,
) {
  const orq = Option.getOrUndefined(input.orq)
  if (orq === undefined) {
    process.stderr.write("missing required --orq" + EOL)
    process.exitCode = 2
    return
  }
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const dispatch = yield* Effect.tryPromise({
    try: () => client.experimental.squad.dispatch.accept({ orqId: orq }),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(dispatch, null, 2) : formatDispatch(dispatch)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.dispatch.commands.accept, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)
