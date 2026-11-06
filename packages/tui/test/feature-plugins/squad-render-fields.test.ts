import { expect, test } from "bun:test"
import {
  formatAge,
  formatInstant,
  freshnessLabel,
  renderSessionLine,
  renderStageLine,
} from "../../src/feature-plugins/squad/render-fields"
import { T0, panelDocument, sessionStatus, stage } from "./squad-fixtures"

test("renderSessionLine never exposes location, body, credential or token", () => {
  const status = {
    ...sessionStatus({
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
        cause: "no heartbeat",
      },
      inboxPending: 2,
      // REQ-08: these fields exist on the wire and must never reach the frame.
      location: { directory: "/Users/segredo/worktree" },
    }),
    body: "corpo secreto do checkpoint",
    credential: "sk-secreta",
    token: "token-secreto",
  }
  const text = renderSessionLine(status)
  expect(text.indexOf("/Users")).toBe(-1)
  expect(text.indexOf("segredo")).toBe(-1)
  expect(text.indexOf("corpo secreto")).toBe(-1)
  expect(text.indexOf("sk-secreta")).toBe(-1)
  expect(text.indexOf("token-secreto")).toBe(-1)
  // Allowlisted fields do render.
  expect(text).toContain("builder-1")
  expect(text).toContain("presumed_dead")
  expect(text).toContain("no heartbeat")
})

test("renderSessionLine renders allowlisted fields when no sensitive fields are present", () => {
  const text = renderSessionLine(
    sessionStatus({
      liveness: { verdict: "idle", measuredAt: T0, workingStale: false, presumedDead: false },
    }),
  )
  expect(text).toContain("builder-1")
  expect(text).toContain("idle")
  expect(text.indexOf("/Users")).toBe(-1)
})

test("renderStageLine renders evidence verbatim and marks exigido", () => {
  // evidence.reference is rendered verbatim: redaction is the producer's job (DD-06).
  const withEvidence = renderStageLine(
    "ci",
    stage({
      status: "verified",
      source: "ci_command",
      evidence: { type: "ci", reference: "https://ci.example/build/123", at: T0 },
    }),
    true,
  )
  expect(withEvidence).toContain("ci")
  expect(withEvidence).toContain("verified")
  expect(withEvidence).toContain("https://ci.example/build/123")
  expect(withEvidence).toContain(formatInstant(T0))
  expect(withEvidence).toContain("exigido")

  const withoutEvidence = renderStageLine("deploy", stage({ status: "unknown", source: "none" }), false)
  expect(withoutEvidence).toContain("sem evidência")
  expect(withoutEvidence).toContain("none")
  expect(withoutEvidence).toContain("não exigido")
})

test("formats age with unit and instants as ISO-8601 UTC", () => {
  expect(formatAge(T0, T0 + 90_000)).toBe("1 min")
  expect(formatAge(T0, T0 + 45_000)).toBe("45 s")
  expect(formatAge(T0, T0 + 3_600_000)).toBe("1 h")
  expect(formatInstant(T0)).toBe(new Date(T0).toISOString())
  expect(formatInstant(T0).endsWith("Z")).toBe(true)
})

test("freshnessLabel shows revisao, relative age and absolute time (DA-05)", () => {
  const label = freshnessLabel(panelDocument({ revisao: "abc123def456" }), T0 + 90_000)
  expect(label).toContain("abc123def456")
  expect(label).toContain("1 min")
  expect(label).toContain("às ")
  expect(label).toContain("Z")
})
