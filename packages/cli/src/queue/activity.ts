import type { OpenCodeClient } from "@opencode/client/promise"

export type ActivityState = "busy" | "idle" | "unknown"

export type ActivitySnapshot = {
  state: ActivityState
  lastMessageAt: string | null
  pendingCount: number
  outcome: string | null
  observedAt: string
}

export type ActivityEvent = { type: string; created: number; data?: { sessionID?: string } }

export async function snapshotActivity(
  _client: OpenCodeClient,
  _input: { sessionID: string; signal?: AbortSignal },
): Promise<ActivitySnapshot> {
  return { state: "unknown", lastMessageAt: null, pendingCount: 0, outcome: null, observedAt: "" }
}

export async function watchActivity(_input: {
  events: AsyncIterable<ActivityEvent>
  sessionID: string
  timeoutMs: number
}): Promise<{ type: string; created: number } | null> {
  return null
}
