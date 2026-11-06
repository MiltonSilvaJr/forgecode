import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { formatDispatch, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.dispatch.list")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.dispatch.commands.list>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const dispatches = yield* Effect.tryPromise({
    try: () => client.experimental.squad.dispatch.list(),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(dispatches, null, 2) : dispatches.map(formatDispatch).join(EOL)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.dispatch.commands.list, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)
