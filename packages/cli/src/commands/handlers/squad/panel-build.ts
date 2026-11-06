import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { SquadKanban } from "@opencode/schema/squad-kanban"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.panel.build")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.panel.commands.build>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const panel = yield* Effect.tryPromise({
    try: () => client.experimental.squad.panel(),
    catch: (cause) => cause,
  })
  const kanban = SquadKanban.fromPanel(panel)
  const document = JSON.stringify(kanban, null, 2)
  const out = Option.getOrUndefined(input.out)
  if (out === undefined) {
    process.stdout.write(document + EOL)
    return
  }
  yield* Effect.tryPromise({ try: () => Bun.write(out, document + EOL), catch: (cause) => cause })
  const summary = { out, revisao: kanban.revisao, cards: Object.keys(kanban.cards).length }
  process.stdout.write((input.json ? JSON.stringify(summary, null, 2) : out) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.panel.commands.build, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)
