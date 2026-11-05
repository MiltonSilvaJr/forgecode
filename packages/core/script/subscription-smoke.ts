import { Effect } from "effect"

export type SmokeOutcome = "skipped" | "ok" | "failed"

/** Stub: the opt-in probe has not learned to skip yet. */
export function smokeKimi(_env: Record<string, string | undefined>): Effect.Effect<SmokeOutcome> {
  return Effect.succeed("ok")
}
