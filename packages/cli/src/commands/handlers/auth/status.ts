import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { createClient, location, request } from "./shared"
import { errorMessage } from "../../../util/error"

const PROVIDERS = ["claude-code", "codex-chatgpt", "kimi-code"] as const

export default Runtime.handler(Commands.commands.auth.commands.status, (input) =>
  status(Option.getOrUndefined(input.provider), input.json).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(subscriptionError(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

const status = Effect.fn("cli.auth.status")(function* (provider: string | undefined, json: boolean) {
  const client = yield* createClient()
  const response = yield* request((signal) => client.experimental.subscription.status({ location }, { signal }))
  const providers =
    provider === undefined ? response.data.providers : response.data.providers.filter((item) => item.id === provider)
  if (provider !== undefined && providers.length === 0) return yield* Effect.fail(providerUnsupported(provider))
  if (json) {
    process.stdout.write(JSON.stringify({ enabled: response.data.enabled, providers }, null, 2) + EOL)
    return
  }
  const lines = providers.map((item) => [item.id, item.source ?? "-", item.expiresAt ?? "-", item.state].join("  "))
  process.stdout.write(lines.join(EOL) + EOL)
})

const providerUnsupported = (target: string) =>
  Object.assign(new Error(`Unsupported subscription provider: ${target}. Available: ${PROVIDERS.join(", ")}`), {
    code: "provider_unsupported",
  })

const subscriptionError = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined
  return code === undefined ? errorMessage(error) : `${code}: ${errorMessage(error)}`
}
