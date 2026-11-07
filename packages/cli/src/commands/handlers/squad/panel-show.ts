import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { SquadKanban } from "@opencode/schema/squad-kanban"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { formatPanel, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.panel.show")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.panel.commands.show>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const panel = yield* Effect.tryPromise({
    try: () => client.experimental.squad.panel(),
    catch: (cause) => cause,
  })
  const kanban = SquadKanban.fromPanel(panel)
  process.stdout.write((input.json ? JSON.stringify(kanban, null, 2) : formatPanel(kanban)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.panel.commands.show, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)
