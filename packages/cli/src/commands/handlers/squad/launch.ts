import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.launch")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.launch>,
) {
  const reason = Option.getOrUndefined(input.reason)
  if (input.retry && reason === undefined) return yield* usageError("--retry requires --reason")
  const timeoutSeconds = Option.getOrUndefined(input.timeout)
  const timeout = timeoutSeconds === undefined ? undefined : Math.round(Number(timeoutSeconds) * 1000)
  if (timeout !== undefined && !(timeout > 0)) return yield* usageError("invalid --timeout: expected a positive number of seconds")
  const adopt = parseAdopt(Option.getOrUndefined(input.adopt))
  if (adopt === undefined) return yield* usageError("invalid --adopt: expected name=ses_... pairs")

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const listed = yield* Effect.tryPromise({ try: () => client.experimental.squad.session.list(), catch: (cause) => cause })
  const only = Option.getOrUndefined(input.only)
  const names = listed.sessions.map((entry) => entry.name).filter((name) => only === undefined || name === only)
  if (only !== undefined && names.length === 0) return yield* usageError(`session ${only} is not in the active generation`)

  const results = yield* Effect.forEach(names, (name) =>
    Effect.tryPromise({
      try: () =>
        client.experimental.squad.session.launch({
          sessionRef: name,
          retry: input.retry || undefined,
          reason,
          adopt: adopt[name],
          timeout,
        }),
      catch: (cause) => cause,
    }).pipe(
      Effect.map((entry) => ({ name, ok: true as const, entry })),
      Effect.catch((cause) => Effect.succeed({ name, ok: false as const, error: toMessage(cause) })),
    ),
  )
  process.stdout.write((input.json ? JSON.stringify(results, null, 2) : format(results)) + EOL)
  if (results.some((result) => !result.ok)) process.exitCode = 1
})

export default Runtime.handler(Commands.commands.squad.commands.launch, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })

const toMessage = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "message" in cause ? String(cause.message) : String(cause)

function parseAdopt(value: string | undefined): Record<string, string> | undefined {
  if (value === undefined) return {}
  const pairs = value.split(",").map((pair) => pair.split("="))
  if (pairs.some((pair) => pair.length !== 2 || !pair[0] || !pair[1]?.startsWith("ses"))) return undefined
  return Object.fromEntries(pairs.map(([name, id]) => [name, id]))
}

function format(
  results: readonly ({ name: string; ok: true; entry: { state: string; sessionID?: string } } | { name: string; ok: false; error: string })[],
): string {
  return results
    .map((result) =>
      result.ok ? `${result.name}: ${result.entry.state} (${result.entry.sessionID})` : `${result.name}: failed — ${result.error}`,
    )
    .join(EOL)
}
