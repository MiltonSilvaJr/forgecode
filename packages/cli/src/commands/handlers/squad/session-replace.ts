import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.session.replace")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.session.commands.replace>,
) {
  const name = Option.getOrUndefined(input.name)
  if (name === undefined) return yield* usageError("missing required --name")
  const provider = Option.getOrUndefined(input.provider)
  if (provider === undefined) return yield* usageError("missing required --provider")

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const entry = yield* Effect.tryPromise({
    try: () =>
      client.experimental.squad.session.replace({
        sessionRef: name,
        provider,
        model: Option.getOrUndefined(input.model),
        variant: Option.getOrUndefined(input.variant),
        reason: Option.getOrUndefined(input.reason),
        from: process.env.OPENCODE_SESSION_ID,
      }),
    catch: (cause) => cause,
  })
  const text = `${entry.name}: ${entry.state} (${entry.sessionID}) on ${entry.provider}/${entry.model}${entry.variant ? `#${entry.variant}` : ""}`
  process.stdout.write((input.json ? JSON.stringify(entry, null, 2) : text) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.session.commands.replace, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })
