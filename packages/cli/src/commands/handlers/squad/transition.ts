import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { formatReceipt, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.transition")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.transition>,
) {
  const from = Option.getOrUndefined(input.from)
  if (from === undefined) return yield* usageError("missing required --from")

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const receipt = yield* Effect.tryPromise({
    try: () =>
      client.experimental.squad.transition({
        from,
        idempotencyKey: Option.getOrUndefined(input.idempotencyKey),
      }),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(receipt, null, 2) : formatReceipt(receipt)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.transition, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })
