import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"
import { readAuditLines } from "../../../queue/audit"
import { listQueueItems, type QueueItem } from "../../../queue/status"

const handler = Effect.fn("cli.queue.list")(function* (input: Runtime.Input<typeof Commands.commands.queue.commands.list>) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const data = yield* Global.Service
  const items = yield* Effect.promise(() =>
    listQueueItems(client, {
      sessionID: input.thread,
      readAudit: (sessionID, limit) => readAuditLines(data.data, sessionID, limit),
      limit: input.limit,
    }),
  )
  const output = input.json ? JSON.stringify(items, null, 2) : items.map(formatItem).join(EOL)
  if (output) yield* Effect.promise(() => writeStdout(output + EOL))
})

export default Runtime.handler(Commands.commands.queue.commands.list, (input) =>
  handler(input).pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(cause) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

function formatItem(item: QueueItem): string {
  return [item.id, item.created, item.delivery, item.state].join("\t")
}

const writeStdout = (output: string) =>
  new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (error) => (error ? reject(error) : resolve()))
  })
