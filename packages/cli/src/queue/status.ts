import type { OpenCodeClient } from "@opencode/client/promise"
import type { AuditLine } from "./audit"

export type QueueItemState = "pending" | "delivered" | "cancelled" | "unknown"

export type QueueItem = {
  id: string
  created: string
  delivery: "queue" | "steer"
  state: QueueItemState
  target: string | null
}

export type AuditReader = (sessionID: string, limit: number) => Promise<AuditLine[]>

export async function listQueueItems(
  _client: OpenCodeClient,
  _input: { sessionID: string; readAudit: AuditReader; limit: number; signal?: AbortSignal },
): Promise<QueueItem[]> {
  return []
}
