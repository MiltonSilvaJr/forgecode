import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServerConnection } from "../../../services/server-connection"
import { writeSquadError } from "../../squad"

const handler = Effect.fn("cli.squad.check")(function* (
  input: Runtime.Input<typeof Commands.commands.squad.commands.check>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const report = yield* Effect.tryPromise({
    try: () => client.experimental.squad.check(),
    catch: (cause) => cause,
  })
  const output = input.json ? JSON.stringify(report, null, 2) : formatCheck(report)
  process.stdout.write(output + EOL)
})

export default Runtime.handler(Commands.commands.squad.commands.check, (input) =>
  handler(input).pipe(Effect.catch((cause) => writeSquadError(cause, input.json))),
)

function formatCheck(report: { sessions: readonly { name: string; credential: string; checks: readonly { check: string; verdict: string; reason?: string }[] }[] }): string {
  return report.sessions
    .map((entry) => {
      const failures = entry.checks.filter((check) => check.verdict === "fail")
      const warnings = entry.checks.filter((check) => check.verdict === "warn")
      const lines = [`${entry.name}: credential ${entry.credential}`]
      for (const check of [...failures, ...warnings]) {
        lines.push(`  [${check.verdict}] ${check.check}${check.reason ? ` — ${check.reason}` : ""}`)
      }
      if (failures.length === 0 && warnings.length === 0) lines.push("  [ok] all checks passed")
      return lines.join(EOL)
    })
    .join(EOL)
}
