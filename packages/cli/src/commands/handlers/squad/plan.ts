import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.plan")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.plan>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const document = yield* Effect.tryPromise({
    try: () => client.experimental.squad.plan(),
    catch: (cause) => cause,
  })
  const output = input.json ? JSON.stringify(document, null, 2) : formatPlan(document)
  process.stdout.write(output + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.plan, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

function formatPlan(document: {
  generationID: string
  sessions: readonly { name: string; action: string; sessionID?: string; promptSha256: string }[]
}) {
  return [
    `generation ${document.generationID} (plan only, nothing was changed)`,
    ...document.sessions.map(
      (entry) =>
        `  ${entry.name}: ${entry.action}${entry.sessionID ? ` ${entry.sessionID}` : ""} prompt sha256 ${entry.promptSha256}`,
    ),
  ].join(EOL)
}
