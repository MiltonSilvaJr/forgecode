/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { SquadLivenessReport, SquadPanelCard } from "@opencode/client"
import { CardDetail } from "../../src/feature-plugins/squad/card-detail"
import { formatInstant } from "../../src/feature-plugins/squad/render-fields"
import { T0, contextFixture, livenessReport, panelCard, sessionStatus, stage } from "./squad-fixtures"

function fixtureCard(): SquadPanelCard {
  return panelCard({
    id: "card-1",
    titulo: "Login social",
    agente: "builder-1",
    prioridade: "P1",
    refs: ["PROJ-42"],
    evidencias: ["ev-1"],
    bloqueio: "aguardando review",
    estagios: {
      jira: stage({ status: "failed", source: "jira_command" }),
      ci: stage({
        status: "verified",
        source: "ci_command",
        evidence: { type: "ci", reference: "build/123", at: T0 },
      }),
      merge: stage({ status: "unknown", source: "none" }),
      deploy: stage({ status: "unknown", source: "none" }),
      acceptance: stage({
        status: "verified",
        source: "human",
        evidence: { type: "manual", reference: "QA signoff", at: T0 + 60_000 },
      }),
    },
    exigidos: ["ci", "merge", "acceptance"],
    desconhecido: ["merge", "deploy"],
    progressa: false,
  })
}

function fixtureLiveness(): SquadLivenessReport {
  return livenessReport({
    sessions: [
      sessionStatus({
        name: "builder-1",
        location: { directory: "/Users/segredo/worktree" },
        liveness: { verdict: "idle", measuredAt: T0, workingStale: false, presumedDead: false },
      }),
    ],
  })
}

async function renderDetail(card: SquadPanelCard, liveness: SquadLivenessReport | null) {
  const app = await testRender(() => <CardDetail card={card} liveness={liveness} theme={contextFixture().theme} />, {
    width: 120,
    height: 30,
  })
  await app.renderOnce()
  return app
}

test("renders the five stages in fixed order with verbatim status, source and evidence", async () => {
  const app = await renderDetail(fixtureCard(), fixtureLiveness())
  try {
    const frame = app.captureCharFrame()
    // Stage com evidence: null mostra "sem evidência" e o source verbatim.
    expect(frame).toContain("sem evidência")
    expect(frame).toContain("não exigido")
    expect(frame).toContain("none")
    // Status como palavras: unknown nunca vira ok/idle.
    expect(frame).toContain("unknown")
    // evidence.reference verbatim e instante ISO-8601 com Z.
    expect(frame).toContain("build/123")
    expect(frame).toContain("QA signoff")
    expect(frame).toContain(formatInstant(T0))
    expect(frame).toContain(formatInstant(T0 + 60_000))
    // Ordem fixa dos estágios.
    const order = ["jira", "ci", "merge", "deploy", "acceptance"]
    const positions = order.map((key) => frame.indexOf(`${key}:`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    // desconhecido verbatim.
    expect(frame).toContain("merge, deploy")
    // Sem barra de progresso nem percentual (DA-04).
    expect(frame).not.toContain("█")
    expect(frame).not.toContain("%")
    // Campos do card.
    expect(frame).toContain("Login social")
    expect(frame).toContain("PROJ-42")
    expect(frame).toContain("aguardando review")
  } finally {
    app.renderer.destroy()
  }
})

test("links the card agent to its session by exact name", async () => {
  const app = await renderDetail(fixtureCard(), fixtureLiveness())
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("builder-1")
    expect(frame).toContain("idle")
  } finally {
    app.renderer.destroy()
  }
})

test("missing session shows the not-found message and never invents a sessionID", async () => {
  const app = await renderDetail(fixtureCard(), livenessReport({ sessions: [] }))
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("sessão não encontrada nesta geração")
    expect(frame).not.toContain("ses_")
  } finally {
    app.renderer.destroy()
  }
})

test("no frame leaks the session location", async () => {
  const app = await renderDetail(fixtureCard(), fixtureLiveness())
  try {
    expect(app.captureCharFrame().indexOf("/Users")).toBe(-1)
  } finally {
    app.renderer.destroy()
  }
})
