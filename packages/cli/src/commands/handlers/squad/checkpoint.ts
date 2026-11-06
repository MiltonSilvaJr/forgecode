import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { exportCheckpoint, readMessageFile, writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.checkpoint")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.checkpoint>,
) {
  const name = Option.getOrUndefined(input.name)
  if (name === undefined) return yield* usageError("missing required --name")
  const file = Option.getOrUndefined(input.bodyFile)
  if (file === undefined) return yield* usageError("missing required --body-file")

  const body = yield* Effect.promise(() => readMessageFile(file))
  if (!body.ok) return yield* Effect.fail(Object.assign(new Error(body.error.replace("message file", "checkpoint file")), { code: "invalid_body_file" }))

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const checkpoint = yield* Effect.tryPromise({
    try: () =>
      client.experimental.squad.checkpoint({
        name,
        body: body.text,
        from: process.env.OPENCODE_SESSION_ID,
        allowSecretLikeText: input.allowSecretLikeText,
        reason: Option.getOrUndefined(input.reason),
      }),
    catch: (cause) => cause,
  })

  const exportDir = Option.getOrUndefined(input.exportDir)
  const exported =
    exportDir === undefined
      ? undefined
      : yield* Effect.promise(() =>
          exportCheckpoint(exportDir, {
            filename: `${checkpoint.generationID}-${checkpoint.name}-${checkpoint.sha256.slice(0, 12)}.md`,
            content: checkpoint.body,
          }),
        )
  if (exported && !exported.ok) return yield* Effect.fail(Object.assign(new Error(exported.error), { code: "invalid_export_dir" }))

  const summary = {
    generation: checkpoint.generationID,
    name: checkpoint.name,
    sha256: checkpoint.sha256,
    bytes: checkpoint.bytes,
    ...(exported ? { exported: exported.path } : {}),
  }
  const output = input.json
    ? JSON.stringify(summary, null, 2)
    : `Checkpoint for ${summary.name} recorded: sha256 ${summary.sha256} (${summary.bytes} bytes)${exported ? `${EOL}exported to ${exported.path}` : ""}`
  process.stdout.write(output + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.checkpoint, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })
