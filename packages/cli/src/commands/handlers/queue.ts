import { OpenCode } from "@opencode/client"
import { ClientError } from "@opencode/client/promise"
import { Service } from "@opencode/client/effect/service"
import { Global } from "@opencode/util/global"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands, Server as ServerFlag } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { errorMessage } from "../../util/error"
import { appendAuditLine } from "../../queue/audit"
import { enqueueAll, enqueueOne, validateIdempotencyKey } from "../../queue/enqueue"
import { resolveForgeQueueEnabled } from "../../queue/flag"
import { formatQueued } from "../../queue/format"
import {
  ambiguousMessage,
  listEligibleTargets,
  notFoundMessage,
  previousGenerationMessage,
  resolveByName,
  tooManyMessage,
} from "../../queue/target"

const MISSING_DESTINATION = "one of --thread, --to, or --all is required"
const DESTINATION_EXCLUSIVE = "--thread, --to, and --all are mutually exclusive"
const MESSAGE_EXCLUSIVE = "--message and --message-file are mutually exclusive"
const MESSAGE_REQUIRED = "one of --message or --message-file is required"
const FLAG_DISABLED = "ForgeQueue is disabled; set experimental.forgequeue.enabled to true in opencode.json"
const NO_TARGETS = "no targets in the current generation"

type Destination = { sessionID: string; target: string | null }
type ResolveInput = { thread?: string; to?: string; all: boolean; allowSelf: boolean }

const handler = Effect.fn("cli.queue")(function* (input: Runtime.Input<typeof Commands.commands.queue>) {
  const key = validateIdempotencyKey(Option.getOrUndefined(input.idempotencyKey))
  if (!key.ok) return yield* writeError(2, key.message)

  const delivery = input.delivery
  if (delivery !== "queue" && delivery !== "steer")
    return yield* writeError(2, "invalid delivery: expected queue or steer")

  const thread = Option.getOrUndefined(input.thread)
  const to = Option.getOrUndefined(input.to)
  const modes = [thread, to, input.all].filter((mode) => mode !== undefined && mode !== false).length
  if (modes === 0) return yield* writeError(2, MISSING_DESTINATION)
  if (modes > 1) return yield* writeError(2, DESTINATION_EXCLUSIVE)

  const message = Option.getOrUndefined(input.message)
  const messageFile = Option.getOrUndefined(input.messageFile)
  if (message !== undefined && messageFile !== undefined) return yield* writeError(2, MESSAGE_EXCLUSIVE)
  if (message === undefined && messageFile === undefined) return yield* writeError(2, MESSAGE_REQUIRED)

  const read =
    messageFile !== undefined
      ? yield* Effect.promise(() => readMessageFile(messageFile))
      : { ok: true as const, text: message as string }
  if (!read.ok) return yield* writeError(1, read.error)

  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })

  const config = yield* Effect.tryPromise(() => client.config.get({ location: { directory: process.cwd() } }))
  if (!resolveForgeQueueEnabled(config)) return yield* writeError(1, FLAG_DISABLED)

  const location = yield* Effect.tryPromise(() => client.location.get({ location: { directory: process.cwd() } }))
  const destinations = yield* Effect.promise(() =>
    resolveDestinations(client, { thread, to, all: input.all, allowSelf: input.allowSelf }, location.project.id),
  )
  if (destinations.error) return yield* writeError(1, destinations.error)

  const data = yield* Global.Service
  const audit = { append: (line: Parameters<typeof appendAuditLine>[1]) => appendAuditLine(data.data, line) }
  const common = {
    text: read.text,
    delivery: delivery as "queue" | "steer",
    idempotencyKey: key.key,
    allowSelf: input.allowSelf,
    serverUrl: server.endpoint.url,
    audit,
  }
  const results = input.all
    ? yield* Effect.promise(() => enqueueAll(client, { targets: destinations.targets, ...common }))
    : [
        yield* Effect.promise(() =>
          enqueueOne(client, { sessionID: destinations.targets[0].sessionID, target: destinations.targets[0].target, ...common }),
        ),
      ]
  if (input.all && results.length === 0) return yield* writeError(1, NO_TARGETS)

  const output = input.json
    ? results.length === 1
      ? JSON.stringify(toJson(results[0]), null, 2)
      : JSON.stringify(results.map(toJson), null, 2)
    : results.map(formatText).join(EOL)
  if (output) yield* Effect.promise(() => writeStdout(output + EOL))
  process.exitCode = results.some((result) => result.status === "failed") ? 1 : 0
})

export default Runtime.handler(Commands.commands.queue, (input) =>
  Effect.gen(function* () {
    const serverFlag = yield* Effect.serviceOption(ServerFlag).pipe(Effect.map(Option.flatten))
    const serverUrl = Option.getOrUndefined(serverFlag)
    return yield* handler(input).pipe(
      Effect.catch((cause) => writeError(1, toUserMessage(cause, serverUrl))),
    )
  }),
)

async function resolveDestinations(
  client: ReturnType<typeof OpenCode.make>,
  input: ResolveInput,
  project: string,
): Promise<{ targets: Destination[]; error?: string }> {
  if (input.thread !== undefined) return { targets: [{ sessionID: input.thread, target: null }] }
  if (input.to !== undefined) {
    const result = await resolveByName({ client, project, name: input.to })
    switch (result.type) {
      case "found":
        return { targets: [{ sessionID: result.session.id, target: input.to }] }
      case "ambiguous":
        return {
          targets: [],
          error:
            ambiguousMessage(input.to) +
            EOL +
            result.sessions.map((session) => `${session.id} ${session.location.directory}`).join(EOL),
        }
      case "previous-generation":
        return { targets: [], error: previousGenerationMessage(input.to, result.session.id) }
      case "too-many":
        return { targets: [], error: tooManyMessage(input.to) }
      case "not-found":
        return { targets: [], error: notFoundMessage(input.to) }
    }
  }
  const eligible = await listEligibleTargets({ client, project })
  const targets = eligible.map((session) => ({ sessionID: session.id, target: session.title ?? null }))
  return { targets }
}

async function readMessageFile(file: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let content: string
  try {
    content = await Bun.file(file).text()
  } catch {
    return { ok: false, error: `cannot read message file ${file}` }
  }
  if (content.trim().length === 0) return { ok: false, error: "message file is empty" }
  return { ok: true, text: content }
}

function formatText(result: Awaited<ReturnType<typeof enqueueOne>>): string {
  if (result.status === "failed") return `failed ${result.sessionID}: ${result.error}`
  return formatQueued(result, false)
}

function toJson(result: Awaited<ReturnType<typeof enqueueOne>>) {
  return {
    id: result.messageID,
    sessionID: result.sessionID,
    delivery: result.delivery,
    created: result.created,
    target: result.target,
    idempotencyKey: result.idempotencyKey,
    status: result.status,
  }
}

function toUserMessage(cause: unknown, server?: string): string {
  if (cause instanceof ClientError && cause.reason === "Transport")
    return `cannot reach the ForgeCode server at ${server ?? "the background service"}`
  if (cause instanceof Error && cause.cause instanceof ClientError && cause.cause.reason === "Transport")
    return `cannot reach the ForgeCode server at ${server ?? "the background service"}`
  return errorMessage(cause)
}

const writeError = (code: number, message: string) =>
  Effect.sync(() => {
    process.stderr.write(message + EOL)
    process.exitCode = code
  })

const writeStdout = (output: string) =>
  new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (error) => (error ? reject(error) : resolve()))
  })
