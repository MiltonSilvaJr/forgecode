import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import type { OpenCodeClient, SessionInfo } from "@opencode/client/promise"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { ServerConnection } from "../../services/server-connection"
import { errorMessage } from "../../util/error"

export type SessionRow = {
  id: string
  title: string
  model: string
  directory: string
  status: "busy" | "idle" | "archived"
}

const PAGE_LIMIT = 100

export function sessionRow(session: SessionInfo): SessionRow {
  return {
    id: session.id,
    title: session.title ?? "-",
    model: session.model ? `${session.model.providerID}/${session.model.id}` : "-",
    directory: session.location.directory,
    status: sessionStatus(session),
  }
}

export async function listSessions(
  client: OpenCodeClient,
  input: { project: string; signal?: AbortSignal },
): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await client.session.list(
      {
        project: input.project,
        parentID: null,
        order: "desc",
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      },
      ...(input.signal ? [{ signal: input.signal }] : []),
    )
    sessions.push(...page.data)
    if (!page.cursor.next || page.data.length === 0) return sessions
    cursor = page.cursor.next
  }
}

const handler = Effect.fn("cli.sessions")(function* (input: Runtime.Input<typeof Commands.commands.sessions>) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const location = yield* Effect.tryPromise(() => client.location.get({ location: { directory: process.cwd() } }))
  const sessions = yield* Effect.promise(() => listSessions(client, { project: location.project.id }))
  const rows = sessions
    .filter((session) => input.all || session.time.archived === undefined)
    .map(sessionRow)
  const output = input.json ? JSON.stringify(rows, null, 2) : rows.map(formatRow).join(EOL)
  if (output) yield* Effect.promise(() => writeStdout(output + EOL))
})

export default Runtime.handler(Commands.commands.sessions, (input) =>
  handler(input).pipe(
    Effect.catch((cause) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(cause) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

function sessionStatus(session: SessionInfo): "busy" | "idle" | "archived" {
  if (session.time.archived !== undefined) return "archived"
  if (session.time.busy !== undefined && session.time.busy > (session.time.idle ?? 0)) return "busy"
  return "idle"
}

function formatRow(row: SessionRow): string {
  return [row.id, row.title, row.model, row.directory, row.status].join("\t")
}

const writeStdout = (output: string) =>
  new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (error) => (error ? reject(error) : resolve()))
  })
