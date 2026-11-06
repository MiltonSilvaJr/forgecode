import { DateTime } from "effect"
import { Location } from "@opencode/schema/location"
import { Money } from "@opencode/schema/money"
import { Project } from "@opencode/schema/project"
import { Session } from "@opencode/schema/session"
import { AbsolutePath } from "@opencode/core/schema"

export interface InfoOptions {
  readonly id?: string
  readonly busy?: number
  readonly idle?: number
  readonly updated?: number
  readonly title?: string
  readonly outcome?: "succeeded" | "failed" | "interrupted"
  readonly model?: { providerID: string; id: string; variant?: string }
  readonly cost?: number
  readonly input?: number
  readonly output?: number
}

export const info = (options: InfoOptions = {}) =>
  Session.Info.make({
    id: Session.ID.make(options.id ?? "ses_info"),
    projectID: Project.ID.make("squad-project"),
    cost: Money.USD.make(options.cost ?? 0),
    tokens: { input: options.input ?? 0, output: options.output ?? 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
    ...(options.model === undefined ? {} : { model: options.model as never }),
    time: {
      created: DateTime.makeUnsafe(0),
      updated: DateTime.makeUnsafe(options.updated ?? 0),
      ...(options.busy === undefined ? {} : { busy: DateTime.makeUnsafe(options.busy) }),
      ...(options.idle === undefined ? {} : { idle: DateTime.makeUnsafe(options.idle) }),
    },
    ...(options.title === undefined ? {} : { title: options.title }),
    location: Location.Ref.make({ directory: AbsolutePath.make("/squad/x") }),
  })
