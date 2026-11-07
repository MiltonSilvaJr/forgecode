import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { writeSquadError } from "../squad"

const MISSING_GENERATION = "missing required --generation"
const MISSING_CONFIG = "missing required --config"

export default Runtime.handler(Commands.commands.squad.commands.init, (input) =>
  init(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

const init = Effect.fn("cli.squad.init")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.init>,
) {
  const generation = Option.getOrUndefined(input.generation)
  if (generation === undefined) return yield* usageError(MISSING_GENERATION)
  const configFile = Option.getOrUndefined(input.config)
  if (configFile === undefined) return yield* usageError(MISSING_CONFIG)

  const config = yield* Effect.promise(() => readConfig(configFile))
  if (!config.ok) return yield* Effect.fail(configError(config.error))

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })

  const created = yield* Effect.tryPromise({
    try: () =>
      client.experimental.squad.generation.create({
        generation,
        sessions: config.sessions,
        replace: input.replace,
        reason: Option.getOrUndefined(input.reason),
        idempotencyKey: Option.getOrUndefined(input.idempotencyKey),
      }),
    catch: (cause) => cause,
  })

  const output = input.json
    ? JSON.stringify(created, null, 2)
    : `Created generation ${created.id} with ${created.sessions.length} session(s)`
  process.stdout.write(output + EOL)
})

const usageError = (message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = 2
  })

const configError = (message: string) => Object.assign(new Error(message), { code: "invalid_config" })

type SquadSession = {
  name: string
  role: "orchestrator" | "worker"
  provider: string
  model: string
  variant?: string
  location: { directory: string; workspaceID?: string }
  branch?: string
  sessionID?: string
}

async function readConfig(file: string): Promise<{ ok: true; sessions: SquadSession[] } | { ok: false; error: string }> {
  let content: string
  try {
    content = await Bun.file(file).text()
  } catch {
    return { ok: false, error: `cannot read config file ${file}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { ok: false, error: "config file is not valid JSON" }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'config file must be an object with a "sessions" array' }
  }
  const sessions = (parsed as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) return { ok: false, error: 'config file must contain a "sessions" array' }
  return { ok: true, sessions: sessions as SquadSession[] }
}
