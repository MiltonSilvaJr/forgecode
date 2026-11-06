import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, location, request } from "./shared"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(Commands.commands.auth.commands.refresh, (input) =>
  refresh(input.target).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(subscriptionError(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

const refresh = Effect.fn("cli.auth.refresh")(function* (target: string) {
  const client = yield* createClient()
  const response = yield* request((signal) =>
    client.experimental.subscription.refresh({ integrationID: target, location }, { signal }),
  )
  const { state, expiresAt } = response.data
  process.stdout.write(`state: ${state}${expiresAt !== undefined ? ` (expires ${expiresAt})` : ""}` + EOL)
})

const subscriptionError = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined
  return code === undefined ? errorMessage(error) : `${code}: ${errorMessage(error)}`
}
