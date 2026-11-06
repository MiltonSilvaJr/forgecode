import type { SquadLivenessReport } from "@opencode/client"

export type SessionRow = {
  readonly name: string
  readonly role: string
  readonly state: string
  readonly provider: string
  readonly model: string
  readonly variant: string | null
  readonly branch: string | null
  readonly sessionID: string | null
  readonly verdict: string
  readonly measuredAt: number
  readonly lastActivity: number | null
  readonly source: string | null
  readonly workingStale: boolean
  readonly presumedDead: boolean
  readonly cause: string | null
  readonly inboxPending: number
}

export type PreviousSessionRow = {
  readonly name: string
  readonly sessionID: string | null
  readonly state: string
}

export type PreviousGenerationRow = {
  readonly id: string
  readonly closedAt: number | null
  readonly closedBy: string | null
  readonly sessions: PreviousSessionRow[]
}

export function sessionRows(report: SquadLivenessReport): SessionRow[] {
  return report.sessions.map((session) => ({
    name: session.name,
    role: session.role,
    state: session.state,
    provider: session.provider,
    model: session.model,
    variant: session.variant ?? null,
    branch: session.branch ?? null,
    sessionID: session.sessionID ?? null,
    verdict: "idle",
    measuredAt: session.liveness.measuredAt,
    lastActivity: session.liveness.lastActivity ?? null,
    source: session.liveness.source ?? null,
    workingStale: session.liveness.workingStale,
    presumedDead: session.liveness.presumedDead,
    cause: session.liveness.cause ?? null,
    inboxPending: session.inboxPending,
  }))
}

export function findSession(rows: SessionRow[], name: string): SessionRow | undefined {
  return rows.find((row) => row.name === name)
}

export function previousGeneration(report: SquadLivenessReport): PreviousGenerationRow | null {
  if (!report.previous) return null
  return {
    id: report.previous.id,
    closedAt: report.previous.closedAt ?? null,
    closedBy: report.previous.closedBy ?? null,
    sessions: report.previous.sessions.map((session) => ({
      name: session.name,
      sessionID: session.sessionID ?? null,
      state: session.state,
    })),
  }
}
