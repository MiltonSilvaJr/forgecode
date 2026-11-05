import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { errorMessage } from "../../../util/error"
import { snapshotActivity, watchActivity, type ActivitySnapshot } from "../../../queue/activity"

const WATCH_TYPES = [
  "session.inbox.delivered",
  "session.execution.started",
  "session.execution.succeeded",
  "session.execution.failed",
] as const

const handler = Effect.fn("cli.queue.activity")(function* (
  input: Runtime.Input<typeof Commands.commands.queue.commands.activity>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })

  if (input.watch) {
    const events = client.event.subscribe({ types: [...WATCH_TYPES] })
    const event = yield* Effect.promise(() =>
      watchActivity({ events, sessionID: input.thread, timeoutMs: input.timeout }),
    )
    if (event === null) {
      process.stderr.write(`no activity within ${input.timeout}ms` + EOL)
      process.exitCode = 1
      return
    }
    const output = input.json ? JSON.stringify({ type: event.type, created: event.created }) : `${event.type} ${event.created}`
    yield* Effect.promise(() => writeStdout(output + EOL))
    return
  }

  const snapshot = yield* Effect.promise(() => snapshotActivity(client, { sessionID: input.thread }))
  const output = input.json ? JSON.stringify(snapshot, null, 2) : formatSnapshot(snapshot)
  yield* Effect.promise(() => writeStdout(output + EOL))
})

export default Runtime.handler(Commands.commands.queue.commands.activity, (input) =>
  handler(input).pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(cause) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

function formatSnapshot(snapshot: ActivitySnapshot): string {
  return [
    `state=${snapshot.state}`,
    `lastMessageAt=${snapshot.lastMessageAt ?? "-"}`,
    `pendingCount=${snapshot.pendingCount}`,
    `outcome=${snapshot.outcome ?? "-"}`,
    `observedAt=${snapshot.observedAt}`,
  ].join(" ")
}

const writeStdout = (output: string) =>
  new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (error) => (error ? reject(error) : resolve()))
  })
