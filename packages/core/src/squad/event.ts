export * as SquadEvent from "./event.js"

import { Schema } from "effect"
import { Bus } from "../bus.js"

export const GenerationOpened = Bus.ephemeral({
  type: "squad.generation.opened",
  schema: { generation: Schema.String },
})

export const Event = { GenerationOpened }
