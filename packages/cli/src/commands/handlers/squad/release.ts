import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { formatRelease, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.release")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.release>,
) {
  const from = Option.getOrUndefined(input.from)
  const to = Option.getOrUndefined(input.to)
  const reason = Option.getOrUndefined(input.reason)
  if (from === undefined || to === undefined || reason === undefined) {
    process.stderr.write("--from, --to and --reason are required" + EOL)
    process.exitCode = 2
    return
  }
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const receipt = yield* Effect.tryPromise({
    try: () => client.experimental.squad.release({ from, to, reason, actor: process.env.OPENCODE_SESSION_ID }),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(receipt, null, 2) : formatRelease(receipt)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.release, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)
