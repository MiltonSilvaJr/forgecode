import path from "node:path"

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
  return path.join(dataDirectory, "forgequeue")
}

export async function appendAuditLine(_dataDirectory: string, _line: AuditLine): Promise<boolean> {
  return true
}

export async function readAuditLines(
  _dataDirectory: string,
  _sessionID: string,
  _limit: number,
): Promise<AuditLine[]> {
  return []
}
