import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.audit.export")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.audit.commands.export>,
) {
  const out = Option.getOrUndefined(input.out)
  if (out === undefined) return yield* usageError("missing required --out")

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const chain = yield* Effect.tryPromise({
    try: () => client.experimental.squad.audit({ since: Option.getOrUndefined(input.since) }),
    catch: (cause) => cause,
  })
  yield* Effect.promise(() => Bun.write(out, chain.entries.map((entry) => JSON.stringify(entry)).join("\n") + (chain.entries.length > 0 ? "\n" : "")))

  const summary = { out, lines: chain.entries.length, digest: chain.digest, integrity: chain.integrity }
  const output = input.json
    ? JSON.stringify(summary, null, 2)
    : `Exported ${summary.lines} line(s) to ${out}${EOL}digest ${summary.digest}${EOL}${summary.integrity}`
  process.stdout.write(output + EOL)
  if (chain.integrity !== "integrity_ok") process.exitCode = 1
})

export default Runtime.handler(Commands.commands.squad.commands.audit.commands.export, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })
