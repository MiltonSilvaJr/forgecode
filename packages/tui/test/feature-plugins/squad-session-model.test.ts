import { expect, test } from "bun:test"
import { findSession, previousGeneration, sessionRows } from "../../src/feature-plugins/squad/session-model"
import { T0, livenessReport, sessionStatus } from "./squad-fixtures"

test("projects verdict, cause and flags verbatim per session", () => {
  const report = livenessReport({
    sessions: [
      sessionStatus({
        name: "builder-1",
        variant: "high",
        branch: "feature/x",
        sessionID: "ses_1",
        liveness: {
          verdict: "presumed_dead",
          measuredAt: T0,
          lastActivity: T0 - 60_000,
          source: "execution",
          workingStale: true,
          presumedDead: true,
          cause: "no heartbeat for 5m",
        },
        inboxPending: 2,
      }),
      sessionStatus({
        name: "builder-2",
        liveness: { verdict: "stalled", measuredAt: T0, workingStale: true, presumedDead: false },
      }),
      sessionStatus({
        name: "builder-3",
        liveness: {
          verdict: "working",
          measuredAt: T0,
          workingStale: false,
          presumedDead: false,
          cause: "deadline extension requested",
        },
      }),
    ],
  })
  const rows = sessionRows(report)
  expect(rows.length).toBe(3)

  expect(rows[0].verdict).toBe("presumed_dead")
  expect(rows[0].cause).toBe("no heartbeat for 5m")
  expect(rows[0].workingStale).toBe(true)
  expect(rows[0].presumedDead).toBe(true)
  expect(rows[0].lastActivity).toBe(T0 - 60_000)
  expect(rows[0].source).toBe("execution")
  expect(rows[0].variant).toBe("high")
  expect(rows[0].branch).toBe("feature/x")
  expect(rows[0].sessionID).toBe("ses_1")
  expect(rows[0].inboxPending).toBe(2)

  expect(rows[1].verdict).toBe("stalled")
  expect(rows[1].presumedDead).toBe(false)
  expect(rows[1].lastActivity).toBeNull()
  expect(rows[1].source).toBeNull()
  expect(rows[1].cause).toBeNull()

  // REQ-04: cause text never rewrites the verdict.
  expect(rows[2].verdict).toBe("working")
  expect(rows[2].cause).toBe("deadline extension requested")
})

test("missing optional fields become null, never the current instant", () => {
  const rows = sessionRows(livenessReport({ sessions: [sessionStatus()] }))
  expect(rows[0].lastActivity).toBeNull()
  expect(rows[0].source).toBeNull()
  expect(rows[0].cause).toBeNull()
  expect(rows[0].variant).toBeNull()
  expect(rows[0].branch).toBeNull()
  expect(rows[0].sessionID).toBeNull()
})

test("findSession resolves by exact name and misses without a match", () => {
  const rows = sessionRows(livenessReport({ sessions: [sessionStatus({ name: "builder-1" })] }))
  expect(findSession(rows, "builder-1")?.name).toBe("builder-1")
  expect(findSession(rows, "ghost")).toBeUndefined()
})

test("previous generation is a separate read-only block", () => {
  const report = livenessReport({
    previous: {
      id: "ORQ-0",
      closedAt: T0 - 3_600_000,
      closedBy: "operator",
      sessions: [
        { name: "builder-0", sessionID: "ses_0", state: "closed" },
        { name: "builder-9", state: "closed" },
      ],
    },
  })
  const previous = previousGeneration(report)
  expect(previous).not.toBeNull()
  expect(previous!.id).toBe("ORQ-0")
  expect(previous!.closedAt).toBe(T0 - 3_600_000)
  expect(previous!.closedBy).toBe("operator")
  expect(previous!.sessions.map((session) => [session.name, session.sessionID, session.state])).toEqual([
    ["builder-0", "ses_0", "closed"],
    ["builder-9", null, "closed"],
  ])
  expect(previousGeneration(livenessReport({ previous: null }))).toBeNull()
})
