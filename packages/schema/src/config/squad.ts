export * as ConfigSquad from "./squad.js"

import { Duration, Effect, Schema } from "effect"
import { optional } from "../schema.js"

const PositiveDuration = Schema.DurationFromString.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => (Duration.toMillis(value) > 0 ? undefined : "Expected a positive duration"),
      {
        expected: "a positive duration",
        representation: { id: "squad/positive-duration", payload: null },
        toJsonSchema: () => ({ type: "string" }),
        toCode: () => ({ runtime: "Schema.DurationFromString" }),
        arbitraryConstraint: {},
      },
    ),
  ),
)

const Liveness = Schema.Struct({
  stale_after: PositiveDuration,
  dead_after: PositiveDuration,
})
  .check(
    Schema.makeFilter(
      (value) =>
        Duration.toMillis(value.dead_after) > Duration.toMillis(value.stale_after)
          ? undefined
          : "Expected dead_after to be greater than stale_after",
      {
        expected: "dead_after greater than stale_after",
        representation: { id: "squad/dead-after-greater", payload: null },
        toJsonSchema: () => ({}),
        toCode: () => ({ runtime: "Schema.Struct" }),
        arbitraryConstraint: {},
      },
    ),
  )
  .annotate({ identifier: "Config.Squad.Liveness" })

const Launch = Schema.Struct({
  verify_timeout: PositiveDuration,
}).annotate({ identifier: "Config.Squad.Launch" })

const Checkpoint = Schema.Struct({
  max_bytes: Schema.Number,
}).annotate({ identifier: "Config.Squad.Checkpoint" })

const Credential = Schema.Struct({
  expiry_warn: PositiveDuration,
}).annotate({ identifier: "Config.Squad.Credential" })

const Panel = Schema.Struct({
  jira_command: Schema.String.pipe(optional),
  ci_command: Schema.String.pipe(optional),
  ci_evidence: Schema.String.pipe(optional),
}).annotate({ identifier: "Config.Squad.Panel" })

export class Info extends Schema.Class<Info>("Config.Squad")({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  state_dir: Schema.String.pipe(optional),
  liveness: Liveness.pipe(optional),
  writer_scope: Schema.Literals(["worktree", "repository"]).pipe(optional),
  launch: Launch.pipe(optional),
  checkpoint: Checkpoint.pipe(optional),
  credential: Credential.pipe(optional),
  panel: Panel.pipe(optional),
}) {}
