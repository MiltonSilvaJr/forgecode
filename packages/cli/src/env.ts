import { Config } from "effect"

// Every environment variable the CLI reads, in one place. Consumers yield
// these instead of touching process.env so the full surface stays visible,
// typed, and redacted where secret.

const passwordNames = new Set([
  "FORGECODE_PASSWORD",
  "OPENCODE_PASSWORD",
  "FORGECODE_SERVER_PASSWORD",
  "OPENCODE_SERVER_PASSWORD",
])

// The forgecode server password: sent by clients connecting to an explicit
// --server, and adopted by a manually run or standalone server. The OpenCode
// spellings are still honored for compatibility.
export const password = Config.Redacted("FORGECODE_PASSWORD").pipe(
  Config.orElse(() => Config.Redacted("OPENCODE_PASSWORD")),
  Config.orElse(() => Config.Redacted("FORGECODE_SERVER_PASSWORD")),
  Config.orElse(() => Config.Redacted("OPENCODE_SERVER_PASSWORD")),
  Config.withDefault(undefined),
)

export function session() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !passwordNames.has(entry[0]),
    ),
  )
}

export * as Env from "./env"
