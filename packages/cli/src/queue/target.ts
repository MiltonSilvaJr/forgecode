import type { OpenCodeClient, SessionInfo } from "@opencode/client/promise"

const PAGE_LIMIT = 50
const MAX_PAGES = 10

export type ResolveByNameResult =
  | { type: "found"; session: SessionInfo }
  | { type: "not-found"; name: string }
  | { type: "ambiguous"; name: string; sessions: SessionInfo[] }
  | { type: "previous-generation"; name: string; session: SessionInfo }
  | { type: "too-many"; name: string }

export const notFoundMessage = (name: string) => `Session "${name}" not found in the current generation`
export const ambiguousMessage = (name: string) => `Session "${name}" is ambiguous`
export const previousGenerationMessage = (name: string, id: string) =>
  `Session "${name}" belongs to a previous generation (archived): ${id}`
export const tooManyMessage = (name: string) => `too many sessions match "${name}"`

type Search = {
  matches: SessionInfo[]
  stoppedAtLimit: boolean
}

export async function resolveByName(input: {
  client: OpenCodeClient
  project: string
  name: string
  signal?: AbortSignal
}): Promise<ResolveByNameResult> {
  const active = await search(input.client, { project: input.project, name: input.name, signal: input.signal })
  if (active.matches.length === 1) return { type: "found", session: active.matches[0] }
  if (active.matches.length > 1) return { type: "ambiguous", name: input.name, sessions: active.matches }
  if (active.stoppedAtLimit) return { type: "too-many", name: input.name }

  const archived = await search(input.client, {
    project: input.project,
    name: input.name,
    archived: true,
    signal: input.signal,
  })
  if (archived.matches.length > 0)
    return { type: "previous-generation", name: input.name, session: archived.matches[0] }
  return { type: "not-found", name: input.name }
}

async function search(
  client: OpenCodeClient,
  input: { project: string; name: string; archived?: boolean; signal?: AbortSignal },
): Promise<Search> {
  const matches: SessionInfo[] = []
  let cursor: string | undefined
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await client.session.list(
      {
        project: input.project,
        parentID: null,
        archived: input.archived ?? false,
        search: input.name,
        order: "desc",
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      },
      ...(input.signal ? [{ signal: input.signal }] : []),
    )
    for (const session of result.data) if (session.title === input.name) matches.push(session)
    if (matches.length > 0) return { matches, stoppedAtLimit: false }
    if (!result.cursor.next || result.data.length === 0) return { matches, stoppedAtLimit: false }
    cursor = result.cursor.next
  }
  return { matches, stoppedAtLimit: true }
}
