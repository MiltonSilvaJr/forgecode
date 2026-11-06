import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, location, request } from "./shared"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(Commands.commands.auth.commands.test, (input) =>
  test(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(subscriptionError(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

const test = Effect.fn("cli.auth.test")(function* (input) {
  const client = yield* createClient()
  const response = yield* request((signal) =>
    client.experimental.subscription.test(
      { integrationID: input.target, model: Option.getOrUndefined(input.model), location },
      { signal },
    ),
  )
  const { ok, latencyMs, model } = response.data
  if (input.json) {
    process.stdout.write(JSON.stringify({ ok, latencyMs, model }, null, 2) + EOL)
    return
  }
  process.stdout.write(`ok: ${ok} (${latencyMs}ms)${model !== undefined ? ` model: ${model}` : ""}` + EOL)
})

const subscriptionError = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined
  return code === undefined ? errorMessage(error) : `${code}: ${errorMessage(error)}`
}
