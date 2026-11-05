import { intro, log, outro, spinner } from "@clack/prompts"
import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { handlePromptErrors, requireInteractive } from "../../../ui/prompt"
import { createClient, isSubscriptionProvider, loadIntegrations, request } from "./shared"
import { chooseCredential, chooseIntegration } from "./account"
import { errorMessage } from "../../../util/error"

export default Runtime.handler(
  Commands.commands.auth.commands.logout,
  Effect.fn("cli.auth.logout")((input) => {
    const target = Option.getOrUndefined(input.target)
    if (target !== undefined && isSubscriptionProvider(target)) {
      return subscriptionLogout(target).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            process.stderr.write(subscriptionError(error) + EOL)
            process.exitCode = 1
          }),
        ),
      )
    }
    return logout({
      target,
      credential: Option.getOrUndefined(input.credential),
    }).pipe(handlePromptErrors)
  }),
)

const logout = Effect.fn("cli.auth.logout.run")(function* (input: {
  target?: string
  credential?: string
}) {
  if (!input.target)
    yield* requireInteractive("Pass an integration ID or name when running without an interactive terminal")
  if (!input.credential)
    yield* requireInteractive("Pass a credential ID or label when running without an interactive terminal")
  intro("Log out of an account")
  const client = yield* createClient()
  const integrations = yield* loadIntegrations(client)
  const integration = yield* chooseIntegration(integrations, input.target)
  const credentialID = yield* chooseCredential(integration, "log out", input.credential)
  const progress = spinner()
  progress.start("Removing credential...")
  yield* request((signal) => client.credential.remove({ credentialID }, { signal })).pipe(
    Effect.tap(() => Effect.sync(() => progress.stop(`Removed account from ${integration.name}`))),
    Effect.tapCause(() => Effect.sync(() => progress.stop("Failed to remove credential", 1))),
  )
  outro("Done")
})

const subscriptionLogout = Effect.fn("cli.auth.logout.subscription")(function* (target: string) {
  process.stderr.write("stub: not implemented\n")
  process.exitCode = 1
})

const subscriptionError = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined
  return code === undefined ? errorMessage(error) : `${code}: ${errorMessage(error)}`
}
