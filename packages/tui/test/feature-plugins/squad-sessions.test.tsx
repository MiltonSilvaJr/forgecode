/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { SquadLivenessReport, SquadPanelCard } from "@opencode/client"
import { Sessions } from "../../src/feature-plugins/squad/sessions"
import { formatInstant } from "../../src/feature-plugins/squad/render-fields"
import { T0, contextFixture, livenessReport, panelCard, sessionStatus } from "./squad-fixtures"

function fixtureReport(): SquadLivenessReport {
  return livenessReport({
    sessions: [
      sessionStatus({
        name: "builder-1",
        role: "worker",
        provider: "anthropic",
        model: "claude",
        variant: "high",
        location: { directory: "/Users/segredo/worktree" },
        state: "verified",
        liveness: {
          verdict: "presumed_dead",
          measuredAt: T0,
          lastActivity: T0 - 120_000,
          source: "execution",
          workingStale: true,
          presumedDead: true,
          cause: "sem heartbeat há 5 minutos",
        },
        inboxPending: 2,
      }),
      sessionStatus({
        name: "builder-2",
        role: "worker",
        provider: "anthropic",
        model: "claude",
        location: { directory: "/workspace/other" },
        state: "verified",
        liveness: { verdict: "stalled", measuredAt: T0, workingStale: true, presumedDead: false },
      }),
      sessionStatus({
        name: "builder-3",
        role: "orchestrator",
        provider: "anthropic",
        model: "claude",
        location: { directory: "/workspace/orch" },
        state: "verified",
        liveness: {
          verdict: "working",
          measuredAt: T0,
          workingStale: false,
          presumedDead: false,
          cause: "deadline extension requested",
        },
      }),
    ],
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
}

function fixtureCards(): SquadPanelCard[] {
  return [
    panelCard({ id: "card-1", titulo: "Login", agente: "builder-1", coluna: "in_progress" }),
    panelCard({ id: "card-2", titulo: "Logout", agente: "ghost", coluna: "backlog" }),
  ]
}

async function renderSessions(liveness: SquadLivenessReport | null, cards: SquadPanelCard[] = []) {
  const app = await testRender(() => <Sessions liveness={liveness} cards={cards} theme={contextFixture().theme} />, {
    width: 120,
    height: 30,
  })
  await app.renderOnce()
  return app
}

test("renders distinct verdicts with cause and inbox count", async () => {
  const app = await renderSessions(fixtureReport(), fixtureCards())
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("presumed_dead")
    expect(frame).toContain("stalled")
    expect(frame).toContain("working")
    expect(frame).toContain("sem heartbeat há 5 minutos")
    expect(frame).toContain("inbox: 2")
    expect(frame).toContain(formatInstant(T0))
  } finally {
    app.renderer.destroy()
  }
})

test("missing lastActivity and source show a dash, never the current instant", async () => {
  const app = await renderSessions(fixtureReport())
  try {
    const frame = app.captureCharFrame()
    // builder-2 has no lastActivity/source; a dash is shown for both.
    expect(frame).toContain("—")
    expect(frame).not.toContain(formatInstant(T0 + 999_000))
  } finally {
    app.renderer.destroy()
  }
})

test("previous generation is a separate closed block", async () => {
  const app = await renderSessions(fixtureReport())
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("geração anterior ORQ-0")
    expect(frame).toContain(formatInstant(T0 - 3_600_000))
    expect(frame).toContain("operator")
    expect(frame).toContain("builder-0")
    expect(frame).toContain("ses_0")
    expect(frame).toContain("closed")
    expect(frame).toContain("builder-9")
  } finally {
    app.renderer.destroy()
  }
})

test("a card agent without a session shows the not-found message", async () => {
  const app = await renderSessions(fixtureReport(), fixtureCards())
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("ghost")
    expect(frame).toContain("sessão não encontrada nesta geração")
  } finally {
    app.renderer.destroy()
  }
})

test("no frame leaks session locations", async () => {
  const app = await renderSessions(fixtureReport(), fixtureCards())
  try {
    expect(app.captureCharFrame().indexOf("/Users")).toBe(-1)
  } finally {
    app.renderer.destroy()
  }
})
