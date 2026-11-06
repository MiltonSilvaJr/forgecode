import { Effect } from "effect"
import { EOL } from "node:os"
import { errorMessage } from "../util/error"

export type SquadError = { code: string; message: string; details: Record<string, unknown> }

/**
 * Map a thrown error to the CLI's machine-readable `{code, message, details}` shape.
 * `code` is the tagged error name (`ForbiddenError`, `ConflictError`, …), a client
 * `ClientError`, or an explicit `code` attached by a squad command (e.g. `invalid_config`).
 */
export function toSquadError(error: unknown): SquadError {
  if (typeof error === "object" && error !== null) {
    const explicit = "code" in error && typeof error.code === "string" ? error.code : undefined
    const name =
      "name" in error && typeof error.name === "string" && error.name !== "Error" ? error.name : undefined
    return { code: explicit ?? name ?? "Error", message: errorMessage(error), details: {} }
  }
  return { code: "Error", message: errorMessage(error), details: {} }
}

/** Write a failed command's error — JSON on stdout under `--json`, text on stderr otherwise — and set exit code 1. */
export function writeSquadError(error: unknown, json: boolean) {
  const mapped = toSquadError(error)
  const output = json ? JSON.stringify({ error: mapped }) : mapped.message
  return Effect.sync(() => {
    if (json) process.stdout.write(output + EOL)
    else process.stderr.write(output + EOL)
    process.exitCode = 1
  })
}

/** Read a message from a UTF-8 file; a missing, unreadable or empty file fails before anything is enqueued. */
export async function readMessageFile(file: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  let content: string
  try {
    content = await Bun.file(file).text()
  } catch {
    return { ok: false, error: `cannot read message file ${file}` }
  }
  if (content.trim().length === 0) return { ok: false, error: "message file is empty" }
  return { ok: true, text: content }
}

/** Describe an enqueue acknowledgement; it states acceptance only, never reading or processing. */
export function formatEnqueue(proof: { messageID: string; name: string; sessionID: string; delivery: string; at: number }) {
  return `Queued message ${proof.messageID} for ${proof.name} (${proof.sessionID}) delivery ${proof.delivery} at ${new Date(proof.at).toISOString()}`
}
