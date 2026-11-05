import type { OpenCodeClient } from "@opencode/client/promise"

export type ActivityState = "busy" | "idle" | "unknown"

export type ActivitySnapshot = {
  state: ActivityState
  lastMessageAt: string | null
  pendingCount: number
  outcome: string | null
  observedAt: string
}

export type ActivityEvent = { type: string; created?: number; data?: unknown }

export async function snapshotActivity(
  client: OpenCodeClient,
  input: { sessionID: string; signal?: AbortSignal },
): Promise<ActivitySnapshot> {
  const session = await client.session.get(
    { sessionID: input.sessionID },
    ...(input.signal ? [{ signal: input.signal }] : []),
  )
  const state: ActivityState =
    session.time.busy !== undefined && session.time.busy > (session.time.idle ?? 0)
      ? "busy"
      : session.time.idle !== undefined
        ? "idle"
        : "unknown"

  const messages = await client.message.list(
    { sessionID: input.sessionID, limit: 1, order: "desc" },
    ...(input.signal ? [{ signal: input.signal }] : []),
  )
  const lastMessageAt = messages.data[0] ? new Date(messages.data[0].time.created).toISOString() : null

  const inbox = await client.session.inbox.list(
    { sessionID: input.sessionID },
    ...(input.signal ? [{ signal: input.signal }] : []),
  )

  return {
    state,
    lastMessageAt,
    pendingCount: inbox.length,
    outcome: session.outcome ?? null,
    observedAt: new Date().toISOString(),
  }
}

export async function watchActivity(input: {
  events: AsyncIterable<ActivityEvent>
  sessionID: string
  timeoutMs: number
}): Promise<{ type: string; created: number } | null> {
  return Promise.race([
    (async () => {
      for await (const event of input.events) {
        const sessionID = (event.data as { sessionID?: string } | undefined)?.sessionID
        if (sessionID === input.sessionID && event.created !== undefined)
          return { type: event.type, created: event.created }
      }
      return null
    })(),
    new Promise<null>((resolve) => {
      const timer = setTimeout(() => resolve(null), input.timeoutMs)
      if (typeof timer.unref === "function") timer.unref()
    }),
  ])
}
