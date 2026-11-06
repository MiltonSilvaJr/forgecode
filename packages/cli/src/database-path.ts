import path from "node:path"
import { env } from "@opencode/util/identity"
import { OPENCODE_CHANNEL } from "./version"

export function databasePath(data: string) {
  const filename =
    env("DB") ??
    (["latest", "dev", "beta", "next", "prod"].includes(OPENCODE_CHANNEL) ||
    env("DISABLE_CHANNEL_DB") === "1" ||
    env("DISABLE_CHANNEL_DB") === "true"
      ? "forgecode.db"
      : `forgecode-${OPENCODE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
