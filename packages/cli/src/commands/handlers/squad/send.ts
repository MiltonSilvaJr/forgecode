import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { formatEnqueue, readMessageFile, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.send")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.send>,
) {
  if (input.delivery !== "queue" && input.delivery !== "steer")
    return yield* usageError("invalid delivery: expected queue or steer")
  const delivery = input.delivery
  const to = Option.getOrUndefined(input.to)
  const sessionID = Option.getOrUndefined(input.sessionId)
  if (to === undefined && sessionID === undefined) return yield* usageError("one of --to or --session-id is required")
  if (to !== undefined && sessionID !== undefined) return yield* usageError("--to and --session-id are mutually exclusive")
  const file = Option.getOrUndefined(input.messageFile)
  if (file === undefined) return yield* usageError("missing required --message-file")

  const message = yield* Effect.promise(() => readMessageFile(file))
  if (!message.ok) return yield* Effect.fail(Object.assign(new Error(message.error), { code: "invalid_message_file" }))

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const proof = yield* Effect.tryPromise({
    try: () =>
      client.experimental.squad.session.send({
        sessionRef: to ?? sessionID!,
        text: message.text,
        delivery,
        from: process.env.OPENCODE_SESSION_ID,
        allowSelf: input.allowSelf,
        idempotencyKey: Option.getOrUndefined(input.idempotencyKey),
      }),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(proof, null, 2) : formatEnqueue(proof)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.send, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })
