import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.status")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.status>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const report = yield* Effect.tryPromise({
    try: () => client.experimental.squad.liveness(),
    catch: (cause) => cause,
  })
  process.stdout.write((input.json ? JSON.stringify(report, null, 2) : formatStatus(report)) + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.status, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

interface CostSnapshot {
  cost?: number
  tokens?: { input?: number; output?: number }
  unknown: boolean
}

interface Report {
  generation: string | null
  inboxPending: number
  cost: CostSnapshot
  sessions: readonly {
    name: string
    state: string
    sessionID?: string
    provider: string
    model: string
    variant?: string
    inboxPending: number
    cost: CostSnapshot
    liveness: { verdict: string; lastActivity?: number; source?: string; workingStale: boolean; presumedDead: boolean; cause?: string }
  }[]
  previous: { id: string; sessions: readonly { name: string; sessionID?: string }[] } | null
}

function formatStatus(report: Report): string {
  const lines = [
    report.generation === null
      ? "No active generation"
      : `Generation ${report.generation} (inbox pending: ${report.inboxPending}, cost: ${formatCost(report.cost)})`,
  ]
  for (const row of report.sessions) {
    const activity =
      row.liveness.lastActivity === undefined
        ? "no measured activity"
        : `last activity ${new Date(row.liveness.lastActivity).toISOString()} (${row.liveness.source})`
    const flags = [
      row.liveness.workingStale ? "working_stale" : undefined,
      row.liveness.presumedDead ? "presumed_dead" : undefined,
      row.inboxPending > 0 ? `inbox_pending=${row.inboxPending}` : undefined,
    ].filter((flag) => flag !== undefined)
    const cause = row.liveness.cause === undefined ? "" : ` — ${row.liveness.cause}`
    lines.push(
      `  ${row.name} [${row.state}] ${row.liveness.verdict}${flags.length === 0 ? "" : ` {${flags.join(", ")}}`} ${row.sessionID ?? "-"} ${row.provider}/${row.model}${row.variant ? `#${row.variant}` : ""} cost ${formatCost(row.cost)} — ${activity}${cause}`,
    )
  }
  if (report.previous !== null) {
    lines.push(`Previous generation ${report.previous.id}`)
    for (const row of report.previous.sessions) lines.push(`  ${row.name} [closed] ${row.sessionID ?? "-"}`)
  }
  return lines.join(EOL)
}

function formatCost(cost: CostSnapshot): string {
  if (cost.cost === undefined) return "unknown"
  return `$${cost.cost.toFixed(4)} (${cost.tokens?.input ?? 0} in / ${cost.tokens?.output ?? 0} out tokens${cost.unknown ? ", partial" : ""})`
}
