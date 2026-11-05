import { Effect } from "effect"
import type { SessionInfo } from "@opencode/client/promise"
import type { OpenCodeClient } from "@opencode/client/promise"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

export type SessionRow = {
  id: string
  title: string
  model: string
  directory: string
  status: "busy" | "idle" | "archived"
}

export function sessionRow(_session: SessionInfo): SessionRow {
  return { id: "", title: "", model: "", directory: "", status: "idle" }
}

export async function listSessions(
  _client: OpenCodeClient,
  _input: { project: string; signal?: AbortSignal },
): Promise<SessionInfo[]> {
  return []
}

export default Runtime.handler(Commands.commands.sessions, () => Effect.void)
