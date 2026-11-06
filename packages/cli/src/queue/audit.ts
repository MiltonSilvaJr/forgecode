import fs from "node:fs/promises"
import path from "node:path"

const AUDIT_DIR = "forgequeue"
const AUDIT_FILE = "audit.jsonl"
const ERROR_MAX_LENGTH = 200
const SCHEMA_VERSION = 1

export type AuditLine = {
  schema_version: 1
  timestamp: string
  command: string
  target: string | null
  sessionID: string
  messageID: string | null
  delivery: "queue" | "steer"
  idempotencyKey: string
  result: "queued" | "failed"
  error: string | null
}

export function auditDirectory(dataDirectory: string): string {
  return path.join(dataDirectory, AUDIT_DIR)
}

/**
 * Append one audit line. Never throws: a write failure warns on stderr and returns false,
 * because the durable enqueue record is `session.inbox.enqueued`, not this local trail.
 */
export async function appendAuditLine(dataDirectory: string, line: AuditLine): Promise<boolean> {
  const directory = auditDirectory(dataDirectory)
  const record = JSON.stringify({ ...line, error: truncate(line.error) }) + "\n"
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    await fs.appendFile(path.join(directory, AUDIT_FILE), record, { mode: 0o600 })
    return true
  } catch (cause) {
    process.stderr.write(`forgequeue: warning: failed to write audit line: ${errorMessage(cause)}\n`)
    return false
  }
}

/** Read audit lines for one session, newest first, truncated to `limit`. Corrupt lines are skipped. */
export async function readAuditLines(
  dataDirectory: string,
  sessionID: string,
  limit: number,
): Promise<AuditLine[]> {
  const file = path.join(auditDirectory(dataDirectory), AUDIT_FILE)
  let text: string
  try {
    text = await fs.readFile(file, "utf8")
  } catch {
    return []
  }
  const lines: AuditLine[] = []
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      process.stderr.write("forgequeue: warning: ignoring corrupt audit line\n")
      continue
    }
    if (!isAuditLine(parsed) || parsed.schema_version !== SCHEMA_VERSION || parsed.sessionID !== sessionID) continue
    lines.push(parsed)
  }
  lines.reverse()
  return lines.slice(0, limit)
}

function truncate(error: string | null): string | null {
  if (error === null) return null
  return error.length > ERROR_MAX_LENGTH ? error.slice(0, ERROR_MAX_LENGTH) : error
}

function isAuditLine(value: unknown): value is AuditLine {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema_version" in value &&
    "sessionID" in value &&
    "messageID" in value
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
