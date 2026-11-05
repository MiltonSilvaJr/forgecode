import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(Commands.commands.auth.commands.test, () =>
  Effect.sync(() => {
    process.stdout.write(JSON.stringify({ ok: false, latencyMs: 0 }) + "\n")
  }),
)
