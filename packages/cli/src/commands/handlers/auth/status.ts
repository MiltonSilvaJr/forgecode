import { EOL } from "node:os"
import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(Commands.commands.auth.commands.status, () =>
  Effect.sync(() => {
    process.stdout.write(JSON.stringify({ enabled: true, providers: [] }) + EOL)
  }),
)
