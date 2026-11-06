import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { formatEnqueue, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.activate")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.activate>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const proof = yield* Effect.tryPromise({
    try: () => client.experimental.squad.activate({ generation: Option.getOrUndefined(input.generation) }),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(proof, null, 2) : formatEnqueue(proof)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.activate, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)
