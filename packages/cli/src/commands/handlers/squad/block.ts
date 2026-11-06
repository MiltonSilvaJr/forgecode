import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.block")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.block>,
) {
  const name = Option.getOrUndefined(input.name)
  if (name === undefined) return yield* usageError("missing required --name")
  const waiting = Option.getOrUndefined(input.waiting)
  if (!input.clear && waiting !== "human" && waiting !== "tool") return yield* usageError("invalid --waiting: expected human or tool")
  const reason = Option.getOrUndefined(input.reason)
  if (!input.clear && reason === undefined) return yield* usageError("missing required --reason")

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const block = yield* Effect.tryPromise({
    try: () =>
      client.experimental.squad.block({
        name,
        waitingOn: waiting === "tool" ? "tool" : "human",
        reason: reason ?? "",
        clear: input.clear || undefined,
        from: process.env.OPENCODE_SESSION_ID,
      }),
    catch: (cause) => cause,
  })
  const text = input.clear ? `Cleared block on ${block.name}` : `Blocked ${block.name}: waiting on ${block.waitingOn} — ${block.reason}`
  process.stdout.write((input.json ? JSON.stringify(block, null, 2) : text) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.block, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })
