import type { OpenCodeClient, SessionInfo } from "@opencode/client/promise"

export type ResolveByNameResult =
  | { type: "found"; session: SessionInfo }
  | { type: "not-found"; name: string }
  | { type: "ambiguous"; name: string; sessions: SessionInfo[] }
  | { type: "previous-generation"; name: string; session: SessionInfo }
  | { type: "too-many"; name: string }

export async function resolveByName(_input: {
  client: OpenCodeClient
  project: string
  name: string
  signal?: AbortSignal
}): Promise<ResolveByNameResult> {
  return { type: "not-found", name: "" }
}
