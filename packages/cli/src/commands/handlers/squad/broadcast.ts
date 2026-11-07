import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { readMessageFile, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.broadcast")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.broadcast>,
) {
  const file = Option.getOrUndefined(input.messageFile)
  if (file === undefined) return yield* usageError("missing required --message-file")
  const message = yield* Effect.promise(() => readMessageFile(file))
  if (!message.ok) return yield* Effect.fail(Object.assign(new Error(message.error), { code: "invalid_message_file" }))

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const report = yield* Effect.tryPromise({
    try: () =>
      client.experimental.squad.broadcast({
        text: message.text,
        from: process.env.OPENCODE_SESSION_ID,
        includeSelf: input.includeSelf,
        idempotencyKey: Option.getOrUndefined(input.idempotencyKey),
      }),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(report, null, 2) : formatBroadcast(report)) + EOL)
  if (report.results.some((result) => result.status !== "accepted")) process.exitCode = 1
})

export default Runtime.handler(Commands.commands.squad.commands.broadcast, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })

function formatBroadcast(report: {
  results: readonly { name: string; status: string; messageID?: string; reason?: string }[]
}): string {
  if (report.results.length === 0) return "No recipients"
  return report.results
    .map((result) =>
      result.status === "accepted"
        ? `${result.name}: queued message ${result.messageID}`
        : `${result.name}: ${result.status}${result.reason ? ` — ${result.reason}` : ""}`,
    )
    .join(EOL)
}
