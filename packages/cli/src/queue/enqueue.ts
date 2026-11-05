import type { OpenCodeClient } from "@opencode/client/promise"
import type { AuditLine } from "./audit"

export type AuditSink = { append(line: AuditLine): Promise<boolean> }

export type EnqueueResult = {
  sessionID: string
  target: string | null
  delivery: "queue" | "steer"
  idempotencyKey: string
  messageID: string | null
  status: "queued" | "failed"
  error: string | null
}

export const deriveMessageID = (key: string) => key

export function validateIdempotencyKey(
  _key: string | undefined,
): { ok: true; key: string } | { ok: false; code: 2; message: string } {
  return { ok: false, code: 2, message: "missing required --idempotency-key" }
}

export async function enqueueOne(
  _client: OpenCodeClient,
  input: {
    sessionID: string
    text: string
    delivery: "queue" | "steer"
    idempotencyKey: string
    target: string | null
    allowSelf: boolean
    serverUrl: string
    audit: AuditSink
    signal?: AbortSignal
  },
): Promise<EnqueueResult> {
  return {
    sessionID: input.sessionID,
    target: input.target,
    delivery: input.delivery,
    idempotencyKey: input.idempotencyKey,
    messageID: null,
    status: "failed",
    error: null,
  }
}
