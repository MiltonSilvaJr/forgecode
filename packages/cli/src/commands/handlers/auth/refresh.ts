import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(Commands.commands.auth.commands.refresh, () =>
  Effect.sync(() => {
    process.stderr.write("stub: not implemented\n")
    process.exitCode = 1
  }),
)
