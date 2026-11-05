import type { EnqueueResult } from "./enqueue"

/** Render one enqueue result as text or JSON. */
export function formatQueued(result: EnqueueResult, json: boolean): string {
  if (json)
    return JSON.stringify({
      id: result.messageID,
      sessionID: result.sessionID,
      delivery: result.delivery,
      created: result.created,
      target: result.target,
      idempotencyKey: result.idempotencyKey,
      status: result.status,
    })
  return `Queued message ${result.messageID} for thread ${result.sessionID}`
}
