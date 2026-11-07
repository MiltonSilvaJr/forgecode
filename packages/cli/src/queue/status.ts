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
  client: OpenCodeClient,
  input: { sessionID: string; readAudit: AuditReader; limit: number; signal?: AbortSignal },
): Promise<QueueItem[]> {
  const inbox = await client.session.inbox.list(
    { sessionID: input.sessionID },
    ...(input.signal ? [{ signal: input.signal }] : []),
  )
  const auditLines = (await input.readAudit(input.sessionID, input.limit)).slice(0, input.limit)

  const pendingByID = new Map(inbox.map((item) => [item.id, item]))
  const auditByID = new Map(
    auditLines.filter((line) => line.messageID !== null).map((line) => [line.messageID as string, line]),
  )

  const items: QueueItem[] = []
  for (const item of inbox) {
    items.push({
      id: item.id,
      created: new Date(item.time.created).toISOString(),
      delivery: item.delivery,
      state: "pending",
      target: auditByID.get(item.id)?.target ?? null,
    })
  }
  for (const line of auditLines) {
    if (line.messageID === null || pendingByID.has(line.messageID)) continue
    items.push({
      id: line.messageID,
      created: line.timestamp,
      delivery: line.delivery,
      state: await messageState(client, input.sessionID, line.messageID, input.signal),
      target: line.target,
    })
  }
  items.sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0))
  return items
}

async function messageState(
  client: OpenCodeClient,
  sessionID: string,
  messageID: string,
  signal?: AbortSignal,
): Promise<QueueItemState> {
  try {
    await client.session.message.get({ sessionID, messageID }, ...(signal ? [{ signal }] : []))
    return "delivered"
  } catch (cause) {
    const tag = (cause as { _tag?: unknown } | null)?._tag
    return tag === "MessageNotFoundError" || tag === "SessionNotFoundError" ? "cancelled" : "unknown"
  }
}
